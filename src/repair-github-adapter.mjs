/**
 * Narrow GitHub transport for Repair App branch/PR creation and observation.
 * This adapts the repository- and installation-scoped GitHub App operator;
 * it never exposes a general mutation method, grants or credentials.
 * The caller still must provide fresh authenticated installation readback,
 * durable admission and the Postgres write-intent ledger.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const BRANCH=/^ultron\/repair-[a-z0-9][a-z0-9-]{2,63}$/;
const SHA=/^[0-9a-f]{40}$/;
const MARKER=/^<!-- ultron-repair:[0-9a-f]{64} -->/;
function scope(repository,branch){
  if(repository!==REPO || typeof branch!=='string' || !BRANCH.test(branch))
    throw Error('Repair GitHub repository or branch scope invalid');
}
function requirePR({base,draft,title,body}){
  if(base!=='main'||draft!==false||
    typeof title!=='string'||!/^repair: [^\r\n]{12,100}$/.test(title)||
    typeof body!=='string'||!MARKER.test(body)||body.length>4000)
    throw Error('Repair GitHub PR creation scope invalid');
}
function checkRepo(r){return r?.id===REPO_ID&&r?.full_name===REPO;}
function readPR(raw,branch){
  if(!raw||!Number.isSafeInteger(raw.number)||raw.number<1||
    raw.state!=='open'||raw.draft!==false||
    raw.head?.ref!==branch||!SHA.test(raw.head?.sha||'')||
    raw.base?.ref!=='main'||
    !checkRepo(raw.head?.repo)||!checkRepo(raw.base?.repo)||
    typeof raw.body!=='string'||!MARKER.test(raw.body)||
    typeof raw.title!=='string'||!/^repair: [^\r\n]{12,100}$/.test(raw.title))
    throw Error('Repair GitHub PR readback identity mismatch');
  return Object.freeze({
    number:raw.number,repo:REPO,head:branch,headSha:raw.head.sha,base:'main',
    title:raw.title,body:raw.body,draft:false
  });
}
/**
 * operator.request() is the only authorized network action. In production
 * operator must be created with createGitHubAppOperator, not an arbitrary
 * caller-provided bearer token or unauthenticated HTTP transport.
 */
export function createRepairGitHubAdapter({operator}={}){
  if(typeof operator?.request!=='function')
    throw Error('Repair GitHub App scoped operator required');
  return Object.freeze({
    async getBranch({repository,branch}={}){
      scope(repository,branch);
      let response;
      try{
        response=await operator.request({
          method:'GET',path:'/git/ref/heads/'+branch,permission:'contents:read'
        });
      }catch(error){
        // Only an authoritative 404 is absence; 401, 403, timeouts or
        // unknown reads must not become permission to repeat writes.
        if(/^GitHub operation denied or unavailable: HTTP 404$/.test(
          String(error?.message??'')))return null;
        throw error;
      }
      if(response?.ref!=='refs/heads/'+branch ||
        response.object?.type!=='commit'||!SHA.test(response.object.sha||''))
        throw Error('Repair GitHub branch readback identity mismatch');
      return Object.freeze({repo:REPO,ref:branch,sha:response.object.sha});
    },
    async createBranch({repository,branch,baseSha}={}){
      scope(repository,branch);
      if(!SHA.test(baseSha||''))
        throw Error('Repair GitHub base SHA invalid');
      return operator.request({
        method:'POST',path:'/git/refs',permission:'contents:write',
        body:{ref:'refs/heads/'+branch,sha:baseSha}
      });
    },
    async findPR({repository,branch,base}={}){
      scope(repository,branch);
      if(base!=='main')throw Error('Repair GitHub PR base invalid');
      // Query characters are restricted by scope regex; no untrusted URL.
      // Search all PR states to prevent recreating closed/merged duplicates.
      const response=await operator.request({
        method:'GET',
        path:'/pulls?state=all&head=michaeljwilliams0123:'+branch+
          '&base=main&per_page=100',
        permission:'pull_requests:read'
      });
      if(!Array.isArray(response))
        throw Error('Repair GitHub PR readback missing list');
      if(response.length===0)return null;
      if(response.length!==1)
        throw Error('Repair GitHub PR readback ambiguous');
      return readPR(response[0],branch);
    },
    async createPR({repository,branch,base,title,body,draft}={}){
      scope(repository,branch);
      requirePR({base,title,body,draft});
      return operator.request({
        method:'POST',path:'/pulls',permission:'pull_requests:write',
        body:{head:branch,base:'main',title,body,draft:false}
      });
    }
  });
}
