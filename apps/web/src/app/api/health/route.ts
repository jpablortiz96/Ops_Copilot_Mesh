import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.API_BASE_URL;
  if (!base) {
    return NextResponse.json(
      { ok: false, error: "API_BASE_URL is not set" },
      { status: 500 }
    );
  }

  const url = `${base.replace(/\/$/, "")}/health`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  return NextResponse.json(data, { status: res.status });
}
