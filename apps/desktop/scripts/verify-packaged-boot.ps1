param(
  [Parameter(Position = 0)]
  [string]$Executable = '../../dist/desktop/win-unpacked/DeepSeek Harness.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspace = 'D:\DeepSeek'
$homePath = Join-Path $workspace 'Home'
$desktopDataPath = Join-Path $workspace 'DesktopData'
$harnessPath = Join-Path $workspace 'Harness'
$expectedUrl = 'app://dsh/index.html'
$expectedMarker = "dsh-desktop ready $expectedUrl"
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$appPath = Split-Path -Parent $resolvedExecutable
$verificationPath = Join-Path $desktopDataPath 'verification'
$stdoutPath = Join-Path $verificationPath 'packaged-boot.stdout.log'
$stderrPath = Join-Path $verificationPath 'packaged-boot.stderr.log'
$forbiddenPaths = @(
  (Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop'),
  (Join-Path $env:LOCALAPPDATA '@deepseek-ai\dsh-desktop'),
  (Join-Path $env:APPDATA 'DeepSeek Harness'),
  (Join-Path $env:LOCALAPPDATA 'DeepSeek Harness')
)

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Get-ProcessTree {
  param([uint32]$RootProcessId)
  $all = @(Get-CimInstance Win32_Process)
  $ids = [System.Collections.Generic.HashSet[uint32]]::new()
  [void]$ids.Add($RootProcessId)
  do {
    $count = $ids.Count
    foreach ($process in $all) {
      if ($ids.Contains([uint32]$process.ParentProcessId)) {
        [void]$ids.Add([uint32]$process.ProcessId)
      }
    }
  } while ($ids.Count -ne $count)
  return @($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) })
}

function Get-HarnessSnapshot {
  $prefixLength = $harnessPath.Length
  return @(
    Get-ChildItem -LiteralPath $harnessPath -Recurse -Force -File |
      Sort-Object FullName |
      ForEach-Object { "$($_.FullName.Substring($prefixLength))|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }
  )
}

function Get-AppSnapshot {
  $prefixLength = $appPath.Length
  return @(
    Get-ChildItem -LiteralPath $appPath -Recurse -Force -File |
      Sort-Object FullName |
      ForEach-Object { "$($_.FullName.Substring($prefixLength))|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }
  )
}

function Is-AllowedWrite {
  param([string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  # Creating the managed Profile junctions can surface target-directory
  # notifications under the unpacked app. Its own before/after snapshot below
  # still rejects every material installation change.
  foreach ($allowed in @($homePath, $desktopDataPath, $appPath)) {
    if ($fullPath.Equals($allowed, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith("$allowed\", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

foreach ($path in $forbiddenPaths) {
  Assert-True (-not (Test-Path -LiteralPath $path)) "forbidden Electron data path already exists before probe: $path"
}
Assert-True (Test-Path -LiteralPath $harnessPath -PathType Container) "Harness path is missing: $harnessPath"
$harnessBefore = @(Get-HarnessSnapshot)
$appBefore = @(Get-AppSnapshot)

New-Item -ItemType Directory -Path $verificationPath -Force | Out-Null
$watcher = [System.IO.FileSystemWatcher]::new($workspace)
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'
$eventIds = @('dsh-desktop-created', 'dsh-desktop-changed', 'dsh-desktop-deleted', 'dsh-desktop-renamed')
$subscriptions = @(
  Register-ObjectEvent -InputObject $watcher -EventName Created -SourceIdentifier $eventIds[0]
  Register-ObjectEvent -InputObject $watcher -EventName Changed -SourceIdentifier $eventIds[1]
  Register-ObjectEvent -InputObject $watcher -EventName Deleted -SourceIdentifier $eventIds[2]
  Register-ObjectEvent -InputObject $watcher -EventName Renamed -SourceIdentifier $eventIds[3]
)
$watcher.EnableRaisingEvents = $true

$process = $null
$observedIds = [System.Collections.Generic.HashSet[uint32]]::new()
$readyTree = @()
try {
  $process = Start-Process -FilePath $resolvedExecutable -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  # Touch the handle before the app can exit: without an open OS handle the
  # .NET Process object cannot report ExitCode after HasExited (PowerShell's
  # Start-Process -PassThru returns null for an already-collected process).
  [void]$process.Handle
  [void]$observedIds.Add([uint32]$process.Id)
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $ready = $false
  do {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    foreach ($entry in @(Get-ProcessTree -RootProcessId ([uint32]$process.Id))) {
      [void]$observedIds.Add([uint32]$entry.ProcessId)
    }
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -Encoding UTF8 $stdoutPath } else { '' }
    $ready = $stdout -match "(?m)^$([regex]::Escape($expectedMarker))\r?$" -and $process.MainWindowHandle -ne 0
  } while (-not $ready -and -not $process.HasExited -and [DateTime]::UtcNow -lt $deadline)

  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -Encoding UTF8 $stderrPath } else { '' }
  Assert-True (-not $process.HasExited) "packaged app exited before readiness: $stderr"
  Assert-True $ready "packaged app did not load $expectedUrl and show a window before timeout: $stderr"

  $readyTree = @(Get-ProcessTree -RootProcessId ([uint32]$process.Id))
  foreach ($entry in $readyTree) { [void]$observedIds.Add([uint32]$entry.ProcessId) }
  $listeners = @(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $observedIds.Contains([uint32]$_.OwningProcess) }
  )
  Assert-True ($listeners.Count -eq 0) "packaged app opened TCP listeners: $($listeners | ConvertTo-Json -Compress)"

  $expectedUserData = Join-Path $desktopDataPath 'userData'
  foreach ($entry in @($readyTree | Where-Object { $_.ProcessId -ne $process.Id -and $_.Name -eq 'DeepSeek Harness.exe' })) {
    $match = [regex]::Match([string]$entry.CommandLine, '--user-data-dir="?([^" ]+)')
    Assert-True $match.Success "Electron child $($entry.ProcessId) has no explicit user-data-dir"
    Assert-True ($match.Groups[1].Value -eq $expectedUserData) "Electron child $($entry.ProcessId) uses unexpected user-data-dir $($match.Groups[1].Value)"
  }

  Assert-True ($process.CloseMainWindow()) 'packaged app did not accept a main-window close request'
  $shutdownDeadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
    foreach ($entry in @(Get-ProcessTree -RootProcessId ([uint32]$process.Id))) {
      [void]$observedIds.Add([uint32]$entry.ProcessId)
    }
  } while (-not $process.HasExited -and [DateTime]::UtcNow -lt $shutdownDeadline)
  Assert-True $process.HasExited 'packaged app did not exit within the bounded shutdown window'
  Assert-True ($process.ExitCode -eq 0) "packaged app exited with $($process.ExitCode)"

  Start-Sleep -Seconds 2
  $remaining = @(
    Get-CimInstance Win32_Process |
      Where-Object { $observedIds.Contains([uint32]$_.ProcessId) }
  )
  Assert-True ($remaining.Count -eq 0) "packaged process residue remains: $($remaining | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress)"

  foreach ($path in $forbiddenPaths) {
    Assert-True (-not (Test-Path -LiteralPath $path)) "packaged app wrote forbidden Electron data path: $path"
  }
  Assert-True (Test-Path -LiteralPath $homePath -PathType Container) "packaged app Home path is missing: $homePath"
  Assert-True (Test-Path -LiteralPath $desktopDataPath -PathType Container) "packaged app data path is missing: $desktopDataPath"

  $writeEvents = @(
    foreach ($eventId in $eventIds) {
      Get-Event -SourceIdentifier $eventId -ErrorAction SilentlyContinue
    }
  )
  $unexpectedWrites = @(
    $writeEvents |
      ForEach-Object { [string]$_.SourceEventArgs.FullPath } |
      Where-Object { -not (Is-AllowedWrite $_) } |
      Sort-Object -Unique
  )
  Assert-True ($unexpectedWrites.Count -eq 0) "packaged app wrote outside Home/DesktopData: $($unexpectedWrites | Select-Object -First 20 | ConvertTo-Json -Compress)"

  $appAfter = @(Get-AppSnapshot)
  $appDelta = @(Compare-Object -ReferenceObject $appBefore -DifferenceObject $appAfter)
  Assert-True ($appDelta.Count -eq 0) "packaged app changed its installation: $($appDelta | Select-Object -First 20 | ConvertTo-Json -Compress)"

  $harnessAfter = @(Get-HarnessSnapshot)
  $harnessDelta = @(Compare-Object -ReferenceObject $harnessBefore -DifferenceObject $harnessAfter)
  Assert-True ($harnessDelta.Count -eq 0) "Harness metadata changed during packaged boot: $($harnessDelta | Select-Object -First 20 | ConvertTo-Json -Compress)"

  Write-Output "desktop packaged boot: $expectedUrl loaded; $($readyTree.Count) Electron processes, zero TCP listeners, bounded clean shutdown, no unexpected writes under D:\DeepSeek or to four preset C-drive Electron data paths, and unchanged Harness verified."
}
finally {
  $watcher.EnableRaisingEvents = $false
  foreach ($subscription in $subscriptions) {
    Unregister-Event -SubscriptionId $subscription.Id -ErrorAction SilentlyContinue
  }
  foreach ($eventId in $eventIds) {
    Get-Event -SourceIdentifier $eventId -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
  }
  $watcher.Dispose()
  if ($null -ne $process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
  }
}
