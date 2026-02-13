import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { forwardJson } from "../../_lib/proxy";

export const runtime = "nodejs";

const executeSchema = z.object({
  actionId: z.string().trim().min(1, "actionId is required"),
  executorRole: z.string().trim().min(1, "executorRole is required").default("operator"),
});

export async function POST(req: NextRequest) {
  let payloadRaw: unknown;
  try {
    payloadRaw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = executeSchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return forwardJson({ method: "POST", upstreamPath: "/v1/actions/execute", body: parsed.data });
}
