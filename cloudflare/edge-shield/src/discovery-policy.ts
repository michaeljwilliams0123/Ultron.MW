/** Unsupported discovery protocols must never reach the HTML origin fallback. */
const unsupported = new Set([
  "/.well-known/ucp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/api-catalog",
  "/.well-known/http-message-signatures-directory",
]);

export function unsupportedDiscoveryResponse(path: string, method: string): Response | null {
  // Decode only RFC 3986 unreserved bytes; never turn an encoded separator
  // into a route boundary. Unknown and supported routes remain untouched.
  const normalized = path.replace(/%([0-9a-f]{2})/gi, (escape, hex) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : escape;
  }).replace(/\/+$/, "");
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
