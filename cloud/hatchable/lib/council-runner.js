const API = 'https://api.github.com';
const REPO = 'michaeljwilliams0123/Ultron.MW';
const SHA = /^[a-f0-9]{40}$/;
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
    if (!['Builder', 'Skeptic', 'Steward', 'Predictor', 'Generator', 'Sentinel', 'Companion'].includes(role) ||
        roles.has(role) || !Array.isArray(member.actions) || member.actions.length > 4) deny();
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

async function github(token, path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(API + path, {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'ultron-council'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw Error('github-' + response.status);
  return response.status === 204 ? null : response.json();
}

export async function runCouncilActions({ plan, installations, mintToken, fetchImpl = fetch }) {
  validateCouncilPlan(plan);
  const issue = await github('', '/repos/' + REPO + '/issues/' + plan.itemNumber, { fetchImpl });
  if (!issue || issue.state !== 'open' || Boolean(issue.pull_request) !== plan.isPr) {
    throw Error('council-target-changed');
  }
  if (plan.isPr) {
    const pr = await github('', '/repos/' + REPO + '/pulls/' + plan.itemNumber, { fetchImpl });
    if (!plan.sourceSha || pr.head?.sha !== plan.sourceSha) throw Error('council-pr-head-changed');
  }

  const results = [];
  for (const member of plan.memberAssessments) {
    const role = member.identity.role;
    const token = await mintToken(installations[role]);
    for (const action of member.actions) {
      const signed = '**' + role + '** (`ultron-mw-' + role.toLowerCase() + '`): ';
      const text = signed + String(action.text || action.why || '').slice(0, 4000);
      let path, body;
      const method = 'POST';
      switch (action.op) {
        case 'issue.comment':
        case 'pr.comment':
        case 'review.comment':
          path = '/repos/' + REPO + '/issues/' + plan.itemNumber + '/comments';
          body = { body: text };
          break;
        case 'review.request-changes':
          path = '/repos/' + REPO + '/pulls/' + plan.itemNumber + '/reviews';
          body = { event: 'REQUEST_CHANGES', body: text };
          break;
        case 'issue.label':
          path = '/repos/' + REPO + '/issues/' + plan.itemNumber + '/labels';
          body = { labels: action.labels };
          break;
        case 'issue.create':
          path = '/repos/' + REPO + '/issues';
          body = { title: action.title, body: text };
          break;
        case 'branch.create': {
          const ref = await github(token, '/repos/' + REPO + '/git/ref/heads/main', { fetchImpl });
          path = '/repos/' + REPO + '/git/refs';
          body = { ref: 'refs/heads/' + action.branch, sha: ref.object.sha };
          break;
        }
        case 'actions.dispatch':
          path = '/repos/' + REPO + '/actions/workflows/' + action.workflow + '/dispatches';
          body = { ref: 'main' };
          break;
        default:
          deny();
      }
      try {
        await github(token, path, { method, body, fetchImpl });
        results.push({ role, op: action.op, status: 'done' });
      } catch (error) {
        results.push({ role, op: action.op, status: 'error', reason: String(error.message).slice(0, 120) });
      }
    }
  }
  return results;
}
