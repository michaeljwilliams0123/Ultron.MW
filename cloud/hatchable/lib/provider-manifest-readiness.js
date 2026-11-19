// Read-only diagnostics. Manifest presence and successful GETs grant no authority.
import {evaluateAdapterConfig} from './universal-cloud-routing.js';

const definitions = Object.freeze([
 ['github','GitHub','Ultron.MW repository','github.issue.write'],
 ['gitlab','GitLab','private project 87884831 ultron task branches','gitlab.branch.create'],
 ['destiny','Destiny Work / Codex','owner-authorized task scope',null],
 ['mahoraga','Mahoraga federation','fixed private Mahoraga repository','mahoraga.action.execute'],
 ['reef','Reef','owner-authorized evaluation scope',null],
 ['research','External research','bounded public primary sources','research.intake'],
 ['openapi','OpenAPI factory','owner-approved API schema',null],
 ['browser','Browser execution','owner-authorized origin and postcondition',null],
]);

export function providerManifestReadiness({githubOauth,gitlabRead,gitlabWrite,adapterConfigRaw=null}={}) {
 const githubConnected=githubOauth?.state==='identity-and-repository-read-verified' &&
  githubOauth.actor==='michaeljwilliams0123ultron' &&
  /^[a-f0-9]{40}$/.test(githubOauth.mainSha||'');
 const gitlabConnected=gitlabRead?.state==='authenticated-read' && gitlabRead.httpStatus===200;
 const hasAdapterConfig=adapterConfigRaw!==null&&adapterConfigRaw!==undefined&&
  !(typeof adapterConfigRaw==='string'&&adapterConfigRaw.trim()==='');
 return {
  schema:'ultron.provider-manifests.v1',manifestVersion:1,readOnly:true,
  paidCeilingCents:0,executionAuthorized:false,
  manifests:definitions.map(([id,name,scope,operation])=>{
   const connected=id==='github'?githubConnected:id==='gitlab'?gitlabConnected:null;
   const cfg=hasAdapterConfig?evaluateAdapterConfig(id,adapterConfigRaw,operation):{ok:true,adapterVersion:null,rolledBack:false};
   const disabledByConfig=cfg.ok===false&&cfg.reason==='adapter-disabled-by-config';
   const configInvalid=cfg.ok===false&&cfg.reason==='adapter-registry-config-invalid';
   return {
    id,name,version:1,scope,operations:operation?[operation]:[],
    state:disabledByConfig||configInvalid?'blocked':connected===true?'connected':'blocked',
    connected,ready:false,
    connectionEvidence:id==='github'&&githubConnected?'authenticated-identity-and-repository-get':
     id==='gitlab'&&gitlabConnected?'authenticated-user-get':'not-observed',
    writeScopeReadObserved:id==='gitlab'?
     gitlabWrite?.state==='authenticated-read'&&gitlabWrite.httpStatus===200:null,
    executionAuthorized:false,paidCeilingCents:0,
    visibilityEvidence:{
     // Provenance is an authenticated GET only; no inferred write authority.
     identity:id==='github'&&githubConnected?'michaeljwilliams0123ultron':null,
     identityVerified:id==='github'&&githubConnected,
     operationContract:operation?'declared-not-exercised':'none-declared',
     scopeEnforcement:cfg.ok===false&&cfg.reason==='operation-disabled-by-config'?'disabled-by-config':'unverified',
     schemaVerified:false,
     lastProbeAt:null,health:'not-measured',latencyMs:null,
     quota:'unknown',canary:'not-observed',
     rollback:cfg.rolledBack?('rolled-back:'+cfg.adapterVersion):'not-observed',
    },
    blockers:[...(connected===true?[]:['provider-connection-unverified']),
     ...(disabledByConfig?['adapter-disabled-by-config']:[]),
     ...(configInvalid?['adapter-registry-config-invalid']:[]),
     'operation-scoped-live-acceptance-unverified',
     ...(hasAdapterConfig?[]:['config-disable-revoke-rollback-unverified'])],
    lifecycleEvidence:{
     disable:disabledByConfig?'disabled-by-config':hasAdapterConfig?'config-evaluated':'not-observed',
     revoke:'not-observed',
     rollback:cfg.rolledBack?('rolled-back:'+cfg.adapterVersion):'not-observed',
    },
   };
  }),
 };
}
