param([string]$Action = "gui")
$ErrorActionPreference = "Stop"
$binary = Join-Path $PSScriptRoot "GCBridge.exe"
if (Test-Path $binary) {
    & $binary $Action
    exit $LASTEXITCODE
}
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
    $linuxRoot = (& wsl.exe --exec wslpath -u $PSScriptRoot).Trim()
    if ($LASTEXITCODE -eq 0 -and $linuxRoot.StartsWith("/")) {
        & wsl.exe --exec bash "$linuxRoot/launch.sh" $Action
        exit $LASTEXITCODE
    }
}
throw "Download the Windows compiled artifact and run GCBridge.exe. No Node, Bun or WSL installation is required for that build. Source launch requires a development runtime."
