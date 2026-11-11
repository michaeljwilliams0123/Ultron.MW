/** Canonical delegated PR initiator, NOT owner-signed release authority. */
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const OWNER='michaeljwilliams0123';
const SECONDARY='michaeljwilliams0123ultron';
const SECONDARY_ID=354634860;
const SHA=/^[a-f0-9]{40}$/;

export function isCouncilOwnerInitiated({eventName,actor,repository,pr}={}){
 if(repository!==REPO)return false;
 if(actor===OWNER)return true;
 return eventName==='pull_request'&&actor===SECONDARY&&
   pr?.user?.login===SECONDARY&&pr?.user?.id===SECONDARY_ID&&
   pr.head?.repo?.id===REPO_ID&&
   pr.head?.repo?.full_name===REPO&&SHA.test(pr.head?.sha||'')&&
   pr.base?.repo?.id===REPO_ID&&
   pr.base?.repo?.full_name===REPO&&pr.base?.ref==='main';
}
