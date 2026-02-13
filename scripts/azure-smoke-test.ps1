[CmdletBinding()]
param(
    [string]$LocalApiBase = "http://127.0.0.1:8000",
    [string]$LocalWebBase = "http://127.0.0.1:3000",
    [string]$CloudApiBase = "",
    [string]$CloudWebBase = "",
    [string]$ResourceGroup = "rg-ops-copilot-mesh",
    [string]$ApiApp = "api-ops-copilot-mesh",
    [string]$WebApp = "web-ops-copilot-mesh",
    [switch]$SkipLocal,
    [switch]$SkipCloud
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-Base([string]$BaseUrl) {
    if ($null -eq $BaseUrl) {
        return ""
    }
    return $BaseUrl.Trim().TrimEnd("/")
}

function Read-ErrorBody([System.Exception]$Exception) {
    if ($null -eq $Exception.Response) {
        return $Exception.Message
    }
    $response = $Exception.Response
    try {
        $stream = $response.GetResponseStream()
        if ($null -eq $stream) {
            return $Exception.Message
        }
        $reader = [System.IO.StreamReader]::new($stream)
        return $reader.ReadToEnd()
    } catch {
        return $Exception.Message
    }
}

function Invoke-Json {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")] [string]$Method,
        [Parameter(Mandatory = $true)] [string]$Uri,
        [object]$Body = $null
    )

    try {
        if ($Method -eq "GET") {
            $result = Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec 30
        } else {
            $payload = $Body | ConvertTo-Json -Compress -Depth 20
            $result = Invoke-RestMethod -Method Post -Uri $Uri -ContentType "application/json" -Body $payload -TimeoutSec 30
        }

        return [pscustomobject]@{
            Success = $true
            Uri = $Uri
            Body = $result
            Error = $null
        }
    } catch {
        return [pscustomobject]@{
            Success = $false
            Uri = $Uri
            Body = $null
            Error = (Read-ErrorBody $_.Exception)
        }
    }
}

function Resolve-CloudBases {
    param(
        [string]$ApiBase,
        [string]$WebBase,
        [string]$ResourceGroupName,
        [string]$ApiAppName,
        [string]$WebAppName
    )

    $resolvedApi = Normalize-Base $ApiBase
    $resolvedWeb = Normalize-Base $WebBase

    if (-not $resolvedApi) {
        $apiFqdn = az containerapp show -n $ApiAppName -g $ResourceGroupName --query "properties.configuration.ingress.fqdn" -o tsv
        $resolvedApi = "https://$apiFqdn"
    }
    if (-not $resolvedWeb) {
        $webFqdn = az containerapp show -n $WebAppName -g $ResourceGroupName --query "properties.configuration.ingress.fqdn" -o tsv
        $resolvedWeb = "https://$webFqdn"
    }

    return [pscustomobject]@{
        ApiBase = Normalize-Base $resolvedApi
        WebBase = Normalize-Base $resolvedWeb
    }
}

function Test-ApiTarget {
    param(
        [Parameter(Mandatory = $true)][string]$Base,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host "==> [$Label] API smoke tests on $Base"
    $payload = @{ incident = "Users report 500 errors after deployment"; role = "operator"; top = 5 }
    $searchBody = @{ query = "inventory negative"; top = 3 }

    $health = Invoke-Json -Method GET -Uri "$Base/health"
    $search = Invoke-Json -Method POST -Uri "$Base/v1/sop/search" -Body $searchBody
    $propose = Invoke-Json -Method POST -Uri "$Base/v1/actions/propose" -Body $payload

    foreach ($result in @($health, $search, $propose)) {
        if (-not $result.Success) {
            throw "[$Label] request failed: $($result.Uri) -> $($result.Error)"
        }
    }

    Write-Host "[$Label] health ok; propose actionId=$($propose.Body.id) status=$($propose.Body.status)"
}

function Test-WebTarget {
    param(
        [Parameter(Mandatory = $true)][string]$Base,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host "==> [$Label] WEB proxy smoke tests on $Base"
    $payload = @{ incident = "Users report 500 errors after deployment"; role = "operator"; top = 5 }
    $searchBody = @{ query = "inventory negative"; top = 3 }

    $health = Invoke-Json -Method GET -Uri "$Base/api/health"
    $search = Invoke-Json -Method POST -Uri "$Base/api/sop/search" -Body $searchBody
    $propose = Invoke-Json -Method POST -Uri "$Base/api/actions/propose" -Body $payload

    foreach ($result in @($health, $search, $propose)) {
        if (-not $result.Success) {
            throw "[$Label] request failed: $($result.Uri) -> $($result.Error)"
        }
    }

    Write-Host "[$Label] proxy ok; propose actionId=$($propose.Body.id) status=$($propose.Body.status)"
}

try {
    if (-not $SkipLocal) {
        Test-ApiTarget -Base (Normalize-Base $LocalApiBase) -Label "LOCAL"
        Test-WebTarget -Base (Normalize-Base $LocalWebBase) -Label "LOCAL"
    }

    if (-not $SkipCloud) {
        $bases = Resolve-CloudBases -ApiBase $CloudApiBase -WebBase $CloudWebBase -ResourceGroupName $ResourceGroup -ApiAppName $ApiApp -WebAppName $WebApp
        Test-ApiTarget -Base $bases.ApiBase -Label "CLOUD"
        Test-WebTarget -Base $bases.WebBase -Label "CLOUD"
    }

    Write-Host "Smoke tests completed successfully." -ForegroundColor Green
    exit 0
} catch {
    Write-Error $_
    exit 1
}
