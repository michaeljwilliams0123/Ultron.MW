/**
 * Dependency-free, read-only GitHub Actions reference integrity audit.
 * Static references only: no network calls, credentials, or workflow execution.
 */
import {readdirSync,readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const EXECUTABLE=/\b(?:scripts|src|test|cloud|integrations)\/[A-Za-z0-9_./-]+\.(?:mjs|js|sh|py)\b/g;
const REUSABLE=/\buses:\s*(\.\/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml)/g;
const NAMED_TRIGGER=/\bworkflows:\s*\[([^\]]+)\]/g;

function rootPath(value){
  return value instanceof URL?fileURLToPath(value):resolve(value);
}
function confinedTarget(root,ref){
  const absolute=resolve(root,ref);
  const rel=relative(root,absolute);
  if(rel.startsWith('..'+sep)||rel==='..'||rel.startsWith(sep))return null;
  return absolute;
}
function nonblankLabel(s){
  return String(s||'').trim().replace(/^(['"])(.*)\1$/,'$2').trim();
}
export function auditWorkflowReferences(rootInput){
  const root=rootPath(rootInput);
  const directory=join(root,'.github','workflows');
  const errors=[];
  const files=readdirSync(directory).filter(f=>/\.ya?ml$/.test(f)).sort();
  const sources=new Map(files.map(f=>[f,readFileSync(join(directory,f),'utf8')]));
  const byName=new Map();
  let referencesChecked=0;

  for(const [file,content] of sources){
    const name=nonblankLabel(/^name:\s*(.+)$/m.exec(content)?.[1]);
    if(!name){errors.push(file+': missing workflow name');continue;}
    if(byName.has(name))errors.push(file+': duplicate workflow name '+name+' with '+byName.get(name));
    byName.set(name,file);
  }

  for(const [file,content] of sources){
    for(const match of content.matchAll(EXECUTABLE)){
      referencesChecked++;
      const path=match[0];
      const target=confinedTarget(root,path);
      if(!target||!existsSync(target)||!statSync(target).isFile())
        errors.push(file+': missing executable reference '+path);
    }
    for(const match of content.matchAll(REUSABLE)){
      referencesChecked++;
      const ref=match[1];
      const target=confinedTarget(root,ref);
      if(!target||!existsSync(target)){
        errors.push(file+': missing reusable workflow '+ref);
        continue;
      }
      const targetSource=readFileSync(target,'utf8');
      if(!/^  workflow_call:\s*$/m.test(targetSource))
        errors.push(file+': '+ref+' missing on.workflow_call');
    }
    for(const match of content.matchAll(NAMED_TRIGGER)){
      const list=match[1].split(',').map(nonblankLabel).filter(Boolean);
      for(const name of list){
        referencesChecked++;
        if(!byName.has(name))errors.push(file+': workflow_run refers to unknown name '+name);
      }
    }
  }
  return {workflowCount:files.length,referencesChecked,errors:errors.sort()};
}

const entry=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href;
if(entry===import.meta.url){
  const result=auditWorkflowReferences(new URL('../',import.meta.url));
  if(result.errors.length){
    for(const error of result.errors)console.error('workflow reference error: '+error);
    process.exitCode=1;
  }else console.log('Workflow integrity OK: '+result.workflowCount+
    ' workflow files; '+result.referencesChecked+' local references/trigger names verified.');
}
