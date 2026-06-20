#Requires -Version 5.1
<#
.SYNOPSIS
    Smart Laundry local development startup script.

.DESCRIPTION
    Starts one or all services in separate titled terminal windows.
    Each Java service is wrapped with `doppler run` for secret injection.

.EXAMPLE
    .\dev.ps1 start         # start all services
    .\dev.ps1 start bff     # start only the Reporting BFF
    .\dev.ps1 stop          # kill processes on all service ports
    .\dev.ps1 status        # show which ports are in use
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "status", "help")]
    [string]$Command = "help",

    [Parameter(Position = 1)]
    [string]$Service = "all"
)

$Root = $PSScriptRoot

# ── Service registry ──────────────────────────────────────────────────────────
# cmd   : the command to run inside the service directory
# doppler: Doppler project name (empty = no Doppler injection)
# port  : primary listening port (used by stop/status)
$Services = [ordered]@{
    bff       = @{
        label   = "Reporting BFF"
        dir     = "reporting-bff"
        doppler = "reporting-bff"
        cmd     = "mvn spring-boot:run"
        port    = 8083
    }
    bot       = @{
        label   = "Spring Bot Manager"
        dir     = "spring-bot-manager-only"
        doppler = "spring-bot-manager"
        cmd     = "mvn spring-boot:run"
        port    = 8090
    }
    payment   = @{
        label   = "Payment Management Service"
        dir     = "PaymentManagementService"
        doppler = "payment-management-service"
        cmd     = "mvn spring-boot:run"
        port    = 8081
    }
    machine   = @{
        label   = "Machine State Service"
        dir     = "MachineStateService"
        doppler = "machine-state-service"
        cmd     = "mvn spring-boot:run"
        port    = 8082
    }
    dashboard = @{
        label   = "Dashboard (Next.js)"
        dir     = "smart-laundry-dashboard"
        doppler = "smart-laundry-dashboard"
        cmd     = "npm run dev"
        port    = 3001
    }
}

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Header([string]$text) {
    Write-Host "`n=== $text ===" -ForegroundColor Cyan
}

function Get-PidOnPort([int]$port) {
    $line = netstat -ano 2>$null | Select-String ":$port\s" | Where-Object { $_ -match "LISTEN|ABH" } | Select-Object -First 1
    if ($line -match '(\d+)\s*$') { return [int]$Matches[1] }
    return $null
}

function Start-OneService([string]$name, [hashtable]$svc) {
    $dir        = Join-Path $Root $svc.dir
    $label      = $svc.label
    $dopplerPrj = $svc.doppler
    $innerCmd   = $svc.cmd
    $port       = $svc.port

    if (-not (Test-Path $dir)) {
        Write-Host "  [SKIP] $label — directory not found: $dir" -ForegroundColor Yellow
        return
    }

    $existingPid = Get-PidOnPort $port
    if ($null -ne $existingPid) {
        Write-Host "  [SKIP] $label — already running on :$port (PID $existingPid)" -ForegroundColor Yellow
        return
    }

    if ($dopplerPrj) {
        $fullCmd = "doppler run --project '$dopplerPrj' --config dev -- $innerCmd"
    } else {
        $fullCmd = $innerCmd
    }

    $psCmd = "Set-Location '$dir'; Write-Host 'Starting $label on :$port' -ForegroundColor Green; $fullCmd"

    Start-Process powershell `
        -ArgumentList "-NoExit", "-Command", $psCmd `
        -WindowStyle Normal `
        -WorkingDirectory $dir

    Write-Host "  [START] $label  :$port" -ForegroundColor Green
}

function Stop-AllServices {
    Write-Header "Stopping services"
    foreach ($name in $Services.Keys) {
        $svc  = $Services[$name]
        $port = $svc.port
        $procId = Get-PidOnPort $port
        if ($null -ne $procId) {
            try {
                taskkill /F /PID $procId 2>$null | Out-Null
                Write-Host "  [STOP] $($svc.label)  :$port  (PID $procId)" -ForegroundColor Red
            } catch {
                Write-Host "  [FAIL] Could not kill PID $procId on :$port" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [    ] $($svc.label)  :$port  (not running)" -ForegroundColor DarkGray
        }
    }
}

function Show-Status {
    Write-Header "Service status"
    foreach ($name in $Services.Keys) {
        $svc  = $Services[$name]
        $port = $svc.port
        $procId = Get-PidOnPort $port
        if ($null -ne $procId) {
            Write-Host ("  [UP]  {0,-30} :{1}  PID {2}" -f $svc.label, $port, $procId) -ForegroundColor Green
        } else {
            Write-Host ("  [--]  {0,-30} :{1}" -f $svc.label, $port) -ForegroundColor DarkGray
        }
    }
    Write-Host ""
}

function Show-Help {
    Write-Host @"

Smart Laundry dev script
Usage:  .\dev.ps1 <command> [service]

Commands:
  start [service]   Start one or all services in separate windows.
                    Services: bff, bot, payment, machine, dashboard
                    Default: all
  stop              Kill all services by port.
  status            Show which services are running.
  help              Show this message.

Examples:
  .\dev.ps1 start           # start everything
  .\dev.ps1 start bff       # start only the Reporting BFF
  .\dev.ps1 stop            # kill everything
  .\dev.ps1 status          # check what's running
"@ -ForegroundColor White
}

# ── Entry point ───────────────────────────────────────────────────────────────
switch ($Command) {

    "start" {
        if ($Service -eq "all") {
            Write-Header "Starting all services"
            foreach ($name in $Services.Keys) {
                Start-OneService $name $Services[$name]
            }
            Write-Host "`nAll services launched. Run .\dev.ps1 status to check." -ForegroundColor Cyan
        } elseif ($Services.Contains($Service)) {
            Write-Header "Starting $Service"
            Start-OneService $Service $Services[$Service]
        } else {
            Write-Host "Unknown service '$Service'. Valid: $($Services.Keys -join ', ')" -ForegroundColor Red
        }
    }

    "stop"   { Stop-AllServices }
    "status" { Show-Status }
    "help"   { Show-Help }
}
