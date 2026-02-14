# Ops Copilot Mesh Demo Script (2 Minutes)

## Goal
Show a full closed loop:
1. Evidence-backed action proposal.
2. Human approval gate.
3. Simulated execution.
4. Audit trail.

## Preconditions
- API running at `http://127.0.0.1:8000`.
- WEB running at `http://localhost:3000`.
- API has `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_KEY`, `AZURE_SEARCH_INDEX=ops-sop`, `AZURE_STORAGE_CONNECTION_STRING`.

## Live Script

### 1) Show service health (10s)
```powershell
Invoke-RestMethod "http://127.0.0.1:8000/health" | ConvertTo-Json
```

### 2) Show evidence retrieval from SOP search (20s)
```powershell
$searchBody = @{ query="negative inventory"; top=3 } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/sop/search" -ContentType "application/json" -Body $searchBody | ConvertTo-Json -Depth 8
```

### 3) Propose action from an incident (30s)
```powershell
$payload = @{ incident="Users report 500 errors after deployment"; role="operator"; top=5 } | ConvertTo-Json -Compress
$proposed = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/propose" -ContentType "application/json" -Body $payload
$proposed | ConvertTo-Json -Depth 10
$actionId = $proposed.id
```

Expected talking points:
- `evidence` contains SOP snippets and sources.
- `plan` contains risk + steps.
- `gate` explains whether approval is required and why.

### 4) Human in the loop approval (20s)
```powershell
$approve = @{ actionId=$actionId; approverRole="manager"; decision="APPROVE"; note="approved for demo" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/approve" -ContentType "application/json" -Body $approve | ConvertTo-Json -Depth 10
```

### 5) Execute (simulated) (20s)
```powershell
$exec = @{ actionId=$actionId; executorRole="operator" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/execute" -ContentType "application/json" -Body $exec | ConvertTo-Json -Depth 10
```

### 6) Show audit timeline (20s)
```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/v1/audit/recent?limit=20" | ConvertTo-Json -Depth 10
```

Expected events:
- `action.proposed`
- `action.approved`
- `action.executed`

## Optional Azure Demo (same flow)
Replace local URLs with:
- API: `https://<API_FQDN>/v1/actions/*`
- WEB proxy: `https://<WEB_FQDN>/api/actions/*`
