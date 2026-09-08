import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getChain } from "../config/index";
export class RpcTransferError extends Error {
 readonly code: string;
 constructor(code: string) { super(code); this.name = "RpcTransferError"; this.code = code; }
}
export function fail(code: string): never { throw new RpcTransferError(code); }
export type RpcReaderOptions = { fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; budgetPath?: string; maxCalls?: number };
type Budget = { day: string; calls: number; nextStart: number; cooldownUntil: number };
async function budget<T>(file: string, now: number, change: (s: Budget) => T): Promise<T> {
 const lock = `${file}.lock`, temp = `${file}.${randomUUID()}.tmp`;
 let handle;
 try {
  await mkdir(dirname(file), {recursive:true}); handle = await open(lock,"wx",0o600);
  let s: Budget;
  try {
   if((await stat(file)).size>4096) fail("STATE"); s=JSON.parse(await readFile(file,"utf8"));
   if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.day) || ![s.calls,s.nextStart,s.cooldownUntil].every(x=>Number.isSafeInteger(x)&&x>=0)) fail("STATE");
  } catch(e) { if((e as NodeJS.ErrnoException).code!=="ENOENT") throw e; s={day:new Date(now).toISOString().slice(0,10),calls:0,nextStart:0,cooldownUntil:0}; }
  const result=change(s);
  const out=await open(temp,"wx",0o600); try {await out.writeFile(JSON.stringify(s));await out.sync();} finally {await out.close();}
  await rename(temp,file); return result;
 } catch(e) {if(e instanceof RpcTransferError) throw e; return fail("STATE");}
 finally {if(handle){await handle.close().catch(()=>{});await unlink(lock).catch(()=>{});}await unlink(temp).catch(()=>{});}
}
export function createRpcRequest(options: RpcReaderOptions={}) {
 const now=options.now??Date.now, sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))), fetcher=options.fetch??fetch;
 const started=now(), realStarted=Date.now(), file=options.budgetPath??join(process.cwd(),"data","rpc-transfer-budget.json");
 let calls=0, stopped=false, queue:Promise<unknown>=Promise.resolve();
 const remaining=()=>Math.min(120000-(now()-started),120000-(Date.now()-realStarted));
 async function run(method:string,params:unknown[]) {
  if(stopped) fail("STOPPED"); if(remaining()<=0) fail("DEADLINE");
  if(calls>=Math.min(96,options.maxCalls??96)) fail("CALL_LIMIT");
  let endpoint:string; try {const chain=getChain();if(chain.id!==4663) fail("CHAIN_ID"); endpoint=chain.rpcUrl;}catch(e){if(e instanceof RpcTransferError)throw e;return fail("CONFIG");}
  const wait=await budget(file,now(),s=>{const day=new Date(now()).toISOString().slice(0,10);if(s.cooldownUntil>now())fail("COOLDOWN");if(s.day!==day){s.day=day;s.calls=0;}if(s.calls>=10000)fail("DAILY_LIMIT");const wait=Math.max(0,s.nextStart-now());if(wait>=remaining())fail("DEADLINE");s.calls++;s.nextStart=now()+wait+350;return wait;});
  await sleep(wait); if(remaining()<=0)fail("DEADLINE"); calls++;
  const id=calls, controller=new AbortController();
  let timer:ReturnType<typeof setTimeout> | undefined;
  const work=async()=>{
   const response=await fetcher(endpoint,{method:"POST",redirect:"error",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params}),signal:controller.signal});
   if(response.status===403||response.status===429){stopped=true;const retry=response.headers.get("retry-after");let delay=response.status===403?900000:60000;if(response.status===429&&retry){const parsed=/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now();if(Number.isFinite(parsed)&&parsed>0)delay=Math.max(delay,parsed);}await budget(file,now(),s=>{s.cooldownUntil=Math.max(s.cooldownUntil,now()+delay);});void response.body?.cancel().catch(()=>{});fail(`HTTP_${response.status}`);}
   if(!response.ok){void response.body?.cancel().catch(()=>{});fail(`HTTP_${response.status}`);}
   if(!response.body)fail("ENVELOPE");const stream=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const part=await stream.read();if(part.done)break;size+=part.value.byteLength;if(size>2097152){void stream.cancel().catch(()=>{});fail("RESPONSE_LIMIT");}chunks.push(part.value);}}finally{stream.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   let value;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{fail("ENVELOPE");}
   if(!value||Array.isArray(value)||value.jsonrpc!=="2.0"||value.id!==id)fail("ENVELOPE");
   if("error" in value){stopped=true;if(value.error?.code===-32005||value.error?.code===-32016){await budget(file,now(),s=>{s.cooldownUntil=Math.max(s.cooldownUntil,now()+60000);});fail("RPC_LIMIT");}fail("RPC_ERROR");}
   if(!("result" in value)||value.result===null||value.result===undefined)fail("ENVELOPE");return value.result;
  };
  try {return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new RpcTransferError("TIMEOUT"));},Math.min(12000,remaining()));})]);}
  catch(e){if(e instanceof RpcTransferError)throw e;return fail("TRANSPORT");}finally{if(timer)clearTimeout(timer);controller.abort();}
 }
 return {get calls(){return calls;},request(method:string,params:unknown[]):Promise<unknown>{const task=queue.then(()=>run(method,params));queue=task.catch(()=>{});return task;}};
}
