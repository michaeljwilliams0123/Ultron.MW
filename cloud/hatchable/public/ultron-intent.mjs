// Ultron conversation intents are UI hints, NEVER write authorization.
const secretLike=/\b(?:private[ -]?key|pem|otp|password|access[ -]?token|api[ -]?key)\b/i;
const prNumber=s=>{const m=s.match(/\b(?:pr|pull request)\s*#?\s*(\d{1,7})\b/i);const n=m?Number(m[1]):0;return n>0&&n<=9999999?n:null};
export function parseUltronIntent(value){
 if(typeof value!=='string'||!value.trim()||value.length>6000)return null;
 const text=value.trim();
 if(secretLike.test(text))return null;
 const pr=prNumber(text);
 if(pr&&/\b(?:squash(?:[- ]merge)?|merge|merging)\b/i.test(text))
  return {kind:'merge',pr,requiresOwnerAuthorization:true};
 if(pr&&/\b(?:canary|sign|signed|comment)\b/i.test(text))
  return {kind:'canary',pr,requiresOwnerAuthorization:true};
 const conn=text.match(/\b(?:connect|link|authorize|set\s*up|configure)\s+(?:my\s+)?(github|gitlab|composio|gmail|microsoft(?:\s+graph)?|mahoraga|hugging\s*face)\b/i);
 if(conn)return {kind:'connection',provider:conn[1].toLowerCase().replace(/\s+/g,'-'),requiresOwnerAuthorization:true};
 if(/\b(?:release\s+(?:status|proof|health)|status\s+of\s+(?:the\s+)?release|check\s+(?:the\s+)?release|show\s+(?:the\s+)?release\s+status)\b/i.test(text))
  return {kind:'release',requiresOwnerAuthorization:false};
 return null;
}
