import {observeMahoragaMain} from 'lib/mahoraga-actions.js';

// Native owner-OAuth MCP binding. It reuses the existing PAT/App credential
// selection and exact private-repository identity checks. Read-only: the
// adapter performs two GitHub repository GETs. PAT mode needs no token mint;
// GitHub App mode first issues one App installation-token POST, requesting
// ONLY contents:read + the implicit metadata:read. Neither mode performs
// repository writes or dispatches Actions.
export const access='admin';
export default {
 name:'ultron_mahoraga_repo',
 description:'Read the authenticated private Mahoraga GitHub repository identity and current main commit. Uses the already-scoped Ultron Mahoraga credential; never creates issues, dispatches workflows, or reveals tokens.',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 async handler(args,ctx){
  const schema='ultron.mahoraga.repo-read.v1';
  let valid=false;
  try{valid=args&&typeof args==='object'&&!Array.isArray(args)&&
   Object.keys(args).length===0;}catch{}
  if(!valid)return {schema,ok:false,status:'held',reason:'invalid-arguments'};
  if(typeof ctx?.config?.get!=='function')
   return {schema,ok:false,status:'held',reason:'provider-identity-unavailable'};
  try{
   const observation=await observeMahoragaMain({config:ctx.config});
   return {schema,ok:true,readOnly:true,paidSpendCents:0,...observation};
  }catch{
   return {schema,ok:false,status:'held',reason:'mahoraga-read-unavailable'};
  }
 }
};
