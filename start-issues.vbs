CreateObject("WScript.Shell").Run "cmd /c npx serve ""C:\Projects\custody-calendar-app"" -p 9111", 0, False
WScript.Sleep 2000
CreateObject("WScript.Shell").Run "http://localhost:9111/issues.html"
