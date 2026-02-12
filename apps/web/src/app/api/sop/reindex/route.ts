import { NextResponse } from "next/server";

export async function POST() {
  const apiBase = process.env.API_BASE_URL;
  if (!apiBase) {
    return NextResponse.json({ error: "API_BASE_URL missing" }, { status: 500 });
  }

  const r = await fetch(`${apiBase}/v1/sop/reindex`, { method: "POST" });
  const text = await r.text();

  return new NextResponse(text, {
    status: r.status,
    headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
  });
}
