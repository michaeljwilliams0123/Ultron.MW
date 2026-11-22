export class RateLimiter implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { limit, windowMs } = (await request.json()) as {
      limit: number;
      windowMs: number;
    };
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const key = `w:${window}`;
    const count = ((await this.state.storage.get<number>(key)) ?? 0) + 1;
    await this.state.storage.put(key, count);
    if (count === 1) {
      const stale = await this.state.storage.list({ prefix: "w:" });
      for (const k of stale.keys()) {
        if (k !== key) await this.state.storage.delete(k);
      }
    }
    const resetAt = (window + 1) * windowMs;
    return Response.json({
      allowed: count <= limit,
      count,
      limit,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    });
  }
}
