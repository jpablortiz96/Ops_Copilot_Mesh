import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const proposeSchema = z.object({
  incident: z.string().trim().min(1, "incident is required").max(2000, "incident is too long"),
  role: z.enum(["operator", "admin"]).default("operator"),
  top: z.number().int().min(1).max(20).default(5),
});

function parseUpstreamPayload(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Upstream returned non-JSON payload", raw: text.slice(0, 500) };
  }
}

export async function POST(req: Request) {
  const base = process.env.API_BASE_URL;
  if (!base) {
    return NextResponse.json({ error: "API_BASE_URL is not set" }, { status: 500 });
  }

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

  const upstreamUrl = `${base.replace(/\/$/, "")}/v1/actions/propose`;
  const controller = new AbortController();
  const timeoutMs = 20_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await upstream.text();
    const data = parseUpstreamPayload(text);
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Upstream timeout", upstream: "/v1/actions/propose", timeoutMs },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Failed to reach API upstream", upstream: "/v1/actions/propose" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
