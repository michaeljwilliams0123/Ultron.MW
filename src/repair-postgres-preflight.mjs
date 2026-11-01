/**
 * Repair App CI-only PostgreSQL preflight.
 * Validate the explicitly identified ephemeral GitHub Actions service before
 * the live fixture can execute SQL. The injected Docker runner is restricted
 * to a single inspect call; this module never issues docker exec.
 */
const ID=/^[a-f0-9]{12,64}$/i;
const FULL_ID=/^[a-f0-9]{64}$/i;
function deny(reason){throw Error('repair-postgres-preflight:'+reason);}

export function assertEphemeralPostgresService({containerId,runDocker}={}){
  if(typeof containerId!=='string'||!ID.test(containerId))
    deny('service-id-invalid');
  if(typeof runDocker!=='function')deny('inspect-runner-required');
  let details;
  try {
    const raw=runDocker(['inspect','--format','{{json .}}',containerId]);
    if(typeof raw!=='string')deny('inspect-output-invalid');
    details=JSON.parse(raw);
  } catch {
    deny('inspect-unavailable');
  }
  if(!details||typeof details!=='object'||Array.isArray(details)||
     typeof details.Id!=='string'||!FULL_ID.test(details.Id)||
     !details.Id.toLowerCase().startsWith(containerId.toLowerCase()))
    deny('service-identity-mismatch');
  if(details.Config?.Image!=='postgres:16-alpine')
    deny('service-image-mismatch');
  if(details.State?.Running!==true)
    deny('service-not-running');
  const env=details.Config?.Env;
  if(!Array.isArray(env)||!env.every(x=>typeof x==='string')||
     !env.includes('ULTRON_TEST_POSTGRES=repair-ci-ephemeral-v1')||
     !env.includes('POSTGRES_USER=ultron')||
     !env.includes('POSTGRES_DB=ultron'))
    deny('service-ephemeral-configuration-mismatch');
  if(!Array.isArray(details.Mounts)||
     details.Mounts.some(m=>!m||typeof m!=='object'||m.Type==='bind'))
    deny('service-storage-unsafe');
  return containerId;
}
