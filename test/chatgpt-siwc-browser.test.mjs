import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSiwcBrowserCommand} from '../src/providers/chatgpt-siwc-browser.mjs';

const url='https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client';

test('Windows opens the official OpenAI authorization in an explicit visible Chrome window',()=>{
 const root='C:\\Program Files';
 const wanted='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
 const spec=resolveSiwcBrowserCommand(url,{
  os:'win32',env:{PROGRAMFILES:root},
  exists:path=>path===wanted
 });
 assert.equal(spec.command,wanted);
 assert.deepEqual(spec.args,['--new-window',url]);
 assert.equal(spec.windowsHide,false);
});

test('Windows path resolution handles ProgramFiles x86 without host-dependent separators',()=>{
 const root='C:\\Program Files (x86)';
 const wanted='C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
 const r=resolveSiwcBrowserCommand(url,{
  os:'win32',env:{'ProgramFiles(x86)':root},exists:path=>path===wanted
 });
 assert.equal(r.command,wanted);
 assert.equal(r.windowsHide,false);
});

test('Windows refuses a silent browser fallback if Chrome cannot be found',()=>{
 assert.throws(()=>resolveSiwcBrowserCommand(url,{
  os:'win32',env:{PROGRAMFILES:'C:\\Missing'},exists:()=>false
 }),{message:'chatgpt-plan-chrome-unavailable'});
});

test('browser launcher only accepts the canonical OpenAI registration endpoint',()=>{
 for(const other of ['https://evil.example','http://auth.openai.com/api/accounts/authorize',
  'https://auth.openai.com/phishing']){
  assert.throws(()=>resolveSiwcBrowserCommand(other,{
   os:'win32',env:{},exists:()=>false
  }),{message:'chatgpt-plan-browser-destination-invalid'});
 }
});
