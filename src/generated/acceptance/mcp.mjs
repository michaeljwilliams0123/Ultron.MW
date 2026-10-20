import { createMcpHandler } from '../../framework-integration-runtime.mjs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
export const integration = Object.freeze({"name":"acceptance","kind":"mcp","operations":["status","ci"]});
export function createHandler(options={}) { return createMcpHandler(integration,options); }
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const handle=createHandler();
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input) {
    if(!line.trim())continue;
    let reply;
    try { reply=await handle(JSON.parse(line)); }
    catch { reply={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; }
    if(reply)process.stdout.write(JSON.stringify(reply)+'\n');
  }
}
