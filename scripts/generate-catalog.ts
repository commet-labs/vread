import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const upstream = JSON.parse(
  await readFile(new URL("catalog/upstream.json", root), "utf8"),
);
const paths = Object.fromEntries(
  Object.entries(upstream.paths).map(([path, entry]) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("get" in entry) ||
      !entry.get ||
      typeof entry.get !== "object"
    )
      throw new Error(`Missing GET operation: ${path}`);
    return [
      path,
      {
        ...("parameters" in entry ? { parameters: entry.parameters } : {}),
        get: { ...entry.get, security: [{ serviceApiKey: [] }] },
      },
    ];
  }),
);
const specification = {
  openapi: upstream.openapi,
  info: {
    title: "vercel-read",
    version: "0.2.0",
    description:
      "GET-only proxy for Vercel. Native routes, parameters, response bodies, errors and streams. No operation filtering or redaction.",
    license: { name: "MIT" },
  },
  servers: [{ url: "/" }],
  security: [{ serviceApiKey: [] }],
  paths,
  components: {
    ...upstream.components,
    securitySchemes: {
      serviceApiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "The vercel-read service key. The proxy supplies its own upstream Vercel token.",
      },
    },
  },
};
const file = new URL("catalog/openapi.json", root);
const serialized = `${JSON.stringify(specification, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== serialized)
    throw new Error("Regenerate catalog/openapi.json");
} else await writeFile(file, serialized);
console.log(
  `${Object.keys(paths).length} documented GET operations; runtime forwards all GET paths`,
);
