import { extractModelPatch, selectTargetLine, localCpuInference,
  explicitRewriteGoal, rewriteGoalMet, explicitMarkdownCorrection } from './pr-brain-model.mjs';
import { assertModelSourceSafe } from './pr-brain-safety.mjs';
import { applyPrPatch } from './pr-brain-patch.mjs';
import { capacityLimits } from './capacity.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SOURCE=/^(?:src|docs|test|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|md|json|html|css)$/;
const SHA=/^[a-f0-9]{40}$/;

/**
 * Explicit multi-file PR command. No command text can supply paths outside
 * the existing source tree, change GitHub workflows, or write to main.
 */
export function parseMultiFileRequest(text,{env=process.env}={}) {
  const limits=capacityLimits(env);
  if(typeof text!=='string')return null;
  const match=text.match(/^implement\s+files\s+([^\n:]{8,420})\s*:\s*([\s\S]{5,300})$/i);
  if(!match)return null;
  const paths=match[1].split(',').map(x=>x.trim());
  const objective=match[2].trim();
  if(paths.length<2||paths.length>limits.maxFiles||new Set(paths).size!==paths.length||
    paths.some(x=>!SOURCE.test(x)||x.split('/').some(y=>!y||y==='..'||y.startsWith('.')))||
    !objective || objective.length>limits.maxObjective)
    return {kind:'invalid-multi',error:'Use 2-'+limits.maxFiles+' distinct existing source paths and a clear objective'};
  return {kind:'implement-multi',paths,objective};
}
function decode(file,path,limits) {
  if(file?.encoding!=='base64'||!SHA.test(file?.sha||''))
    throw Error('Unverified PR source: '+path);
  const content=Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
  if(!content||Buffer.byteLength(content)>limits.maxFileBytes)
    throw Error('File exceeds bounded model context: '+path);
  return content;
}
async function readSources(pr,paths,get,limits) {
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
    const content=decode(await get(ROOT+'/contents/'+path+'?ref='+pr.head.sha),path,limits);
    sources.push({path,content});
  }
  if(sources.reduce((n,x)=>n+Buffer.byteLength(x.content),0)>limits.maxTotalBytes)
    throw Error('Multi-file context exceeds bounded CPU memory budget');
  return sources;
}
function promptFor(source,objective,goal) {
  // Prefer an exact observed old-word line over fuzzy ranking.
  const matching=goal?source.content.split('\n').filter(line=>
    wordCount(line,goal.from)>0&&line.trim().length>10):[];
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
  const limits=capacityLimits();
  const parsed=parseMultiFileRequest('implement files '+(paths||[]).join(', ')+': '+objective);
  if(parsed?.kind!=='implement-multi'||typeof model!=='function'||
    typeof apply!=='function'||typeof post!=='function')
    throw Error(parsed?.error||'Invalid multi-file code generation request');
  const sources=await readSources(pr,parsed.paths,get,limits);
  const changes=[];
  const preflights=[];
  const goal=explicitRewriteGoal(objective);
  const correctedPaths=[];
  for(const source of sources) {
    const task=promptFor(source,objective,goal);
    const common={path:source.path,head:pr.head.sha,objective,targetLine:task.target};
    let reply=await model([{role:'system',content:task.system},{role:'user',content:task.user}]);
    let manifest;
    try{manifest=extractModelPatch(reply,common);}
    catch {
      if(!task.target)throw Error('No reliable source line found in '+source.path);
      reply=await model([
        {role:'system',content:task.system},
        {role:'user',content:'Improve this exact line:\n'+task.target+
          '\nObjective: '+objective+'\nReturn only the new source line.'}
      ]);
      manifest=extractModelPatch(reply,common);
    }
    let change=JSON.parse(manifest).changes[0];
    if(goal&&!rewriteGoalMet(source.content,change,goal)){
      // A passing syntax preflight does not prove the objective. Provide
      // explicit corrective feedback to the same pinned CPU model once.
      const revision=await model([
        {role:'system',content:task.system},
        {role:'user',content:'The previous suggestion did not replace '+
          JSON.stringify(goal.from)+' with '+JSON.stringify(goal.to)+'.\n'+
          'Exact original line:\n'+task.target+'\n'+
          'Return the complete line with the requested replacement, nothing else.'}
      ]);
      try{
        const proposal=extractModelPatch(revision,common);
        const candidate=JSON.parse(proposal).changes[0];
        if(rewriteGoalMet(source.content,candidate,goal)){
          change=candidate;
          manifest=proposal;
        }
      }catch{/* Keep the existing bounded and disclosed Markdown fallback. */}
    }
    if(!rewriteGoalMet(source.content,change,goal)){
      const corrected=explicitMarkdownCorrection(source.path,source.content,task.target,goal);
      if(!corrected)
        throw Error('Model output did not satisfy explicit source objective: '+source.path);
      change=corrected;
      manifest=JSON.stringify({objective:objective.slice(0,300),baseSha:pr.head.sha,changes:[change]});
      correctedPaths.push(source.path);
    }
    const check=assertModelSourceSafe({path:source.path,original:source.content,manifest});
    changes.push(change);
    preflights.push({path:source.path,bytes:check.bytes,validated:check.validated});
  }
  const manifest=JSON.stringify({objective:objective.slice(0,300),
    baseSha:pr.head.sha,changes});
  if(manifest.length>22000)
    throw Error('Atomic multi-file manifest exceeds GitHub mutation budget');
  const result=await apply({pr,manifest,get,post});
  return {...result,rollbackChanges:changes.map(x=>({path:x.path,before:x.after,after:x.before})),
    preflight:preflights,sourcePaths:parsed.paths,
    goalAssurance:{mode:goal?'explicit-substitution':'unscored',correctedPaths},
    generatedBy:'public-CPU-ONNX-inference',model:'onnx-community/Qwen2.5-0.5B-Instruct',
    verifiedCommit:true};
}

export { explicitRewriteGoal } from './pr-brain-model.mjs';
