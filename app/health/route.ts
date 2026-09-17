import { jsonResponse } from "@/lib/handler";

export const dynamic = "force-dynamic";

export function GET() {
  return jsonResponse({ service: "vercel-read", status: "ok" });
}
