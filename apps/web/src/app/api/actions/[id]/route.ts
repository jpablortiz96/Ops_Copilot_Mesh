import { NextRequest } from "next/server";

import { forwardJson } from "../../_lib/proxy";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return forwardJson({ method: "GET", upstreamPath: `/v1/actions/${encodeURIComponent(id)}` });
}
