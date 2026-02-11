"use client";

import { useMemo, useState } from "react";

type Health = { ok: boolean; service: string };

export default function Home() {
  const API_BASE = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000",
    []
  );

  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pingHealth() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Health;
      setHealth(data);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Ops Copilot Mesh
            </h1>
            <p className="mt-2 text-slate-300">
              Multi-agent operations intelligence on Azure (Foundry + Agent Framework + MCP)
            </p>
          </div>
          <button
            onClick={pingHealth}
            className="rounded-xl bg-slate-100 px-4 py-2 text-slate-900 font-semibold hover:bg-white disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Checking..." : "Check API /health"}
          </button>
        </div>

        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <Card title="1) Upload operational data">
            <p className="text-slate-300">
              Upload Excel/CSV exports (inventory, movements, occupancy, billing). The Ingestion Agent validates schemas and normalizes fields.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
              Demo placeholder — we’ll wire this to Azure Storage next.
            </div>
          </Card>

          <Card title="2) Detect & explain anomalies">
            <p className="text-slate-300">
              The Quality Agent flags issues (negative inventory, capacity overflow, duplicates) and shows evidence + confidence.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
              Demo placeholder — next we generate real insights.
            </div>
          </Card>

          <Card title="3) SOP-grounded recommendations (RAG)">
            <p className="text-slate-300">
              The RAG Agent retrieves SOP steps and explains the “why”, grounded in policies and runbooks.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
              Demo placeholder — we’ll connect Azure AI Search soon.
            </div>
          </Card>

          <Card title="4) Role-based actions + Audit (HITL)">
            <p className="text-slate-300">
              The Action Planner proposes checklists by role (Operator/Supervisor/Manager). Sensitive actions require approval and are logged.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
              <p className="text-slate-300">
                API Base: <span className="text-slate-100 font-mono">{API_BASE}</span>
              </p>
              <div className="mt-3">
                {error && (
                  <p className="text-red-300">Error: {error}</p>
                )}
                {health && (
                  <pre className="text-green-200 whitespace-pre-wrap">
{JSON.stringify(health, null, 2)}
                  </pre>
                )}
                {!health && !error && (
                  <p className="text-slate-400">
                    Click “Check API /health” to verify end-to-end connectivity.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </section>

        <footer className="mt-12 text-xs text-slate-500">
          Built for AI Dev Days Hackathon — deployable on Azure.
        </footer>
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
