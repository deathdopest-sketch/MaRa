@echo off
:: launch-chrome.bat — opens Chrome with remote debugging so MaRa can attach.
:: run this ONCE before starting mara. your login session is preserved.
:: close all Chrome windows first, then double-click this.

set PORT=9222
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"

if not exist %CHROME% (
  set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

echo.
echo  launching Chrome with remote debugging on port %PORT%
echo  your existing login session will still be there.
echo  navigate to stumblechat.com and join your room(s), then run: node mara.js
echo.

start "" %CHROME% --remote-debugging-port=%PORT% --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
