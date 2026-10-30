import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROTECTED=new Set([65,66,67,68]);
const PREFIX=/\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s*:?\s+(?:(?:michaeljwilliams0123\/Ultron\.MW)?#)(\d+)((?:\s*(?:,|and)\s*(?:(?:michaeljwilliams0123\/Ultron\.MW)?#)\d+)*)/gi;

export function findProtectedIssueClosures(message=''){
 const findings=[];
 for(const match of String(message).matchAll(PREFIX)){
  const numbers=[Number(match[1]),...[...match[2].matchAll(/#(\d+)/g)].map(x=>Number(x[1]))];
  for(const issue of numbers)if(PROTECTED.has(issue))findings.push({issue});
 }
 return findings;
}

export function inspectPullRequestClosureClaims({title='',body='',commitMessages=[]}={}){
 const sources=[['pr-title',title],['pr-body',body],
  ...commitMessages.map(msg=>['commit-message',msg])];
 return sources.flatMap(([source,text])=>
  findProtectedIssueClosures(text).map(x=>({...x,source})));
}

function main(){
 const eventPath=process.env.GITHUB_EVENT_PATH;
 if(!eventPath)throw Error('GITHUB_EVENT_PATH required in pull-request CI');
 const event=JSON.parse(readFileSync(eventPath,'utf8'));
 if(!event.pull_request)throw Error('pull_request event required');
 const base=process.env.BASE_SHA,head=process.env.CANDIDATE_SHA;
 if(!/^[a-f0-9]{40}$/.test(base||'')||!/^[a-f0-9]{40}$/.test(head||''))
  throw Error('Exact base and head SHA required');
 const commits=execFileSync('git',['log','--format=%B%x00',base+'..'+head],{
  encoding:'utf8',maxBuffer:1024*1024
 }).split('\0').filter(Boolean);
 const violations=inspectPullRequestClosureClaims({
  title:event.pull_request.title,
  body:event.pull_request.body,
  commitMessages:commits
 });
 if(violations.length){
  console.error('Protected acceptance issues may be closed only after separately validated acceptance.');
  for(const {issue,source} of violations)console.error('Forbidden GitHub auto-close: #'+issue+' via '+source);
  console.error('Use "Refs #65" or a neutral reference, then explicitly close the issue after independent evidence.');
  process.exitCode=1;
 }else console.log('Protected acceptance-issue auto-close guard: PASS');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main()}catch(e){console.error('Protected closure guard unable to verify: '+(e.code||e.message));process.exitCode=1}
}
