const SHA = /^[a-f0-9]{40}$/;
const ROLES = ['Builder', 'Skeptic', 'Steward', 'Predictor', 'Generator', 'Sentinel', 'Companion'];
const BRANCH = /^[A-Za-z0-9._/-]{1,120}$/;
const WORKFLOW = /^[A-Za-z0-9._-]{1,120}\.yml$/;

function deny() {
  throw Error('council-plan-invalid');
}

export function validateCouncilPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
      plan.ownerMode !== true || plan.hold !== false ||
      !Number.isSafeInteger(plan.itemNumber) || plan.itemNumber < 1 ||
      typeof plan.isPr !== 'boolean' || !Array.isArray(plan.memberAssessments) ||
      plan.memberAssessments.length !== 7) deny();
  if (plan.sourceSha && !SHA.test(plan.sourceSha)) deny();

  const roles = new Set();
  for (const member of plan.memberAssessments) {
    const role = member?.identity?.role;
    if (!ROLES.includes(role) || roles.has(role) ||
        !Array.isArray(member.actions) || member.actions.length > 4) deny();
    roles.add(role);
    for (const action of member.actions) {
      if (!action || !['issue.comment', 'pr.comment', 'review.comment', 'review.request-changes',
        'issue.label', 'issue.create', 'branch.create', 'actions.dispatch'].includes(action.op)) deny();
      if (action.op === 'branch.create' && !BRANCH.test(action.branch || '')) deny();
      if (action.op === 'actions.dispatch' && (!WORKFLOW.test(action.workflow || '') ||
        (action.ref && action.ref !== 'main'))) deny();
      if (action.op === 'issue.label' && (!Array.isArray(action.labels) ||
        action.labels.length > 5 || action.labels.some(label => typeof label !== 'string' || label.length > 50))) deny();
      if (action.op === 'issue.create' && (typeof action.title !== 'string' || action.title.length > 200)) deny();
    }
  }
  if (roles.size !== 7) deny();
  return plan;
}
