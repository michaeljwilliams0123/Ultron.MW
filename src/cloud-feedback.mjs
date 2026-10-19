import { createHash } from 'node:crypto';

/**
 * GitHub-hosted, evidence-only learning. A result rating is public GitHub
 * comment data, not an authenticated private chat, model training, or proof
 * of general-purpose cognition. No policy can grant execution authority.
 */
export const FEEDBACK_MARKER = 'ULTRON_FEEDBACK_V1';
const MIN_RATINGS=16;
const COMMANDS=new Set(['/help','/system status','/repo inspect','/learning status']);
const feedbackPattern=/^ULTRON_FEEDBACK_V1\nrun:([0-9]{1,32}):([1-9][0-9]{0,5})\nrating:(helpful|not-helpful)$/;

export function parseOwnerFeedback(comment, owner='michaeljwilliams0123') {
  if (comment?.user?.login!==owner || typeof comment?.body!=='string' ||
    !Number.isSafeInteger(comment?.id) || !Number.isFinite(Date.parse(comment?.created_at))) return null;
  const found=comment.body.trim().match(feedbackPattern);
  return found ? { commentId:comment.id, at:comment.created_at,
    key:found[1]+':'+Number(found[2]), rating:found[3] } : null;
}

function normalizedCommand(receipt) {
  if (receipt?.status!=='succeeded' || !Array.isArray(receipt?.receipts) ||
    receipt.receipts.length!==1) return null;
  const item=receipt.receipts[0];
  return item?.status==='succeeded' && COMMANDS.has(item.command) ? item.command : null;
}

/** Bind a rating to an observed, newer-than-receipt owner comment. */
export function joinCloudFeedback({ issueNumber, attempts=[], comments=[],
  owner='michaeljwilliams0123' }={}) {
  const candidates=[];
  const ratings=comments.map(c=>parseOwnerFeedback(c,owner)).filter(Boolean);
  for(const item of attempts){
    const receipt=item.receipt;
    const command=normalizedCommand(receipt);
    if(!command || receipt.issueNumber!==issueNumber ||
      !/^[0-9]{1,32}$/.test(receipt.runId||'') ||
      !Number.isSafeInteger(receipt.runAttempt) || receipt.runAttempt<1)continue;
    const key=receipt.runId+':'+receipt.runAttempt;
    if(key!==item.key || !Number.isSafeInteger(item.comment?.id) ||
      !Number.isFinite(Date.parse(item.comment?.created_at))) continue;
    const after=ratings.filter(r=>r.key===key &&
      r.commentId>item.comment.id &&
      Date.parse(r.at)>=Date.parse(item.comment.created_at))
      .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.commentId-b.commentId);
    if(!after.length)continue;
    const last=after.at(-1);
    candidates.push({ issueNumber, command, rating:last.rating, at:last.at,
      receiptKey:key, receiptCommentId:item.comment.id,
      feedbackCommentId:last.commentId });
  }
  return candidates;
}

/**
 * Real-owner-labeled command usefulness evaluator. Predicting whether a
 * supported command is worth recommending never adds or removes authority.
 * The newest chronological quarter is held out from training and tuning.
 */
export function evaluateCloudFeedback(records) {
  const unique=[...new Map((Array.isArray(records)?records:[])
    .filter(x=>Number.isSafeInteger(x.issueNumber)&&x.issueNumber>0 &&
      COMMANDS.has(x.command) && ['helpful','not-helpful'].includes(x.rating) &&
      Number.isFinite(Date.parse(x.at)))
    .map(x=>[x.issueNumber,x])).values()]
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.issueNumber-b.issueNumber);
  const hash=createHash('sha256').update(JSON.stringify(unique.map(x=>[
    x.issueNumber,x.command,x.rating,x.receiptKey,x.feedbackCommentId
  ]))).digest('hex');
  const base={schema:'ultron.cloud.feedback-evaluation.v1',
    status:'insufficient-evidence',qualifiedExperiences:unique.length,
    required:MIN_RATINGS,evidenceHash:hash,training:0,heldout:0,
    adopted:false,activeVersion:'baseline',candidate:null,
    authority:'advisory-only',modelTraining:false };
  if(unique.length<MIN_RATINGS)return base;
  const heldout=Math.max(4,Math.ceil(unique.length*.25));
  const training=unique.slice(0,-heldout),evaluation=unique.slice(-heldout);
  const pos=training.filter(x=>x.rating==='helpful').length;
  const neg=training.filter(x=>x.rating==='not-helpful').length;
  if(pos<6 || neg<4 || !evaluation.some(x=>x.rating==='helpful') ||
    !evaluation.some(x=>x.rating==='not-helpful'))
    return {...base,status:'insufficient-diversity',training:training.length,
      heldout:evaluation.length,positive:pos,negative:neg};
  const score=new Map();
  for(const item of training) {
    const record=score.get(item.command)||{helpful:0,notHelpful:0};
    if(item.rating==='helpful')record.helpful++;else record.notHelpful++;
    score.set(item.command,record);
  }
  const cautionCommands=[...score.entries()].filter(([,x])=>
    x.notHelpful>=3 && x.notHelpful/(x.helpful+x.notHelpful)>=.6).map(([c])=>c).sort();
  const predict=command=>cautionCommands.includes(command)?'caution':'normal';
  let beforeCorrect=0,afterCorrect=0,regressions=0;
  for(const item of evaluation){
    const expected=item.rating==='helpful'?'normal':'caution';
    if(expected==='normal')beforeCorrect++;
    if(predict(item.command)===expected)afterCorrect++;
    if(expected==='normal' && predict(item.command)==='caution')regressions++;
  }
  const baselineAccuracy=beforeCorrect/evaluation.length;
  const candidateAccuracy=afterCorrect/evaluation.length;
  const delta=candidateAccuracy-baselineAccuracy;
  const passed=delta>=.05 && regressions===0 && cautionCommands.length>0;
  const candidateVersion='cloud-suggestions-'+hash.slice(0,12);
  return {...base,status:passed?'validated':'rejected',
    training:training.length,heldout:evaluation.length,
    baselineAccuracy,candidateAccuracy,delta,regressions,
    adopted:passed,activeVersion:passed?candidateVersion:'baseline',
    candidate:passed?{version:candidateVersion,cautionCommands}:null,
    limitation:'Owner-rated GitHub command usefulness only, not autonomous learning of model weights or expanded permissions.'};
}

export function suggestionFor(command, report) {
  if(!COMMANDS.has(command))return {command,advisory:'unsupported',executable:false};
  return {command,advisory:report?.adopted &&
    report.candidate?.cautionCommands?.includes(command)?
    'owner-reported-low-usefulness':'no-measured-objection',
    executable:false,policy:report?.activeVersion||'baseline'};
}
