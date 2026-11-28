import { unsupportedDiscoveryResponse } from "./discovery-policy";
import { applyOwnHeaders } from "./security";

// No proxy, queue, workflow, credentials, or production bindings in this entrypoint.
export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const discovery = unsupportedDiscoveryResponse(path, request.method);
    if (discovery) return applyOwnHeaders(discovery);
    if (path === "/__ultron/health" && request.method === "GET") {
      return applyOwnHeaders(Response.json({ok:true,environment:"isolated-preview"}, {
        headers: {"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"},
      }));
    }
    return applyOwnHeaders(Response.json({error:"not_found"}, {
      status:404, headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"},
    }));
  },
};
