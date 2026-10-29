(async () => {
  const { createCloudTaskUrl } = await import('./core/cloud-submit.mjs');
  const { createCloudPrUrl } = await import('./core/cloud-pr-submit.mjs');
  const { CODEX_AUTHORS } = await import('./core/codex-authors.mjs');
  const { fetchCloudStatus } = await import('./core/cloud-status.mjs');
  let cloudStatusLoaded = false;
  async function refreshHostedCloud() {
    const status = document.getElementById('hatchable-cloud-status');
    const button = document.getElementById('hatchable-refresh');
    if (!status || !button) return;
    button.disabled = true;
    status.textContent = 'Checking live cloud runtime…';
    try {
      const result = await fetchCloudStatus();
      cloudStatusLoaded = true;
      const last = result.lastEventAt ? ' · Last ledger event: ' + result.lastEventAt : ' · No ledger event reported';
      status.textContent = 'Cloud runtime: ' + result.status +
        ' · Scheduler: configured hourly · Observed: ' + result.observedAt + last;
    } catch {
      status.textContent = 'Cloud status could not be verified. No backend action was submitted.';
    } finally { button.disabled = false; }
  }
  document.getElementById('hatchable-refresh')?.addEventListener('click', refreshHostedCloud);
  document.querySelector('[data-tab="systems"]')?.addEventListener('click', () => {
    if (!cloudStatusLoaded) void refreshHostedCloud();
  });

  const $ = id => document.getElementById(id);
  for (const author of CODEX_AUTHORS) {
    const card = document.createElement('article');
    card.className = 'codex-author-card';
    const name = document.createElement('strong');
    name.textContent = author.name;
    const alias = document.createElement('p');
    alias.textContent = 'Callable name: ' + author.id;
    const fingerprint = document.createElement('code');
    fingerprint.textContent = 'Author fingerprint: ' + author.fingerprint;
    const status = document.createElement('p');
    status.className = 'muted';
    status.textContent = author.binding ? 'Work route enrolled · check each task receipt for execution' :
      'Not bound · enrollment needed from Mike’s account';
    card.append(name, alias, fingerprint, status);
    if (author.binding) {
      const binding = document.createElement('code');
      binding.textContent = 'Route fingerprint: ' + author.binding.fingerprint;
      card.append(binding);
    }
    if (author.sessionObservation) {
      const observation = document.createElement('p');
      observation.className = 'muted';
      observation.textContent = 'Setup session fingerprint: ' + author.sessionObservation.threadFingerprint +
        ' · observation only; not account authentication';
      card.append(observation);
    }
    $('codex-author-cards').append(card);
    const option = document.createElement('option');
    option.value = author.id;
    option.textContent = author.name + (author.binding ? '' : ' (not bound)');
    option.selected = Boolean(author.binding);
    $('codex-author').append(option);
  }
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local) document.getElementById('optional-local-actions')?.classList.remove('hidden');
  let connected = false;
  let modelReady = false;
  let browserBrain = null;
  let localEvolution = null;
  let vault = null;
  const ephemeralExchanges = [];
  const title = {
    brain: 'Ultron is ready to evolve.',
    learning: 'Evidence before evolution.',
    systems: 'One brain. One command surface.',
  };
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    const tab = button.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(item =>
      item.setAttribute('aria-current', item === button ? 'page' : 'false'));
    for (const key of Object.keys(title)) $('pane-' + key).classList.toggle('hidden', key !== tab);
    $('heading').textContent = title[tab];
  }));
  function line(label, content) {
    const div = document.createElement('div');
    div.className = 'entry';
    const header = document.createElement('strong');
    header.textContent = label;
    const body = document.createElement('p');
    body.textContent = content;
    div.append(header, body);
    $('feed').appendChild(div);
    div.scrollIntoView({ block: 'nearest' });
    return div;
  }
  function history(state) {
    $('feed').replaceChildren();
    const entries = [
      ...state.objectives.slice(-12).map(x => ({ label: 'You · saved draft', message: x.text, at: x.createdAt })),
      ...(state.plans || []).slice(-8).map(x => ({ label: 'Ultron · objective ' + x.status,
        message: x.objective, at: x.createdAt, plan: x })),
      ...state.receipts.slice(-12).map(x => ({
        label: x.kind === 'model-response' ? 'Ultron · local model (unverified narrative)' : 'Ultron · ' + x.status + ' · ' + x.command,
        message: x.summary + '\n' + JSON.stringify(x.details), at: x.createdAt,
      })),
    ].sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).slice(-15);
    for (const item of entries) {
      const card = line(item.label, item.message);
      if (item.plan) addPlanControls(card, item.plan);
    }
    if (!entries.length) line('Ultron · capabilities',
      'Use /help, /system status, /repo inspect, /learning status for verified read-only operations. Other text is saved as a draft.');
  }
  const passphraseInput = $('vault-passphrase');
  const vaultStatus = $('vault-state');
  const vaultToggle = $('vault-toggle');
  const vaultClear = $('vault-clear');
  const vaultExport = $('vault-export');
  const vaultImport = $('vault-import');
  const vaultImportFile = $('vault-import-file');

  function updateVaultUI(message = '') {
    if (!vault) return;
    const open = vault.unlocked();
    const present = vault.saved();
    const info = vault.statistics();
    vaultToggle.textContent = open ? 'Lock browser memory' : present ? 'Unlock memory' : 'Start local memory';
    // Permit entering another backup passphrase while an existing vault is unlocked.
    passphraseInput.disabled = false;
    vaultClear.disabled = !present;
    vaultExport.disabled = !present;
    vaultStatus.textContent = message || (open
      ? 'Unlocked on this device. Responses are encrypted before storing. Remember your passphrase.'
      : present ? 'Encrypted memory exists on this device. Enter your passphrase to unlock it.' :
        'Memory is off. Browser AI conversations disappear when you reload.');
    $('active-routing').textContent = 'Accepted routing strategy: ' + (open ? vault.evolution().accepted : 'routing-v1 (locked)');
    $('learning-state').textContent = open
      ? info.total + ' saved responses · ' + info.helpful + ' helpful · ' +
        info.notHelpful + ' not helpful · ' + info.unrated +
        ' unrated. These are owner feedback signals, not independently verified improvements.'
      : 'No unlocked browser memory; no automatic training or cross-device synchronization.';
  }

  function addFeedbackCard(container, id, existing = null) {
    if (!vault?.unlocked() || !id) return;
    const row = document.createElement('div');
    row.className = 'feedback';
    const choices = [
      { value: 'helpful', label: 'Helpful' },
      { value: 'not-helpful', label: 'Not helpful' },
    ];
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      button.setAttribute('aria-pressed', String(existing === choice.value));
      button.addEventListener('click', async () => {
        for (const item of row.querySelectorAll('button')) item.disabled = true;
        try {
          await vault.rate(id, choice.value);
          for (const item of row.querySelectorAll('button')) {
            item.setAttribute('aria-pressed', String(item.textContent === choice.label));
          }
          updateVaultUI('Feedback saved in the encrypted local ledger.');
        } catch (error) {
          updateVaultUI('Feedback not saved: ' + (error instanceof Error ? error.message : 'storage failure'));
        } finally {
          for (const item of row.querySelectorAll('button')) item.disabled = false;
        }
      });
      row.appendChild(button);
    }
    container.appendChild(row);
  }

  function restoreSavedHistory() {
    if (!vault?.unlocked()) return;
    $('feed').replaceChildren();
    const items = vault.snapshot().exchanges.slice(-10);
    for (const item of items) {
      line('You · encrypted local history', item.prompt);
      const card = line('Ultron · saved model answer (unverified)', item.answer);
      addFeedbackCard(card, item.id, item.feedback);
    }
    for (const plan of vault.snapshot().plans.slice(-4)) {
      const card = line('Ultron · encrypted saved plan (not executed)', plan.objective);
      addPlanControls(card, plan);
    }
    if (!items.length && !vault.snapshot().plans.length) line('Ultron · memory ready',
      'Your next browser AI responses can be saved here. This memory stays on this device and cannot perform tools.');
  }

  if (!local) {
    $('vault-pane').classList.remove('hidden');
    try {
      const { createBrowserVault } = await import('./browser-vault.mjs');
      vault = createBrowserVault();
      updateVaultUI();
    } catch (error) {
      vaultToggle.disabled = true;
      vaultStatus.textContent = error instanceof Error ? error.message : 'Encrypted storage is unavailable.';
    }
  }
  vaultToggle.addEventListener('click', async () => {
    if (!vault || local) return;
    if (vault.unlocked()) {
      vault.lock();
      ephemeralExchanges.length = 0;
      $('feed').replaceChildren();
      line('Ultron · local memory locked', 'Saved conversations are hidden until you unlock again.');
      updateVaultUI();
      return;
    }
    const phrase = passphraseInput.value;
    vaultToggle.disabled = true;
    try {
      await vault.open(phrase);
      passphraseInput.value = '';
      ephemeralExchanges.length = 0;
      restoreSavedHistory();
      updateVaultUI('Memory unlocked. New browser AI replies and feedback will be encrypted locally.');
    } catch (error) {
      updateVaultUI('Unable to unlock: ' + (error instanceof Error ? error.message : 'unknown error'));
    } finally {
      passphraseInput.value = '';
      vaultToggle.disabled = false;
    }
  });
  vaultClear.addEventListener('click', () => {
    if (!vault || !vault.saved()) return;
    if (!confirm('Permanently delete encrypted Ultron browser memory from this device? This cannot be undone.')) return;
    try {
      vault.clear();
      ephemeralExchanges.length = 0;
      $('feed').replaceChildren();
      line('Ultron · memory deleted', 'Encrypted browser history and feedback were deleted from this browser storage.');
      updateVaultUI();
    } catch (error) {
      updateVaultUI('Unable to delete memory: ' + (error instanceof Error ? error.message : 'storage failure'));
    }
  });
  vaultImport.addEventListener('click', () => {
    if (!vault || local) return;
    vaultImportFile.click();
  });
  vaultImportFile.addEventListener('change', async () => {
    const file = vaultImportFile.files?.[0];
    vaultImportFile.value = '';
    if (!vault || !file) return;
    if (file.size > 360000) {
      updateVaultUI('Backup too large; expected an encrypted Ultron memory file.');
      return;
    }
    const phrase = passphraseInput.value;
    if (phrase.length < 10) {
      updateVaultUI('Enter the backup passphrase (at least 10 characters) before importing.');
      return;
    }
    const replacing = vault.saved();
    if (replacing && !confirm('Replace the current encrypted browser memory with the selected backup? Existing saved history will be overwritten.')) {
      updateVaultUI('Import canceled. Existing encrypted memory was preserved.');
      return;
    }
    vaultImport.disabled = true;
    try {
      const encrypted = await file.text();
      await vault.importBackup(encrypted, phrase, { replace: replacing });
      ephemeralExchanges.length = 0;
      restoreSavedHistory();
      updateVaultUI('Encrypted backup imported and unlocked on this device. Import is manual, not automatic synchronization.');
    } catch (error) {
      updateVaultUI('Import failed, existing memory unchanged: ' +
        (error instanceof Error ? error.message : 'unknown error'));
    } finally {
      vaultImport.disabled = false;
      passphraseInput.value = '';
    }
  });

  vaultExport.addEventListener('click', () => {
    if (!vault || !vault.saved()) return;
    try {
      const backup = vault.encryptedBackup();
      const blob = new Blob([backup], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ultron-mw-vault-encrypted.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      updateVaultUI('Encrypted backup download requested. This file can be imported manually on another device using your passphrase.');
    } catch (error) {
      updateVaultUI('Export failed: ' + (error instanceof Error ? error.message : 'unknown error'));
    }
  });


  function acceptedRouting() {
    return connected ? localEvolution?.accepted || 'routing-v1' :
      vault?.unlocked() ? vault.evolution().accepted : 'routing-v1';
  }
  function addPlanControls(card, plan) {
    const pre = document.createElement('pre');
    pre.className = 'plan-list';
    const rows = plan.steps.map(step =>
      String(step.index + 1) + '. ' + (step.command || step.description) +
      ' — ' + step.status + (step.receiptId ? ' · ' + step.receiptId : ''));
    if (plan.advisory?.kind) {
      rows.push('Suggested next owner-approved action: ' + plan.advisory.kind +
        ' · requires manual review, pairing and separate preparation · NOT executed');
    }
    pre.textContent = rows.join('\n');
    card.appendChild(pre);
    if (!connected || !plan.id || !plan.steps.some(step => step.status === 'ready')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plan-run';
    button.textContent = 'Run approved read-only steps';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const r = await fetch('/api/plan/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
          body: JSON.stringify({ id: plan.id }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Plan execution rejected');
        line('Ultron · execution receipt', data.receipts.length +
          ' read-only steps completed; no privileged actions were run.');
        await sync();
      } catch (error) {
        button.disabled = false;
        line('Ultron · execution rejected',
          error instanceof Error ? error.message : 'No verified execution occurred');
      }
    });
    card.appendChild(button);
  }

  async function showPlan(text) {
    if (typeof text !== 'string' || !text.trim()) {
      line('Ultron · plan error', 'Enter an objective first.');
      return;
    }
    try {
      let plan;
      if (connected) {
        const response = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
          body: JSON.stringify({ text }),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'Plan could not be persisted');
        plan = data.plan;
      } else {
        const { planObjective } = await import('./core/cycle.mjs');
        plan = planObjective(text, { strategy: acceptedRouting() });
        if (vault?.unlocked()) plan = await vault.savePlan(plan);
      }
      const card = line('Ultron · ' + (connected ? 'saved local objective plan' :
        vault?.unlocked() ? 'encrypted browser plan (not executed)' : 'session-only draft plan'), plan.objective);
      addPlanControls(card, plan);
      if (!connected) line('Ultron · execution boundary',
        'Pages can plan tasks; select Run in GitHub cloud for hosted read-only execution. It cannot directly execute private PC actions.');
    } catch (error) {
      line('Ultron · planning failed',
        error instanceof Error ? error.message : 'Could not create plan');
    }
  }

  function routePrToGitHub(objective) {
    try {
      const url = createCloudPrUrl(objective);
      window.open(url, '_blank', 'noopener,noreferrer');
      line(/^\/codex(?:\s|$)/i.test(objective) ? 'Ultron · named Codex call' : 'Ultron · Create PR to main',
        /^\/codex(?:\s|$)/i.test(objective) ?
        'Confirm the public Issue in GitHub. Ultron will create a PR addressed to the named Work executor. Inspect its completion receipt to verify execution. An enrolled route alone is not proof that a task ran.' :
        'Confirm the prefilled Issue in GitHub. A plain objective creates a documentation proposal; a JSON code-change manifest with baseSha and exact source edits creates a real implementation commit and PR targeting main. Both use the same owner-only hosted routing and return a verified PR link. No auto-merge or local PC is required.');
    } catch (error) {
      line('Ultron · PR request rejected', error.message);
    }
  }
  $('cloud-pr').addEventListener('click', () => {
    routePrToGitHub($('code-manifest').value.trim() || $('message').value.trim());
  });
  $('codex-call').addEventListener('click', () => {
    const objective = $('message').value.trim();
    if (!objective) { line('Ultron · Codex call', 'Enter a public task first.'); return; }
    routePrToGitHub(/^\/codex(?:\s|$)/i.test(objective) ? objective :
      '/codex ' + $('codex-author').value + ' ' + objective);
  });
  $('self-scan').addEventListener('click', () => {
    try {
      const url=createCloudTaskUrl('/self scan');
      window.open(url,'_blank','noopener,noreferrer');
      line('Ultron · Self-scan', 'Open GitHub Actions and select Run workflow. Ultron scans current main and creates or updates one findings PR targeting main when results change. No Issue is created.');
    } catch (error) {
      line('Ultron · Self-scan rejected',error.message);
    }
  });
  $('cloud-run').addEventListener('click', () => {
    const objective = $('message').value.trim();
    try {
      const url = createCloudTaskUrl(objective);
      window.open(url, '_blank', 'noopener,noreferrer');
      line('Ultron · public GitHub handoff', url.includes('/actions/workflows/self-scan-pr.yml') ?
      'Select Run workflow on GitHub to create or update the self-scan PR; no Issue is created.' :
      'Review and submit the canonical read-only commands in GitHub. To publish source changes, use Create PR to main.');
    } catch (error) {
      line('Ultron · cloud request rejected', error.message +
        ' To request a PR, use Create PR to main.');
    }
  });

  $('plan-objective').addEventListener('click', async () => {
    await showPlan($('message').value.trim());
  });
  $('run-routing-eval').addEventListener('click', async () => {
    const button = $('run-routing-eval');
    button.disabled = true;
    try {
      let evaluation;
      if (connected) {
        const response = await fetch('/api/learning/evaluate', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
          body: '{}',
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'Evaluation failed');
        evaluation = data.evaluation;
        await sync();
      } else if (vault?.unlocked()) {
        evaluation = await vault.evaluateAndAdopt();
        updateVaultUI();
      } else {
        const { evaluateRouting } = await import('./core/cycle.mjs');
        evaluation = evaluateRouting();
        evaluation.status = 'preview-only';
      }
      if (evaluation.status === 'already-adopted') {
        $('routing-report').textContent = 'Already using routing-v2. No new candidate has been evaluated.';
      } else {
        $('routing-report').textContent =
          evaluation.status + ' · ' + evaluation.total + ' labeled cases · baseline ' +
          Math.round(evaluation.baselineAccuracy * 100) + '% · candidate ' +
          Math.round(evaluation.candidateAccuracy * 100) + '% · delta +' +
          Math.round(evaluation.delta * 100) + ' percentage points · ' +
          evaluation.regressions + ' regressions · ' +
          evaluation.criticalRegressions + ' critical regressions. ' +
          (evaluation.status === 'preview-only' ? 'Unlock memory to persist an adoption.' :
          evaluation.passed ? 'Improved routing strategy adopted.' :
            'Candidate rejected, accepted strategy unchanged.');
      }
    } catch (error) {
      $('routing-report').textContent = 'Evaluation failed: ' +
        (error instanceof Error ? error.message : 'unknown error');
    } finally { button.disabled = false; }
  });
  $('rollback-routing').addEventListener('click', async () => {
    try {
      if (connected) {
        const response = await fetch('/api/learning/rollback', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
          body: JSON.stringify({ reason: 'owner-request' }),
        });
        if (!response.ok) throw Error('Rollback rejected');
        await sync();
      } else if (vault?.unlocked()) {
        await vault.rollbackRouting('owner-request');
        updateVaultUI();
      } else throw Error('Unlock memory to roll back an adopted routing strategy');
      $('routing-report').textContent = 'Routing strategy restored to routing-v1.';
    } catch (error) {
      $('routing-report').textContent = error instanceof Error ? error.message : 'Rollback failed';
    }
  });

  const browserButton = $('enable-browser-ai');
  const browserInfo = $('browser-ai-info');
  if (!local) {
    $('browser-mode').classList.remove('hidden');
    if (!globalThis.navigator?.gpu) {
      browserButton.disabled = true;
      browserInfo.textContent = 'WebGPU is not available on this device. GitHub cloud execution remains accessible without your PC.';
    }
  }
  browserButton.addEventListener('click', async () => {
    if (local || browserButton.disabled) return;
    browserButton.disabled = true;
    browserInfo.textContent = 'Checking GPU support…';
    try {
      const { createBrowserBrain } = await import('./browser-brain.mjs');
      const instance = createBrowserBrain();
      await instance.enable(progress => { browserInfo.textContent = progress; });
      browserBrain = instance;
      browserButton.textContent = 'On-device AI enabled';
      browserInfo.textContent = 'Session-only AI responses. On-device text only; no tools, external actions, cross-device memory, or hosted inference.';
      $('status').textContent = 'On-device AI · no tools';
      $('status').classList.add('live');
      $('runtime').textContent = 'Browser';
      $('hero-sub').textContent = 'On-device browser model ready · no tools or external actions';
    } catch (error) {
      browserBrain = null;
      browserButton.disabled = false;
      browserButton.textContent = 'Retry on-device AI';
      browserInfo.textContent = (error instanceof Error ? error.message : 'On-device model failed') +
        '. No model response or tool execution occurred.';
      $('status').textContent = 'GitHub cloud · browser AI unavailable';
      $('status').classList.add('live');
    }
  });

  // Owner action pairing exists only in this tab and only on localhost.
  let ownerKey = '';
  let preparedOperation = null;
  let lastVerifiedOperation = null;
  const actionStatus = $('action-status');
  const actionResult = $('action-result');

  async function ownerRequest(method, path, body) {
    if (!local || !ownerKey) throw new Error('Local owner pairing required');
    const reply = await fetch(path, {
      method, cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-ultron-owner': ownerKey,
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const data = await reply.json();
    if (!reply.ok) throw new Error(data.error || 'Owner action rejected');
    return data;
  }


  async function refreshExperience() {
    if (!local || !ownerKey) {
      $('experience-summary').textContent =
        'Cloud receipts persist in GitHub Issues. Optional legacy PC learning is separate and not cloud-synchronized.';
      return;
    }
    try {
      const data = await ownerRequest('GET', '/api/owner/learning');
      $('experience-summary').textContent = data.eligible + '/' + data.minimum +
        ' distinct verified, owner-rated actions · active suggestion policy: ' +
        data.activeVersion + ' · ' + data.assessments.length +
        ' stored assessments · ' + data.changes.length + ' audited changes.';
      const report = data.assessments.at(-1);
      if (report) {
        $('experience-report').textContent = 'Latest measured evaluation: ' +
          report.status + ' · ' + report.eligible + ' eligible · ' +
          (report.heldout || 0) + ' later held-out cases' +
          (report.baselineAccuracy === null ? '' :
            ' · baseline ' + Math.round(report.baselineAccuracy * 100) + '%' +
            ' · candidate ' + Math.round(report.candidateAccuracy * 100) + '%') +
          '. User ratings are observational, not proof of general AI training.';
      }
    } catch {
      $('experience-summary').textContent = 'Authenticated outcome history unavailable.';
    }
  }

  $('experience-evaluate').addEventListener('click', async () => {
    if (!local || !ownerKey) {
      $('experience-report').textContent = 'Pair your owner runtime in Systems first.';
      return;
    }
    const button = $('experience-evaluate');
    button.disabled = true;
    try {
      const data = await ownerRequest('POST', '/api/owner/evaluate', {});
      const report = data.report;
      $('experience-report').textContent =
        report.status + ' · ' + report.eligible + ' real eligible outcomes' +
        (report.heldout ? ' · ' + report.heldout + ' chronological holdout cases' : '') +
        (report.delta === undefined ? '' :
          ' · measured change ' + (report.delta * 100).toFixed(1) + ' points' +
          ' · regressions ' + report.regressions) +
        ' · active policy ' + data.activeVersion +
        '. This changes suggestions only, never action permissions.';
      await refreshExperience();
    } catch (error) {
      $('experience-report').textContent = 'Evaluation failed: ' + error.message;
    } finally { button.disabled = false; }
  });

  $('experience-rollback').addEventListener('click', async () => {
    if (!local || !ownerKey) {
      $('experience-report').textContent = 'Pair your owner runtime in Systems first.';
      return;
    }
    try {
      const data = await ownerRequest('POST', '/api/owner/rollback',
        { reason: 'owner-request' });
      $('experience-report').textContent = data.status +
        ' · accepted suggestion policy: ' + data.active +
        '. No execution rights were changed.';
      await refreshExperience();
    } catch (error) {
      $('experience-report').textContent = 'Rollback failed: ' + error.message;
    }
  });

  $('action-suggest').addEventListener('click', async () => {
    const objective = ($('action-title').value + ' ' + $('action-text').value).trim();
    if (!objective) {
      actionResult.textContent = 'Enter a task description to receive a nonexecuting suggestion.';
      return;
    }
    try {
      const data = await ownerRequest('POST', '/api/owner/suggest', { objective });
      actionResult.textContent = data.kind
        ? 'Suggested action: ' + data.kind + ' (policy ' + data.activeVersion +
          '). A suggestion does NOT prepare or execute a job.'
        : 'Ultron abstained: no sufficiently supported and currently allowed action. ' +
          'No action was prepared or executed.';
    } catch (error) { actionResult.textContent = error.message; }
  });

  if (!local) {
    $('action-pair').disabled = true;
    actionStatus.textContent = 'GitHub Pages cannot connect to the private local runtime. Open the same interface at 127.0.0.1 on your PC.';
  }

  async function refreshOwnerOutcomes() {
    if (!ownerKey) return;
    try {
      const data = await ownerRequest('GET', '/api/owner/jobs');
      const x = data.outcomes;
      if (!x) return;
      $('action-outcomes').textContent = x.verified + ' verified actions · ' +
        x.helpful + ' helpful · ' + x.notHelpful + ' not helpful · ' +
        x.unrated + ' unrated · ' + x.reconcileRequired +
        ' require reconciliation' +
        (x.meanVerifiedLatencyMs === null ? '' :
          ' · mean verified latency ' + x.meanVerifiedLatencyMs + ' ms') + '.';
    } catch {
      $('action-outcomes').textContent = 'Outcome history unavailable.';
    }
  }

  $('action-pair').addEventListener('click', async () => {
    if (!local) return;
    ownerKey = $('action-key').value.trim();
    $('action-key').value = '';
    preparedOperation = null;
    $('action-execute').disabled = true;
    if (!ownerKey) {
      actionStatus.textContent = 'Enter the current session key printed by your local Ultron runtime.';
      return;
    }
    try {
      const status = await ownerRequest('GET', '/api/owner/status');
      if (status.paired !== true) throw new Error('Not paired');
      $('action-controls').classList.remove('hidden');
      await refreshOwnerOutcomes();
      await refreshExperience();
      const githubOption = $('action-kind').querySelector('option[value="github-draft"]');
      githubOption.disabled = !status.actions?.includes('github-draft');
      if (githubOption.disabled) $('action-kind').value = 'local-note';
      actionStatus.textContent = githubOption.disabled
        ? 'Owner paired · isolated local notes ready · GitHub draft writes disabled pending acceptance.'
        : status.github.connected
          ? 'Owner paired · GitHub identity: ' + status.github.account + ' · draft-only adapter enabled.'
          : 'Owner paired · local notes ready · GitHub CLI authentication unavailable.';
    } catch {
      ownerKey = '';
      $('action-controls').classList.add('hidden');
      actionStatus.textContent = 'Pairing was denied. Confirm the local runtime session key.';
    }
  });

  $('action-prepare').addEventListener('click', async () => {
    if (!local) return;
    const job = {
      id: crypto.randomUUID(),
      kind: $('action-kind').value,
      title: $('action-title').value.trim(),
      text: $('action-text').value.trim(),
    };
    $('action-prepare').disabled = true;
    $('action-execute').disabled = true;
    try {
      const result = await ownerRequest('POST', '/api/owner/prepare', job);
      preparedOperation = result.job;
      $('action-kind').disabled = true;
      $('action-title').disabled = true;
      $('action-text').disabled = true;
      $('action-execute').disabled = false;
      actionResult.textContent = 'Prepared but NOT executed: ' + job.kind + ' (' +
        result.job.id + '). Review the displayed title and note body, then choose Execute.';
    } catch (error) {
      actionResult.textContent = 'Nothing prepared: ' + error.message;
    } finally {
      $('action-prepare').disabled = false;
    }
  });

  $('action-execute').addEventListener('click', async () => {
    if (!preparedOperation) return;
    $('action-execute').disabled = true;
    const jobId = preparedOperation.id;
    actionResult.textContent = 'Running this specific approved operation; checking actual outcome.';
    try {
      const result = await ownerRequest('POST', '/api/owner/execute', { id: jobId });
      lastVerifiedOperation = jobId;
      $('action-good').disabled = false;
      $('action-bad').disabled = false;
      actionResult.textContent = 'VERIFIED: ' + result.receipt.summary +
        ' · receipt ' + result.receipt.id +
        (result.receipt.details.url ? ' · ' + result.receipt.details.url : '');
      await refreshOwnerOutcomes();
      line('Ultron · verified owner operation', result.receipt.summary +
        '\n' + JSON.stringify(result.receipt.details));
    } catch (error) {
      actionResult.textContent = 'Outcome NOT verified: ' + error.message +
        '. Inspect the operation before preparing a new attempt.';
    } finally {
      preparedOperation = null;
      $('action-kind').disabled = false;
      $('action-title').disabled = false;
      $('action-text').disabled = false;
    }
  });

  for (const [id, rating] of [['action-good','helpful'],['action-bad','not-helpful']]) {
    $(id).addEventListener('click', async () => {
      if (!lastVerifiedOperation) return;
      try {
        const result = await ownerRequest('POST', '/api/owner/feedback', {
          id: lastVerifiedOperation, rating,
        });
        await refreshOwnerOutcomes();
        await refreshExperience();
        actionResult.textContent = 'Owner feedback recorded as ' + result.rating +
          ' for independently verified receipt ' + result.receiptId + '.';
      } catch (error) {
        actionResult.textContent = error.message;
      }
    });
  }

  async function sync() {
    if (!local) {
      connected = false;
      modelReady = false;
      $('status').textContent = 'GitHub cloud · owner confirmation';
      $('status').classList.add('live');
      $('runtime').textContent = 'GitHub';
      $('hero-sub').textContent = 'On-demand GitHub-hosted execution · optional browser AI';
      return;
    }
    try {
      const [hr, sr] = await Promise.all([
        fetch('/api/health', { cache: 'no-store' }),
        fetch('/api/state', { cache: 'no-store' }),
      ]);
      if (!hr.ok || !sr.ok) throw Error('Local runtime unavailable');
      const health = await hr.json();
      const state = await sr.json();
      localEvolution = state.evolution || null;
      if (health.name !== 'Ultron' || health.connected !== true) throw Error('Wrong local runtime');
      connected = true;
      modelReady = health.modelReady === true;
      $('status').textContent = modelReady ? 'Local model · read-only tools' : 'Local runtime · read-only';
      $('status').classList.add('live');
      $('runtime').textContent = 'Local';
      $('objectives').textContent = String(state.objectives.length);
      $('release').textContent = state.evolution?.accepted || state.acceptedVersion || 'routing-v1';
      $('active-routing').textContent = 'Accepted routing strategy: ' + acceptedRouting();
      $('hero-sub').textContent = modelReady ? 'Local model '+ health.model +' ready · bounded tool access' : 'Deterministic tools online · AI provider not connected';
      $('learning-state').textContent = String(state.observations) + ' evidence observations · ' +
        String(state.candidates) + ' candidates · accepted release ' + state.acceptedVersion + '.';
      history(state);
    } catch {
      connected = false;
      modelReady = false;
      $('status').classList.remove('live');
      $('status').textContent = 'GitHub cloud on demand · local extension offline';
      $('runtime').textContent = 'GitHub';
      $('hero-sub').textContent = 'Hosted read-only tasks do not need localhost';
    }
  }
  $('composer').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('message');
    const text = input.value.trim();
    if (!text) return;
    if (/^\/codex(?:\s|$)/i.test(text)) { routePrToGitHub(text); return; }
    // Owner-intended PR requests route to GitHub Actions rather than a
    // browser LLM that cannot execute repository tools.
    if (/^(?:please\s+)?(?:create|open|launch|draft|make)\b.*\b(?:pr|pull request)\b/i.test(text)) {
      routePrToGitHub(text);
      return;
    }
    if (!connected) {
      if (text.startsWith('/plan ')) {
        await showPlan(text.slice(6).trim());
        return;
      }
      if (browserBrain?.ready()) {
        if (text.startsWith('/')) {
          line('Ultron · browser-only inference', 'Use Run in GitHub cloud for hosted read-only tools. The browser model cannot issue tool receipts.');
          return;
        }
        const submit = $('composer').querySelector('button');
        submit.disabled = true;
        line('You · browser session (unsaved)', text);
        try {
          const context = vault?.unlocked()
            ? vault.context() : ephemeralExchanges.slice(-3).flatMap(item => ([
              { role: 'user', content: item.prompt.slice(0, 750) },
              { role: 'assistant', content: item.answer.slice(0, 1100) },
            ]));
          const response = await browserBrain.respond(text, { context });
          let savedRecord = null;
          if (vault?.unlocked()) {
            try {
              savedRecord = await vault.record({
                prompt: text, answer: response.text, model: response.model,
              });
              updateVaultUI();
            } catch (error) {
              line('Ultron · save failed', 'The answer was generated, but memory was not saved: ' +
                (error instanceof Error ? error.message : 'storage error'));
            }
          }
          if (!savedRecord) {
            ephemeralExchanges.push({ prompt: text, answer: response.text });
            if (ephemeralExchanges.length > 4) ephemeralExchanges.shift();
          }
          const card = line(
            savedRecord ? 'Ultron · locally saved model answer (unverified)' :
              'Ultron · session-only model answer (unverified)', response.text);
          if (savedRecord) addFeedbackCard(card, savedRecord.id);
          input.value = '';
        } catch (error) {
          line('Ultron · model error', error instanceof Error ? error.message : 'On-device inference failed');
        } finally {
          submit.disabled = false;
        }
        return;
      }
      line('Ultron · cloud execution', 'Use Run in GitHub cloud for supported tasks or optionally enable browser AI for chat. No specific computer needs to be online.');
      return;
    }
    if (text.startsWith('/plan ')) {
      await showPlan(text.slice(6).trim());
      return;
    }
    const url = text.startsWith('/') ? '/api/execute' : modelReady ? '/api/think' : '/api/objectives';
    $('composer').querySelector('button').disabled = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ultron-client': 'local-ui-v1' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        line('Ultron · rejected', data.error || 'Operation rejected');
        return;
      }
      input.value = '';
      await sync();
    } catch {
      line('Ultron · failed', 'Local runtime connection failed. No success was recorded.');
      await sync();
    } finally {
      $('composer').querySelector('button').disabled = false;
    }
  });
  sync();
})();
