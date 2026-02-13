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

## Architecture
TBD

## Smoke Test Commands

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
