const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.origin !== "https://api.vercel.com")
    return originalFetch(input, init);
  const headers = new Headers(init?.headers);
  console.log(
    `UPSTREAM_FIXTURE ${JSON.stringify({ path: url.pathname, method: init?.method, teamId: url.searchParams.get("teamId"), clientHeader: headers.has("x-client-injection"), correctToken: headers.get("authorization") === "Bearer upstream_fixture_credential", redirect: init?.redirect, body: init?.body })}`,
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
