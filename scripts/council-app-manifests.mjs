#!/usr/bin/env node
/** Generate GitHub App registration blueprints. This program never creates Apps,
 * requests tokens, installs anything, or writes credentials.
 * The owner must register/install each private App through GitHub settings.
 * The webhook is disabled until its authenticated receiver is reviewed.
 */
import {COUNCIL_APP_ROLES,councilAlias,buildCouncilAppManifest,
 councilCapacityReport} from '../src/council-app-identities.mjs';

const args=process.argv.slice(2);
if(args.length!==1||!['--profile=scoped','--profile=engineering-autonomy','--profile=owner-requested'].includes(args[0])){
 console.error('usage: node scripts/council-app-manifests.mjs --profile=scoped|engineering-autonomy|owner-requested');
 process.exitCode=2;
}else{
 const profile=args[0].split('=')[1];
 const mailbox=process.env.COUNCIL_NOTIFICATION_MAILBOX||null;
 const repository='michaeljwilliams0123/Ultron.MW';
 const webhookUrl='https://ultron-mw-cloud.hatchable.site/api/brain/council-events';
 const apps=COUNCIL_APP_ROLES.map(role=>({
  role,
  gmailAlias:mailbox?councilAlias(mailbox,role):null,
  manifest:buildCouncilAppManifest(role,{repository,webhookUrl,profile}),
  registrationPage:'https://github.com/settings/apps/new',
  installationStatus:'NOT_INSTALLED',
  requiresIndividualOwnerApproval:true
 }));
 console.log(JSON.stringify({
  schema:'ultron.council-github-app-blueprints.v1',
  repository,permissionProfile:profile,identityCount:apps.length,
  registrationStatus:'NOT_REGISTERED',
  requiresOwnerInstallApproval:true,
  createsSecrets:false,
  createsAccounts:false,
  deploys:false,
  enablesWebhooks:false,
  quota:councilCapacityReport(),
  apps
 },null,2));
}
