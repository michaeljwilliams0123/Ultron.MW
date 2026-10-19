import {spawnSync} from 'node:child_process';

const CODE=/\.(?:mjs|js)$/;
const CHECK_TIMEOUT=4000;
/** Compile a proposed source file without running it, before GitHub writes. */
export function assertModelSourceSafe({path,original,manifest}={}){
  if(typeof path!=='string'||typeof original!=='string'||
    typeof manifest!=='string')throw Error('Model source preflight requires exact file evidence');
  const m=JSON.parse(manifest);
  if(!Array.isArray(m?.changes)||m.changes.length!==1||
     m.changes[0]?.path!==path)throw Error('Model patch must change one observed source path');
  const {before,after}=m.changes[0];
  if(typeof before!=='string'||typeof after!=='string'||!before||
    original.indexOf(before)<0||
    original.indexOf(before,original.indexOf(before)+before.length)>=0)
    throw Error('Model patch original context is absent or ambiguous');
  const updated=original.replace(before,after);
  if(updated===original)throw Error('Model patch did not change source');
  // A small model may hallucinate filenames/attestations. It cannot rewrite
  // the evidence registry from a natural-language prompt without proof.
  if(path==='docs/core/capabilities.mjs'){
    const oldProof=original.match(/proof:Object\.freeze\(\[[\s\S]*?\]\)/)?.[0];
    const newProof=updated.match(/proof:Object\.freeze\(\[[\s\S]*?\]\)/)?.[0];
    if(!oldProof||oldProof!==newProof)
      throw Error('Model cannot alter capability proof paths without independently verified evidence');
  }
  if(CODE.test(path)){
    const result=spawnSync(process.execPath,['--input-type=module','--check'],{
      input:updated,encoding:'utf8',timeout:CHECK_TIMEOUT,
      maxBuffer:16384,windowsHide:true});
    if(result.error||result.status!==0)
      throw Error('Model candidate rejected by syntax preflight: '+
        String(result.stderr||result.error?.message||'syntax invalid').slice(0,260));
  }
  return Object.freeze({path,bytes:Buffer.byteLength(updated),
    validated:true,candidate:updated});
}
