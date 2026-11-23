export const WORKERS_AI_MODELS = Object.freeze({
  classify: '@cf/meta/llama-3.1-8b-instruct-fast',
  summarize: '@cf/meta/llama-3.1-8b-instruct-fast',
  embed: '@cf/baai/bge-small-en-v1.5',
});

export const FREE_TIER_NEURON_BUDGET = Object.freeze({
  dailyNeuronLimit: 10000,
  resetCadence: 'daily-utc',
  ceilingUsd: 0,
  maxInputChars: 8000,
  maxTokens: Object.freeze({
    classify: 64,
    summarize: 180,
  }),
  notes:
    'Cloudflare Workers AI free tier provides 10,000 Neurons/day at $0. Input length and max_tokens are capped to stay within the free-tier ceiling.',
});

const DEFAULT_CLASSIFY_LABELS = Object.freeze(['urgent', 'normal', 'low-priority', 'noise']);
const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/i;

async function readConfigValue(config, key) {
  let value = null;
  if (config && typeof config.get === 'function') {
    try {
      value = await config.get(key);
    } catch {
      value = null;
    }
  }
  if ((value == null || String(value).trim() === '') && typeof process !== 'undefined' && process?.env) {
    value = process.env[key];
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function maskAccountId(accountId) {
  if (!accountId) return null;
  if (accountId.length <= 10) return `${accountId.slice(0, 2)}...`;
  return `${accountId.slice(0, 6)}...${accountId.slice(-4)}`;
}

export async function getWorkersAiReadiness({ config } = {}) {
  const [accountId, token] = await Promise.all([
    readConfigValue(config, 'CLOUDFLARE_ACCOUNT_ID'),
    readConfigValue(config, 'CLOUDFLARE_AI_TOKEN'),
  ]);

  const missingEnvVars = [];
  if (!accountId) missingEnvVars.push('CLOUDFLARE_ACCOUNT_ID');
  if (!token) missingEnvVars.push('CLOUDFLARE_AI_TOKEN');

  const accountIdValidFormat = accountId ? ACCOUNT_ID_RE.test(accountId) : false;

  return {
    ready: missingEnvVars.length === 0 && accountIdValidFormat,
    accountConfigured: Boolean(accountId),
    accountIdValidFormat,
    accountIdPreview: maskAccountId(accountId),
    tokenConfigured: Boolean(token),
    missingEnvVars,
    models: WORKERS_AI_MODELS,
    modes: ['classify', 'summarize', 'embed'],
    freeTierBudget: FREE_TIER_NEURON_BUDGET,
  };
}

function normalizeLabels(labels) {
  if (labels === undefined || labels === null) {
    return { ok: true, labels: [...DEFAULT_CLASSIFY_LABELS] };
  }
  if (!Array.isArray(labels) || labels.length < 2 || labels.length > 20) {
    return {
      ok: false,
      error: 'invalid-labels',
      message: 'labels must be an array of 2 to 20 non-empty strings.',
    };
  }
  const cleaned = [];
  for (const item of labels) {
    if (typeof item !== 'string') {
      return { ok: false, error: 'invalid-labels', message: 'Every label must be a string.' };
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 64) {
      return {
        ok: false,
        error: 'invalid-labels',
        message: 'Each label must be 1 to 64 characters.',
      };
    }
    cleaned.push(trimmed);
  }
  return { ok: true, labels: cleaned };
}

function buildRequestForMode({ mode, text, labels }) {
  const model = WORKERS_AI_MODELS[mode];
  if (mode === 'classify') {
    return {
      model,
      body: {
        messages: [
          {
            role: 'system',
            content: `Classify the user text into exactly one of these labels: ${labels.join(', ')}. Reply with only the chosen label.`,
          },
          { role: 'user', content: text },
        ],
        max_tokens: FREE_TIER_NEURON_BUDGET.maxTokens.classify,
        temperature: 0,
      },
    };
  }
  if (mode === 'summarize') {
    return {
      model,
      body: {
        messages: [
          {
            role: 'system',
            content: 'Summarize the user text concisely in 1 to 3 clear sentences.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: FREE_TIER_NEURON_BUDGET.maxTokens.summarize,
        temperature: 0.2,
      },
    };
  }
  return {
    model,
    body: {
      text: [text],
    },
  };
}

function extractTextOutput(result) {
  if (typeof result?.response === 'string') return result.response.trim();
  const choiceContent = result?.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent.trim();
  return null;
}

export async function runWorkersAi({ config, mode, text, labels, fetchImpl = fetch } = {}) {
  if (!['classify', 'summarize', 'embed'].includes(mode)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid-mode',
      message: "mode must be one of: 'classify', 'summarize', 'embed'.",
    };
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'invalid-text',
      message: 'text must be a non-empty string.',
    };
  }

  const trimmedText = text.trim();
  if (trimmedText.length > FREE_TIER_NEURON_BUDGET.maxInputChars) {
    return {
      ok: false,
      status: 400,
      error: 'text-too-long',
      message: `text exceeds max length of ${FREE_TIER_NEURON_BUDGET.maxInputChars} characters.`,
    };
  }

  let normalizedLabels = null;
  if (mode === 'classify') {
    const labelCheck = normalizeLabels(labels);
    if (!labelCheck.ok) {
      return { ok: false, status: 400, error: labelCheck.error, message: labelCheck.message };
    }
    normalizedLabels = labelCheck.labels;
  }

  const [accountId, token] = await Promise.all([
    readConfigValue(config, 'CLOUDFLARE_ACCOUNT_ID'),
    readConfigValue(config, 'CLOUDFLARE_AI_TOKEN'),
  ]);

  const missingEnvVars = [];
  if (!accountId) missingEnvVars.push('CLOUDFLARE_ACCOUNT_ID');
  if (!token) missingEnvVars.push('CLOUDFLARE_AI_TOKEN');

  if (missingEnvVars.length > 0) {
    return {
      ok: false,
      status: 503,
      error: 'workers-ai-not-configured',
      missingEnvVars,
      message: `Cloudflare Workers AI is not configured in Hatchable (missing: ${missingEnvVars.join(', ')}). Configure them in protected Hatchable Setup.`,
    };
  }

  if (!ACCOUNT_ID_RE.test(accountId)) {
    return {
      ok: false,
      status: 503,
      error: 'invalid-cloudflare-account-id',
      message: 'CLOUDFLARE_ACCOUNT_ID must be a 32-character hex Cloudflare account ID.',
    };
  }

  const { model, body } = buildRequestForMode({
    mode,
    text: trimmedText,
    labels: normalizedLabels,
  });

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'workers-ai-network-error',
      message: 'Failed to reach Cloudflare Workers AI REST API.',
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const cfError = Array.isArray(payload?.errors) && payload.errors[0]?.message
      ? payload.errors[0].message
      : `HTTP ${response.status}`;
    return {
      ok: false,
      status: response.status >= 500 ? 503 : 502,
      error: 'workers-ai-upstream-error',
      upstreamStatus: response.status,
      message: `Cloudflare Workers AI request failed: ${cfError}`,
    };
  }

  const result = payload?.result ?? null;
  const usage = result?.usage ?? null;

  if (mode === 'embed') {
    const vector = Array.isArray(result?.data?.[0]) ? result.data[0] : null;
    return {
      ok: true,
      status: 200,
      mode,
      model,
      output: {
        dimensions: vector ? vector.length : 0,
        embedding: vector,
      },
      usage,
      freeTierBudget: FREE_TIER_NEURON_BUDGET,
    };
  }

  const textOutput = extractTextOutput(result);
  if (mode === 'classify') {
    const matched = normalizedLabels.find(
      (lbl) => lbl.toLowerCase() === (textOutput || '').toLowerCase()
    );
    return {
      ok: true,
      status: 200,
      mode,
      model,
      output: {
        label: matched || textOutput,
        raw: textOutput,
        labels: normalizedLabels,
      },
      usage,
      freeTierBudget: FREE_TIER_NEURON_BUDGET,
    };
  }

  return {
    ok: true,
    status: 200,
    mode,
    model,
    output: {
      summary: textOutput,
    },
    usage,
    freeTierBudget: FREE_TIER_NEURON_BUDGET,
  };
}