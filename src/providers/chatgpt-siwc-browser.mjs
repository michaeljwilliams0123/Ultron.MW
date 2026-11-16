import {existsSync} from 'node:fs';
import {win32} from 'node:path';
import {platform} from 'node:os';

/** Resolve a visible authorization browser without invoking shell URL associations. */
export function resolveSiwcBrowserCommand(url,{
 os=platform(),env=process.env,exists=existsSync
}={}){
 let parsed;
 try{parsed=new URL(url)}catch{throw Error('chatgpt-plan-browser-destination-invalid')}
 if(parsed.origin!=='https://auth.openai.com'||
    parsed.pathname!=='/api/accounts/authorize'||
    parsed.searchParams.has('id_token_hint'))
  throw Error('chatgpt-plan-browser-destination-invalid');
 if(os==='win32'){
  const roots=[env.PROGRAMFILES,env['ProgramFiles(x86)'],env.LOCALAPPDATA];
  // Use Windows path rules even when tests run on a Linux CI host.
  const chrome=roots.filter(Boolean).map(root=>
   win32.join(root,'Google','Chrome','Application','chrome.exe')).find(exists);
  if(!chrome)throw Error('chatgpt-plan-chrome-unavailable');
  return {command:chrome,args:['--new-window',url],windowsHide:false};
 }
 return {command:os==='darwin'?'open':'xdg-open',
  args:[url],windowsHide:false};
}
