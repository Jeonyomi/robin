import { formatUnits } from "viem/utils";
import { createRpcRequest, fail, type RpcReaderOptions } from "./rpc-request";
export { RpcTransferError } from "./rpc-request";
export type { RpcReaderOptions } from "./rpc-request";
export type RpcBlock = { number: number; hash: string; timestamp: Date };
export type RpcTransfer = { blockNumber: number; blockHash: string; txHash: string; logIndex: number; tokenAddress: string; fromAddress: string; toAddress: string; rawValue: string; normalizedValue: string; timestamp: Date };
const TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const hash=(v:unknown):v is string=>typeof v==="string"&&/^0x[0-9a-fA-F]{64}$/.test(v);
const address=(v:unknown):v is string=>typeof v==="string"&&/^0x[0-9a-fA-F]{40}$/.test(v);
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
function quantity(v:unknown):number {if(typeof v!=="string"||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v))fail("MALFORMED");const n=Number(BigInt(v as string));if(!integer(n))fail("MALFORMED");return n;}
export function createRpcTransferReader(options:RpcReaderOptions={}) {
 const rpc=createRpcRequest(options),now=options.now??Date.now;
 let chain:Promise<number>|undefined;
 const chainId=()=>chain??=(async()=>{const id=quantity(await rpc.request("eth_chainId",[]));if(id!==4663)fail("CHAIN_ID");return id;})();
 const headers=new Map<number,RpcBlock>();
 function decode(value:unknown,expected?:number):RpcBlock {const b=value as Record<string,unknown>;if(!b||typeof b!=="object"||!hash(b.hash))fail("MALFORMED");const number=quantity(b.number),seconds=quantity(b.timestamp);const timestamp=new Date(seconds*1000);if((expected!==undefined&&number!==expected)||seconds<=0||!Number.isFinite(timestamp.getTime())||timestamp.getTime()>now()+60000)fail("HEADER");return {number,hash:b.hash.toLowerCase(),timestamp};}
 async function block(number:number):Promise<RpcBlock>{if(!integer(number))fail("INPUT");await chainId();const b=decode(await rpc.request("eth_getBlockByNumber",[`0x${number.toString(16)}`,false]),number);headers.set(number,b);return b;}
 return {get calls(){return rpc.calls;},chainId,block,async head():Promise<RpcBlock>{await chainId();return decode(await rpc.request("eth_getBlockByNumber",["latest",false]));},
 async range(from:number,to:number,assets:{address:string;decimals:number}[]):Promise<RpcTransfer[]> {
  if(!integer(from)||!integer(to)||to<from||to-from>=32||!Array.isArray(assets)||assets.length<1||assets.length>256)fail("INPUT");
  const known=new Map<string,number>();for(const a of assets){if(!a||!address(a.address)||!integer(a.decimals)||a.decimals>36||known.has(a.address.toLowerCase()))fail("INPUT");known.set(a.address.toLowerCase(),a.decimals);}
  await chainId();const logs=await rpc.request("eth_getLogs",[{fromBlock:`0x${from.toString(16)}`,toBlock:`0x${to.toString(16)}`,address:[...known.keys()],topics:[TOPIC]}]);
  if(!Array.isArray(logs))fail("MALFORMED");if(logs.length>2000)fail("RANGE_LIMIT");
  const rows:RpcTransfer[]=[],seen=new Map<string,string>();
  for(const l of logs){
   if(!l||l.removed!==false||!address(l.address)||!known.has(l.address.toLowerCase())||!hash(l.blockHash)||!hash(l.transactionHash)||!Array.isArray(l.topics)||l.topics.length!==3||typeof l.topics[0]!=="string"||l.topics[0].toLowerCase()!==TOPIC||!l.topics.slice(1).every((v:unknown)=>typeof v==="string"&&/^0x0{24}[0-9a-fA-F]{40}$/.test(v))||!hash(l.data))fail("MALFORMED");
   const number=quantity(l.blockNumber),index=quantity(l.logIndex);if(number<from||number>to)fail("LOG_SCOPE");
   const b=headers.get(number)??await block(number);if(b.hash!==l.blockHash.toLowerCase())fail("HEADER_HASH");
   const row:RpcTransfer={blockNumber:number,blockHash:b.hash,txHash:l.transactionHash.toLowerCase(),logIndex:index,tokenAddress:l.address.toLowerCase(),fromAddress:`0x${l.topics[1].slice(-40).toLowerCase()}`,toAddress:`0x${l.topics[2].slice(-40).toLowerCase()}`,rawValue:BigInt(l.data).toString(),normalizedValue:formatUnits(BigInt(l.data),known.get(l.address.toLowerCase())!),timestamp:b.timestamp};
   const key=`${number}:${index}`,identity=JSON.stringify(row);if(seen.has(key)){if(seen.get(key)!==identity)fail("LOG_CONFLICT");continue;}seen.set(key,identity);rows.push(row);
  } return rows;
 }};
}
