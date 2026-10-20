import { multifileLimits, velocityEnabled } from './velocity.mjs';
import { extractModelPatch, selectTargetLine, localCpuInference,
  explicitRewriteGoal, rewriteGoalMet, explicitMarkdownCorrection } from './pr-brain-model.mjs';
import { assertModelSourceSafe } from './pr-brain-safety.mjs';
import { applyPrPatch } from './pr-brain-patch.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SOURCE=/^(?:src|docs|test|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|md|json|html|css)$/;
const SHA=/^[a-f0-9]{40}$/;
const _L=multifileLimits();
const MAX_FILES=_L.maxFiles;
const MAX_FILE_BYTES=_L.maxFileBytes;
const MAX_TOTAL_BYTES=_L.maxTotalBytes;
const MAX_OBJECTIVE=_L.maxObjective;

/**
 * Explicit multi-file PR command. No command text can supply paths outside
 * the existing source tree, change GitHub workflows, or write to main.
 */
export function parseMultiFileRequest(text) {
  if(typeof text!=='string')return null;
  const match=text.match(/^implement\s+files\s+([^\n:]{8,420})\s*:\s*([\s\S]{5,300})$/i);
  if(!match)return null;
  const paths=match[1].split(',').map(x=>x.trim());
  const objective=match[2].trim();
  if(paths.length<2||paths.length>MAX_FILES||new Set(paths).size!==paths.length||
    paths.some(x=>!SOURCE.test(x)||x.split('/').some(y=>!y||y==='..'||y.startsWith('.')))||
    !objective || objective.length>MAX_OBJECTIVE)
    return {kind:'invalid-multi',error:'Use 2-'+MAX_FILES+' distinct existing source paths and a clear objective'+(velocityEnabled()?' (velocity)':'')};
  return {kind:'implement-multi',paths,objective};
}
function decode(file,path) {
  if(file?.encoding!=='base64'||!SHA.test(file?.sha||''))
    throw Error('Unverified PR source: '+path);
  const content=Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
  if(!content||Buffer.byteLength(content)>MAX_FILE_BYTES)
    throw Error('File exceeds bounded model context: '+path);
  return content;
}
async function readSources(pr,paths,get) {
  if(!SHA.test(pr?.head?.sha||'')||typeof get!=='function')
    throw Error('Invalid multi-file PR source authority');
  const commit=await get(ROOT+'/git/commits/'+pr.head.sha);
  if(!SHA.test(commit?.tree?.sha||''))throw Error('Unverified PR source commit');
  const tree=await get(ROOT+'/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree?.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>4096)
    throw Error('Incomplete PR file inventory');
  const known=new Set(tree.tree.filter(x=>x.type==='blob').map(x=>x.path));
  if(paths.some(x=>!known.has(x)))throw Error('Source path not present in current PR tree');
  const sources=[];
  for(const path of paths) {
    const content=decode(await get(ROOT+'/contents/'+path+'?ref='+pr.head.sha),path);
    sources.push({path,content});
  }
  if(sources.reduce((n,x)=>n+Buffer.byteLength(x.content),0)>MAX_TOTAL_BYTES)
    throw Error('Multi-file source exceeds total byte budget');
  return sources;
}
function buildPrompt(source,objective) {
  const goal=explicitRewriteGoal(objective)||explicitMarkdownCorrection(objective);
  const matching=goal?source.content.split(/\n/).filter(line=>line.includes(goal.from)):[];
  if(goal&&matching.length!==1)
    throw Error('Explicit objective has no unique source line: '+source.path);
  const target=goal?matching[0]:selectTargetLine(source.content,objective);
  const system='Edit an existing file. Return ONE complete corrected source line, with its original prefix and unrelated words unchanged. No JSON, fences, or explanation.';
  const directive=goal?'Replace the whole word '+JSON.stringify(goal.from)+' with '+
    JSON.stringify(goal.to)+'. The new line must NOT contain '+
    JSON.stringify(goal.from)+'.\n':'';
  const user='Objective: '+objective+'\nPath: '+source.path+'\n'+directive+
    'Exact original line:\n'+(target||'(choose an existing source line)')+
    '\nReply only with the complete corrected line:';
  return {target,system,user};
}
function wordCount(content,word) {
  return (String(content).match(new RegExp('\\b'+word+'\\b','gi'))||[]).length;
}

/** Each candidate is independently preflighted before ONE atomic multi-file commit. */
export async function generateAndApplyMulti({
  pr,paths,objective,get,post,model=localCpuInference,apply=applyPrPatch
}={}) {
  const sources=await readSources(pr,paths,get);
  const changes=[];
  for(const source of sources) {
    const {target,system,user}=buildPrompt(source,objective);
    const raw=await model({system,user});
    const patch=extractModelPatch(raw,target,source.content);
    const safe=assertModelSourceSafe({
      path:source.path,original:source.content,
      manifest:JSON.stringify({changes:[{path:source.path,before:patch.before,after:patch.after}]})
    });
    changes.push({path:source.path,before:patch.before,after:patch.after,candidate:safe.candidate});
  }
  return apply({pr,get,post,changes,message:'multi-file: '+objective.slice(0,120)});
}
export { explicitRewriteGoal } from './pr-brain-model.mjs';
