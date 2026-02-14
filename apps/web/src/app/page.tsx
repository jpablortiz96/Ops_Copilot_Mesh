"use client";

import { useEffect, useMemo, useState } from "react";

type SopResult = {
  id: string;
  title: string;
  source: string;
  score: number;
  snippet: string;
  domain?: string;
};

type Health = { ok?: boolean; service?: string; error?: string };

type ActionRole = "operator" | "admin" | "manager" | "sre-lead";

type ActionEvidence = {
  id: string;
  title: string;
  domain: string;
  source: string;
  score: number;
  snippet: string;
};

type ActionPlan = {
  summary?: string;
  risk?: string;
  requiresApproval?: boolean;
  steps?: string[];
};

type ActionGate = {
  decision?: string;
  reason?: string;
  requiredRole?: string;
  requesterRole?: string;
  allowedToAutoExecute?: boolean;
};

type ActionApproval = {
  decision?: "APPROVE" | "REJECT";
  approverRole?: string;
  note?: string | null;
  ts?: string;
};

type ActionExecution = {
  executorRole?: string;
  mode?: string;
  result?: {
    ok: boolean;
    actionId: string;
    status: string;
    startedAt: string;
    finishedAt: string;
    stepsExecuted: string[];
  };
};

type ActionProposal = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  requesterRole: string;
  category: string;
  incident: string;
  plan: ActionPlan;
  gate: ActionGate;
  evidence: ActionEvidence[];
  warnings?: string[];
  approval?: ActionApproval;
  execution?: ActionExecution;
};

type AuditEvent = {
  ts: string;
  event: string;
  actionId?: string | null;
  data: Record<string, unknown>;
};

type AuditEnvelope = {
  items?: AuditEvent[];
  count?: number;
};

type ApiError = {
  error?: string;
  detail?: string;
};

function isBlob(source: string) {
  return source?.startsWith("blob:");
}

function safeJson<T>(value: unknown): T | null {
  if (value && typeof value === "object") {
    return value as T;
  }
  return null;
}

function formatUtc(dateIso: string) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return dateIso;
  }
  return date.toLocaleString();
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  const err = safeJson<ApiError>(payload);
  return err?.error ?? err?.detail ?? fallback;
}

function riskPillClass(risk: string | undefined): string {
  if (risk === "medium" || risk === "high") return "pill riskMedium";
  if (risk === "low") return "pill riskLow";
  return "pill";
}

function isSimulatedStatus(status: string | undefined): boolean {
  return typeof status === "string" && status.toUpperCase().includes("SIMULATED");
}

function buildAuditUrl(actionId?: string): string {
  const params = new URLSearchParams();
  params.set("limit", "20");
  if (actionId) {
    params.set("actionId", actionId);
  }
  return `/api/audit/recent?${params.toString()}`;
}

export default function Home() {
  const [query, setQuery] = useState("service 500 errors");
  const [results, setResults] = useState<SopResult[]>([]);
  const [status, setStatus] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [onlyUploaded, setOnlyUploaded] = useState(true);
  const [busy, setBusy] = useState<
    "upload" | "reindex" | "search" | "propose" | "approve" | "execute" | "refresh" | "none"
  >("none");
  const [health, setHealth] = useState<Health>({});
  const [top, setTop] = useState(5);

  const [incident, setIncident] = useState("Users report 500 errors after deployment");
  const [role, setRole] = useState<ActionRole>("operator");
  const [triageTop, setTriageTop] = useState(5);
  const [actionData, setActionData] = useState<ActionProposal | null>(null);
  const [actionError, setActionError] = useState("");
  const [auditItems, setAuditItems] = useState<AuditEvent[]>([]);

  const roleCanApprove = role === "manager" || role === "sre-lead";
  const canExecute = actionData ? actionData.status === "APPROVED" || actionData.status === "READY" : false;
  const isSimulatedExecution =
    isSimulatedStatus(actionData?.status) || isSimulatedStatus(actionData?.execution?.result?.status);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const data = (await r.json()) as Health;
        setHealth(data);
      } catch {
        setHealth({ ok: false, error: "Health check failed" });
      }
    })();
    void refreshAudit();
  }, []);

  const visibleResults = useMemo(() => {
    const filtered = onlyUploaded ? results.filter((r) => isBlob(r.source)) : results;
    return [...filtered].sort((a, b) => {
      const ab = isBlob(a.source) ? 0 : 1;
      const bb = isBlob(b.source) ? 0 : 1;
      if (ab !== bb) return ab - bb;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }, [results, onlyUploaded]);

  async function refreshAudit(actionId?: string) {
    try {
      const r = await fetch(buildAuditUrl(actionId), { cache: "no-store" });
      const data = (await r.json()) as AuditEnvelope;
      if (!r.ok) return;
      setAuditItems(Array.isArray(data?.items) ? (data.items as AuditEvent[]) : []);
    } catch {
      // Ignore transient audit fetch failures to keep UI responsive.
    }
  }

  async function refreshAction(actionId: string) {
    const r = await fetch(`/api/actions/${encodeURIComponent(actionId)}`, { cache: "no-store" });
    const payload = (await r.json()) as unknown;
    if (!r.ok) {
      throw new Error(extractErrorMessage(payload, `Action refresh failed (${r.status})`));
    }
    const action = safeJson<ActionProposal>(payload);
    if (!action) {
      throw new Error("Unexpected action payload");
    }
    setActionData(action);
  }

  const refreshCurrentAction = async () => {
    if (!actionData) return;
    setBusy("refresh");
    setActionError("");
    try {
      await refreshAction(actionData.id);
      await refreshAudit(actionData.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action refresh failed");
    } finally {
      setBusy("none");
    }
  };

  const search = async () => {
    setBusy("search");
    setStatus("Searching SOPs...");
    try {
      const r = await fetch("/api/sop/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top }),
      });
      const data = await r.json();
      const list = Array.isArray(data?.results) ? (data.results as SopResult[]) : [];
      setResults(list);
      setStatus(r.ok ? "Search completed" : "Search completed with upstream error");
    } catch {
      setStatus("Search failed");
    } finally {
      setBusy("none");
    }
  };

  const upload = async () => {
    if (!file) {
      setStatus("Select a file before upload");
      return;
    }

    setBusy("upload");
    setStatus("Uploading SOP...");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/sop/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) {
        setStatus(`Upload failed (${r.status})`);
        return;
      }
      setStatus(`Upload completed: ${data.path ?? "unknown path"}`);
    } catch {
      setStatus("Upload failed");
    } finally {
      setBusy("none");
    }
  };

  const reindex = async () => {
    setBusy("reindex");
    setStatus("Reindexing index...");
    try {
      const r = await fetch("/api/sop/reindex", { method: "POST" });
      const data = await r.json();
      if (!r.ok) {
        setStatus(`Reindex failed (${r.status})`);
        return;
      }
      setStatus(`Reindex completed: indexed=${data.indexed ?? "?"}`);
    } catch {
      setStatus("Reindex failed");
    } finally {
      setBusy("none");
    }
  };

  const proposeActions = async () => {
    setBusy("propose");
    setActionError("");

    const cleanedIncident = incident.trim();
    if (!cleanedIncident) {
      setActionError("Incident is required");
      setBusy("none");
      return;
    }

    try {
      const r = await fetch("/api/actions/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident: cleanedIncident, role, top: triageTop }),
      });

      const payload = (await r.json()) as unknown;
      if (!r.ok) {
        setActionData(null);
        setActionError(extractErrorMessage(payload, `Request failed (${r.status})`));
        return;
      }

      const proposed = safeJson<ActionProposal>(payload);
      if (!proposed || !proposed.id) {
        setActionData(null);
        setActionError("Unexpected payload from actions API");
        return;
      }

      setActionData(proposed);
      await refreshAudit(proposed.id);
    } catch {
      setActionData(null);
      setActionError("Actions request failed");
    } finally {
      setBusy("none");
    }
  };

  const decideAction = async (decision: "APPROVE" | "REJECT") => {
    if (!actionData) return;
    setBusy("approve");
    setActionError("");

    try {
      const r = await fetch("/api/actions/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: actionData.id, approverRole: role, decision }),
      });
      const payload = (await r.json()) as unknown;
      if (!r.ok) {
        setActionError(extractErrorMessage(payload, `Decision failed (${r.status})`));
        return;
      }

      const updated = safeJson<ActionProposal>(payload);
      if (!updated || !updated.id) {
        setActionError("Unexpected approval payload");
        return;
      }

      setActionData(updated);
      await refreshAudit(updated.id);
    } catch {
      setActionError("Approval request failed");
    } finally {
      setBusy("none");
    }
  };

  const executeAction = async () => {
    if (!actionData) return;
    setBusy("execute");
    setActionError("");

    try {
      const r = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: actionData.id, executorRole: role }),
      });
      const payload = (await r.json()) as unknown;
      if (!r.ok) {
        setActionError(extractErrorMessage(payload, `Execution failed (${r.status})`));
        return;
      }

      await refreshAction(actionData.id);
      await refreshAudit(actionData.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Execution request failed");
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
              Incident to action loop: evidence-backed proposals, human approval, and simulated execution.
            </p>
          </div>

          <div className="ocm__right">
            <div className={`ocm__badge ${health.ok ? "ok" : "bad"}`}>
              <span className="dot" />
              {health.ok ? "API connected" : "API unavailable"}
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
          <div className="step">3) Propose</div>
          <div className="sep" />
          <div className={`step ${actionData?.status === "APPROVED" || actionData?.status === "READY" ? "done" : ""}`}>
            4) Approve
          </div>
          <div className="sep" />
          <div className={`step ${actionData?.status === "EXECUTED_SIMULATED" ? "done" : ""}`}>5) Execute</div>
        </section>

        <div className="ocm__grid">
          <div className="ocm__col">
            <div className="card">
              <div className="card__head">
                <div>
                  <h2 className="card__title">Upload SOP / Policy</h2>
                  <p className="card__desc">Upload Markdown or text SOP files to Azure Blob Storage.</p>
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
                  <div className="drop__title">{file ? file.name : "Choose a .md or .txt file"}</div>
                  <div className="drop__hint">Uploaded files become searchable after reindex.</div>
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
                  <h2 className="card__title">Incident Triage</h2>
                  <p className="card__desc">Create an action proposal with gate checks and evidence.</p>
                </div>
              </div>

              <label className="fieldLabel" htmlFor="incident">
                Incident
              </label>
              <textarea
                id="incident"
                className="ocm__textarea"
                value={incident}
                onChange={(e) => setIncident(e.target.value)}
                rows={4}
                placeholder="Describe the production incident"
              />

              <div className="row triageRow">
                <div className="field">
                  <label className="fieldLabel" htmlFor="role">
                    Role
                  </label>
                  <select id="role" className="ocm__select" value={role} onChange={(e) => setRole(e.target.value as ActionRole)}>
                    <option value="operator">operator</option>
                    <option value="admin">admin</option>
                    <option value="manager">manager</option>
                    <option value="sre-lead">sre-lead</option>
                  </select>
                </div>

                <div className="field">
                  <label className="fieldLabel" htmlFor="triageTop">
                    Top K
                  </label>
                  <input
                    id="triageTop"
                    className="ocm__input"
                    type="number"
                    min={1}
                    max={20}
                    value={triageTop}
                    onChange={(e) => setTriageTop(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                  />
                </div>
              </div>

              <button className="ocm__btn primary triageBtn" onClick={proposeActions} disabled={busy !== "none"}>
                {busy === "propose" ? "Proposing..." : "Propose actions"}
              </button>

              {actionError && <div className="status statusError">{actionError}</div>}
            </div>

            <div className="card">
              <div className="card__head">
                <div>
                  <h2 className="card__title">Search SOPs with Evidence</h2>
                  <p className="card__desc">Retrieve relevant SOP snippets with citation metadata.</p>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={onlyUploaded} onChange={(e) => setOnlyUploaded(e.target.checked)} />
                  <span>Only uploaded</span>
                </label>
              </div>

              <div className="row">
                <input
                  className="ocm__input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="500 errors, latency spike, auth failures, db connection exhaustion"
                />
                <button className="ocm__btn primary" onClick={search} disabled={busy !== "none"}>
                  {busy === "search" ? "Searching..." : "Search"}
                </button>
              </div>

              <div className="row small">
                <span className="label">Top</span>
                <input type="range" min={1} max={10} value={top} onChange={(e) => setTop(Number(e.target.value))} />
                <span className="label">{top}</span>
              </div>

              {status && <div className="status">{status}</div>}

              {visibleResults.length === 0 ? (
                <div className="empty">No search results yet.</div>
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
                        <span>score={Number(r.score ?? 0).toFixed(3)}</span>
                        <span className="sepDot">|</span>
                        <span className="mono">{r.source}</span>
                      </div>
                      <pre className="snippet">{r.snippet}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ocm__col">
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Action Proposal</h2>
              </div>

              {!actionData ? (
                <div className="empty">No action proposal yet. Submit an incident to run triage.</div>
              ) : (
                <div className="proposal">
                  <div className="proposalHead">
                    <span className="pill strong">{actionData.status}</span>
                    <span className="pill">{actionData.category}</span>
                    <span className={riskPillClass(actionData.plan.risk)}>risk: {actionData.plan.risk ?? "unknown"}</span>
                    <span className="pill">gate: {actionData.gate.decision ?? "n/a"}</span>
                  </div>

                  <div className="proposalMeta">
                    <div>
                      <span className="metaLabel">Action ID:</span>
                      <span className="mono">{actionData.id}</span>
                    </div>
                    <div>
                      <span className="metaLabel">Created:</span>
                      <span>{formatUtc(actionData.createdAt)}</span>
                    </div>
                  </div>

                  {Array.isArray(actionData.warnings) && actionData.warnings.length > 0 && (
                    <div className="status statusWarn">{actionData.warnings.join(" | ")}</div>
                  )}
                  {isSimulatedExecution && (
                    <div className="status statusInfo">Execution is simulated</div>
                  )}

                  <div className="proposalSection">
                    <h3>Evidence First</h3>
                    {Array.isArray(actionData.evidence) && actionData.evidence.length > 0 ? (
                      <div className="list">
                        {actionData.evidence.map((item) => (
                          <div key={item.id} className="item">
                            <div className="item__top">
                              <div className="item__title">{item.title || item.id}</div>
                              <div className={`tag ${isBlob(item.source) ? "blob" : "demo"}`}>
                                {isBlob(item.source) ? "UPLOADED" : "INDEXED"}
                              </div>
                            </div>
                            <div className="meta">
                              <span>score={Number(item.score ?? 0).toFixed(3)}</span>
                              <span className="sepDot">|</span>
                              <span className="mono">{item.source}</span>
                            </div>
                            <pre className="snippet">{item.snippet}</pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty">No evidence returned.</div>
                    )}
                  </div>

                  <div className="proposalSection">
                    <h3>Plan</h3>
                    <div className="planMeta">
                      <span>requiresApproval: {String(Boolean(actionData.plan.requiresApproval))}</span>
                      <span>steps: {Array.isArray(actionData.plan.steps) ? actionData.plan.steps.length : 0}</span>
                    </div>

                    {Array.isArray(actionData.plan.steps) && actionData.plan.steps.length > 0 ? (
                      <ol className="planList">
                        {actionData.plan.steps.map((step, index) => (
                          <li key={`${index}-${step}`}>{step}</li>
                        ))}
                      </ol>
                    ) : (
                      <div className="empty">No plan steps returned.</div>
                    )}
                  </div>

                  <div className="proposalSection">
                    <h3>Decision Gate</h3>
                    <div className="gateGrid">
                      <div className="gateRow">
                        <span className="metaLabel">Decision:</span>
                        <span>{actionData.gate.decision ?? "n/a"}</span>
                      </div>
                      <div className="gateRow">
                        <span className="metaLabel">Required role:</span>
                        <span>{actionData.gate.requiredRole ?? "n/a"}</span>
                      </div>
                      <div className="gateRow">
                        <span className="metaLabel">Requester role:</span>
                        <span>{actionData.gate.requesterRole ?? actionData.requesterRole}</span>
                      </div>
                      <div className="gateRow">
                        <span className="metaLabel">Auto execute:</span>
                        <span>{String(Boolean(actionData.gate.allowedToAutoExecute))}</span>
                      </div>
                    </div>
                    <p className="gateReason">{actionData.gate.reason ?? "No gate rationale returned."}</p>
                  </div>

                  <div className="proposalActions">
                    {roleCanApprove && (
                      <>
                        <button
                          className="ocm__btn primary"
                          onClick={() => void decideAction("APPROVE")}
                          disabled={busy !== "none" || actionData.status !== "PENDING_APPROVAL"}
                        >
                          {busy === "approve" ? "Applying..." : "Approve"}
                        </button>
                        <button
                          className="ocm__btn"
                          onClick={() => void decideAction("REJECT")}
                          disabled={busy !== "none" || actionData.status === "EXECUTED_SIMULATED"}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    <button className="ocm__btn" onClick={() => void refreshCurrentAction()} disabled={busy !== "none"}>
                      {busy === "refresh" ? "Refreshing..." : "Refresh action state"}
                    </button>
                    <button className="ocm__btn" onClick={() => void executeAction()} disabled={busy !== "none" || !canExecute}>
                      {busy === "execute" ? "Executing..." : "Execute (simulated)"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Audit Timeline</h2>
              </div>

              {auditItems.length === 0 ? (
                <div className="empty">No audit events yet.</div>
              ) : (
                <div className="list">
                  {auditItems.map((event, index) => (
                    <div key={`${event.ts}-${event.event}-${index}`} className="item">
                      <div className="item__top">
                        <div className="item__title">{event.event}</div>
                        <div className="tag">{formatUtc(event.ts)}</div>
                      </div>
                      {event.actionId && (
                        <div className="meta">
                          <span className="metaLabel">actionId:</span>
                          <span className="mono">{event.actionId}</span>
                        </div>
                      )}
                      <pre className="snippet">{JSON.stringify(event.data, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="ocm__footer">
          Human-in-the-loop ops control plane with evidence, approvals, simulated execution, and audit trail.
        </footer>
      </div>
    </main>
  );
}
