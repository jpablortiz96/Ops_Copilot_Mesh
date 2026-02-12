import { NextResponse } from "next/server";

export async function GET() {
  const apiBase = process.env.API_BASE_URL;
  if (!apiBase) {
    return NextResponse.json({ ok: false, error: "API_BASE_URL missing" }, { status: 500 });
  }

  const r = await fetch(`${apiBase}/health`, { cache: "no-store" });
  const text = await r.text();

  return new NextResponse(text, {
    status: r.status,
    headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
  });
}
