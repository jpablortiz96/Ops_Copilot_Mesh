# Ops Copilot Mesh Demo Script (2 Minutes)

## Open These URLs
- Local Web UI: `http://localhost:3000`
- Local API docs: `http://127.0.0.1:8000/docs`
- Azure Web UI: `https://<WEB_FQDN>`
- Azure API docs: `https://<API_FQDN>/docs`

## Neutral Incident Examples
- `Users report intermittent 500 errors after deployment`
- `API latency spike above 2s in one region`
- `Authentication failures increased for admin users`
- `Database connection pool exhausted in checkout service`

## Judge Narrative (Copy/Paste)
1. "We ingest SOPs and operational runbooks, then retrieve evidence snippets with source citations."
2. "Given an incident, the system proposes a plan, scores risk, and runs a decision gate."
3. "If approval is required, a human approves/rejects. Execution is simulated for safety."
4. "Every step is written to an audit timeline: proposed, approved/rejected, executed."

## Live Commands (Local API)
```powershell
$incident = "Users report intermittent 500 errors after deployment"
$payload = @{ incident=$incident; role="operator"; top=5 } | ConvertTo-Json -Compress

$proposed = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/propose" -ContentType "application/json" -Body $payload
$proposed | ConvertTo-Json -Depth 10
$actionId = $proposed.id

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/approve" -ContentType "application/json" -Body (@{ actionId=$actionId; approverRole="manager"; decision="APPROVE"; note="judge demo" } | ConvertTo-Json -Compress) | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/v1/actions/execute" -ContentType "application/json" -Body (@{ actionId=$actionId; executorRole="operator" } | ConvertTo-Json -Compress) | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/v1/audit/recent?actionId=$actionId&limit=50" | ConvertTo-Json -Depth 10
```

## Azure Commands (API + Web Proxy)
```powershell
$RG="rg-ops-copilot-mesh"
$API_APP="api-ops-copilot-mesh"
$WEB_APP="web-ops-copilot-mesh"
$API_FQDN = az containerapp show -n $API_APP -g $RG --query "properties.configuration.ingress.fqdn" -o tsv
$WEB_FQDN = az containerapp show -n $WEB_APP -g $RG --query "properties.configuration.ingress.fqdn" -o tsv

$incident = "API latency spike above 2s in one region"
$payload = @{ incident=$incident; role="operator"; top=5 } | ConvertTo-Json -Compress

# API direct
$proposedApi = Invoke-RestMethod -Method Post -Uri "https://$API_FQDN/v1/actions/propose" -ContentType "application/json" -Body $payload
$proposedApi | ConvertTo-Json -Depth 10

# Web proxy
$proposedWeb = Invoke-RestMethod -Method Post -Uri "https://$WEB_FQDN/api/actions/propose" -ContentType "application/json" -Body $payload
$proposedWeb | ConvertTo-Json -Depth 10
```
