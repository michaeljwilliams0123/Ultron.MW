import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {legacyView} from './workflow-lane-view.mjs';

const script=resolve(import.meta.dirname,'../scripts/mirror-gitlab.sh');
// Hosts may set safe.bareRepository=explicit; these tests only use their own temp bare repos.
Object.assign(process.env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.bareRepository',GIT_CONFIG_VALUE_0:'all'});
const bash=process.platform==='win32' ? [
  process.env.BASH,
  process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Programs/Git/bin/bash.exe'),
  process.env.ProgramFiles&&join(process.env.ProgramFiles,'Git/bin/bash.exe'),
].find(value=>value&&existsSync(value))||'bash' : 'bash';
const git=(cwd,...args)=>{
  const run=spawnSync('git',args,{cwd,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  return run.stdout.trim();
};
const bareGit=(cwd,...args)=>git(cwd,'--git-dir=.',...args);
test('mirror fast-forwards exactly, is idempotent, and never overwrites divergence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ultron-mirror-'));
  const src=join(dir,'source'),dst=join(dir,'mirror.git'),other=join(dir,'other');
  try{
    git(dir,'init','-b','main','source');
    git(src,'config','user.name','Ultron CI');git(src,'config','user.email','ultron@example.test');
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','initial');
    git(dir,'clone','--bare',src,dst);
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','next');
    const sha=git(src,'rev-parse','HEAD');
    const success=spawnSync(bash,[script,dst],{cwd:src,encoding:'utf8'});
    assert.equal(success.status,0,success.stderr);
    assert.match(success.stdout,/SYNCHRONIZED/);
    assert.equal(bareGit(dst,'rev-parse','refs/heads/main'),sha);
    const repeated=spawnSync(bash,[script,dst],{cwd:src,encoding:'utf8'});
    assert.equal(repeated.status,0,repeated.stderr);
    assert.match(repeated.stdout,/PARITY/);
    git(dir,'clone',dst,other);
    git(other,'config','user.name','Ultron CI');git(other,'config','user.email','ultron@example.test');
    git(other,'-c','commit.gpgsign=false','commit','--allow-empty','-m','diverge');
    git(other,'push','origin','HEAD:main');
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','separate');
    const conflict=spawnSync(bash,[script,dst],{cwd:src,encoding:'utf8'});
    assert.equal(conflict.status,4);
    assert.match(conflict.stderr,/CONFLICT/);
    assert.notEqual(bareGit(dst,'rev-parse','HEAD'),git(src,'rev-parse','HEAD'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('a superseded verified source exits neutrally without mutating the mirror',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ultron-mirror-race-'));
  const src=join(dir,'source'),dst=join(dir,'mirror.git');
  const canonical=join(dir,'canonical.git'),updater=join(dir,'updater');
  try{
    git(dir,'init','-b','main','source');
    git(src,'config','user.name','Ultron CI');git(src,'config','user.email','ultron@example.test');
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','initial');
    git(dir,'clone','--bare',src,dst);
    const mirrorBefore=bareGit(dst,'rev-parse','refs/heads/main');

    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','verified candidate');
    const staleSource=git(src,'rev-parse','HEAD');
    git(dir,'clone','--bare',src,canonical);
    git(dir,'clone',canonical,updater);
    git(updater,'config','user.name','Ultron Main');git(updater,'config','user.email','main@example.test');
    git(updater,'-c','commit.gpgsign=false','commit','--allow-empty','-m','newer main');
    git(updater,'push','origin','HEAD:main');
    const currentMain=bareGit(canonical,'rev-parse','refs/heads/main');
    assert.notEqual(currentMain,staleSource);

    const run=spawnSync(bash,[script,dst,canonical],{cwd:src,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/SUPERSEDED/);
    assert.equal(bareGit(dst,'rev-parse','refs/heads/main'),mirrorBefore,
      'an obsolete run must not publish its older verified commit');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('an unreadable canonical main fails closed without mutating the mirror',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ultron-mirror-unreadable-'));
  const src=join(dir,'source'),dst=join(dir,'mirror.git');
  const missing=join(dir,'missing-canonical.git');
  try{
    git(dir,'init','-b','main','source');
    git(src,'config','user.name','Ultron CI');git(src,'config','user.email','ultron@example.test');
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','initial');
    git(dir,'clone','--bare',src,dst);
    const mirrorBefore=bareGit(dst,'rev-parse','refs/heads/main');
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','candidate');

    const run=spawnSync(bash,[script,dst,missing],{cwd:src,encoding:'utf8'});
    assert.equal(run.status,6);
    assert.match(run.stderr,/canonical main missing or unreadable/i);
    assert.equal(bareGit(dst,'rev-parse','refs/heads/main'),mirrorBefore);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('mirror action stays disabled until owner config and retains no checkout credential',async()=>{
  const yml=legacyView('gitlab-mirror.yml');
  assert.match(yml,/ULTRON_GITLAB_MIRROR_ENABLED == 'true'/);
  assert.match(yml,/github\.event\.workflow_run\.event == 'push'/);
  assert.match(yml,/persist-credentials: false/);
  assert.doesNotMatch(yml,/\bforce-push\b|git push -f|--force(?!-)/);
  assert.match(yml,/ULTRON_GITLAB_MIRROR_TOKEN/);
  assert.match(yml,/actions: read/);
  assert.match(yml,/actions\/workflows\/verify\.yml\/runs\?branch=main&event=push/);
  assert.match(yml,/\.head_sha == /);
  assert.match(yml,/\.conclusion == /);
  assert.match(yml,/\.status == /);
  assert.match(yml,/BLOCKED: no successful independent main Verify/);
  assert.match(yml,/bash scripts\/mirror-gitlab\.sh https:\/\/gitlab\.com\/michaelj\.williams0123\/Ultron\.MW\.git https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\.git/);
  assert.doesNotMatch(yml,/BLOCKED: exact-head GitHub main changed since verification/);
  assert.ok(yml.indexOf('Confirm independent successful Verify') <
    yml.indexOf('Verify canonical head then fast-forward GitLab'),
    'exact-main verified status must precede any token-authenticated push');

});
