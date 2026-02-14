import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { forwardJson } from "../../_lib/proxy";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = z.string().trim().min(1, "id is required").safeParse(id);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  return forwardJson({ method: "GET", upstreamPath: `/v1/actions/${encodeURIComponent(parsed.data)}` });
}
