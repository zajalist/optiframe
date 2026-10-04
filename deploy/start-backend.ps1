param([string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'OptiFrame\runtime'))
$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$phase = 'configuration'
$pointer = [IntPtr]::Zero
$secret = $null
$result = 1
try {
    $configPath = Join-Path $runtimeRoot 'backend-config.json'
    $config = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
    $repoRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
    if ($config.schemaVersion -ne 1 -or $config.repoRoot -ne $repoRoot) { throw 'Backend configuration does not match this checkout.' }
    $pythonPath = (Resolve-Path -LiteralPath $config.pythonPath).Path
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'gpu\segment.py') -PathType Leaf)) { throw 'Backend code missing.' }
    $phase = 'credential decryption'
    $secret = ConvertTo-SecureString -String $config.encryptedAccessToken
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $env:OPTIFRAME_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:OPTIFRAME_ENV = 'production'
    $phase = 'supervisor launch'
    & $pythonPath (Join-Path $PSScriptRoot 'supervisor.py') --repo-root $repoRoot --runtime $runtimeRoot
    $result = $LASTEXITCODE
} catch {
    # Record failures before Python's rotating logger can start, without dumping
    # config, invocation arguments, environment, encrypted data, or credentials.
    $detail = $_.Exception.Message
    if ($env:OPTIFRAME_ACCESS_TOKEN) { $detail = $detail.Replace($env:OPTIFRAME_ACCESS_TOKEN, '[REDACTED]') }
    $detail = $detail -replace '(?i)(token|key|authorization)\s*[=:]\s*\S+', '$1=[REDACTED]'
    $detail = $detail -replace '[0-9a-fA-F]{64,}', '[REDACTED]'
    if ($detail.Length -gt 1000) { $detail = $detail.Substring(0,1000) }
    $entry = '{0:u} phase={1}; type={2}; hresult={3}; {4}' -f (Get-Date), $phase, $_.Exception.GetType().Name, $_.Exception.HResult, $detail
    try {
        $logPath = Join-Path $runtimeRoot 'launcher-error.log'
        if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 100000) { Move-Item -LiteralPath $logPath -Destination ($logPath + '.1') -Force }
        Add-Content -LiteralPath $logPath -Value $entry -Encoding UTF8
    } catch {
        $fallbackLog = Join-Path $env:TEMP 'OptiFrame-launcher-error.log'
        if ((Test-Path -LiteralPath $fallbackLog) -and (Get-Item -LiteralPath $fallbackLog).Length -gt 100000) { Move-Item -LiteralPath $fallbackLog -Destination ($fallbackLog + '.1') -Force -ErrorAction SilentlyContinue }
        Add-Content -LiteralPath $fallbackLog -Value $entry -Encoding UTF8 -ErrorAction SilentlyContinue
    }
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Remove-Item Env:\OPTIFRAME_ACCESS_TOKEN -ErrorAction SilentlyContinue
    if ($secret) { $secret.Dispose() }
}
exit $result
