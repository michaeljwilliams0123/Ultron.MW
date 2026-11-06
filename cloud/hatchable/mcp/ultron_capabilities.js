import {CAPABILITIES} from 'lib/brain-core.js';
import {MCP_CAPABILITIES} from 'lib/mcp-capability-registry.js';

export const access='admin';
export default {
 name:'ultron_capabilities',
 description:'Discover bounded source-defined queue objectives and their execution limitations. No provider connectivity or authorization is implied.',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 async handler(){
  const queue=new Set(['repo.inspect','repo.prs','repo.ci','site.render','council.review']);
  return {
   schema:'ultron.mcp-capabilities.v1',
   operations:MCP_CAPABILITIES,
   objectives:CAPABILITIES.filter(capability=>queue.has(capability.id)).map(capability=>({
    id:capability.id,kind:capability.kind,effect:capability.effect,
    description:capability.description,tool:'ultron_queue'
   })),
   queue:{access:'admin',keyRequired:true,reconciliationMode:'reconcile',
    admissionChecksOwnerProfile:false,admissionChecksStop:false},
   externalWrites:{universalGatewayAvailable:false,
    reason:'No verified owner identity contract for new MCP mutation admission.'},
   providerConnectivityVerified:false,
   deploymentVerified:false
  };
 }
};
