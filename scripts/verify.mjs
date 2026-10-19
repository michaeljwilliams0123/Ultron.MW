import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
async function sourceFiles(directory){
  const entries=await readdir(resolve(root,directory),{withFileTypes:true});
  const files=[];
  for(const entry of entries){
    const path=directory+'/'+entry.name;
    if(entry.isDirectory())files.push(...await sourceFiles(path));
    else if(/\.(mjs|js)$/.test(entry.name))files.push(path);
  }
  return files.sort();
}
function run(args){
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
for(const directory of ['src','docs','scripts','test']){
  for(const path of await sourceFiles(directory))run(['--check',path]);
}
const tests=(await sourceFiles('test')).filter(path=>path.endsWith('.test.mjs'));
run(['--test',...tests]);
