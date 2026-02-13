[CmdletBinding()]
param(
    [string]$ResourceGroup = "rg-ops-copilot-mesh",
    [string]$AcrName = "acropscopilotmesh2390",
    [string]$ApiApp = "api-ops-copilot-mesh",
    [string]$WebApp = "web-ops-copilot-mesh",
    [string]$ApiImageRepo = "ops-copilot-mesh-api",
    [string]$WebImageRepo = "ops-copilot-mesh-web",
    [string]$ApiTag = ("v" + (Get-Date -Format "yyyyMMddHHmmss")),
    [string]$WebTag = "",
    [string]$SearchEndpoint = "",
    [string]$SearchIndex = "",
    [string]$ApiBaseUrl = "",
    [string]$SearchKey = "",
    [string]$StorageConnectionString = "",
    [switch]$RestartRevisions
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-Base([string]$BaseUrl) {
    if ($null -eq $BaseUrl) {
        return ""
    }
    return $BaseUrl.Trim().TrimEnd("/")
}

function Get-ContainerEnvMap {
    param(
        [Parameter(Mandatory = $true)][string]$AppName,
        [Parameter(Mandatory = $true)][string]$RG
    )

    $envItems = az containerapp show -n $AppName -g $RG --query "properties.template.containers[0].env" -o json | ConvertFrom-Json
    $map = @{}
    foreach ($item in $envItems) {
        $name = [string]$item.name
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $map[$name] = $item
        }
    }
    return $map
}

function Ensure-ContainerSecrets {
    param(
        [Parameter(Mandatory = $true)][string]$AppName,
        [Parameter(Mandatory = $true)][string]$RG,
        [string[]]$Secrets = @()
    )

    if ($Secrets.Count -eq 0) {
        return
    }
    Write-Host "Setting secrets on $AppName"
    az containerapp secret set -n $AppName -g $RG --secrets @Secrets | Out-Null
}

function Restart-LatestReadyRevision {
    param(
        [Parameter(Mandatory = $true)][string]$AppName,
        [Parameter(Mandatory = $true)][string]$RG
    )

    $revision = az containerapp show -n $AppName -g $RG --query "properties.latestReadyRevisionName" -o tsv
    if ($revision) {
        Write-Host "Restarting revision $revision on $AppName"
        az containerapp revision restart -n $AppName -g $RG --revision $revision | Out-Null
    }
}

if (-not $WebTag) {
    $WebTag = $ApiTag
}

$apiImage = "$AcrName.azurecr.io/${ApiImageRepo}:$ApiTag"
$webImage = "$AcrName.azurecr.io/${WebImageRepo}:$WebTag"

Write-Host "Building API image: $apiImage"
az acr build -r $AcrName -t "${ApiImageRepo}:$ApiTag" -f "apps/api/Dockerfile" "apps/api" --no-logs | Out-Null

Write-Host "Building WEB image: $webImage"
az acr build -r $AcrName -t "${WebImageRepo}:$WebTag" -f "apps/web/Dockerfile" "apps/web" --no-logs | Out-Null

$apiEnvMap = Get-ContainerEnvMap -AppName $ApiApp -RG $ResourceGroup
$effectiveSearchEndpoint = if ($SearchEndpoint) { $SearchEndpoint.Trim() } elseif ($apiEnvMap.ContainsKey("AZURE_SEARCH_ENDPOINT")) { [string]$apiEnvMap["AZURE_SEARCH_ENDPOINT"].value } else { "" }
$effectiveSearchIndex = if ($SearchIndex) { $SearchIndex.Trim() } elseif ($apiEnvMap.ContainsKey("AZURE_SEARCH_INDEX")) { [string]$apiEnvMap["AZURE_SEARCH_INDEX"].value } else { "" }

if (-not $effectiveSearchIndex) {
    $effectiveSearchIndex = "ops-sop"
}
if (-not $effectiveSearchEndpoint) {
    throw "AZURE_SEARCH_ENDPOINT is required. Pass -SearchEndpoint or configure it in Container Apps."
}

$apiSecrets = @()
if ($SearchKey) {
    $apiSecrets += "search-key=$SearchKey"
}
if ($StorageConnectionString) {
    $apiSecrets += "storage-conn=$StorageConnectionString"
}
Ensure-ContainerSecrets -AppName $ApiApp -RG $ResourceGroup -Secrets $apiSecrets

$apiEnvVars = @(
    "AZURE_SEARCH_ENDPOINT=$effectiveSearchEndpoint",
    "AZURE_SEARCH_INDEX=$effectiveSearchIndex",
    "AZURE_SEARCH_KEY=secretref:search-key",
    "AZURE_STORAGE_CONNECTION_STRING=secretref:storage-conn"
)

Write-Host "Updating API container app: $ApiApp"
az containerapp update -n $ApiApp -g $ResourceGroup --image $apiImage --set-env-vars @apiEnvVars | Out-Null

$apiFqdn = az containerapp show -n $ApiApp -g $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
$resolvedApiBase = if ($ApiBaseUrl) { Normalize-Base $ApiBaseUrl } else { "https://$apiFqdn" }

Write-Host "Updating WEB container app: $WebApp"
az containerapp update -n $WebApp -g $ResourceGroup --image $webImage --set-env-vars "API_BASE_URL=$resolvedApiBase" | Out-Null

if ($RestartRevisions) {
    Restart-LatestReadyRevision -AppName $ApiApp -RG $ResourceGroup
    Restart-LatestReadyRevision -AppName $WebApp -RG $ResourceGroup
}

$apiState = az containerapp show -n $ApiApp -g $ResourceGroup --query "{fqdn:properties.configuration.ingress.fqdn,image:properties.template.containers[0].image,latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}" -o json | ConvertFrom-Json
$webState = az containerapp show -n $WebApp -g $ResourceGroup --query "{fqdn:properties.configuration.ingress.fqdn,image:properties.template.containers[0].image,latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}" -o json | ConvertFrom-Json

Write-Host "Deployment completed." -ForegroundColor Green
Write-Host ("API  -> https://{0}" -f $apiState.fqdn)
Write-Host ("WEB  -> https://{0}" -f $webState.fqdn)
Write-Host ("API image: {0}" -f $apiState.image)
Write-Host ("WEB image: {0}" -f $webState.image)
Write-Host ("API ready/latest: {0} / {1}" -f $apiState.ready, $apiState.latest)
Write-Host ("WEB ready/latest: {0} / {1}" -f $webState.ready, $webState.latest)
