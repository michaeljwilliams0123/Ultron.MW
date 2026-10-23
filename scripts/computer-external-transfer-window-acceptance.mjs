#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';

// An external network acceptance fixture, NOT an authenticated owner action.
// Only freshly generated non-sensitive canary bytes may be sent to Postman Echo.
if (process.argv.length !== 3 || process.argv[2] !== '--synthetic-public')
  throw Error('Explicit --synthetic-public required for external canary network test');

const uid = randomBytes(12).toString('hex');
const payload = 'ultron-external-transfer-canary-' + uid + '\n';
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const downloadUrl='https://httpbin.org/response-headers?Content-Disposition=attachment%3B%20filename%3Dultron-ext-canary.json';
let blockedRequests=0,redirectPosts=0,blockedOrigin=null;
const blockedServer=createServer((req,res)=>{blockedRequests++;res.writeHead(200);res.end('must not arrive');});
const server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/two'){res.end('<!doctype html><title>Second window</title><h1>Separate window fixture</h1>');return;}
  if(req.url==='/redirect-post' && req.method==='POST') {
    redirectPosts++;
    res.writeHead(302,{Location:blockedOrigin+'/exfil'});res.end();return;
  }
  if(req.url==='/redirect-form') {
    res.end('<!doctype html><title>Redirect fixture</title><h1>Blocked redirect test</h1>'+
      '<form method="POST" action="/redirect-post" enctype="multipart/form-data">'+
      '<input type="file" name="canary" id="upload">'+
      '<button id="send" type="submit">Submit bounded canary</button></form>');return;
  }
  res.end('<!doctype html><title>Transfer fixture</title><h1>Public external file transfer</h1>'+
    '<form method="POST" action="https://postman-echo.com/post" enctype="multipart/form-data">'+
    '<input type="file" name="canary" id="upload">'+
    '<button id="send" type="submit">Send canary to Postman Echo</button></form>'+
    '<a id="download" href="'+downloadUrl+'">Download external canary</a>');
});
let browser;
const temp=await mkdtemp(join(tmpdir(),'ultron-external-e2e-'));
try{
  await new Promise(ok=>blockedServer.listen(0,'127.0.0.1',ok));
  blockedOrigin='http://127.0.0.1:'+blockedServer.address().port;
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+server.address().port;
  const uploadRoot=join(temp,'owner-approved-canaries'),downloadRoot=join(temp,'download-evidence');
  await mkdir(uploadRoot);await mkdir(downloadRoot);
  const uploadPath=join(uploadRoot,'generated-canary.txt');await writeFile(uploadPath,payload);
  browser=await launchIsolatedBrowser({
    headless:false,ownerApproval:true,channel:'chrome',enableWindows:true,
    allowedOrigins:[origin,'https://postman-echo.com','https://httpbin.org'],
    uploadRoot,downloadRoot,
  });
  const contexts=browser.page.context().browser().contexts();
  assert.equal(contexts.length,2,'Expected exactly two independent browser contexts');
  const mainWindow=browser.page,extraWindow=contexts.find(x=>x!==mainWindow.context()).pages()[0];
  assert.ok(extraWindow,'Launcher must preallocate the only secondary window');
  const firstId=(await (await mainWindow.context().newCDPSession(mainWindow)).send('Browser.getWindowForTarget')).windowId;
  const secondId=(await (await extraWindow.context().newCDPSession(extraWindow)).send('Browser.getWindowForTarget')).windowId;
  assert.notEqual(firstId,secondId,'Two native Chrome windows must have distinct OS-window IDs');
  assert.equal((await mainWindow.context().cookies()).length,0);
  assert.equal((await extraWindow.context().cookies()).length,0);
  const run=async step=>{await browser.driver.perform(step);return await browser.driver.observe();};
  await run({action:'navigate',url:origin+'/'});
  assert.equal((await run({action:'window-open',windowId:'window-secondary',url:origin+'/two'})).title,'Second window');
  assert.equal((await run({action:'window-switch',windowId:'primary'})).title,'Transfer fixture');
  const upload={id:'upload-public-canary',action:'upload',selector:'#upload',filePath:uploadPath};
  assert.equal(await browser.driver.preflight(upload),true);
  const uploaded=await browser.driver.perform(upload);
  assert.equal(uploaded.verifiedEffect,true);
  const expectedHash=checksum(await readFile(uploadPath));
  assert.equal(uploaded.fileSha256,expectedHash);
  const submit={id:'submit-public-canary',action:'click',selector:'#send',
    sendToOrigin:'https://postman-echo.com'};
  assert.equal(await browser.driver.preflight(submit),true);
  const before=await browser.driver.observe();
  assert.equal(new URL(before.url).origin,origin);
  await browser.driver.perform(submit);
  const response=await browser.driver.observe();
  assert.equal(new URL(response.url).origin,'https://postman-echo.com');
  const received=JSON.parse(response.text);
  // Provider response is an independent external application readback.
  const returned=Object.values(received.files || {}).map(String).join(' ');
  const echoes=received.data || '';
  const expectedBase64=Buffer.from(payload).toString('base64');
  assert.ok(returned.includes(expectedBase64) || returned.includes(payload.trim()) ||
    String(echoes).includes(expectedBase64) || String(echoes).includes(payload.trim()),
    'External echo did not attest exact uploaded canary payload');
  await run({action:'window-switch',windowId:'window-secondary'});
  await run({action:'navigate',url:origin+'/'});
  const download={id:'download-public-canary',action:'download',
    selector:'#download',outputName:'public-external-canary.json'};
  assert.equal(await browser.driver.preflight(download),true);
  const result=await browser.driver.perform(download);
  assert.equal(result.verifiedEffect,true);
  const data=JSON.parse((await readFile(join(downloadRoot,'public-external-canary.json'))).toString());
  assert.ok(data['Content-Disposition'].includes('attachment'));
  assert.equal(result.sha256,checksum(await readFile(join(downloadRoot,'public-external-canary.json'))));
  await run({action:'window-switch',windowId:'primary'});
  await run({action:'navigate',url:origin+'/redirect-form'});
  const redirectUpload={id:'upload-redirect-canary',action:'upload',selector:'#upload',filePath:uploadPath};
  assert.equal(await browser.driver.preflight(redirectUpload),true);
  await browser.driver.perform(redirectUpload);
  const redirectSubmit={id:'send-redirect-canary',action:'click',selector:'#send'};
  assert.equal(await browser.driver.preflight(redirectSubmit),true);
  try { await browser.driver.perform(redirectSubmit); }
  catch { /* Expected aborted navigation on the forbidden redirect. */ }
  assert.equal(redirectPosts,1,'One bounded multipart POST should reach its allowed origin');
  assert.equal(blockedRequests,0,'Forbidden origin must never receive redirected bytes');
  await run({action:'window-close',windowId:'window-secondary'});
  assert.equal(mainWindow.context().pages().length,1);
  assert.equal(contexts.at(-1).pages().length,0);
  // Test output includes only generated test payload digest and booleans.
  process.stdout.write(JSON.stringify({status:'passed',realExternalPost:true,
    independentEchoReadback:true,realExternalDownload:true,sha256Upload:expectedHash,
    downloadSha256:result.sha256,distinctNativeWindowIds:true,
    isolatedBrowserContexts:true,secondaryWindowClosed:true,
    crossOriginMultipartRedirectBlocked:blockedRequests===0 && redirectPosts===1,
    credentialsUsed:false,liveOwnerApprovalUsed:false})+'\n');
}finally{
  try{if(browser)await browser.close();}finally{
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>blockedServer.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
}
