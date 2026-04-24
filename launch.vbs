Set WshShell = CreateObject("WScript.Shell")
strPath = WshShell.CurrentDirectory & "\launch-dev.bat"
WshShell.Run "cmd.exe /c """ & strPath & """", 0, False
