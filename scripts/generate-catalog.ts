import { readFile, writeFile } from "node:fs/promises";
import type { Operation, ReadOperation } from "../lib/types";

const root = new URL("../", import.meta.url);
const upstream = JSON.parse(
  await readFile(new URL("catalog/upstream.json", root), "utf8"),
) as { operations: Operation[]; schemas: Record<string, unknown> };
const policy = JSON.parse(
  await readFile(new URL("catalog/policy.json", root), "utf8"),
) as Record<
  string,
  {
    access: "read" | "blocked";
    reason: string;
    forcedQuery?: Record<string, string>;
  }
>;
const byId = new Map(
  upstream.operations.map((operation) => [operation.operationId, operation]),
);
if (byId.size !== upstream.operations.length)
  throw new Error("Duplicate operation IDs");
const missingReads = upstream.operations.filter(
  (operation) =>
    ["GET", "HEAD"].includes(operation.method) &&
    !Object.hasOwn(policy, operation.operationId),
);
if (missingReads.length)
  throw new Error(
    `Review new reads: ${missingReads.map((operation) => operation.operationId).join(", ")}`,
  );
const operations: ReadOperation[] = Object.entries(policy).map(
  ([operationId, decision]) => {
    const operation = byId.get(operationId);
    if (!operation) throw new Error(`Unknown operation: ${operationId}`);
    if (!["GET", "HEAD", "POST"].includes(operation.method))
      throw new Error(`Mutation in read catalog: ${operationId}`);
    if (!["read", "blocked"].includes(decision.access) || !decision.reason)
      throw new Error(`Missing review: ${operationId}`);
    return { ...operation, ...decision };
  },
);
const paths = Object.fromEntries(
  operations
    .filter((operation) => operation.access === "read")
    .map((operation) => {
      const parameters = (operation.parameters ?? [])
        .filter(
          (parameter) =>
            ["path", "query"].includes(parameter.in) &&
            !["teamId", "slug", "teamSlug", "ownerId"].includes(
              parameter.name,
            ) &&
            !Object.hasOwn(operation.forcedQuery ?? {}, parameter.name),
        )
        .map((parameter) => ({
          name: parameter.name,
          in: "query",
          required: parameter.required === true,
          ...(parameter.description
            ? { description: parameter.description }
            : {}),
          schema: parameter.schema,
          style: "form",
          explode: true,
        }));
      let requestBody = operation.requestBody;
      if (operation.operationId === "createObservabilityQuery") {
        const original = requestBody?.content["application/json"].schema;
        requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: {
                ...original,
                required: ["metric"],
                properties: Object.fromEntries(
                  Object.entries(original?.properties ?? {}).filter(
                    ([name]) => name !== "scope",
                  ),
                ),
                additionalProperties: false,
              },
            },
          },
        };
      }
      return [
        `/api/${operation.operationId}`,
        {
          [operation.method === "POST" ? "post" : "get"]: {
            operationId: operation.operationId,
            summary: operation.summary ?? operation.operationId,
            description: `Read-only wrapper for ${operation.method} ${operation.path}. Team is configured by the service. Secret-bearing fields are omitted; responses are not byte-for-byte upstream responses.`,
            tags: operation.tags ?? ["Vercel"],
            parameters,
            ...(requestBody ? { requestBody } : {}),
            responses: {
              "200": {
                description:
                  "Sanitized upstream read result. Upstream HEAD operations return status metadata.",
                content: { "application/json": { schema: {} } },
              },
              "400": { description: "Invalid or unsupported input" },
              "401": { description: "Missing or invalid service API key" },
              "403": { description: "Operation or scope is forbidden" },
              "405": { description: "Method is not allowed" },
              "429": { description: "Upstream rate limit" },
              "502": {
                description:
                  "Upstream response unavailable, unsafe or too large",
              },
              "503": { description: "Service credentials are not configured" },
              "504": { description: "Upstream timeout" },
            },
            "x-upstream-method": operation.method,
            "x-upstream-path": operation.path,
          },
        },
      ];
    }),
);
const outputs = {
  "catalog/operations.json": operations,
  "catalog/openapi.json": {
    openapi: "3.0.3",
    info: {
      title: "vercel-read",
      version: "0.1.0",
      description:
        "Authenticated read-only access to Vercel. One server-held upstream token. No arbitrary proxying or credential export.",
      license: { name: "MIT" },
    },
    servers: [{ url: "/" }],
    security: [{ serviceApiKey: [] }],
    paths,
    components: {
      schemas: upstream.schemas,
      securitySchemes: {
        serviceApiKey: {
          type: "http",
          scheme: "bearer",
          description: "The vercel-read service key, never your Vercel token.",
        },
      },
    },
  },
};
for (const [path, output] of Object.entries(outputs)) {
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const file = new URL(path, root);
  if (process.argv.includes("--check")) {
    if ((await readFile(file, "utf8")) !== serialized)
      throw new Error(`Regenerate ${path}`);
  } else await writeFile(file, serialized);
}
console.log(
  `${operations.length} reviewed reads; ${operations.filter((operation) => operation.access === "read").length} enabled`,
);
