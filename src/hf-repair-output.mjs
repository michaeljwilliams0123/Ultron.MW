/**
 * Shape-only parser for public synthetic model repair proposals.
 * Never executes a proposal, never returns raw model content in diagnostics,
 * and never silently trims an appended executable statement.
 */
const MAX_CHARS=1500;
const FENCE='\x60\x60\x60';
const PREFIX=/^(?:here(?:'s| is) (?:the )?(?:corrected|repaired) (?:function|code):?|corrected (?:function|code):?|the corrected function is:)$/i;
const SIGNATURE=/\bfunction\s+fix\s*\(\s*input\s*\)\s*\{/;
const DECLARATIONS=/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g;

function closingBrace(text,start){
 let depth=0,quoted='',escaped=false,lineComment=false,blockComment=false;
 for(let i=start;i<text.length;i++){
  const c=text[i],next=text[i+1];
  if(lineComment){if(c==='\n')lineComment=false;continue;}
  if(blockComment){if(c==='*'&&next==='/'){blockComment=false;i++;}continue;}
  if(quoted){
   if(escaped){escaped=false;continue;}
   if(c==='\\'){escaped=true;continue;}
   if(c===quoted)quoted='';
   continue;
  }
  if(c==='/'&&next==='/'){lineComment=true;i++;continue;}
  if(c==='/'&&next==='*'){blockComment=true;i++;continue;}
  if(c==='"'||c==="'"||c==='\x60'){quoted=c;continue;}
  if(c==='{')depth++;
  if(c==='}'){depth--;if(depth===0)return i+1;if(depth<0)return -1;}
 }
 return -1;
}

function parse(raw){
 if(typeof raw!=='string')return {code:null,shape:'non-string'};
 if(raw.length>MAX_CHARS)return {code:null,shape:'too-long'};
 const input=raw.replace(/\r\n/g,'\n').trim();
 if(!input)return {code:null,shape:'empty'};
 let text=input,mode='exact';
 if(input.includes(FENCE)){
  // Accept a single complete fenced block, optionally with a recognized
  // prose introduction. Extra fences or code are never silently discarded.
  const pattern=new RegExp('^(?:(.+)\\n)?'+FENCE+'(?:js|javascript)?\\n([\\s\\S]*?)\\n'+FENCE+'$','i');
  const match=input.match(pattern);
  if(!match)return {code:null,shape:'invalid-fence'};
  if(match[1]&&!PREFIX.test(match[1].trim()))return {code:null,shape:'invalid-prefix'};
  text=match[2].trim();
  mode=match[1]?'prefaced':'fenced';
 }
 const declarations=[...text.matchAll(DECLARATIONS)];
 if(declarations.length>1)return {code:null,shape:'multiple-functions'};
 const marker=SIGNATURE.exec(text);
 if(!marker)return {code:null,shape:'missing-signature'};
 const leading=text.slice(0,marker.index).trim();
 if(leading&&!PREFIX.test(leading))return {code:null,shape:'invalid-prefix'};
 if(leading)mode='prefaced';
 const open=marker.index+marker[0].length-1;
 const end=closingBrace(text,open);
 if(end<0)return {code:null,shape:'incomplete-function'};
 if(text.slice(end).trim())return {code:null,shape:'trailing-content'};
 const code=text.slice(marker.index,end).trim();
 return {code,shape:mode};
}

export function normalizeRepairOutput(raw){
 const result=parse(raw);
 return Object.freeze({code:result.code,format:result.code?result.shape:'invalid',
  reason:result.code?null:result.shape});
}

/** Bounded diagnostics: source text and private values are never emitted. */
export function inspectRepairOutput(raw){
 const parsed=parse(raw);
 return Object.freeze({shape:parsed.shape,
  responseChars:typeof raw==='string'?Math.min(raw.length,MAX_CHARS+1):0,
  responseBytes:typeof raw==='string'?Buffer.byteLength(raw,'utf8'):0,
  hasFence:typeof raw==='string'&&raw.includes(FENCE),
  declarationCount:typeof raw==='string'?
   Math.min([...raw.matchAll(DECLARATIONS)].length,8):0});
}
