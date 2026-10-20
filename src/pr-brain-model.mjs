import {applyPrPatch} from './pr-brain-patch.mjs';
import {assertModelSourceSafe} from './pr-brain-safety.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const MODEL='onnx-community/Qwen2.5-0.5B-Instruct';
const REVISION='516c8d04add8a80c5228f32102b57953b8d421a9';
const SOURCE=/^(?:src|docs|test|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|md|json|html|css)$/;
const SHA=/^[a-f0-9]{40}$/;
const MAX_SOURCE=6500;
let generatorPromise=null;

/** Pinned public model downloaded to the GitHub CPU runner: no inference API. */
export async function localCpuInference(messages){
  if(process.env.ULTRON_PUBLIC_CPU_INFERENCE!=='enabled')
    throw Error('Public CPU inference is disabled; no paid inference fallback');
  if(!generatorPromise)generatorPromise=(async()=>{
    const {env,pipeline}=await import('@huggingface/transformers');
    env.allowLocalModels=false;
    env.allowRemoteModels=true;
    return pipeline('text-generation',MODEL,{dtype:'q4',device:'cpu',revision:REVISION});
  })();
  const generator=await generatorPromise;
  const output=await generator(messages,{max_new_tokens:400,do_sample:false,
    return_full_text:true});
  const text=output?.[0]?.generated_text;
  const response=Array.isArray(text)?text.at(-1)?.content:text;
  if(typeof response!=='string'||!response.trim()||response.length>15000)
    throw Error('Local CPU model produced no valid bounded response');
  return response;
}
export function selectTargetLine(content,objective){
  if(typeof content!=='string'||typeof objective!=='string')return null;
  const ignore=new Set(['please','implement','change','update','make','code','source','that','with','does','clarify']);
  const tokens=[...new Set(objective.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)||[])]
    .filter(x=>!ignore.has(x));
  const ranked=content.split('\n').filter(x=>x.trim().length>18&&x.length<360)
    .map((line,index)=>({line,index,score:tokens.reduce((n,t)=>
      n+(line.toLowerCase().includes(t)?1:0),0)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index);
  return ranked[0]?.score>=(ranked.length===1?1:2)?ranked[0].line:null;
}
/** Recognize the small class of source objectives we can score without a model. */
export function explicitRewriteGoal(objective) {
  const text=String(objective||'');
  const match=text.match(/\b(?:from\s+([a-z][a-z0-9-]{1,39})\s+to|replace\s+([a-z][a-z0-9-]{1,39})\s+with|change\s+([a-z][a-z0-9-]{1,39})\s+to)\s+([a-z][a-z0-9-]{1,39})\b/i);
  const from=match?.[1]||match?.[2]||match?.[3],to=match?.[4];
  return from&&to&&from.toLowerCase()!==to.toLowerCase()?
    Object.freeze({from,to}):null;
}
function wordCount(content,word) {
  return (String(content).match(new RegExp('\\b'+word+'\\b','gi'))||[]).length;
}
export function rewriteGoalMet(original,change,goal) {
  if(!goal)return true;
  const after=original.replace(change.before,change.after);
  return wordCount(original,goal.from)>wordCount(after,goal.from) &&
    wordCount(after,goal.to)>wordCount(original,goal.to);
}
export function explicitMarkdownCorrection(path,content,target,goal) {
  if(!goal||!path.endsWith('.md')||typeof target!=='string')return null;
  if(wordCount(target,goal.from)!==1||content.indexOf(target)<0||
    content.indexOf(target,content.indexOf(target)+target.length)>=0)return null;
  const after=target.replace(new RegExp('\\b'+goal.from+'\\b','i'),goal.to);
  return after!==target?{path,before:target,after}:null;
}
function makeManifest(entry,{path,head,objective}){
  if(typeof entry?.before!=='string'||!entry.before||
    typeof entry.after!=='string'||!entry.after||
    entry.before===entry.after||entry.before.length>16000||
    entry.after.length>16000||entry.path!==path)
    throw Error('CPU model proposed unscoped or invalid before/after context');
  return JSON.stringify({objective:objective.slice(0,300),baseSha:head,changes:[entry]});
}
export function extractModelPatch(reply,{path,head,objective,targetLine=null}){
  if(typeof reply!=='string'||reply.length>15000||!SOURCE.test(path)||
    !SHA.test(head))throw Error('Invalid model output or source authority');
  const text=reply.replace(/\r\n/g,'\n');
  const tags=text.match(/(?:^|\n)<<<BEFORE\n([\s\S]*?)\n<<<AFTER\n([\s\S]*?)(?:\n<<<END|$)/);
  if(tags)return makeManifest({path,before:tags[1],after:tags[2]}, {path,head,objective});
  const first=text.indexOf('{'),last=text.lastIndexOf('}');
  if(first>=0&&last>first){
    try{
      const proposed=JSON.parse(text.slice(first,last+1));
      if(Array.isArray(proposed?.changes)&&proposed.changes.length===1)
        return makeManifest(proposed.changes[0],{path,head,objective});
    }catch{}
  }
  if(targetLine){
    const original=targetLine.trim();
    const prefix=original.slice(0,Math.min(8,original.length));
    const goal=explicitRewriteGoal(objective);
    const exactGoalLine=goal?original.replace(
      new RegExp('\\b'+goal.from+'\\b','i'),goal.to):null;
    const lines=text.replace(/\x60{3}[^\n]*\n?/g,'').split('\n')
      .map(x=>x.trim().replace(/^(?:AFTER|REPLACEMENT|NEW LINE)\s*:\s*/i,''))
      .filter(x=>x&&x.length<=550);
    const replacement=lines.find(x=>x!==original&&!x.startsWith('<<<')&&
      (x.startsWith(prefix)||x===exactGoalLine));
    if(replacement)return makeManifest({path,before:targetLine,
      after:(targetLine.match(/^\s*/)?.[0]||'')+replacement},
      {path,head,objective});
  }
  throw Error('CPU model did not supply a valid exact-context source patch');
}
function rankPaths(text,paths){
  const tokens=[...new Set(text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g)||[])]
    .filter(x=>!['implement','make','change','fix','please','source','the','with','code'].includes(x));
  return paths.filter(x=>SOURCE.test(x)&&
      !x.split('/').some(part=>!part||part==='..'||part.startsWith('.')))
    .map(path=>({
      path,score:tokens.reduce((n,t)=>n+(path.toLowerCase().includes(t)?2:0),0)+
        (text.toLowerCase().includes(path.toLowerCase())?50:0)+
        (path.startsWith('src/')?1:0),
    })).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
}
export async function chooseSourceForObjective({objective,pr,get}){
  if(typeof objective!=='string'||objective.length>500||
    !SHA.test(pr?.head?.sha||'')||typeof get!=='function')
    throw Error('Invalid autonomous implementation request');
  const commit=await get(ROOT+'/git/commits/'+pr.head.sha);
  if(!SHA.test(commit?.tree?.sha||''))throw Error('PR source tree unavailable');
  const tree=await get(ROOT+'/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree?.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>4096)
    throw Error('PR source inventory incomplete');
  const ranked=rankPaths(objective,tree.tree.filter(x=>x.type==='blob').map(x=>x.path));
  if(!ranked.length||ranked[0].score<2||
    (ranked.length>1&&ranked[0].score===ranked[1].score))
    throw Error('Ambiguous source target; specify a path like src/file.mjs in the request');
  const path=ranked[0].path;
  const file=await get(ROOT+'/contents/'+path+'?ref='+pr.head.sha);
  if(file?.encoding!=='base64'||!SHA.test(file.sha||''))
    throw Error('Selected source file cannot be verified at exact PR SHA');
  const content=Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
  if(!content||content.length>MAX_SOURCE)
    throw Error('Chosen file exceeds local CPU context budget; select a smaller source file');
  return {path,content};
}
export async function generateAndApply({
  pr,objective,get,post,model=localCpuInference,apply=applyPrPatch}={}){
  if(typeof model!=='function'||typeof apply!=='function')
    throw Error('Autonomous model or edit backend missing');
  const source=await chooseSourceForObjective({objective,pr,get});
  const goal=explicitRewriteGoal(objective);
  const matching=goal?source.content.split('\n').filter(line=>
    wordCount(line,goal.from)>0&&line.trim().length>10):[];
  if(goal&&matching.length!==1)
    throw Error('Explicit objective has no unique source line: '+source.path);
  const target=goal?matching[0]:selectTargetLine(source.content,objective);
  const common={path:source.path,head:pr.head.sha,objective,targetLine:target};
  const instruction='You are a code repair assistant. Output only a single replacement source line with the original JavaScript/Markdown structure. Do not output JSON, an explanation or markdown fences.';
  const prompt='Objective: '+objective+'\nFilename: '+source.path+
    '\nCurrent source:\n'+source.content+
    '\nExact target line:\n'+(target||'(pick an exact source line)')+
    '\nReply with ONLY a valid replacement line.';
  let response=await model([{role:'system',content:instruction},
    {role:'user',content:prompt}]);
  let manifest;
  try{manifest=extractModelPatch(response,common);}
  catch{
    if(!target)throw Error('No unambiguous source line for corrective generation');
    response=await model([{role:'system',content:instruction},
      {role:'user',content:'Rewrite this exact existing line, keeping its structural prefix:\n'+
        target+'\nObjective: '+objective+'\nReply with one replacement line only.'}]);
    manifest=extractModelPatch(response,common);
  }
  let parsed=JSON.parse(manifest);
  let change=parsed.changes[0];
  const correctedPaths=[];
  if(goal&&!rewriteGoalMet(source.content,change,goal)){
    const revision=await model([{role:'system',content:instruction},{role:'user',content:
      'The previous suggestion did not replace '+JSON.stringify(goal.from)+' with '+
      JSON.stringify(goal.to)+'.\nExact original line:\n'+target+
      '\nReturn the complete corrected line, nothing else.'}]);
    try{
      const candidate=JSON.parse(extractModelPatch(revision,common)).changes[0];
      if(rewriteGoalMet(source.content,candidate,goal))change=candidate;
    }catch{/* The bounded Markdown fallback below remains independently checkable. */}
  }
  if(!rewriteGoalMet(source.content,change,goal)){
    const corrected=explicitMarkdownCorrection(source.path,source.content,target,goal);
    if(!corrected)throw Error('Model output did not satisfy explicit source objective: '+source.path);
    change=corrected;
    correctedPaths.push(source.path);
  }
  manifest=JSON.stringify({objective:objective.slice(0,300),baseSha:pr.head.sha,
    changes:[change]});
  const preflight=assertModelSourceSafe({path:source.path,original:source.content,manifest});
  parsed=JSON.parse(manifest);
  const rollbackChanges=parsed.changes.map(x=>({path:x.path,before:x.after,after:x.before}));
  const result=await apply({pr,manifest,get,post});
  return {...result,rollbackChanges,preflight:{validated:preflight.validated,bytes:preflight.bytes},
    model:MODEL,modelRevision:REVISION,sourcePath:source.path,
    goalAssurance:{mode:goal?'explicit-substitution':'unscored',correctedPaths},
    generatedBy:'public-CPU-ONNX-inference',verifiedCommit:true};
}
