import type { Env } from "../lib";

export class StreamHub implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop();
    if (action === "ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (action === "publish") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const body = await request.json();
      const seq = await this.publish(body);
      return Response.json({ ok: true, seq });
    }
    if (action === "sse") return this.sse(request);
    return new Response("Not Found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000, "closed");
    } catch {
      // already closed
    }
  }

  private async head(): Promise<number> {
    return (await this.state.storage.get<number>("seq")) ?? 0;
  }

  private async publish(event: unknown): Promise<number> {
    const seq = (await this.head()) + 1;
    const at = Date.now();
    await this.state.storage.put("seq", seq);
    await this.state.storage.put(`e:${seq}`, { seq, at, event });
    if (seq > 500) await this.state.storage.delete(`e:${seq - 500}`);
    const payload = JSON.stringify({ seq, at, event });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // socket gone
      }
    }
    return seq;
  }

  private sse(request: Request): Response {
    const url = new URL(request.url);
    let cursor = Number(url.searchParams.get("since") ?? 0) || 0;
    const encoder = new TextEncoder();
    const state = this.state;
    const signal = request.signal;
    const deadline = Date.now() + 5 * 60_000;
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(": connected\n\n"));
        try {
          while (Date.now() < deadline) {
            if (signal.aborted) break;
            const head = (await state.storage.get<number>("seq")) ?? 0;
            if (head > cursor) {
              const from = Math.max(cursor + 1, head - 100);
              for (let s = from; s <= head; s++) {
                const rec = await state.storage.get<{
                  seq: number;
                  at: number;
                  event: unknown;
                }>(`e:${s}`);
                if (rec) {
                  controller.enqueue(
                    encoder.encode(`id: ${rec.seq}\ndata: ${JSON.stringify(rec)}\n\n`),
                  );
                }
              }
              cursor = head;
            } else {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            }
            await scheduler.wait(1000);
          }
          controller.close();
        } catch {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        // consumer disconnected
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
