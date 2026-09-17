import specification from "@/catalog/openapi.json";
import { rejectMethod } from "@/lib/handler";

export function GET() {
  return Response.json(specification, {
    headers: { "Cache-Control": "no-store" },
  });
}

export {
  rejectMethod as POST,
  rejectMethod as PUT,
  rejectMethod as PATCH,
  rejectMethod as DELETE,
  rejectMethod as HEAD,
  rejectMethod as OPTIONS,
};
