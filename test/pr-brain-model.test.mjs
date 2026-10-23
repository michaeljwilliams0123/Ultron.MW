import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chooseSourceForObjective,selectTargetLine,extractModelPatch,generateAndApply,
  explicitRewriteGoal,rewriteGoalMet} from '../src/pr-brain-model.mjs';
import {routePrTurn} from '../src/pr-brain.mjs';
const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SHA='a'.repeat(40),TREE='b'.repeat(40),COMMIT='c'.repeat(40);
const PR={head:{ref:'ultron/test-repair',sha:SHA},base:{ref:'main'}};
const PATH='src/utility.mjs',SOURCE='export const marker="old";\n';
function repository(){
  const calls=[];
  const get=async p=>{
    calls.push(p);
    if(p===ROOT+'/git/commits/'+SHA)return {tree:{sha:TREE}};
    if(p===ROOT+'/git/trees/'+TREE+'?recursive=1')
      return {truncated:false,tree:[{type:'blob',path:PATH},{type:'blob',path:'docs/README.md'}]};
    if(p===ROOT+'/contents/'+PATH+'?ref='+SHA)
      return {sha:COMMIT,encoding:'base64',content:Buffer.from(SOURCE).toString('base64')};
    throw Error('Unexpected source read '+p);
  };
  return {get,calls};
}
test('broad natural language implement command reaches model lane',()=>{
  assert.deepEqual(routePrTurn('@ultron implement src/utility.mjs: improve marker handling'),
    {kind:'implement',objective:'src/utility.mjs: improve marker handling'});
  assert.equal(routePrTurn('@ultron implement quick').kind,'implement');
});
test('repo-bound source selection and source patch derivation',async()=>{
  const r=repository();
  const source=await chooseSourceForObjective({objective:'Fix src/utility.mjs marker',pr:PR,get:r.get});
  assert.equal(source.path,PATH);
  assert.equal(source.content,SOURCE);
  const patch=JSON.parse(extractModelPatch('{"changes":[{"path":"src/utility.mjs","before":"old","after":"new"}]}',
    {path:PATH,head:SHA,objective:'Fix marker'}));
  assert.equal(patch.baseSha,SHA);
  assert.equal(patch.changes[0].after,'new');
  assert.throws(()=>extractModelPatch('{"changes":[{"path":"src/other.mjs","before":"old","after":"new"}]}',
    {path:PATH,head:SHA,objective:'Fix marker'}),/unscoped|valid exact-context/);
});
test('injected CPU model can propose a real patch for exact PR head without paid inference',async()=>{
  const r=repository();let called=false;
  const result=await generateAndApply({
    pr:structuredClone(PR),objective:'Fix src/utility.mjs marker',
    get:r.get,post:async()=>{throw Error('mocked apply never POSTS');},
    model:async messages=>{
      assert.match(messages[1].content,/Current source/);
      return '{"changes":[{"path":"src/utility.mjs","before":"old","after":"new"}]}';
    },
    apply:async ({manifest})=>{
      called=true;
      const p=JSON.parse(manifest);
      assert.equal(p.baseSha,SHA);
      assert.equal(p.changes.length,1);
      return {commitSha:COMMIT,paths:[PATH]};
    },
  });
  assert.equal(called,true);
  assert.equal(result.commitSha,COMMIT);
  assert.equal(result.generatedBy,'public-CPU-ONNX-inference');
});
test('public CPU inference remains default; paid provider requires an explicit variable',async()=>{
  const flow=await readFile(new URL('../.github/workflows/pr-brain.yml',import.meta.url),'utf8');
  assert.match(flow,/github.event.repository.private == false/);
  assert.match(flow,/needsPrModelRuntime/);
  assert.match(flow,/npm ci --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(flow,/npm install|package-lock=false/);
  assert.match(flow,/ULTRON_PUBLIC_CPU_INFERENCE/);
  assert.match(flow,/vars\.ULTRON_MODEL_PROVIDER != 'openai'/);
  assert.match(flow,/ULTRON_MODEL_PROVIDER: \$\{\{ vars\.ULTRON_MODEL_PROVIDER \|\| 'local-cpu' \}\}/);
  assert.match(flow,/OPENAI_API_KEY: \$\{\{ secrets\.ULTRON_OPENAI_API_KEY \}\}/);
  assert.doesNotMatch(flow,/HF_TOKEN|models: read/);
});

test('source-selected single-line output works without model JSON formatting',()=>{
  const line="  {id:'self-scan',description:'Inspect source evidence',";
  const source=line+"\n  {id:'other',description:'unrelated',";
  const target=selectTargetLine(source,'clarify self-scan source evidence');
  assert.equal(target,line);
  const manifest=JSON.parse(extractModelPatch(
    "  {id:'self-scan',description:'Inspect evidence; runtime not independently proven',",
    {path:'src/utility.mjs',head:SHA,objective:'clarify self-scan',targetLine:line}));
  assert.equal(manifest.changes[0].before,line);
  assert.match(manifest.changes[0].after,/not independently proven/);
});
test('bounded corrective retry can turn non-JSON model output into a scoped verified patch',async()=>{
  const r=repository();let count=0;
  const applied=await generateAndApply({
    pr:structuredClone(PR),objective:'Fix src/utility.mjs marker',
    get:r.get,post:async()=>{throw Error('no writes in model fixture');},
    model:async()=>{
      count++;
      return count===1?'I cannot provide the requested JSON':
        'export const marker="new";';
    },
    apply:async({manifest})=>{
      const parsed=JSON.parse(manifest);
      assert.equal(parsed.changes[0].before,'export const marker="old";');
      assert.equal(parsed.changes[0].after,'export const marker="new";');
      return {commitSha:COMMIT,paths:[PATH]};
    },
  });
  assert.equal(count,2);
  assert.equal(applied.verifiedCommit,true);
});

test('AFTER-labeled model source patch preserves exact observed line anchor',()=>{
  const r=JSON.parse(extractModelPatch('AFTER: Alpha outcome: verified',{
    path:'docs/alpha.md',head:SHA,objective:'replace pending',
    targetLine:'Alpha outcome: pending'
  }));
  assert.deepEqual(r.changes,[{path:'docs/alpha.md',
    before:'Alpha outcome: pending',after:'Alpha outcome: verified'}]);
  assert.throws(()=>extractModelPatch('AFTER: Unrelated outcome: verified',{
    path:'docs/alpha.md',head:SHA,objective:'replace pending',
    targetLine:'Alpha outcome: pending'
  }),/valid exact-context/);
  const leading=JSON.parse(extractModelPatch('Independently generated on a PR branch.',{
    path:'docs/alpha.md',head:SHA,
    objective:'change introduction from Autonomously to Independently',
    targetLine:'Autonomously generated on a PR branch.'}));
  assert.deepEqual(leading.changes,[{path:'docs/alpha.md',
    before:'Autonomously generated on a PR branch.',
    after:'Independently generated on a PR branch.'}]);
});
test('common replacement phrases receive deterministic semantic scoring',()=>{
  for(const objective of [
    'rewrite status from pending to verified',
    'replace pending with verified',
    'change pending to verified',
  ])assert.deepEqual(explicitRewriteGoal(objective),{from:'pending',to:'verified'});
  assert.equal(explicitRewriteGoal('make status better'),null);
  const goal=explicitRewriteGoal('replace pending with verified');
  assert.equal(rewriteGoalMet('Status: pending',{before:'Status: pending',
    after:'Status: verified'},goal),true);
  assert.equal(rewriteGoalMet('Status: pending',{before:'Status: pending',
    after:'Status: pending!'},goal),false);
});
test('single-file explicit goal retries the model and reports semantic assurance',async()=>{
  const r=repository();let calls=0;
  const result=await generateAndApply({
    pr:structuredClone(PR),objective:'replace old with new in src/utility.mjs',
    get:r.get,post:async()=>{},
    model:async()=>++calls===1?'export const marker="wrong";':
      'export const marker="new";',
    apply:async({manifest})=>{
      assert.equal(JSON.parse(manifest).changes[0].after,'export const marker="new";');
      return {commitSha:COMMIT,paths:[PATH]};
    },
  });
  assert.equal(calls,2);
  assert.equal(result.goalAssurance.mode,'explicit-substitution');
  assert.deepEqual(result.goalAssurance.correctedPaths,[]);
});
