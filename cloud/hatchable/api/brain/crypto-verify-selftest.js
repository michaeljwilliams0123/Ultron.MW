// Temporary owner-only runtime probe using a disposable, public test vector.
// This module contains no owner credentials, user input, or mutable operations.
import {createVerify} from 'node:crypto';
export const access='admin';
export const methods=['GET'];
const OWNER='michaeljwilliams0123';
const MESSAGE='ultron-hatchable-crypto-bridge-public-selftest-v1';
const PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBKVZE+Q0wDdKArd+GjGBinsNyeX1\n85JKjR9e6O8EH50yLL2E7zQ4MwrgnzGVNO6B2LBNGMbV/85XJS5118FOng==\n-----END PUBLIC KEY-----";
const SIGNATURE_B64="MEUCIHXU/PJRs8fWylTzCOoAaL966XKlsyzaZ98iYwKxlEwDAiEAyrwOnWhAFSbFsBO7yaTApssuxJOhrIhdDF9VY165oOU=";
function probe(id,signatureType,algorithm){
 const result={case:id,algorithm,stage:'create',verified:false};
 try{
  const v=createVerify(algorithm);
  result.stage='update';
  v.update(MESSAGE,'utf8');
  result.stage='verify';
  const signature=signatureType==='base64-string'?SIGNATURE_B64:
   signatureType==='buffer'?Buffer.from(SIGNATURE_B64,'base64'):
   Uint8Array.from(Buffer.from(SIGNATURE_B64,'base64'));
  const verified=signatureType==='base64-string'?
   v.verify(PUBLIC_KEY,signature,'base64'):v.verify(PUBLIC_KEY,signature);
  result.verified=verified===true;
  result.stage='done';
 }catch(error){
  result.errorName=String(error?.name||'Error').slice(0,40);
  // Safe because this path uses only the disposable public test vector,
  // never a real signed grant, browser attestation, or secret.
  result.errorMessage=String(error?.message||'unknown').slice(0,240)
   .replace(/[\r\n\t]/g,' ').replace(/-----BEGIN[^-]*-----/g,'[PUBLIC TEST KEY]');
 }
 return result;
}
export function runPublicCryptoSelftest(){
 const algorithms=['sha256','SHA256','SHA-256','RSA-SHA256','ecdsa-sha256','ECDSA-SHA256','ES256'];
 return algorithms.flatMap(algorithm=>
  ['base64-string','buffer','uint8array'].map(type=>probe(type,type,algorithm)));
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!==OWNER)
  return res.status(403).json({ok:false,reason:'owner-identity-required'});
 if(req.method!=='GET')
  return res.status(405).json({ok:false,reason:'method-not-allowed'});
 return res.status(200).json({ok:true,temporary:true,results:runPublicCryptoSelftest()});
}
