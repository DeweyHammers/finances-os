$WshShell = New-Object -ComObject WScript.Shell
$ProjectRoot = (Get-Location).Path
$VBSPath = Join-Path $ProjectRoot "launch.vbs"
$IconPath = Join-Path $ProjectRoot "resources\finances-v1.ico"

# Desktop Shortcut
$DesktopPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Finances OS.lnk"
$DesktopShortcut = $WshShell.CreateShortcut($DesktopPath)
$DesktopShortcut.TargetPath = "wscript.exe"
$DesktopShortcut.Arguments = "`"$VBSPath`""
$DesktopShortcut.WorkingDirectory = $ProjectRoot
$DesktopShortcut.IconLocation = $IconPath
$DesktopShortcut.Description = "Launch Finances OS (Dev Mode)"
$DesktopShortcut.Save()

# Start Menu Shortcut
$StartMenuPath = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Finances OS.lnk"
$StartMenuShortcut = $WshShell.CreateShortcut($StartMenuPath)
$StartMenuShortcut.TargetPath = "wscript.exe"
$StartMenuShortcut.Arguments = "`"$VBSPath`""
$StartMenuShortcut.WorkingDirectory = $ProjectRoot
$StartMenuShortcut.IconLocation = $IconPath
$StartMenuShortcut.Description = "Launch Finances OS (Dev Mode)"
$StartMenuShortcut.Save()

Write-Host "Shortcuts updated to launch silently via VBS." -ForegroundColor Green
