import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script=resolve(import.meta.dirname,'../scripts/mirror-gitlab.sh');
const git=(cwd,...args)=>{
  const run=spawnSync('git',args,{cwd,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  return run.stdout.trim();
};
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
    const success=spawnSync('bash',[script,dst],{cwd:src,encoding:'utf8'});
    assert.equal(success.status,0,success.stderr);
    assert.match(success.stdout,/SYNCHRONIZED/);
    assert.equal(git(dst,'rev-parse','refs/heads/main'),sha);
    const repeated=spawnSync('bash',[script,dst],{cwd:src,encoding:'utf8'});
    assert.equal(repeated.status,0,repeated.stderr);
    assert.match(repeated.stdout,/PARITY/);
    git(dir,'clone',dst,other);
    git(other,'config','user.name','Ultron CI');git(other,'config','user.email','ultron@example.test');
    git(other,'-c','commit.gpgsign=false','commit','--allow-empty','-m','diverge');
    git(other,'push','origin','HEAD:main');
    git(src,'-c','commit.gpgsign=false','commit','--allow-empty','-m','separate');
    const conflict=spawnSync('bash',[script,dst],{cwd:src,encoding:'utf8'});
    assert.equal(conflict.status,4);
    assert.match(conflict.stderr,/CONFLICT/);
    assert.notEqual(git(dst,'rev-parse','HEAD'),git(src,'rev-parse','HEAD'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('mirror action stays disabled until owner config and retains no checkout credential',async()=>{
  const yml=await readFile(resolve(import.meta.dirname,'../.github/workflows/gitlab-mirror.yml'),'utf8');
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
  assert.ok(yml.indexOf('Confirm independent successful Verify') <
    yml.indexOf('Verify canonical head then fast-forward GitLab'),
    'exact-main verified status must precede any token-authenticated push');

});
