param([switch]$Install)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'wsl.json') -Raw | ConvertFrom-Json
if ($Install) {
  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) ($config.name + '.lnk')
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $shortcut.WindowStyle = 7
  $shortcut.Save()
  Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WindowStyle Hidden
  exit
}
# WSL systemd services alone do not keep a distribution running. A single
# foreground WSL process survives the setup terminal and resumes at login.
$mutex = [Threading.Mutex]::new($false, ('Local\' + $config.name + '-wsl'))
if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); exit }
try { & wsl.exe --distribution $config.distro --exec sleep infinity }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
