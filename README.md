# Ops Copilot Mesh

A reusable, enterprise-grade multi-agent platform that turns operational data (spreadsheets) + SOPs into auditable insights and role-based actions on Azure.

## Core Tech
- Microsoft Foundry (Model Router)
- Microsoft Agent Framework (multi-agent orchestration)
- MCP (tool-aware agents)
- Azure deployment (Container Apps) + Observability

## Local Run
### API (FastAPI)

```powershell
cd apps/api
copy .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### WEB (Next.js)

```powershell
cd apps/web
copy .env.example .env.local
npm install
npm run dev
```

Web will be available at `http://localhost:3000` and will proxy API calls to `API_BASE_URL`.

## Required Environment Variables
### API (`apps/api/.env`)

```env
AZURE_SEARCH_ENDPOINT=https://<your-search-service>.search.windows.net
AZURE_SEARCH_KEY=<your-search-admin-key>
AZURE_SEARCH_INDEX=ops-sop
AZURE_STORAGE_CONNECTION_STRING=<your-storage-connection-string>
APP_ENV=local
```

### WEB (`apps/web/.env.local`)

```env
API_BASE_URL=http://127.0.0.1:8000
```

## Architecture
TBD

## Azure Deploy Runbook (PowerShell)
Use the helper script to build images in ACR and update both Container Apps:

```powershell
.\scripts\azure-deploy.ps1 `
  -ResourceGroup "rg-ops-copilot-mesh" `
  -AcrName "acropscopilotmesh2390" `
  -ApiApp "api-ops-copilot-mesh" `
  -WebApp "web-ops-copilot-mesh" `
  -SearchEndpoint "https://<your-search-service>.search.windows.net" `
  -SearchIndex "ops-sop" `
  -SearchKey "<search-admin-key>" `
  -StorageConnectionString "<storage-connection-string>" `
  -RestartRevisions
```

Notes:
- `AZURE_SEARCH_KEY` and `AZURE_STORAGE_CONNECTION_STRING` are applied as Container Apps secrets (`search-key`, `storage-conn`).
- `AZURE_SEARCH_INDEX` must not be empty in cloud.
- Updating secrets typically requires restarting the active revision:

```powershell
az containerapp revision restart -n api-ops-copilot-mesh -g rg-ops-copilot-mesh --revision <ACTIVE_REVISION_NAME>
az containerapp revision restart -n web-ops-copilot-mesh -g rg-ops-copilot-mesh --revision <ACTIVE_REVISION_NAME>
```

## Smoke Tests

Use this payload for all actions triage checks:

```powershell
$payload = @{ incident="Users report 500 errors after deployment"; role="operator"; top=5 } | ConvertTo-Json -Compress
```

### 1) Local API direct call

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/propose" -ContentType "application/json" -Body $payload | ConvertTo-Json -Depth 12
```

### 1.1) Approve and execute (API direct)

```powershell
$proposed = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/propose" -ContentType "application/json" -Body $payload
$actionId = $proposed.id

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/approve" -ContentType "application/json" -Body (@{ actionId=$actionId; approverRole="manager"; decision="APPROVE" } | ConvertTo-Json -Compress) | ConvertTo-Json -Depth 12
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/execute" -ContentType "application/json" -Body (@{ actionId=$actionId; executorRole="operator" } | ConvertTo-Json -Compress) | ConvertTo-Json -Depth 12
Invoke-RestMethod -Method Get  -Uri "http://127.0.0.1:8000/v1/audit/recent?limit=20" | ConvertTo-Json -Depth 12
```

### 2) Local Web proxy call (Next.js -> API)

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/actions/propose" -ContentType "application/json" -Body $payload | ConvertTo-Json -Depth 12
```

### 2.1) Local Web proxy approve / execute

```powershell
$proposed = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/actions/propose" -ContentType "application/json" -Body $payload
$actionId = $proposed.id

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/actions/approve" -ContentType "application/json" -Body (@{ actionId=$actionId; approverRole="manager"; decision="APPROVE" } | ConvertTo-Json -Compress) | ConvertTo-Json -Depth 12
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/actions/execute" -ContentType "application/json" -Body (@{ actionId=$actionId; executorRole="operator" } | ConvertTo-Json -Compress) | ConvertTo-Json -Depth 12
Invoke-RestMethod -Method Get  -Uri "http://localhost:3000/api/audit/recent?limit=20" | ConvertTo-Json -Depth 12
```

### 3) Deployed Web proxy call (Azure Container Apps)

Replace `<WEB_FQDN>` with your deployed web app hostname:

```powershell
Invoke-RestMethod -Method Post -Uri "https://<WEB_FQDN>/api/actions/propose" -ContentType "application/json" -Body $payload | ConvertTo-Json -Depth 12
```

Equivalent curl examples:

```bash
curl -sS -X POST "http://127.0.0.1:8000/v1/actions/propose" -H "Content-Type: application/json" -d '{"incident":"Users report 500 errors after deployment","role":"operator","top":5}'
curl -sS -X POST "http://localhost:3000/api/actions/propose" -H "Content-Type: application/json" -d '{"incident":"Users report 500 errors after deployment","role":"operator","top":5}'
curl -sS -X POST "https://<WEB_FQDN>/api/actions/propose" -H "Content-Type: application/json" -d '{"incident":"Users report 500 errors after deployment","role":"operator","top":5}'
```

### Scripted smoke tests (recommended)

```powershell
# Local only (requires local API+WEB running)
.\scripts\azure-smoke-test.ps1 -SkipCloud

# Cloud only (auto-discovers FQDN from Container Apps)
.\scripts\azure-smoke-test.ps1 -SkipLocal

# Full (local + cloud)
.\scripts\azure-smoke-test.ps1
```
