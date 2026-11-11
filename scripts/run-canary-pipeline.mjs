/** CLI entrypoint for the five-stage canary pipeline.
 * The pipeline itself lives in src/engine/master-pipeline.mjs (#167) so a
 * deployed handler can import it; this script re-exports the same functions.
 */
import {check,safeRequest} from '../src/engine/master-pipeline.mjs';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export {runMasterPipeline,createCanaryCommitOperation,createCanaryLineageVerifier,
  loadLiveDependencies} from '../src/engine/master-pipeline.mjs';

async function main(argv){
  check(argv.length===2&&argv[0]==='--request','usage--request-FILE');
  const request=JSON.parse(await readFile(resolve(argv[1]),'utf8'));
  safeRequest(request);
  // The standalone CLI must not accept signer/DB authority in untrusted JSON.
  // Use the existing trusted Hatchable composition root for live execution.
  throw Error('canary-live-approval-adapter-unconfigured');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(error=>{
    console.error(error instanceof Error&&error.message.startsWith('canary-')
      ?error.message:'canary-pipeline-failed');
    process.exitCode=1;
  });
}
