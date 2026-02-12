import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiBase = process.env.API_BASE_URL;
  if (!apiBase) {
    return NextResponse.json({ error: "API_BASE_URL missing" }, { status: 500 });
  }

  const formData = await req.formData();

  const r = await fetch(`${apiBase}/v1/sop/upload`, {
    method: "POST",
    body: formData,
  });

  const text = await r.text();
  return new NextResponse(text, {
    status: r.status,
    headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
  });
}
