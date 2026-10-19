(async () => {
  const $ = id => document.getElementById(id);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  let connected = false;
  let modelReady = false;
  let browserBrain = null;
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
      ...state.receipts.slice(-12).map(x => ({
        label: x.kind === 'model-response' ? 'Ultron · local model (unverified narrative)' : 'Ultron · ' + x.status + ' · ' + x.command,
        message: x.summary + '\n' + JSON.stringify(x.details), at: x.createdAt,
      })),
    ].sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).slice(-15);
    for (const item of entries) line(item.label, item.message);
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
    if (!items.length) line('Ultron · memory ready',
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

  const browserButton = $('enable-browser-ai');
  const browserInfo = $('browser-ai-info');
  if (!local) {
    $('browser-mode').classList.remove('hidden');
    if (!globalThis.navigator?.gpu) {
      browserButton.disabled = true;
      browserInfo.textContent = 'This browser has no WebGPU. The public shell stays offline; use a WebGPU-capable browser or your private local runtime.';
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
      browserInfo.textContent = 'Session-only AI responses. No tools, no cross-device memory, no hosted inference.';
      $('status').textContent = 'On-device AI · no tools';
      $('status').classList.add('live');
      $('runtime').textContent = 'Browser';
      $('hero-sub').textContent = 'Local WebGPU inference ready · external execution disabled';
    } catch (error) {
      browserBrain = null;
      browserButton.disabled = false;
      browserButton.textContent = 'Retry on-device AI';
      browserInfo.textContent = (error instanceof Error ? error.message : 'On-device model failed') +
        '. No model response or tool execution occurred.';
      $('status').textContent = 'Static Pages shell · offline';
      $('status').classList.remove('live');
    }
  });
  async function sync() {
    if (!local) {
      connected = false;
      modelReady = false;
      $('status').textContent = 'Static Pages shell · offline';
      $('runtime').textContent = 'Offline';
      $('hero-sub').textContent = 'Start local runtime for live execution';
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
      if (health.name !== 'Ultron' || health.connected !== true) throw Error('Wrong local runtime');
      connected = true;
      modelReady = health.modelReady === true;
      $('status').textContent = modelReady ? 'Local model · read-only tools' : 'Local runtime · read-only';
      $('status').classList.add('live');
      $('runtime').textContent = 'Local';
      $('objectives').textContent = String(state.objectives.length);
      $('release').textContent = state.acceptedVersion || 'seed-v1';
      $('hero-sub').textContent = modelReady ? 'Local model '+ health.model +' ready · bounded tool access' : 'Deterministic tools online · AI provider not connected';
      $('learning-state').textContent = String(state.observations) + ' evidence observations · ' +
        String(state.candidates) + ' candidates · accepted release ' + state.acceptedVersion + '.';
      history(state);
    } catch {
      connected = false;
      modelReady = false;
      $('status').classList.remove('live');
      $('status').textContent = 'Local runtime unavailable';
      $('runtime').textContent = 'Offline';
      $('hero-sub').textContent = 'Start local runtime; no tool execution is available';
    }
  }
  $('composer').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('message');
    const text = input.value.trim();
    if (!text) return;
    if (!connected) {
      if (browserBrain?.ready()) {
        if (text.startsWith('/')) {
          line('Ultron · unsupported', 'Browser-only AI cannot run PC, GitHub, or system commands. Connect the private local runtime for tools.');
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
      line('Ultron · unsaved', 'No execution engine is active. Enable on-device AI or start the private local runtime. No message was saved.');
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
