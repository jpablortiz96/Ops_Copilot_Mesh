import { NextResponse } from "next/server";

export type JsonRecord = Record<string, unknown>;

type ForwardOptions = {
  method: "GET" | "POST";
  upstreamPath: string;
  body?: unknown;
  timeoutMs?: number;
};

function parseUpstreamPayload(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Upstream returned non-JSON payload", raw: text.slice(0, 500) };
  }
}

export async function forwardJson(options: ForwardOptions): Promise<NextResponse> {
  const base = process.env.API_BASE_URL;
  if (!base) {
    return NextResponse.json({ error: "API_BASE_URL is not set" }, { status: 500 });
  }

  const timeoutMs = options.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamUrl = `${base.replace(/\/$/, "")}${options.upstreamPath}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: options.method,
      headers: { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await upstream.text();
    const data = parseUpstreamPayload(text);
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Upstream timeout", upstream: options.upstreamPath, timeoutMs },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Failed to reach API upstream", upstream: options.upstreamPath },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
