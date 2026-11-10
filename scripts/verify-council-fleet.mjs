/** Manual, read-only Council principal verification. No role keys are required. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createScopedInstallationTokenProvider} from '../src/security/crypto_auth.mjs';
import {verifyCouncilFleet,normalizeAppPrivateKey}
 from '../src/security/council-fleet-verification.mjs';
const env={
 GITHUB_APP_ID:process.env.ULTRON_GITHUB_APP_ID||process.env.GITHUB_APP_ID,
 GITHUB_INSTALLATION_ID:process.env.ULTRON_GITHUB_INSTALLATION_ID||process.env.GITHUB_INSTALLATION_ID,
 GITHUB_PRIVATE_KEY:process.env.ULTRON_GITHUB_APP_PRIVATE_KEY||process.env.GITHUB_PRIVATE_KEY
};
let mintScopedToken;
try{
 if(/^[1-9][0-9]*$/.test(env.GITHUB_APP_ID||'')&&
    /^[1-9][0-9]*$/.test(env.GITHUB_INSTALLATION_ID||'')&&
    normalizeAppPrivateKey(env.GITHUB_PRIVATE_KEY)){
  mintScopedToken=createScopedInstallationTokenProvider({
   appId:Number(env.GITHUB_APP_ID),installationId:Number(env.GITHUB_INSTALLATION_ID),
   privateKey:normalizeAppPrivateKey(env.GITHUB_PRIVATE_KEY)
  });
 }
}catch{
 // Unavailable/invalid configuration is a held result, never a fake role.
}
const evidence=await verifyCouncilFleet({env,mintScopedToken});
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/council-principal-proof.json',
 JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log('Council GitHub principal:',evidence.status,
 'verifiedPrincipals:',evidence.verifiedPrincipalCount,
 'independentlyVerifiedRoles:',evidence.verifiedIndependentRoleCount,
 'reason:',evidence.reason);
if(evidence.status!=='verified')process.exitCode=2;
