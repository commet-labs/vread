import { handleGet, rejectMethod } from "@/lib/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export {
  handleGet as GET,
  rejectMethod as POST,
  rejectMethod as PUT,
  rejectMethod as PATCH,
  rejectMethod as DELETE,
  rejectMethod as HEAD,
  rejectMethod as OPTIONS,
};
