import { createHash, timingSafeEqual } from "node:crypto";
import { Ajv, type AnySchemaObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import operationsJson from "../catalog/operations.json";
import upstream from "../catalog/upstream.json";
import type { ReadOperation } from "./types";

export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const operations = new Map(
  (operationsJson as ReadOperation[]).map((operation) => [
    operation.operationId,
    operation,
  ]),
);
const ajv = new Ajv({ strict: false, coerceTypes: false, allErrors: false });
addFormats(ajv);
const validators = new Map<string, ValidateFunction>();
const reservedParameters = new Set(["teamId", "slug", "teamSlug", "ownerId"]);

export function authenticate(
  authorization: string | null,
  serviceKey: string,
): boolean {
  if (!authorization?.startsWith("Bearer ") || authorization.length > 512)
    return false;
  const supplied = authorization.slice(7);
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(supplied), hash(serviceKey));
}

export function resolveOperation(
  operationId: string,
  method: string,
): ReadOperation {
  const operation = operations.get(operationId);
  if (!operation)
    throw new RequestError(
      404,
      "unknown_operation",
      "Operation is not in the reviewed catalog.",
    );
  if (operation.access !== "read")
    throw new RequestError(403, "blocked_operation", operation.reason);
  const publicMethod = operation.method === "POST" ? "POST" : "GET";
  if (method !== publicMethod)
    throw new RequestError(
      405,
      "method_not_allowed",
      `This operation accepts ${publicMethod} only.`,
    );
  return operation;
}

function validateInput(key: string, schema: AnySchemaObject, input: unknown) {
  let validator = validators.get(key);
  if (!validator) {
    const validationSchema = JSON.parse(
      JSON.stringify(
        { ...schema, components: { schemas: upstream.schemas } },
        (_key, value) => {
          if (
            value &&
            typeof value === "object" &&
            value.nullable === true &&
            !value.type
          ) {
            const { nullable: _nullable, ...nonNullSchema } = value;
            return { anyOf: [nonNullSchema, { type: "null" }] };
          }
          return value;
        },
      ),
    );
    validator = ajv.compile(validationSchema);
    validators.set(key, validator);
  }
  if (!validator(input))
    throw new RequestError(
      400,
      "invalid_input",
      "Input does not match this operation's schema.",
    );
}

function parseQueryValue(value: string, schema: AnySchemaObject): unknown {
  if (["number", "integer"].includes(schema.type)) {
    if (!value.trim() || !Number.isFinite(Number(value)))
      throw new RequestError(
        400,
        "invalid_number",
        "Expected a finite number.",
      );
    return Number(value);
  }
  if (schema.type === "boolean") {
    if (value !== "true" && value !== "false")
      throw new RequestError(400, "invalid_boolean", "Expected true or false.");
    return value === "true";
  }
  if (schema.type === "object") {
    try {
      return JSON.parse(value);
    } catch {
      throw new RequestError(
        400,
        "invalid_object",
        "Expected a JSON object parameter.",
      );
    }
  }
  return value;
}

export function buildUpstreamRequest(
  operation: ReadOperation,
  search: URLSearchParams,
  body: unknown,
  teamId: string,
  teamSlug?: string,
): { url: URL; body?: string } {
  const parameters = (operation.parameters ?? []).filter((parameter) =>
    ["path", "query"].includes(parameter.in),
  );
  const properties = Object.fromEntries(
    parameters
      .filter(
        (parameter) =>
          !reservedParameters.has(parameter.name) &&
          !Object.hasOwn(operation.forcedQuery ?? {}, parameter.name),
      )
      .map((parameter) => [parameter.name, parameter.schema]),
  );
  const required = parameters
    .filter(
      (parameter) =>
        parameter.required &&
        !reservedParameters.has(parameter.name) &&
        !Object.hasOwn(operation.forcedQuery ?? {}, parameter.name),
    )
    .map((parameter) => parameter.name);
  const input: Record<string, unknown> = Object.create(null);
  for (const name of new Set(search.keys())) {
    if (!Object.hasOwn(properties, name) || reservedParameters.has(name))
      throw new RequestError(
        400,
        "unknown_parameter",
        "Unknown or server-owned parameter.",
      );
    const values = search.getAll(name);
    if (properties[name].type === "array")
      input[name] = values.map((value) =>
        parseQueryValue(value, properties[name].items),
      );
    else {
      if (values.length !== 1)
        throw new RequestError(
          400,
          "duplicate_parameter",
          "Scalar parameters must not be repeated.",
        );
      input[name] = parseQueryValue(values[0], properties[name]);
    }
  }
  validateInput(
    `${operation.operationId}:parameters`,
    { type: "object", properties, required, additionalProperties: false },
    input,
  );
  let path = operation.path;
  const query = new URLSearchParams();
  for (const parameter of parameters) {
    if (parameter.name === "teamSlug" && !teamSlug)
      throw new RequestError(
        503,
        "not_configured",
        "Registry reads require a server-configured team slug.",
      );
    const value =
      parameter.name === "teamId" || parameter.name === "ownerId"
        ? teamId
        : parameter.name === "teamSlug"
          ? teamSlug
          : input[parameter.name];
    if (value === undefined || parameter.name === "slug") continue;
    if (parameter.in === "path") {
      const segment = String(value);
      if (
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\\/%?#]/.test(segment) ||
        [...segment].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new RequestError(
          400,
          "invalid_path_parameter",
          "Use a resource ID or a single unescaped path segment.",
        );
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(segment));
    } else {
      if (Array.isArray(value)) {
        if (parameter.explode === false)
          query.set(parameter.name, value.join(","));
        else
          for (const item of value) query.append(parameter.name, String(item));
      } else
        query.set(
          parameter.name,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        );
    }
  }
  if (/[{}]/.test(path) || !path.startsWith("/") || path.startsWith("//"))
    throw new RequestError(
      400,
      "invalid_path",
      "Unable to construct a reviewed path.",
    );
  for (const [name, value] of Object.entries(operation.forcedQuery ?? {}))
    query.set(name, value);
  query.set("teamId", teamId);
  const url = new URL(`https://api.vercel.com${path}`);
  url.search = query.toString();
  if (operation.method !== "POST") {
    if (body !== undefined)
      throw new RequestError(
        400,
        "unexpected_body",
        "This read does not accept a request body.",
      );
    return { url };
  }
  const schema = operation.requestBody?.content["application/json"]?.schema;
  if (!schema)
    throw new RequestError(
      400,
      "unsupported_body",
      "Only documented JSON query bodies are supported.",
    );
  let validatedBody = body;
  if (operation.operationId === "createObservabilityQuery") {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.hasOwn(body, "scope")
    )
      throw new RequestError(
        400,
        "invalid_scope",
        "Observability scope belongs to the server.",
      );
    validatedBody = { ...body, scope: { type: "team", ownerId: teamId } };
  }
  validateInput(
    `${operation.operationId}:body`,
    { ...schema, additionalProperties: false },
    validatedBody,
  );
  return { url, body: JSON.stringify(validatedBody) };
}
