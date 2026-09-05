$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$logDir = Join-Path $env:LOCALAPPDATA 'RobinLP\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$started = [DateTime]::UtcNow.ToString('o')
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = "$env:SystemRoot\System32\wsl.exe"
$info.Arguments = '-d Ubuntu -u mjeon -- bash /home/mjeon/.local/share/robin-lp-worker/ops/run-lp-sync.sh'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $info
$code = 1
$revision = ''
try {
  if (-not $process.Start()) { throw 'LP worker could not start.' }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(130000)) {
    $process.Kill()
    $process.WaitForExit()
    $code = 124
  } else { $code = $process.ExitCode }
  $output = $stdout.GetAwaiter().GetResult() + "`n" + $stderr.GetAwaiter().GetResult()
  $output | Out-File -FilePath (Join-Path $logDir 'latest-run.log') -Encoding utf8
  foreach ($line in ($output -split "`r?`n")) {
    try { $item = $line | ConvertFrom-Json; if ($item.revision -match '^[a-f0-9]{40}$') { $revision = $item.revision } } catch { }
  }
} finally {
  $process.Dispose()
  [ordered]@{ startedAt = $started; completedAt = [DateTime]::UtcNow.ToString('o'); exitCode = $code; revision = $revision } | ConvertTo-Json -Compress | Out-File -FilePath (Join-Path $logDir 'latest-result.json') -Encoding utf8
}
exit $code
