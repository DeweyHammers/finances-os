$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WindowUtils {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static void HideWindowsByTitle(string substring) {
        EnumWindows((hWnd, lParam) => {
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            string title = sb.ToString();
            string titleLower = title.ToLower();
            
            // IGNORE if it's the Splash Window - check multiple variations
            if (title.Contains("Splash") || title.Contains("Finances OS")) {
                return true; 
            }

            // ONLY hide if it matches our project and is a terminal/node window
            bool isProject = titleLower.Contains(substring.ToLower());
            bool isTerminal = titleLower.Contains("node") || titleLower.Contains("npm") || titleLower.Contains("nextron") || titleLower.Contains("next-dev") || titleLower.Contains("cmd.exe") || titleLower.Contains("powershell");

            if (isProject && isTerminal) {
                ShowWindow(hWnd, 0); // SW_HIDE
            }
            return true;
        }, IntPtr.Zero);
    }
}
"@

Add-Type -TypeDefinition $code
$parentPid = (Get-Process -Id $PID).Parent.Id

// Wait 3 seconds to let the splash screen stabilize before we start hiding things
Start-Sleep -Seconds 3

while($true) {
    if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {
        break
    }
    [WindowUtils]::HideWindowsByTitle("freelance-os")
    Start-Sleep -Milliseconds 500
}
