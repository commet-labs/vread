import specification from "@/catalog/openapi.json";
import { jsonResponse } from "@/lib/handler";

export function GET() {
  return jsonResponse(specification);
}
