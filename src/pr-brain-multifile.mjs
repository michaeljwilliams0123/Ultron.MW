import { extractModelPatch, selectTargetLine, localCpuInference } from './pr-brain-model.mjs';
import { assertModelSourceSafe } from './pr-brain-safety.mjs';
import { applyPrPatch } from './pr-brain-patch.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SOURCE=/^(?:src|docs|test|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|md|json|html|css)$/;
const SHA=/^[a-f0-9]{40}$/;
const MAX_FILES=4;
const MAX_FILE_BYTES=6500;
const MAX_TOTAL_BYTES=18000;

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
    !objective || objective.length>300)
    return {kind:'invalid-multi',error:'Use 2-4 distinct existing source paths and a clear objective'};
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
    throw Error('Multi-file context exceeds bounded CPU memory budget');
  return sources;
}
function promptFor(source,objective) {
  const target=selectTargetLine(source.content,objective);
  const system='Repair this exact existing source file. Return only ONE corrected complete source line; never invent a file or claim tests passed.';
  const user='Task: '+objective+'\nPath: '+source.path+
    '\nOriginal source:\n'+source.content+
    '\nSuggested exact line:\n'+(target||'(select a line from source)')+
    '\nReturn only the replacement line.';
  return {target,system,user};
}
/** Each candidate is independently preflighted before ONE atomic multi-file commit. */
export async function generateAndApplyMulti({
  pr,paths,objective,get,post,model=localCpuInference,apply=applyPrPatch
}={}) {
  const parsed=parseMultiFileRequest('implement files '+(paths||[]).join(', ')+': '+objective);
  if(parsed?.kind!=='implement-multi'||typeof model!=='function'||
    typeof apply!=='function'||typeof post!=='function')
    throw Error(parsed?.error||'Invalid multi-file code generation request');
  const sources=await readSources(pr,parsed.paths,get);
  const changes=[];
  const preflights=[];
  for(const source of sources) {
    const task=promptFor(source,objective);
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
    const change=JSON.parse(manifest).changes[0];
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
    generatedBy:'public-CPU-ONNX-inference',model:'onnx-community/Qwen2.5-0.5B-Instruct',
    verifiedCommit:true};
}
