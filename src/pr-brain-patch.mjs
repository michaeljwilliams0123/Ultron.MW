import { githubRequest } from './cloud-pr.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const PATH=/^(?:src|docs|test|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|json|md|html|css)$/;
const MAX_BODY=22000;
const MAX_FILE=16000;

/**
 * Atomically commit owner-authored, exact-context code edits on an Ultron PR
 * head. Never merges, never writes to main, and never changes workflow policy.
 * No model-generated code is claimed without an actual provider.
 */
export async function applyPrPatch({pr,manifest,get,post,
  updateRef=(path,body)=>githubRequest(path,{method:'PATCH',body})}={}){
  if(typeof manifest!=='string'||manifest.length>MAX_BODY||
    typeof get!=='function'||typeof post!=='function'||typeof updateRef!=='function')
    throw Error('Invalid PR patch input');
  let patch;
  try{patch=JSON.parse(manifest);}catch{throw Error('Patch must be valid JSON');}
  const paths=new Set();
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||
    Object.keys(patch).sort().join(',')!=='baseSha,changes,objective'||
    typeof patch.objective!=='string'||!patch.objective.trim()||
    patch.objective.length>300||!SHA.test(patch.baseSha||'')||
    !Array.isArray(patch.changes)||patch.changes.length<1||
    patch.changes.length>6||!pr?.head?.ref?.startsWith('ultron/')||
    pr.head.repo?.full_name!=='michaeljwilliams0123/Ultron.MW'||
    pr.base.ref!=='main'||patch.baseSha!==pr.head.sha)
    throw Error('PR patch requires exact head, objective and 1-6 source edits');
  const branch=pr.head.ref,head=pr.head.sha;
  const ref=ROOT+'/git/ref/heads/'+branch;
  if((await get(ref))?.object?.sha!==head)
    throw Error('PR head changed before patch admission');
  const commit=await get(ROOT+'/git/commits/'+head);
  if(!SHA.test(commit?.tree?.sha||''))throw Error('Cannot verify PR source tree');
  const changed=[];
  for(const item of patch.changes){
    const path=item?.path;
    if(typeof path!=='string'||!PATH.test(path)||
      path.split('/').some(s=>!s||s==='..'||s.startsWith('.'))||
      paths.has(path)||typeof item.before!=='string'||!item.before||
      item.before.length>MAX_FILE||typeof item.after!=='string'||
      item.after.length>MAX_FILE||item.after===item.before||
      Object.keys(item).sort().join(',')!=='after,before,path')
      throw Error('Patch path or exact-context edit rejected');
    paths.add(path);
    const file=await get(ROOT+'/contents/'+path+'?ref='+head);
    if(file?.encoding!=='base64'||!SHA.test(file.sha||''))
      throw Error('Patch source file unavailable at exact head');
    const original=Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
    const first=original.indexOf(item.before);
    if(first<0||original.indexOf(item.before,first+item.before.length)>=0)
      throw Error('Patch context missing or ambiguous: '+path);
    const content=original.slice(0,first)+item.after+
      original.slice(first+item.before.length);
    if(content===original||content.length>MAX_FILE*6)
      throw Error('Patch produced unchanged or oversized source');
    changed.push({path,content});
  }
  if((await get(ref))?.object?.sha!==head)
    throw Error('PR source changed during patch preparation');
  const blobs=[];
  for(const item of changed){
    const blob=await post(ROOT+'/git/blobs',{content:item.content,encoding:'utf-8'});
    if(!SHA.test(blob?.sha||''))throw Error('Patch Git blob not verified');
    blobs.push({path:item.path,mode:'100644',type:'blob',sha:blob.sha});
  }
  const tree=await post(ROOT+'/git/trees',{base_tree:commit.tree.sha,tree:blobs});
  if(!SHA.test(tree?.sha||'')||tree.sha===commit.tree.sha)
    throw Error('Patch tree not materially different');
  const next=await post(ROOT+'/git/commits',{
    message:'fix: Ultron PR conversation patch - '+patch.objective.slice(0,60),
    tree:tree.sha,parents:[head]});
  if(!SHA.test(next?.sha||''))throw Error('Patch commit unavailable');
  if((await get(ref))?.object?.sha!==head)
    throw Error('PR source advanced; leave patch commit unreferenced');
  const updated=await updateRef(ref,{sha:next.sha,force:false});
  if(updated?.object?.sha!==next.sha||(await get(ref))?.object?.sha!==next.sha)
    throw Error('PR head commit readback failed');
  for(const item of changed){
    const file=await get(ROOT+'/contents/'+item.path+'?ref='+next.sha);
    if(file?.encoding!=='base64'||Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8')!==item.content)
      throw Error('Patch source-byte readback mismatch: '+item.path);
  }
  return {commitSha:next.sha,paths:changed.map(x=>x.path),objective:patch.objective};
}
