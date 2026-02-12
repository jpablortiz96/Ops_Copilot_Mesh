"use client";

import { useEffect, useMemo, useState } from "react";

type Result = {
  id: string;
  title: string;
  source: string;
  score: number;
  snippet: string;
  domain?: string;
};

type Health = { ok?: boolean; service?: string; error?: string };

function isBlob(source: string) {
  return source?.startsWith("blob:");
}

export default function Home() {
  const [query, setQuery] = useState("inventory negative");
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [onlyUploaded, setOnlyUploaded] = useState(true);
  const [busy, setBusy] = useState<"upload" | "reindex" | "search" | "none">("none");
  const [health, setHealth] = useState<Health>({});
  const [top, setTop] = useState(5);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const data = (await r.json()) as Health;
        setHealth(data);
      } catch (e: any) {
        setHealth({ ok: false, error: "Health check failed" });
      }
    })();
  }, []);

  const visibleResults = useMemo(() => {
    const filtered = onlyUploaded ? results.filter((r) => isBlob(r.source)) : results;
    // Siempre ordenamos: uploaded primero, luego score desc
    return [...filtered].sort((a, b) => {
      const ab = isBlob(a.source) ? 0 : 1;
      const bb = isBlob(b.source) ? 0 : 1;
      if (ab !== bb) return ab - bb;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }, [results, onlyUploaded]);

  const search = async () => {
    setBusy("search");
    setStatus("Searching...");
    try {
      const r = await fetch("/api/sop/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top }),
      });
      const data = await r.json();
      setResults(data.results ?? []);
      setStatus("Done ✅");
    } catch {
      setStatus("Search failed ❌");
    } finally {
      setBusy("none");
    }
  };

  const upload = async () => {
    if (!file) {
      setStatus("Pick a file first ⚠️");
      return;
    }
    setBusy("upload");
    setStatus("Uploading SOP...");
    try {
      const fd = new FormData();
      fd.append("file", file);

      const r = await fetch("/api/sop/upload", { method: "POST", body: fd });
      const data = await r.json();
      setStatus(`Uploaded ✅ ${data.path ?? ""}`);
    } catch {
      setStatus("Upload failed ❌");
    } finally {
      setBusy("none");
    }
  };

  const reindex = async () => {
    setBusy("reindex");
    setStatus("Reindexing...");
    try {
      const r = await fetch("/api/sop/reindex", { method: "POST" });
      const data = await r.json();
      setStatus(`Reindexed ✅ indexed=${data.indexed ?? "?"}`);
    } catch {
      setStatus("Reindex failed ❌");
    } finally {
      setBusy("none");
    }
  };

  return (
    <main className="ocm">
      <div className="ocm__container">
        <header className="ocm__header">
          <div>
            <h1 className="ocm__title">Ops Copilot Mesh</h1>
            <p className="ocm__subtitle">
              Enterprise runbook intelligence: Upload SOPs → Reindex → Search with evidence (Blob + Azure AI Search)
            </p>
          </div>

          <div className="ocm__right">
            <div className={`ocm__badge ${health.ok ? "ok" : "bad"}`}>
              <span className="dot" /> {health.ok ? "API Connected" : "API Not reachable"}
            </div>
            <button className="ocm__btn" onClick={() => location.reload()}>
              Refresh
            </button>
          </div>
        </header>

        <section className="ocm__stepper">
          <div className={`step ${file ? "done" : ""}`}>1) Upload</div>
          <div className="sep" />
          <div className="step">2) Reindex</div>
          <div className="sep" />
          <div className="step">3) Search</div>
          <div className="sep" />
          <div className="step muted">4) Approve Actions (next)</div>
        </section>

        <div className="ocm__grid">
          {/* Left column */}
          <div className="ocm__col">
            <div className="card">
              <div className="card__head">
                <div>
                  <h2 className="card__title">Upload SOP / Policy</h2>
                  <p className="card__desc">Upload a Markdown SOP to Azure Blob Storage.</p>
                </div>
              </div>

              <label className="drop">
                <input
                  className="drop__input"
                  type="file"
                  accept=".md,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <div className="drop__box">
                  <div className="drop__title">{file ? file.name : "Click to choose a .md file"}</div>
                  <div className="drop__hint">Tip: judges love “upload → real indexing → evidence” demos.</div>
                </div>
              </label>

              <div className="row">
                <button className="ocm__btn primary" onClick={upload} disabled={busy !== "none"}>
                  {busy === "upload" ? "Uploading..." : "Upload SOP"}
                </button>
                <button className="ocm__btn" onClick={reindex} disabled={busy !== "none"}>
                  {busy === "reindex" ? "Reindexing..." : "Reindex"}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card__head">
                <div>
                  <h2 className="card__title">Governance & HITL (next)</h2>
                  <p className="card__desc">
                    Next milestone: role-based approvals + audit log (Operator/Supervisor/Manager).
                  </p>
                </div>
              </div>

              <div className="pillrow">
                <span className="pill">Agent Framework</span>
                <span className="pill">MCP Tools</span>
                <span className="pill">Audit</span>
                <span className="pill">App Insights</span>
              </div>

              <div className="mutedBox">
                We’ll add multi-agent orchestration + safe actions after UI polish.
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="ocm__col">
            <div className="card">
              <div className="card__head">
                <div>
                  <h2 className="card__title">Search SOPs with Evidence</h2>
                  <p className="card__desc">Retrieve relevant SOP steps with citations (source + score).</p>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={onlyUploaded}
                    onChange={(e) => setOnlyUploaded(e.target.checked)}
                  />
                  <span>Only uploaded</span>
                </label>
              </div>

              <div className="row">
                <input
                  className="ocm__input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., inventory negative, duplicate orders, access denied..."
                />
                <button className="ocm__btn primary" onClick={search} disabled={busy !== "none"}>
                  {busy === "search" ? "Searching..." : "Search"}
                </button>
              </div>

              <div className="row small">
                <span className="label">Top</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={top}
                  onChange={(e) => setTop(parseInt(e.target.value, 10))}
                />
                <span className="label">{top}</span>
              </div>

              {status && (
                <div className="status">
                  <span className={`statusDot ${status.includes("❌") ? "bad" : "ok"}`} />
                  {status}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Results</h2>
              </div>

              {visibleResults.length === 0 ? (
                <div className="empty">No results yet. Upload + Reindex + Search.</div>
              ) : (
                <div className="list">
                  {visibleResults.map((r) => (
                    <div key={r.id} className="item">
                      <div className="item__top">
                        <div className="item__title">{r.title}</div>
                        <div className={`tag ${isBlob(r.source) ? "blob" : "demo"}`}>
                          {isBlob(r.source) ? "UPLOADED" : "DEMO"}
                        </div>
                      </div>

                      <div className="meta">
                        <span>score={r.score.toFixed(3)}</span>
                        <span className="sepDot">•</span>
                        <span className="mono">{r.source}</span>
                      </div>

                      <pre className="snippet">{r.snippet}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="ocm__footer">
          Built for AI Dev Days Hackathon • Next: Multi-agent orchestration (Agent Framework) + MCP tools + Audit/HITL.
        </footer>
      </div>
    </main>
  );
}