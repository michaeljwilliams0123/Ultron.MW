export interface Env {
  HATCHABLE_CORE_ORIGIN: string;
  HATCHABLE_RECEIPT_PATH: string;
  ORIGIN_LOCK_PROBE_PATH: string;
  GITHUB_REPO: string;
  OWNER_LOGIN: string;
  ENVIRONMENT: string;
  ENFORCE_CSP: string;
  GITHUB_WEBHOOK_SECRET?: string;
  ORIGIN_LOCK_SECRET?: string;
  ADMIN_TOKEN?: string;
  GITHUB_TOKEN?: string;
  STREAM_TOKEN_SECRET?: string;
  EVENTS: Queue<EdgeEvent>;
  RELEASE_PROOF?: Workflow;
  STREAM_HUB?: DurableObjectNamespace;
  RATE_LIMITER?: DurableObjectNamespace;
}

export type EdgeEvent = {
  kind: "push" | "check_suite" | "deploy";
  delivery: string;
  repo: string;
  receivedAt: string;
  branch?: string;
  sha?: string;
  conclusion?: string;
  artifactDigest?: string;
  manifestFileCount?: number;
  target?: string;
};

export type ReleaseProofParams = {
  mode: "watch" | "sync";
  reason: "push" | "check_suite" | "deploy" | "cron" | "manual";
  repo?: string;
  sourceSha?: string;
  artifactDigest?: string;
  manifestFileCount?: number;
  target?: string;
};

export type ReleaseRequest = {
  key: string;
  target: string;
  sourceSha: string;
  artifactDigest: string;
  manifestFileCount: number;
  independentReadback: true;
};

export function buildKey(target: string, sourceSha: string): string {
  const t = target
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const sha = sourceSha.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);

  let key = `${t}-${sha}`.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (key.length < 8) key = key.padEnd(8, "0");
  if (key.length > 48) key = key.slice(0, 48).replace(/-+$/, "");
  return key;
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

export function withHeader(res: Response, name: string, value: string): Response {
  const headers = new Headers(res.headers);
  headers.set(name, value);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
