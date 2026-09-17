const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.origin !== "https://api.vercel.com") {
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return originalFetch(input, init);
    throw new Error("External network access is forbidden in HTTP E2E tests");
  }
  const headers = new Headers(init?.headers);
  console.log(
    `UPSTREAM_FIXTURE ${JSON.stringify({ path: url.pathname, query: url.search, method: init?.method, correctToken: headers.get("authorization") === "Bearer upstream_fixture_credential", methodOverride: headers.has("x-http-method-override"), range: headers.get("range"), artifactCi: headers.get("x-artifact-client-ci"), artifactInteractive: headers.get("x-artifact-client-interactive"), redirect: init?.redirect })}`,
  );
  if (url.pathname === "/fixture/error")
    return new Response(
      '{"error":{"code":"deployment_not_found","message":"Deployment does not exist","detail":42}}',
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "x-vercel-id": "fixture-request",
        },
      },
    );
  if (url.pathname === "/fixture/rate-limit")
    return new Response(
      '{"error":{"code":"rate_limited","message":"Try again later"}}',
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      },
    );
  if (url.pathname === "/fixture/server-error")
    return new Response("upstream failure", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  if (url.pathname === "/fixture/redirect")
    return new Response(null, {
      status: 307,
      headers: { Location: "https://example.invalid/target" },
    });
  if (url.pathname === "/fixture/not-modified")
    return new Response(null, { status: 304, headers: { ETag: '"fixture"' } });
  if (url.pathname === "/fixture/binary")
    return new Response(new Uint8Array([0, 1, 127, 128, 255]), {
      status: 206,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Range": "bytes 0-4/10",
        "Content-Length": "5",
      },
    });
  if (url.pathname === "/fixture/events")
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: log\ndata: {"text":"unchanged"}\n\n',
            ),
          );
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  return new Response(
    '{ "id": "prj_fixture", "env": [{"value":"unchanged"}], "token": "unchanged" }\n',
    {
      headers: {
        "Content-Type": "application/json",
        ETag: '"fixture"',
        "X-Vercel-Id": "fixture-request",
      },
    },
  );
};
