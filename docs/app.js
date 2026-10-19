(() => {
  const $ = id => document.getElementById(id);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  let connected = false;
  let modelReady = false;
  let browserBrain = null;
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
          const response = await browserBrain.respond(text);
          line('Ultron · on-device model (unverified)', response.text);
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
