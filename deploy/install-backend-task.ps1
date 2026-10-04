param(
    [string]$PythonPath = 'C:\Python314\python.exe',
    [SecureString]$AccessToken,
    [string]$TaskName = 'OptiFrame Backend'
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$pythonResolved = (Resolve-Path -LiteralPath $PythonPath).Path
$launcher = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start-backend.ps1')).Path
if ([IO.Path]::GetExtension($pythonResolved) -ne '.exe' -or
    -not (Test-Path -LiteralPath (Join-Path $repoRoot 'gpu\segment.py') -PathType Leaf)) { throw 'Invalid Python or checkout path.' }
if ($launcher.Contains('"') -or $repoRoot.Contains('"')) { throw 'Unsupported quote in installation path.' }
if (-not $AccessToken) { $AccessToken = Read-Host 'Existing OptiFrame API access key' -AsSecureString }
if ($AccessToken.Length -eq 0) { throw 'Access key cannot be empty.' }
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'OptiFrame\runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
# Restrict the user-local configuration and logs before writing encrypted credentials.
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($account in @($identity, 'SYSTEM')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($account, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $runtimeRoot -AclObject $acl
$config = @{ schemaVersion = 1; repoRoot = $repoRoot; pythonPath = $pythonResolved;
             encryptedAccessToken = (ConvertFrom-SecureString -SecureString $AccessToken) }
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'backend-config.json') -Encoding UTF8
# Packaged desktop hosts can transparently redirect LocalAppData writes. Resolve
# the actual file handle, so Task Scheduler (outside the package) sees the same
# encrypted config, instance lock and logs. No credential enters task arguments.
if (-not ('OptiFrameRuntimePath' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class OptiFrameRuntimePath {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
}
'@
}
$configHandle = [IO.File]::OpenRead((Join-Path $runtimeRoot 'backend-config.json'))
try {
    $pathBuffer = New-Object Text.StringBuilder 32768
    $pathLength = [OptiFrameRuntimePath]::GetFinalPathNameByHandle($configHandle.SafeFileHandle, $pathBuffer, 32768, 0)
    if ($pathLength -eq 0 -or $pathLength -ge 32768) { throw 'Could not resolve the backend runtime directory.' }
    $physicalConfigPath = $pathBuffer.ToString()
    if ($physicalConfigPath.StartsWith('\\?\UNC\')) { $physicalConfigPath = '\\' + $physicalConfigPath.Substring(8) }
    elseif ($physicalConfigPath.StartsWith('\\?\')) { $physicalConfigPath = $physicalConfigPath.Substring(4) }
    $runtimeResolved = Split-Path $physicalConfigPath -Parent
} finally { $configHandle.Dispose() }
if ($runtimeResolved.Contains('"')) { throw 'Unsupported quote in runtime path.' }
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -RuntimeRoot "' + $runtimeResolved + '"') -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$settings.Hidden = $true
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Installed '$TaskName' for the current user's next logon. Not started."
