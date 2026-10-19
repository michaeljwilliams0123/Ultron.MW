import { createHash } from 'node:crypto';
import { readdir, lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import {readVerifiedMainCi} from './ci-evidence.mjs';

const REPO = 'michaeljwilliams0123/Ultron.MW';
const ROOT = '/repos/' + REPO;
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILES = 4096;
const MAX_TEXT = 150000;
const CHECK = Object.freeze([
  '.github/workflows/verify.yml',
  '.github/workflows/cloud-pr.yml',
  '.github/workflows/cloud-objective.yml',
  '.github/workflows/self-scan-pr.yml',
  '.github/workflows/pr-brain.yml',
  '.github/workflows/pr-brain-ci.yml',
  'src/cloud-pr.mjs',
  'src/code-pr.mjs',
  'src/self-scan-pr.mjs',
  'src/pr-brain.mjs',
  'src/pr-brain-patch.mjs',
  'src/pr-brain-ci.mjs',
  'src/ci-evidence.mjs',
  'src/pr-brain-model.mjs',
  'src/cloud-cycle.mjs',
  'docs/core/capabilities.mjs',
  'docs/core/cycle.mjs',
  'src/grokbot-governor.mjs',
  'src/cognitive-world-model.mjs',
  'src/learning.mjs',
  'src/self-observer.mjs',
  'test/cloud-pr.test.mjs',
  'test/code-pr.test.mjs',
  'test/self-scan-pr.test.mjs',
  'test/pr-brain.test.mjs',
  'test/pr-brain-patch.test.mjs',
  'test/pr-brain-ci.test.mjs',
  'test/ci-evidence.test.mjs',
  'test/pr-brain-model.test.mjs',
  'test/cloud.test.mjs',
  'test/self-observer.test.mjs',
]);
const SOURCE_CHECKS = Object.freeze({
  'docs/core/capabilities.mjs':['/self scan'],
  'docs/core/cycle.mjs':['/self scan'],
  'src/cloud-cycle.mjs':["case '/self scan':"],
  'src/cloud-pr.mjs':['launchCodePr'],
  '.github/workflows/cloud-pr.yml':['node src/cloud-pr.mjs','pull-requests: write'],
  '.github/workflows/cloud-objective.yml':['node src/cloud-entry.mjs'],
  '.github/workflows/self-scan-pr.yml':['node src/self-scan-pr.mjs','pull-requests: write'],
  'src/self-scan-pr.mjs':['publishSelfScanPr','SELF_SCAN_PATH'],
  '.github/workflows/pr-brain.yml':['node src/pr-brain.mjs','ref: main'],
  'src/pr-brain.mjs':['handlePrConversation','routePrTurn'],
  'src/pr-brain-ci.mjs':['reportCiToPr','verifiedCiReceipt'],
  'src/ci-evidence.mjs':['selectVerifiedMainCi','readVerifiedMainCi'],
  'src/pr-brain-model.mjs':['generateAndApply','localCpuInference'],
  '.github/workflows/pr-brain-ci.yml':['node src/pr-brain-ci.mjs','workflow_run:'],
  '.github/workflows/verify.yml':['node scripts/verify.mjs'],
});

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = list => [...new Set(list)].sort();
const evidence = (kind, status, sourcePath, detail) =>
  ({kind,status,sourcePath,detail});
const concern = (code, priority, detail, repair) =>
  ({code,priority,detail,repair});

/**
 * An inspectable operational self-model, not a subjective mental state.
 * Code presence is source evidence, not a live behavior or deployment proof.
 * Neither a generated assertion nor a model's opinion can count as a scan.
 */
export function evaluateSelfSnapshot({environment,observedAt,commitSha=null,treeSha=null,
  paths,sourceTexts,sourceDigest=null,ciObservation=null}={}) {
  if (!['cloud','local'].includes(environment) ||
    !Array.isArray(paths) || paths.length > MAX_FILES ||
    paths.some(p => typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..') || p.includes('\\')) ||
    new Set(paths).size !== paths.length ||
    !sourceTexts || typeof sourceTexts !== 'object' ||
    typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt)) ||
    (environment === 'cloud' && (!SHA.test(commitSha||'') || !SHA.test(treeSha||''))) ||
    (environment === 'local' && commitSha !== null))
    throw Error('Self-observation source evidence invalid');
  // Generated self-scan report must not trigger an endless PR cycle after merge.
  const inventory = unique(paths.filter(p => p !== 'reports/self-scan/current.md'));
  const pathSet = new Set(inventory);
  const sourceEvidence = [];
  const weaknesses = [];
  for (const path of CHECK) {
    const present = pathSet.has(path);
    sourceEvidence.push(evidence('source-path',present?'observed':'missing',path,
      present?'Path observed in scoped source tree':'Expected structural path not observed'));
    if (!present) weaknesses.push(concern('missing-source-path','high',path,
      'Restore the expected source/test contract or update the explicit inventory'));
  }
  for (const [path, fragments] of Object.entries(SOURCE_CHECKS)) {
    const text = sourceTexts[path];
    if (typeof text !== 'string' || !text.length || text.length > MAX_TEXT)
      throw Error('Self-observation source contents unavailable: '+path);
    const matched = fragments.every(fragment => text.includes(fragment));
    sourceEvidence.push(evidence('static-route-link',matched?'observed':'missing',path,
      matched?'Expected static routing markers observed':'Expected static route markers absent'));
    if (!matched) weaknesses.push(concern('routing-contract-gap','high',path,
      'Repair and independently verify the routing bridge at the exact source revision'));
  }
  // A file count or a deterministic test fixture is never a successful production execution.
  const counts = Object.freeze({
    allFiles: inventory.length,
    source: inventory.filter(x=>x.startsWith('src/')).length,
    tests: inventory.filter(x=>x.startsWith('test/') && x.endsWith('.test.mjs')).length,
    workflows: inventory.filter(x=>x.startsWith('.github/workflows/')).length,
  });
  if (counts.tests === 0) weaknesses.push(concern('tests-unobserved','high',
    'No test files observed','Add independent regression tests before trusting code changes'));
  weaknesses.push(concern('live-execution-unobserved','high',
    'Source inspection cannot attest a production request or response',
    'Run an authenticated end-to-end task and validate its durable result'));
  const verifiedCi=environment==='cloud'&&ciObservation?.sha===commitSha&&
    ciObservation?.schema==='ultron.ci-main.v1'&&
    Number.isSafeInteger(ciObservation.runId)&&ciObservation.runId>0&&
    ['success','failure','cancelled','timed_out','action_required','neutral','skipped']
      .includes(ciObservation.conclusion)?ciObservation:null;
  if(!verifiedCi)weaknesses.push(concern('ci-head-unobserved','medium',
    'Current-main CI conclusion was not independently verified during this scan',
    'Read exact-main GitHub Actions Verify outcome before making a CI claim'));
  else if(verifiedCi.conclusion!=='success')
    weaknesses.push(concern('ci-head-failing','high',
      'Exact-main GitHub Verify completed: '+verifiedCi.conclusion,
      'Repair the failed or blocked check and independently rerun Verify'));
  weaknesses.push(concern('learning-effect-unobserved','medium',
    'The scan has no independently scored future-task or held-out cognition outcome',
    'Compare actual realized outcomes against prior predictions before updating policy'));
  if (environment==='local') weaknesses.push(concern('git-commit-unobserved','medium',
    'Local file-system scan cannot attest a canonical GitHub commit SHA',
    'Compare local source manifest with authenticated GitHub main before claiming convergence'));
  const observations = sourceEvidence.filter(x=>x.status==='observed').length;
  const core={
    schema:'ultron.self-model.v1',kind:'operational-self-observation',
    identity:{name:'Ultron.MW',role:'single-owner agent runtime',consciousness:'not-established'},
    observedAt,environment,
    sourceAuthority:{kind:environment==='cloud'?'github-main-verified':'local-filesystem',
      commitSha,treeSha,sourceDigest,ciObservation:verifiedCi},
    inventory:counts,
    evidence:sourceEvidence,
    uncertainty:{
      sourceCoverage:sourceEvidence.length?Number((observations/sourceEvidence.length).toFixed(4)):0,
      operationalReadiness:'not-probed',
      providerReadiness:'not-probed',
      productionConvergence:'not-probed',
      independentLearningGain:'not-established',
      ciHeadReadiness:verifiedCi?.conclusion??'not-probed',
    },
    weaknesses,
    nextActions:unique(weaknesses.map(x=>x.repair)).slice(0,12),
    prediction:{
      statement:'Static route wiring suggests supported operations may be callable; actual execution remains unproven',
      status:'unvalidated',
      validation:'Independent authenticated execution with matching code revision and durable receipt',
    },
    privilege:'read-only-source-observation',
    limitation:'Operational self-description, not consciousness, AGI, model-weight training, production proof, or authorization to modify code.',
  };
  return Object.freeze({...core,fingerprint:digest(core)});
}

async function localInventory(root) {
  const base=await realpath(root);
  const paths=[];
  async function visit(rel) {
    const next=resolve(base,rel);
    const canonical=await realpath(next);
    if(canonical !== base && !canonical.startsWith(base+sep))
      throw Error('Self-scan filesystem escaped repository');
    for(const item of await readdir(canonical,{withFileTypes:true})){
      if(item.isSymbolicLink())continue;
      const part=rel ? rel+'/'+item.name:item.name;
      if(item.isDirectory()){
        await visit(part);
      } else if(item.isFile()){
        paths.push(part);
        if(paths.length>MAX_FILES)throw Error('Self-scan inventory cap exceeded');
      }
    }
  }
  for(const folder of ['src','docs','scripts','test','.github'])await visit(folder);
  for(const path of ['README.md','SECURITY.md']){
    const stat=await lstat(join(base,path));
    if(stat.isFile())paths.push(path);
  }
  return {base,paths};
}

export async function observeLocalSelf({root,now=()=>new Date().toISOString()}={}) {
  if(typeof root!=='string'||!root)throw Error('Self-scan needs a repository root');
  const {base,paths}=await localInventory(root);
  const sourceTexts={};
  for(const path of Object.keys(SOURCE_CHECKS)){
    const target=resolve(base,path);
    const canonical=await realpath(target);
    if(!canonical.startsWith(base+sep) || !(await lstat(target)).isFile())
      throw Error('Self-scan source path escaped or changed');
    const text=await readFile(target,'utf8');
    if(text.length>MAX_TEXT)throw Error('Self-scan source file too large');
    sourceTexts[path]=text;
  }
  const manifest=Object.entries(sourceTexts).sort(([a],[b])=>a.localeCompare(b));
  return evaluateSelfSnapshot({
    environment:'local',paths,sourceTexts,
    sourceDigest:digest(manifest),observedAt:now(),
  });
}

export async function observeCloudSelf({get,now=()=>new Date().toISOString()}={}) {
  if(typeof get!=='function')throw Error('Self-scan requires GitHub reader');
  const ref=await get(ROOT+'/git/ref/heads/main');
  const commitSha=ref?.object?.sha;
  if(!SHA.test(commitSha||''))throw Error('GitHub main identity unavailable');
  const commit=await get(ROOT+'/git/commits/'+commitSha);
  const treeSha=commit?.tree?.sha;
  if(!SHA.test(treeSha||''))throw Error('GitHub main tree identity unavailable');
  const tree=await get(ROOT+'/git/trees/'+treeSha+'?recursive=1');
  if(tree?.truncated !== false || !Array.isArray(tree?.tree) ||
    tree.tree.length > MAX_FILES)throw Error('GitHub source tree incomplete');
  const entries=tree.tree.filter(x=>x.type==='blob');
  if(entries.some(x=>typeof x.path!=='string'||!SHA.test(x.sha||'')))
    throw Error('GitHub source tree entries invalid');
  const paths=entries.map(x=>x.path);
  const sourceTexts={};
  for(const path of Object.keys(SOURCE_CHECKS)){
    const entry=entries.find(x=>x.path===path);
    if(!entry)throw Error('Self-scan required route file missing: '+path);
    const file=await get(ROOT+'/contents/'+path+'?ref='+commitSha);
    if(file?.encoding!=='base64' || file.sha!==entry.sha)
      throw Error('Self-scan source content SHA disagrees with the tree: '+path);
    const raw=Buffer.from(String(file.content||'').replace(/\s/g,''),'base64').toString('utf8');
    if(!raw || raw.length>MAX_TEXT)throw Error('Self-scan route file unavailable');
    sourceTexts[path]=raw;
  }
  const ciObservation=await readVerifiedMainCi({get,mainSha:commitSha});
  if((await get(ROOT+'/git/ref/heads/main'))?.object?.sha!==commitSha)
    throw Error('GitHub main changed during self-scan');
  return evaluateSelfSnapshot({
    environment:'cloud',commitSha,treeSha,paths,sourceTexts,ciObservation,
    observedAt:now(),
  });
}
