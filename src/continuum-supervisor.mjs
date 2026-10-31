/** Zero-model, pure scheduling policy for the bounded Continuum council supervisor.
 * Calling this function never invokes an executor, grants permissions or spends credits.
 * Only the protected-main workflow may dispatch the advisory council.
 */
export const CONTINUUM_ISSUES=Object.freeze(Array.from({length:13},(_,i)=>183+i));
const allowed=new Set(CONTINUUM_ISSUES);
const parseTime=(x)=>{const t=Date.parse(x);if(!Number.isFinite(t))throw Error('time-invalid');return t;};

export function selectCouncilReviews(issues,{now=new Date().toISOString(),limit=2,refreshHours=24}={}){
  if(!Array.isArray(issues))throw Error('issues-invalid');
  if(!Number.isSafeInteger(limit)||limit<1||limit>3)throw Error('limit-invalid');
  if(!Number.isFinite(refreshHours)||refreshHours<1||refreshHours>168)throw Error('refresh-invalid');
  const current=parseTime(now);
  const seen=new Set();
  const eligible=[];
  for(const issue of issues){
    if(!issue||!allowed.has(issue.number))throw Error('out-of-scope');
    if(seen.has(issue.number))throw Error('duplicate-issue');
    seen.add(issue.number);
    if(issue.state!=='open')continue;
    const last=issue.lastReviewAt===null||issue.lastReviewAt===undefined?null:parseTime(issue.lastReviewAt);
    const changed=parseTime(issue.lastMeaningfulAt);
    if(changed>current||(last!==null&&last>current))throw Error('future-time');
    if(last===null||changed>last||current-last>=refreshHours*60*60*1000){
      eligible.push({number:issue.number,last:last??-1});
    }
  }
  eligible.sort((a,b)=>a.last-b.last||a.number-b.number);
  return Object.freeze(eligible.slice(0,limit).map(x=>x.number));
}
