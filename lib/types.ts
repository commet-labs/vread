import type { AnySchemaObject } from "ajv";

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: AnySchemaObject;
  style?: string;
  explode?: boolean;
}

export interface Operation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: AnySchemaObject }>;
  };
}

export interface ReadOperation extends Operation {
  access: "read" | "blocked";
  reason: string;
}
