// Describes source contracts, not actual provider grants or deployment state.
const records=[
 {tool:'ultron_status',operation:'brain.snapshot',effect:'read',admission:'platform-admin'},
 {tool:'ultron_queue',operation:'brain.objective.submit',effect:'queue-write',
  admission:'platform-admin-and-signed-grant',keyed:true,readback:true,profileEnforced:true},
 {tool:'ultron_queue',operation:'brain.objective.reconcile',effect:'read',
  admission:'platform-admin'},
 {tool:'ultron_remember',operation:'cloud.note.create',effect:'write',
  admission:'platform-admin-and-signed-grant',keyed:true,readback:true,profileEnforced:true},
 {tool:'ultron_remember',operation:'cloud.note.prepare-or-reconcile',effect:'read',
  admission:'platform-admin'},
 {tool:'ultron_control',operation:'mcp.task.control',effect:'write',
  admission:'platform-admin-and-signed-grant',keyed:true,readback:true,profileEnforced:true},
 {tool:'ultron_mahoraga',operation:'mahoraga.action.execute',effect:'external-write',
  admission:'platform-admin-and-signed-grant-and-action-policy',keyed:true,readback:true},
 {tool:'ultron_mahoraga',operation:'mahoraga.action.status',effect:'read',
  admission:'platform-admin'},
 {tool:'ultron_connectivity',operation:'brain.connectivity.read',effect:'read',
  admission:'platform-admin'},
 {tool:'ultron_github_issue',operation:'github.issue.read',effect:'read',
  admission:'platform-admin',scope:'public Ultron.MW repository'},
 {tool:'ultron_graph_workbook',operation:'graph.workbook.cell.read',effect:'read',
  admission:'platform-admin-and-configured-delegated-token',
  scope:'one configured account, workbook, worksheet and cell allowlist'},
 {tool:'ultron_hf_lab',operation:'brain.hf-lab.read',effect:'read',
  admission:'platform-admin'}
];
export const MCP_CAPABILITIES=Object.freeze(records.map(record=>Object.freeze(record)));
