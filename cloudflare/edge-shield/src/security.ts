import type { Env } from "./lib";
import { timingSafeEqual } from "./lib";

const enc = new TextEncoder();

const BASE_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const OWN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function applyOwnHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", OWN_CSP);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function applyProxyHeaders(res: Response, env: Env): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  headers.delete("X-Ultron-Origin-Lock");
  if (env.ENFORCE_CSP === "true") headers.set("Content-Security-Policy", OWN_CSP);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export async function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, signature.slice(7).toLowerCase());
}

export type AuthResult =
  | { ok: true; via: "owner" }
  | { ok: false; status: number; reason: string };

export function authorizeAdmin(request: Request, env: Env): AuthResult {
  if (!env.ADMIN_TOKEN) {
    return { ok: false, status: 503, reason: "admin_token_not_configured" };
  }
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return { ok: false, status: 401, reason: "invalid_token" };
  }
  const owner = request.headers.get("X-Ultron-Owner") ?? "";
  if (!timingSafeEqual(owner, env.OWNER_LOGIN)) {
    return { ok: false, status: 403, reason: "owner_required" };
  }
  return { ok: true, via: "owner" };
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: ("sign" | "verify")[]) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function signStreamToken(
  secret: string,
  channel: string,
  expMs: number,
): Promise<string> {
  const payload = `${channel}.${expMs}`;
  const key = await hmacKey(secret, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return `${b64url(enc.encode(payload))}.${b64url(mac)}`;
}

export async function verifyStreamToken(
  secret: string,
  channel: string,
  token: string | null,
): Promise<boolean> {
  if (!token) return false;
  const [p, m] = token.split(".");
  if (!p || !m) return false;
  let payload: string;
  try {
    payload = new TextDecoder().decode(unb64url(p));
  } catch {
    return false;
  }
  const [tokenChannel, expStr] = payload.split(".");
  if (tokenChannel !== channel) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const key = await hmacKey(secret, ["verify"]);
  try {
    return await crypto.subtle.verify("HMAC", key, unb64url(m), enc.encode(payload));
  } catch {
    return false;
  }
}

export interface Policy {
  limit: number;
  windowMs: number;
}

export function policyFor(pathname: string): Policy {
  if (pathname === "/api/brain/chat-execute") return { limit: 10, windowMs: 60_000 };
  if (pathname === "/api/brain/deployment-release-receipt")
    return { limit: 10, windowMs: 60_000 };
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/brain/auth"))
    return { limit: 20, windowMs: 60_000 };
  if (pathname.startsWith("/__ultron/stream")) return { limit: 30, windowMs: 60_000 };
  if (pathname.startsWith("/api/")) return { limit: 120, windowMs: 60_000 };
  return { limit: 600, windowMs: 60_000 };
}

export interface Verdict {
  allowed: boolean;
  retryAfter: number;
  count: number;
  limit: number;
}

export async function enforceRateLimit(
  request: Request,
  env: Env,
  policy: Policy,
): Promise<Verdict> {
  if (!env.RATE_LIMITER) {
    return { allowed: true, retryAfter: 0, count: 0, limit: policy.limit };
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const bucket = new URL(request.url).pathname.split("/").slice(0, 3).join("/") || "/";
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`${bucket}|${ip}`));
  const res = await stub.fetch("https://ratelimit.internal/check", {
    method: "POST",
    body: JSON.stringify(policy),
  });
  return (await res.json()) as Verdict;
}
