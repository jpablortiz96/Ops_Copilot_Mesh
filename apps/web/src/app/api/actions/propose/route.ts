import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { forwardJson } from "../../_lib/proxy";

export const runtime = "nodejs";

const proposeSchema = z.object({
  incident: z.string().trim().min(1, "incident is required").max(2000, "incident is too long"),
  role: z.enum(["operator", "admin", "manager", "sre-lead"]).default("operator"),
  top: z.number().int().min(1).max(20).default(5),
});

export async function POST(req: NextRequest) {

  let payloadRaw: unknown;
  try {
    payloadRaw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = proposeSchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return forwardJson({ method: "POST", upstreamPath: "/v1/actions/propose", body: parsed.data });
}
