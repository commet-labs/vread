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
    `UPSTREAM_FIXTURE ${JSON.stringify({
      path: url.pathname,
      method: init?.method,
      teamId: url.searchParams.get("teamId"),
      resume: url.searchParams.get("resume"),
      clientHeader: headers.has("x-client-injection"),
      correctToken:
        headers.get("authorization") === "Bearer upstream_fixture_credential",
      redirect: init?.redirect,
      body: init?.body,
    })}`,
  );
  if (url.pathname.endsWith("/runtime-logs"))
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"message":"Bearer secret"}\n{"message":"incomplete',
            ),
          );
        },
      }),
      { headers: { "Content-Type": "application/stream+json" } },
    );
  if (url.pathname.endsWith("/redirect"))
    return new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.invalid" },
    });
  if (url.pathname.endsWith("/upstream-error"))
    return Response.json(
      { error: "upstream_fixture_credential" },
      { status: 403 },
    );
  if (url.pathname.endsWith("/binary"))
    return new Response("upstream_fixture_credential", {
      headers: { "Content-Type": "application/octet-stream" },
    });
  if (url.pathname.endsWith("/large"))
    return Response.json({ message: "a".repeat(3 * 1024 * 1024) });
  if (url.pathname.endsWith("/events"))
    return new Response(
      'data: {"text":"Bearer secret"}\n\ndata: {"text":"build complete"}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  return Response.json({
    id: "prj_fixture",
    name: "vercel-read",
    env: [{ value: "sensitive" }],
    protectionBypass: { secret: "sensitive" },
    nested: { accessToken: "sensitive", text: "upstream_fixture_credential" },
  });
};
