export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = new URL(
    url.pathname + url.search,
    "https://ultron-edge-shield.mahoraga-mjw0123.workers.dev",
  );
  const headers = new Headers(context.request.headers);
  headers.delete("host");
  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: "manual",
  };
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
  }
  return fetch(target.toString(), init);
};
