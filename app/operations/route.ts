import operations from "@/catalog/operations.json";
import { jsonResponse } from "@/lib/handler";

export function GET() {
  return jsonResponse(
    operations.map(
      ({ operationId, method, path, summary, access, reason }) => ({
        operationId,
        upstreamMethod: method,
        upstreamPath: path,
        summary,
        access,
        reason,
      }),
    ),
  );
}
