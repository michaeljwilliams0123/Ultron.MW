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

/** Read recent council/owner activity without assuming the last GitHub page
 * contains the most recent council report. If history is truncated, hold
 * dispatch rather than misclassify an existing review as absent.
 */
export async function readCouncilActivity({
  issue,owner,fetchPage,fetchIssue,maxPages=10
}={}){
  if(!issue||!Number.isSafeInteger(issue.comments)||issue.comments<0||
    typeof issue.created_at!=='string'||typeof owner!=='string'||
    typeof fetchPage!=='function'||
    (fetchIssue!==undefined&&typeof fetchIssue!=='function')||
    !Number.isSafeInteger(maxPages)||
    maxPages<1||maxPages>20)
    throw Error('activity-input-invalid');
  const lastPage=Math.max(1,Math.ceil(issue.comments/100));
  // A comment can arrive after the issue metadata snapshot and create a
  // previously uncounted page. Do not certify an older report in that case.
  const overflow=await fetchPage(lastPage+1);
  if(!Array.isArray(overflow))throw Error('activity-page-invalid');
  if(overflow.length>0)return Object.freeze({complete:false,lastReviewAt:null,
    lastMeaningfulAt:issue.created_at});
  let lastReviewAt=null,lastOwnerAt=null;
  let newestBoundary=null;
  const boundary=comments=>JSON.stringify(comments.map(c=>
    [c?.id,c?.created_at,c?.updated_at]));
  const incomplete=()=>Object.freeze({complete:false,lastReviewAt:null,
    lastMeaningfulAt:issue.created_at});
  let page=lastPage,scanned=0;
  for(;page>=1&&scanned<maxPages;page--,scanned++){
    const comments=await fetchPage(page);
    if(!Array.isArray(comments))throw Error('activity-page-invalid');
    // The issue's comment count is an upper-bound snapshot. A missing
    // expected page may hide a newer owner change; never treat an older
    // council report as sufficient evidence to dispatch again.
    // A nonempty but incomplete page is also unsafe: a newer owner
    // instruction may be among the missing comments.
    const expected=issue.comments===0?0:
      page===lastPage?issue.comments-(lastPage-1)*100:100;
    if(comments.length!==expected)return incomplete();
    if(page===lastPage)newestBoundary=boundary(comments);
    for(let i=comments.length-1;i>=0;i--){
      const c=comments[i];
      if(!lastOwnerAt&&c?.user?.login===owner&&
        !/^\s*\/council\b/.test(c.body||''))lastOwnerAt=c.created_at;
      if(!lastReviewAt&&c?.user?.login==='github-actions[bot]'&&
        c.body?.startsWith('# Ultron Council Report'))lastReviewAt=c.created_at;
    }
    // GitHub comments are ascending: all earlier pages predate this report.
    if(lastReviewAt)break;
  }
  const complete=lastReviewAt!==null||page<1;
  // Reconcile against a fresh issue count and the newest comment boundary.
  // A same-count delete/replacement is invisible to the initial overflow
  // probe; neither case may authorize a stale council dispatch.
  if(complete&&fetchIssue){
    const latest=await fetchIssue();
    if(!latest||latest.comments!==issue.comments||
      latest.updated_at!==issue.updated_at)return incomplete();
    const newestAgain=await fetchPage(lastPage);
    const overflowAgain=await fetchPage(lastPage+1);
    if(!Array.isArray(newestAgain)||!Array.isArray(overflowAgain))
      throw Error('activity-page-invalid');
    if(overflowAgain.length!==0||boundary(newestAgain)!==newestBoundary)
      return incomplete();
  }
  const lastMeaningfulAt=lastOwnerAt&&
    (lastReviewAt===null||Date.parse(lastOwnerAt)>Date.parse(lastReviewAt))?
      lastOwnerAt:issue.created_at;
  return Object.freeze({complete,lastReviewAt,lastMeaningfulAt});
}
