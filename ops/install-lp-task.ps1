$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$name = 'RobinLPRefresh'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'RobinLPRefresh already exists. Review/export it before replacing anything.' }
$directory = Join-Path $env:USERPROFILE '.openclaw\robin-lp-runtime'
$launcher = Join-Path $directory 'run-lp-sync.ps1'
$source = Join-Path $PSScriptRoot 'run-lp-sync.ps1'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (Test-Path $launcher) {
  if ((Get-FileHash $source).Hash -ne (Get-FileHash $launcher).Hash) { throw 'An unrelated/different LP launcher already exists.' }
} else { Copy-Item -LiteralPath $source -Destination $launcher }
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Dedicated Robin LP snapshot publisher every five minutes. No changes to RobinSync. Requires this user session and WSL.'
$task.Settings.Enabled = $false
Register-ScheduledTask -TaskName $name -InputObject $task | Out-Null
Export-ScheduledTask -TaskName $name | Set-Content -Encoding utf8 (Join-Path $directory 'task-disabled.xml')
$t = Get-ScheduledTask -TaskName $name
if ($t.Settings.Enabled) { throw 'LP task must remain disabled until the exact launcher succeeds.' }
[ordered]@{ name=$name; enabled=$t.Settings.Enabled; interval=$t.Triggers[0].Repetition.Interval; overlap=$t.Settings.MultipleInstances.ToString(); launcher=$launcher } | ConvertTo-Json -Compress
