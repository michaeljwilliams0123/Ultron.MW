import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiFileRequest, generateAndApplyMulti, explicitRewriteGoal } from '../src/pr-brain-multifile.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW',SHA='a'.repeat(40);
const TREE='b'.repeat(40),COMMIT='c'.repeat(40);
const paths=['docs/sample-one.md','docs/sample-two.md'];
const contents=['Alpha outcome: old\n','Beta outcome: old\n'];
const pr={head:{ref:'ultron/framework-autonomy',sha:SHA}};
function getSource(){
  return async path=>{
    if(path===ROOT+'/git/commits/'+SHA)return {tree:{sha:TREE}};
    if(path===ROOT+'/git/trees/'+TREE+'?recursive=1')
      return {truncated:false,tree:paths.map(p=>({path:p,type:'blob'}))};
    const n=paths.findIndex(p=>path===ROOT+'/contents/'+p+'?ref='+SHA);
    if(n>=0)return {sha:COMMIT,encoding:'base64',content:Buffer.from(contents[n]).toString('base64')};
    throw Error('Unexpected source '+path);
  };
}
test('multi-file command requires distinct existing source paths',()=>{
  const p=parseMultiFileRequest('implement files docs/sample-one.md, docs/sample-two.md: improve both outcomes');
  assert.equal(p.kind,'implement-multi');
  assert.deepEqual(p.paths,paths);
  for(const x of [
    'implement files docs/sample-one.md, docs/sample-one.md: duplicate source',
    'implement files docs/sample-one.md, .github/workflows/verify.yml: mutate workflow',
    'implement files docs/sample-one.md, docs/../evil.md: unsafe traversal'
  ])assert.equal(parseMultiFileRequest(x).kind,'invalid-multi');
  assert.equal(parseMultiFileRequest('implement something else'),null);
});
test('model proposes coordinated edits and applies a single atomic source commit',async()=>{
  const requested=[];
  const result=await generateAndApplyMulti({
    pr,paths,objective:'change outcome old to new in both source files',
    get:getSource(),post:async()=>{throw Error('model should not write directly')},
    model:async messages=>{
      requested.push(messages[1].content);
      const i=messages[1].content.includes('sample-one')?0:1;
      return JSON.stringify({changes:[{path:paths[i],
        before:contents[i].trim(),after:contents[i].replace('old','new').trim()}]});
    },
    apply:async({manifest})=>{
      const m=JSON.parse(manifest);
      assert.equal(m.baseSha,SHA);
      assert.deepEqual(m.changes.map(x=>x.path),paths);
      assert.ok(m.changes.every(x=>x.after.includes('new')));
      return {commitSha:COMMIT,paths:m.changes.map(x=>x.path)};
    }
  });
  assert.equal(requested.length,2);
  assert.equal(result.commitSha,COMMIT);
  assert.equal(result.rollbackChanges.length,2);
  assert.equal(result.preflight.every(x=>x.validated),true);
});
test('unsafe candidate aborts before applying any other file',async()=>{
  let applies=0;
  await assert.rejects(()=>generateAndApplyMulti({
    pr,paths,objective:'fix two files safely',
    get:getSource(),post:async()=>{},
    model:async messages=>{
      const i=messages[1].content.includes('sample-one')?0:1;
      return JSON.stringify({changes:[{path:paths[i],before:'missing-context',after:'new'}]});
    },
    apply:async()=>{applies++;return {};}
  }),/context/);
  assert.equal(applies,0);
});
test('missing source file fails before inference',async()=>{
  let calls=0;
  await assert.rejects(()=>generateAndApplyMulti({
    pr,paths:['docs/sample-one.md','docs/nonexistent.md'],objective:'fix both source files',
    get:getSource(),post:async()=>{},
    model:async()=>{calls++;return 'unused';}
  }),/not present/);
  assert.equal(calls,0);
});

test('explicit word substitution evaluator distinguishes semantic correctness from CI',()=>{
  const {from,to}=explicitRewriteGoal('rewrite each outcome line from pending to verified');
  assert.equal(from,'pending');assert.equal(to,'verified');
  assert.equal(explicitRewriteGoal('make it better'),null);
});
test('local model output that misses explicit goal gets deterministic Markdown correction',async()=>{
  const originals=['Alpha outcome: pending','Beta outcome: pending'];
  const pathsLocal=['docs/sample-one.md','docs/sample-two.md'];
  let applies=0;
  const result=await generateAndApplyMulti({
    pr,paths:pathsLocal,
    objective:'replace each outcome from pending to verified',
    get:async p=>{
      if(p===ROOT+'/git/commits/'+SHA)return {tree:{sha:TREE}};
      if(p===ROOT+'/git/trees/'+TREE+'?recursive=1')
        return {truncated:false,tree:pathsLocal.map(path=>({type:'blob',path}))};
      const i=pathsLocal.findIndex(path=>p===ROOT+'/contents/'+path+'?ref='+SHA);
      if(i>=0)return {sha:COMMIT,encoding:'base64',content:Buffer.from(originals[i]+'\n').toString('base64')};
      throw Error('Unknown source');
    },
    post:async()=>{},
    model:async messages=>{
      const i=messages[1].content.includes('sample-one')?0:1;
      return JSON.stringify({changes:[{path:pathsLocal[i],before:originals[i],after:originals[i]+'!'}]});
    },
    apply:async({manifest})=>{
      applies++;
      const m=JSON.parse(manifest);
      assert.deepEqual(m.changes.map(c=>c.after),['Alpha outcome: verified','Beta outcome: verified']);
      return {commitSha:COMMIT,paths:pathsLocal};
    }
  });
  assert.equal(applies,1);
  assert.deepEqual(result.goalAssurance.correctedPaths,pathsLocal);
  assert.equal(result.goalAssurance.mode,'explicit-substitution');
});

test('semantic miss is repaired by targeted model retry before any deterministic fallback',async()=>{
  const originals=['Alpha outcome: pending','Beta outcome: pending'];
  let calls=0,writes=0;
  const result=await generateAndApplyMulti({
    pr,paths,objective:'change each outcome from pending to verified',
    get:async p=>{
      if(p===ROOT+'/git/commits/'+SHA)return {tree:{sha:TREE}};
      if(p===ROOT+'/git/trees/'+TREE+'?recursive=1')
        return {truncated:false,tree:paths.map(path=>({type:'blob',path}))};
      const i=paths.findIndex(path=>p===ROOT+'/contents/'+path+'?ref='+SHA);
      if(i>=0)return {sha:COMMIT,encoding:'base64',content:Buffer.from(originals[i]+'\n').toString('base64')};
      throw Error('Unexpected source '+p);
    },post:async()=>{},
    model:async messages=>{
      calls++;
      const i=messages[1].content.includes('Alpha outcome')?0:1;
      return calls%2?originals[i]+'!':originals[i].replace('pending','verified');
    },
    apply:async({manifest})=>{
      writes++;
      const p=JSON.parse(manifest);
      assert.deepEqual(p.changes.map(x=>x.after),['Alpha outcome: verified','Beta outcome: verified']);
      return {commitSha:COMMIT,paths};
    }
  });
  assert.equal(calls,4);
  assert.equal(writes,1);
  assert.deepEqual(result.goalAssurance.correctedPaths,[]);
});
