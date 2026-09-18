import { accessPolicy } from "@/lib/access-policy";
import { rejectMethod } from "@/lib/handler";

export function GET() {
  return Response.json(accessPolicy.specification, {
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
