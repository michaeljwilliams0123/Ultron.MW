import { db, config } from 'hatchable';
import { vaultKey, vaultFor } from 'lib/owner-vault.js';

export const access = 'admin';
export const methods = ['GET'];

const ROLES = ['Builder', 'Skeptic', 'Steward', 'Predictor', 'Generator', 'Sentinel', 'Companion'];
const PERMISSIONS = {
  metadata: 'read',
  administration: 'write',
  actions: 'write',
  checks: 'write',
  contents: 'write',
  deployments: 'write',
  environments: 'write',
  issues: 'write',
  merge_queues: 'write',
  packages: 'write',
  pages: 'write',
  pull_requests: 'write',
  repository_hooks: 'write',
  repository_projects: 'admin',
  secrets: 'write',
  security_events: 'write',
  statuses: 'write',
  vulnerability_alerts: 'write',
  workflows: 'write'
};

function randomState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  const vault = vaultFor(db, await vaultKey(config));
  const origin = 'https://ultron-mw-cloud.hatchable.site';
  const query = req.query || {};

  if (query.code) {
    const role = String(query.role || '');
    if (!ROLES.includes(role)) return res.status(400).send('invalid role');
    const stateRecord = await vault.get('state:' + role);
    if (!stateRecord || stateRecord.state !== query.state) return res.status(400).send('invalid or expired state');
    await vault.del('state:' + role);

    const response = await fetch('https://api.github.com/app-manifests/' + encodeURIComponent(query.code) + '/conversions', {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ultron-council' }
    });
    if (!response.ok) return res.status(502).send('GitHub manifest conversion failed: ' + response.status);
    const app = await response.json();
    await vault.set('app:' + role, { id: app.id, clientId: app.client_id, slug: app.slug, pem: app.pem });

    const installUrl = 'https://github.com/apps/' + encodeURIComponent(app.slug) + '/installations/new';
    return res.send('<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;max-width:720px;margin:3em auto">' +
      '<h1>' + role + ' App created</h1><p>Its private key is sealed in the owner vault.</p>' +
      '<p><a href="' + installUrl + '">Install ' + role + ' on Ultron.MW</a> and select only that repository.</p>' +
      '<p><a href="' + origin + '/api/brain/council-register">Return to the seven-App checklist</a></p></body>');
  }

  const registered = new Set((await vault.list('app:')).map(key => key.slice(4)));
  const forms = [];
  for (const role of ROLES) {
    const state = randomState();
    await vault.set('state:' + role, { state });
    const manifest = {
      name: 'ultron-mw-' + role.toLowerCase(),
      url: 'https://github.com/michaeljwilliams0123/Ultron.MW',
      public: false,
      description: 'Ultron Continuum ' + role + ' council identity for broad repository automation',
      default_events: [],
      default_permissions: PERMISSIONS,
      redirect_url: origin + '/api/brain/council-register?role=' + encodeURIComponent(role) + '&state=' + state,
      setup_url: origin + '/api/brain/council-register?installed=' + encodeURIComponent(role),
      setup_on_update: true
    };
    const done = registered.has(role);
    forms.push('<form method="post" action="https://github.com/settings/apps/new?state=' + state + '" style="margin:.8em 0">' +
      '<input type="hidden" name="manifest" value="' + escapeAttribute(JSON.stringify(manifest)) + '">' +
      '<button style="padding:.6em 1em"' + (done ? ' disabled' : '') + '>' + (done ? 'Registered: ' : 'Create: ') + role + '</button></form>');
  }

  return res.send('<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;max-width:720px;margin:3em auto">' +
    '<h1>Ultron council App registration</h1><p>Each button opens GitHub\'s manifest confirmation. Approve creation, then install the App on Ultron.MW only.</p>' +
    '<p><strong>Permission model:</strong> broad repository API access, not account-owner equivalence.</p>' + forms.join('') + '</body>');
}
