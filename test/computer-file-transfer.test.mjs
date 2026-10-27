import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeComputerPlan } from '../src/computer/executor.mjs';
import { validateUploadFile, receiveDownload } from '../src/computer/file-transfer.mjs';
const origin = 'https://example.test';

test('upload and download are typed-risk actions with bounded fields', () => {
  const p = { id:'file-bound', steps: [
    { action:'navigate', url:origin+'/files' },
    { action:'upload', selector:'input[type=file]', filePath:'C:\\Private\\approved\\data.csv',
      expect: { textIncludes:'files' } },
    { action:'download', selector:'#download', outputName:'report.csv',
      expect: { urlIncludes:'/files' } },
  ] };
  const normalized = normalizeComputerPlan(p, { allowedOrigins:[origin] });
  assert.equal(normalized.steps[1].action, 'upload');
  assert.equal(normalized.steps[2].outputName, 'report.csv');
  assert.throws(() => normalizeComputerPlan({id:'unsafe-download',steps:[
    {action:'download',selector:'#download',outputName:'../other.csv',
     expect:{urlIncludes:'/files'}}
  ]}, {allowedOrigins:[origin]}), /download|filename|output/i);
  assert.throws(() => normalizeComputerPlan({id:'missing-expect',steps:[
    {action:'upload',selector:'input[type=file]',filePath:'C:\\x\\a.csv'}
  ]}, {allowedOrigins:[origin]}), /postcondition/i);
});

test('upload requires owner-approved regular file within declared root; rejects symlinks', async t => {
  const dir = await mkdtemp(join(tmpdir(),'ultron-files-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const root=join(dir,'safe'); await mkdir(root);
  const file=join(root,'small.csv'); await writeFile(file,'a,b\n1,2\n');
  const outside=join(dir,'private.txt'); await writeFile(outside,'private');
  const result=await validateUploadFile(file,root);
  assert.equal(result.bytes,8);
  assert.equal(result.name,'small.csv');
  await assert.rejects(validateUploadFile(outside,root), /outside|root|approved/i);
  const link=join(root,'shortcut.csv');
  try {
    await symlink(outside,link);
    await assert.rejects(validateUploadFile(link,root), /symlink|link|outside/i);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.diagnostic('Windows host has no symlink-creation privilege; symlink negative test not exercised');
  }
});

test('download streams into exclusive owner directory, verifies digest, and never overwrites', async t => {
  const root=await mkdtemp(join(tmpdir(),'ultron-output-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const fake={createReadStream:async()=>Readable.from([Buffer.from('known payload')])};
  const result=await receiveDownload(fake,root,'canary.bin');
  assert.equal(result.verifiedEffect,true);
  assert.equal(result.bytes,13);
  assert.equal((await readFile(join(root,'canary.bin'))).toString(),'known payload');
  await assert.rejects(receiveDownload(fake,root,'canary.bin'), /EEXIST|exist|overwrite/i);
  assert.equal((await readFile(join(root,'canary.bin'))).toString(),'known payload');
  await assert.rejects(receiveDownload(fake,root,'../escape.bin'), /filename/i);
});

test('Playwright upload preflight binds the approved bytes before file-input dispatch', async t => {
  const dir = await mkdtemp(join(tmpdir(),'ultron-driver-upload-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const file = join(dir,'test.csv'); await writeFile(file,'a,b\n1,2\n');
  let evaluations=0, selected=0;
  const target={
    evaluate: async () => ++evaluations === 1 ? true : [{name:'test.csv',bytes:8}],
    setInputFiles: async path => { assert.equal(path,await realpath(file)); selected++; },
  };
  const page={ url:()=>origin+'/form', goto:async()=>{},
    locator:()=>target };
  const { createPlaywrightComputerDriver } = await import('../src/computer/playwright-driver.mjs');
  const driver=createPlaywrightComputerDriver(page,{uploadRoot:dir});
  const step={id:'upload-canary',action:'upload',selector:'#upload',filePath:file};
  assert.equal(await driver.preflight(step),true);
  const result=await driver.perform(step);
  assert.equal(result.verifiedEffect,true);
  assert.equal(result.bytes,8);
  assert.equal(selected,1);
  await assert.rejects(
    createPlaywrightComputerDriver(page).preflight(step),
    /approved|directory|required/i,
  );
});

test('Playwright download uses event witness and exclusive persisted file readback', async t => {
  const dir=await mkdtemp(join(tmpdir(),'ultron-driver-download-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let clickCount=0, waits=0;
  const target={click:async opts=>{if(!opts?.trial)clickCount++;}};
  const page={url:()=>origin+'/files',goto:async()=>{},
    locator:()=>target,
    waitForEvent:async name=>{assert.equal(name,'download');waits++;
      return {createReadStream:async()=>Readable.from([Buffer.from('canary data')])};},
  };
  const {createPlaywrightComputerDriver}=await import('../src/computer/playwright-driver.mjs');
  const driver=createPlaywrightComputerDriver(page,{downloadRoot:dir});
  const step={id:'download-canary',action:'download',selector:'#get',outputName:'download.txt'};
  assert.equal(await driver.preflight(step),true);
  const result=await driver.perform(step);
  assert.equal(result.verifiedEffect,true);
  assert.equal(clickCount,1);
  assert.equal(waits,1);
  assert.equal((await readFile(join(dir,'download.txt'))).toString(),'canary data');
  await assert.rejects(driver.preflight(step),/overwrite|exist/i);
});

test('oversize download is discarded rather than silently saved', async t => {
  const root=await mkdtemp(join(tmpdir(),'ultron-download-bound-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const {MAX_BROWSER_FILE_BYTES}=await import('../src/computer/file-transfer.mjs');
  const fake={createReadStream:async()=>Readable.from([Buffer.alloc(MAX_BROWSER_FILE_BYTES+1)])};
  await assert.rejects(receiveDownload(fake,root,'too-big.bin'),/bounded file size/i);
  await assert.rejects(readFile(join(root,'too-big.bin')),{code:'ENOENT'});
});

test('terminal file-risk approval redacts source path and expected assertions', async () => {
  const {summarizeComputerApproval}=await import('../src/computer/owner-console.mjs');
  const common={planId:'transfer-canary',planFingerprint:'a'.repeat(64),
    stepId:'upload-step',currentOrigin:origin,selector:'input[type=file]',
    expectedState:{textIncludes:'confidential customer name'}};
  const preview=summarizeComputerApproval({
    ...common,action:'upload',fileName:'canary.csv'
  });
  assert.equal(preview.fileName,'canary.csv');
  assert.equal(preview.risk,'send-owner-approved-file');
  assert.equal(JSON.stringify(preview).includes('confidential customer name'),false);
  assert.equal(JSON.stringify(preview).includes('C:\\private'),false);
  const dl=summarizeComputerApproval({
    ...common,action:'download',fileName:'canary-output.csv',
  });
  assert.equal(dl.risk,'write-owner-approved-local-file');
});


test('Playwright refuses file changes between owner approval and second preflight',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-upload-race-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'approved.csv');await writeFile(file,'original bytes');
 const target={evaluate:async()=>true,setInputFiles:async()=>{}};
 const page={url:()=>origin+'/files',goto:async()=>{},locator:()=>target};
 const {createPlaywrightComputerDriver}=await import('../src/computer/playwright-driver.mjs');
 const driver=createPlaywrightComputerDriver(page,{uploadRoot:dir});
 const step={id:'upload-race',action:'upload',selector:'#file',filePath:file};
 assert.equal(await driver.preflight(step),true);
 const approval=driver.approvalMetadata(step);
 assert.match(approval.fileSha256,/^[a-f0-9]{64}$/);
 assert.equal(approval.fileBytes,14);
 await writeFile(file,'modified bytes');
 await assert.rejects(driver.preflight(step),/changed after owner approval/i);
 assert.equal(driver.approvalMetadata(step).fileSha256,approval.fileSha256);
 await assert.rejects(driver.perform(step),/changed after owner approval/i);
});
