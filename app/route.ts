import { jsonResponse } from "@/lib/handler";

export function GET() {
  return jsonResponse({
    service: "vercel-read",
    version: "0.1.0",
    openapi: "/openapi.json",
    operations: "/operations",
    health: "/health",
  });
}
