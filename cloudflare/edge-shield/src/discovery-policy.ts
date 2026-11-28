/** Unsupported discovery protocols must never reach the HTML origin fallback. */
const unsupported = new Set([
  "/.well-known/ucp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/api-catalog",
  "/.well-known/http-message-signatures-directory",
]);

export function unsupportedDiscoveryResponse(path: string, method: string): Response | null {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (!unsupported.has(normalized)) return null;
  return new Response(method === "HEAD" ? null : JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
