import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { forwardJson } from "../../_lib/proxy";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  actionId: z.string().trim().min(1).max(128).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({
    limit: req.nextUrl.searchParams.get("limit") ?? "50",
    actionId: req.nextUrl.searchParams.get("actionId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const query = new URLSearchParams();
  query.set("limit", String(parsed.data.limit));
  if (parsed.data.actionId) {
    query.set("actionId", parsed.data.actionId);
  }
  return forwardJson({ method: "GET", upstreamPath: `/v1/audit/recent?${query.toString()}` });
}
