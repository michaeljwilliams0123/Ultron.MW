// RSASSA-PKCS1-v1_5 with SHA-256 (JWT "RS256") in plain JavaScript.
//
// Why this exists: the Hatchable isolate runtime has no asymmetric signing.
// `node:crypto` there does not export createSign, and crypto.subtle.importKey
// accepts only HMAC, PBKDF2 and AES-GCM. A GitHub App installation token needs
// an RS256-signed JWT, so the signature is computed here with BigInt.
//
// Safety properties:
//  * Accepts only an unencrypted PKCS#1 ("RSA PRIVATE KEY") or PKCS#8
//    ("PRIVATE KEY", rsaEncryption) PEM with a modulus of at least 2048 bits.
//  * The key's CRT parts are cross-checked (p*q=n, d*e≡1, dp, dq, qi).
//  * RSA blinding with a fresh random factor on every signature, to blunt
//    timing side channels in non-constant-time BigInt arithmetic.
//  * Every signature is verified with the public exponent before it is
//    returned (fault check); a mismatch throws and nothing is emitted.
//  * Errors never include key material.
import {createHash} from 'node:crypto';

function randomOctets(length){
 if(typeof globalThis.crypto?.getRandomValues!=='function')fail('blinding-unavailable');
 return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

const RSA_OID=[0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01];
// DER DigestInfo prefix for SHA-256 (RFC 8017 §9.2 note 1).
const SHA256_PREFIX=[0x30,0x31,0x30,0x0d,0x06,0x09,0x60,0x86,0x48,0x01,0x65,
 0x03,0x04,0x02,0x01,0x05,0x00,0x04,0x20];

function fail(reason){throw Error('rsa-key-'+reason);}

function pemBody(pem){
 if(typeof pem!=='string'||pem.length>16384)fail('invalid');
 const text=pem.replace(/\\n/g,'\n').trim();
 const m=/^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----$/.exec(text);
 if(!m)fail(/ENCRYPTED/.test(text)?'encrypted':'invalid');
 const bytes=Uint8Array.from(Buffer.from(m[2].replace(/\s+/g,''),'base64'));
 if(bytes.length<64)fail('invalid');
 return {kind:m[1],bytes};
}

function tlv(buf,off){
 if(off+2>buf.length)fail('invalid');
 const tag=buf[off];let len=buf[off+1],pos=off+2;
 if(len&0x80){
  const n=len&0x7f;
  if(n<1||n>3||pos+n>buf.length)fail('invalid');
  len=0;for(let i=0;i<n;i++)len=len*256+buf[pos+i];
  pos+=n;
 }
 if(pos+len>buf.length)fail('invalid');
 return {tag,start:pos,end:pos+len};
}

function children(buf,node){
 const out=[];let off=node.start;
 while(off<node.end){const c=tlv(buf,off);out.push(c);off=c.end;}
 if(off!==node.end)fail('invalid');
 return out;
}

function int(buf,node){
 if(node.tag!==0x02||node.end<=node.start)fail('invalid');
 if(buf[node.start]&0x80)fail('invalid');
 let hex='';
 for(let i=node.start;i<node.end;i++)hex+=buf[i].toString(16).padStart(2,'0');
 return BigInt('0x'+hex);
}

function pkcs1(buf,node){
 if(node.tag!==0x30)fail('invalid');
 const f=children(buf,node);
 if(f.length<9)fail('invalid');
 const [version,n,e,d,p,q,dp,dq,qi]=f.slice(0,9).map(x=>int(buf,x));
 if(version!==0n)fail('unsupported');
 return {n,e,d,p,q,dp,dq,qi};
}

function bitLength(x){return x.toString(2).length;}

function modPow(base,exp,mod){
 let result=1n;base%=mod;if(base<0n)base+=mod;
 while(exp>0n){
  if(exp&1n)result=result*base%mod;
  base=base*base%mod;exp>>=1n;
 }
 return result;
}

function modInverse(a,m){
 let [r0,r1]=[((a%m)+m)%m,m],[s0,s1]=[1n,0n];
 while(r1!==0n){const q=r0/r1;[r0,r1]=[r1,r0-q*r1];[s0,s1]=[s1,s0-q*s1];}
 if(r0!==1n)return null;
 return ((s0%m)+m)%m;
}

function bytesToBigInt(bytes){
 let hex='';for(const b of bytes)hex+=b.toString(16).padStart(2,'0');
 return hex?BigInt('0x'+hex):0n;
}

function bigIntToBytes(x,length){
 let hex=x.toString(16);
 if(hex.length>length*2)fail('invalid');
 hex=hex.padStart(length*2,'0');
 const out=new Uint8Array(length);
 for(let i=0;i<length;i++)out[i]=parseInt(hex.slice(i*2,i*2+2),16);
 return out;
}

export function parseRsaPrivateKey(pem){
 const {kind,bytes}=pemBody(pem);
 const root=tlv(bytes,0);
 if(root.end!==bytes.length)fail('invalid');
 let key;
 if(kind==='RSA PRIVATE KEY')key=pkcs1(bytes,root);
 else{
  if(root.tag!==0x30)fail('invalid');
  const f=children(bytes,root);
  if(f.length<3||int(bytes,f[0])!==0n||f[1].tag!==0x30||f[2].tag!==0x04)fail('invalid');
  const alg=children(bytes,f[1]);
  const oid=alg[0];
  if(!oid||oid.tag!==0x06||oid.end-oid.start!==RSA_OID.length||
    RSA_OID.some((b,i)=>bytes[oid.start+i]!==b))fail('unsupported');
  const inner=bytes.subarray(f[2].start,f[2].end);
  const innerRoot=tlv(inner,0);
  if(innerRoot.end!==inner.length)fail('invalid');
  key=pkcs1(inner,innerRoot);
 }
 const {n,e,d,p,q,dp,dq,qi}=key;
 if(bitLength(n)<2048||bitLength(n)>8192)fail('size');
 if(e<3n||(e&1n)===0n||p<2n||q<2n||p*q!==n||
   dp!==d%(p-1n)||dq!==d%(q-1n)||(qi*q)%p!==1n||
   (d*e)%(((p-1n)*(q-1n))/gcd(p-1n,q-1n))!==1n)fail('inconsistent');
 return Object.freeze({n,e,d,p,q,dp,dq,qi,length:Math.ceil(bitLength(n)/8)});
}

function gcd(a,b){while(b){[a,b]=[b,a%b];}return a;}

function emsa(message,length){
 const digest=createHash('sha256').update(message).digest();
 const t=new Uint8Array(SHA256_PREFIX.length+digest.length);
 t.set(SHA256_PREFIX,0);t.set(digest,SHA256_PREFIX.length);
 if(length<t.length+11)fail('size');
 const em=new Uint8Array(length);
 em[0]=0;em[1]=1;em.fill(0xff,2,length-t.length-1);
 em[length-t.length-1]=0;em.set(t,length-t.length);
 return em;
}

function blindingFactor(key){
 for(let i=0;i<8;i++){
  const r=bytesToBigInt(randomOctets(key.length))%key.n;
  if(r<2n)continue;
  const inv=modInverse(r,key.n);
  if(inv)return {r,inv};
 }
 fail('blinding-unavailable');
}

// Returns the raw RS256 signature bytes for `message` (string or bytes).
export function signRs256(privateKeyPem,message){
 const key=typeof privateKeyPem==='object'&&privateKeyPem?.n?privateKeyPem:
  parseRsaPrivateKey(privateKeyPem);
 const data=typeof message==='string'?Buffer.from(message,'utf8'):message;
 if(!(data instanceof Uint8Array))fail('message-invalid');
 const em=emsa(data,key.length);
 const m=bytesToBigInt(em);
 const {r,inv}=blindingFactor(key);
 const blinded=m*modPow(r,key.e,key.n)%key.n;
 const s1=modPow(blinded%key.p,key.dp,key.p);
 const s2=modPow(blinded%key.q,key.dq,key.q);
 let h=(key.qi*(s1-s2))%key.p;if(h<0n)h+=key.p;
 const sb=s2+h*key.q;
 const s=sb*inv%key.n;
 if(modPow(s,key.e,key.n)!==m)fail('signature-fault');
 return bigIntToBytes(s,key.length);
}

export function base64url(bytes){
 return Buffer.from(bytes).toString('base64')
  .replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}
