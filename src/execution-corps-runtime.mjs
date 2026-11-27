/** Trusted Node composition root. Reuses the canonical repair ledger and
 * GitHub adapters; no separate queue, provider token, or authorization path.
 * The host must supply installation-scoped transport and the real grant
 * verifier. Requests are passed to Execution Corps, never used as services.
 */
import {createExecutionCorps} from './execution-corps.mjs';
import {createPostgresAutonomousRepairLedger} from './autonomous-repair-postgres-ledger.mjs';
import {createAutonomousRepairGitHubAdapters} from './autonomous-repair-github-adapter.mjs';

export function createPostgresExecutionCorps({db,repair,githubServices,cloudServices,composioWorker}={}){
 if(typeof db?.query!=='function'||typeof repair?.authorize!=='function'||
    typeof repair?.get!=='function'||typeof repair?.post!=='function'||
    typeof repair?.updateRef!=='function'||typeof repair?.repairer?.propose!=='function'||
    (repair.now!==undefined&&typeof repair.now!=='function'))
  throw Error('repair-runtime-trusted-services-required');
 const {get,post,updateRef,readFailureTrace,repairer,authorize,now}=repair;
 const ledger=createPostgresAutonomousRepairLedger({db});
 const adapters=createAutonomousRepairGitHubAdapters({get,post,updateRef,readFailureTrace});
 return createExecutionCorps({githubServices,cloudServices,composioWorker,
  repairServices:Object.freeze({ledger,...adapters,repairer,authorize,...(now?{now}:{})})});
}
