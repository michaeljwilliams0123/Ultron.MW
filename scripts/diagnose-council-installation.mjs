/** Protected GitHub Actions read-only App and installation diagnostic. */
import {mkdir,writeFile} from 'node:fs/promises';
import {diagnoseCouncilAppInstallation}
 from '../src/security/council-app-installation-diagnostic.mjs';

const verdict=await diagnoseCouncilAppInstallation({
 appId:process.env.ULTRON_GITHUB_APP_ID,
 privateKey:process.env.ULTRON_BUILDER_PRIVATE_KEY
});
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/council-app-installation-diagnostic.json',
 JSON.stringify(verdict,null,2)+'\n',{mode:0o600});
console.log('Coordinator App preflight:',verdict.status,
 'appJWTVerified:',verdict.appIdentityVerified,
 'repositoryInstallationVisible:',verdict.installationVisible,
 'verifiedPrincipals:',verdict.verifiedPrincipalCount,
 'reason:',verdict.reason);
if(verdict.status!=='installation-observed')process.exitCode=2;
