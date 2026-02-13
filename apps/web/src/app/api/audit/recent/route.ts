import { NextRequest } from "next/server";

import { forwardJson } from "../../_lib/proxy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  return forwardJson({ method: "GET", upstreamPath: `/v1/audit/recent?limit=${encodeURIComponent(limit)}` });
}
