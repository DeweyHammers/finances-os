$WshShell = New-Object -ComObject WScript.Shell
$ProjectRoot = (Get-Location).Path
$ElectronHost = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
$AppAsar = Join-Path $ProjectRoot "dist\win-unpacked\resources\app.asar"
$IconPath = Join-Path $ProjectRoot "resources\finances-v1.ico"

# Desktop Shortcut
$DesktopPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Finances OS.lnk"
$DesktopShortcut = $WshShell.CreateShortcut($DesktopPath)
$DesktopShortcut.TargetPath = $ElectronHost
$DesktopShortcut.Arguments = "`"$AppAsar`""
$DesktopShortcut.WorkingDirectory = Join-Path $ProjectRoot "dist\win-unpacked"
$DesktopShortcut.IconLocation = $IconPath
$DesktopShortcut.Description = "Launch Finances OS"
$DesktopShortcut.Save()

# Start Menu Shortcut
$StartMenuPath = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Finances OS.lnk"
$StartMenuShortcut = $WshShell.CreateShortcut($StartMenuPath)
$StartMenuShortcut.TargetPath = $ElectronHost
$StartMenuShortcut.Arguments = "`"$AppAsar`""
$StartMenuShortcut.WorkingDirectory = Join-Path $ProjectRoot "dist\win-unpacked"
$StartMenuShortcut.IconLocation = $IconPath
$StartMenuShortcut.Description = "Launch Finances OS"
$StartMenuShortcut.Save()

Write-Host "Shortcuts updated to launch via signed Electron host (Bypasses Smart App Control)." -ForegroundColor Green
