import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcTransferReader, type RpcReaderOptions } from "../../src/lib/sources/rpc-transfers";
const hash = `0x${"a".repeat(64)}`;
const address = `0x${"1".repeat(40)}`;
const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const log = { blockNumber: "0x1", blockHash: hash, transactionHash: hash, logIndex: "0x0", address, topics: [topic, `0x${"0".repeat(24)}${"2".repeat(40)}`, `0x${"0".repeat(24)}${"3".repeat(40)}`], data: `0x${(1234).toString(16).padStart(64,"0")}`, removed: false };
async function setup(transform: (method: string, result: unknown, id: number) => unknown = (_,r)=>r, options: RpcReaderOptions = {}) {
 const budgetPath = join(await mkdtemp(join(tmpdir(), "rpc-test-")), "budget.json");
 let now = 1_800_000_000_000;
 const requests: {method:string;id:number;params:Record<string,unknown>[]}[] = [];
 const fetcher = async (_: unknown, init?: RequestInit) => { const req = JSON.parse(String(init?.body)); requests.push(req); const result = req.method === "eth_chainId" ? "0x1237" : req.method === "eth_getLogs" ? [structuredClone(log)] : {number:"0x1",hash,timestamp:"0x6b49d200"}; const changed = transform(req.method,result,req.id); return changed instanceof Response ? changed : Response.json({jsonrpc:"2.0", id:req.id, result:changed}); };
 const reader = createRpcTransferReader({fetch: fetcher as typeof fetch, now:()=>now, sleep:async(ms:number)=>{now+=ms;}, budgetPath, ...options});
 return {reader, requests, budgetPath};
}
describe("RPC transfer reader",()=>{
 it("paces requests at least 1500ms apart without increasing the daily budget",async()=>{
  const {reader,budgetPath}=await setup();
  await reader.chainId();
  const first=JSON.parse(await readFile(budgetPath,"utf8"));
  await reader.head();
  const second=JSON.parse(await readFile(budgetPath,"utf8"));
  expect(second.nextStart-first.nextStart).toBeGreaterThanOrEqual(1500);
  expect(second.calls).toBe(2);
 });
 it.each([null, [{...log,removed:true}], [{...log,topics:[]}], [{...log,address:`0x${"9".repeat(40)}`}], [{...log,blockNumber:"0x2"}], [{...log,data:"0x1"}], [{...log,blockHash:`0x${"b".repeat(64)}`}], [log,{...log,data:`0x${"0".repeat(64)}`} ]].map(bad=>[bad]))("rejects malformed or unverified log scope %#",async(bad)=>{const {reader}=await setup((m,r)=>m==="eth_getLogs"?bad:r);await expect(reader.range(1,1,[{address,decimals:2}])).rejects.toThrow();});
 it("rejects wrong RPC identity and envelope",async()=>{for(const result of [Response.json({jsonrpc:"2.0",id:99,result:"0x1237"}),Response.json({jsonrpc:"1.0",id:1,result:"0x1237"}),"0x1"]){const {reader}=await setup(()=>result); await expect(reader.chainId()).rejects.toThrow();}});
 it("stops 429 and persists cooldown",async()=>{const {reader,requests,budgetPath}=await setup(()=>new Response("secret",{status:429}));await expect(reader.head()).rejects.toThrow("HTTP_429");await expect(reader.head()).rejects.toThrow();expect(requests).toHaveLength(1);const {reader:next,requests:nextRequests}=await setup(undefined,{budgetPath});await expect(next.head()).rejects.toThrow("COOLDOWN");expect(nextRequests).toHaveLength(0);});
 it("never follows redirects",async()=>{let redirect:unknown;const {reader}=await setup(undefined,{fetch:async(_:unknown,init?:RequestInit)=>{redirect=init?.redirect;return Response.json({jsonrpc:"2.0",id:1,result:"0x1237"});}});await reader.chainId();expect(redirect).toBe("error");});
 it("caches one header for a thousand events",async()=>{const {reader,requests}=await setup((m,r)=>m==="eth_getLogs"?Array.from({length:1000},(_,i)=>({...log,logIndex:`0x${i.toString(16)}`})):r);expect(await reader.range(1,1,[{address,decimals:2}])).toHaveLength(1000);expect(requests.filter(r=>r.method==="eth_getBlockByNumber")).toHaveLength(1);});
 it("caps streaming bytes",async()=>{const {reader}=await setup(()=>new Response("x".repeat(2*1024*1024+1)));await expect(reader.head()).rejects.toThrow("RESPONSE_LIMIT");});
 it("enforces calls and durable daily cap",async()=>{const {reader,budgetPath,requests}=await setup(undefined,{maxCalls:1});await reader.chainId();await expect(reader.head()).rejects.toThrow("CALL_LIMIT");expect(requests).toHaveLength(1);const state=JSON.parse(await readFile(budgetPath,"utf8"));state.calls=10000;await writeFile(budgetPath,JSON.stringify(state));const {reader:next}=await setup(undefined,{budgetPath});await expect(next.head()).rejects.toThrow("DAILY_LIMIT");});
 it("fails closed on range overflow",async()=>{const {reader}=await setup((m,r)=>m==="eth_getLogs"?Array(2001).fill(log):r);await expect(reader.range(1,1,[{address,decimals:2}])).rejects.toThrow("RANGE_LIMIT");});
 it("decodes ERC20 units and verified block time through POST",async()=>{
  const {reader,requests}=await setup();
  expect(await reader.chainId()).toBe(4663);
  expect(await reader.head()).toMatchObject({number:1,hash});
  const rows=await reader.range(1,1,[{address,decimals:2}]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({rawValue:"1234",normalizedValue:"12.34",blockHash:hash,tokenAddress:address,logIndex:0});
  expect(rows[0].timestamp).toBeInstanceOf(Date);
  expect(requests.find(r=>r.method==="eth_getLogs")?.params[0]).toMatchObject({fromBlock:"0x1",toBlock:"0x1",address:[address],topics:[topic]});
  expect(reader.calls).toBe(requests.length);
 });
});
