@echo off
rem DeepSeek Harness launcher (console). All arguments are forwarded to `dsh`.
rem   dsh.cmd                          open the Web GUI (same as: dsh --profile web)
rem   dsh.cmd --profile web --port 8080
rem   dsh.cmd --profile headless "run the tests"
rem   dsh.cmd --help
rem
rem Data location: %DSH_HOME%, default %USERPROFILE%\.dsh
rem   - set DSH_HOME yourself to point somewhere else
rem   - set DSH_PORTABLE=1 to keep the data inside this installation folder
setlocal EnableExtensions

set "HERE=%~dp0"
set "ROOT=%HERE%.."
set "NODE=%ROOT%\node.exe"
set "BIN=%ROOT%\app\node_modules\@deepseek-ai\dsh\lib\bin.js"

rem A non-ASCII install path breaks cmd's UTF-8 handling; the 8.3 short name
rem avoids it. Harmless when 8.3 names are disabled or the path is ASCII.
set "ROOTSHORT=%~sI"
if defined ROOTSHORT (
  set "NODE=%ROOTSHORT%\..\node.exe"
  set "BIN=%ROOTSHORT%\..\app\node_modules\@deepseek-ai\dsh\lib\bin.js"
)

if not defined DSH_HOME (
  if /i "%DSH_PORTABLE%"=="1" (
    set "DSH_HOME=%ROOT%\home"
  ) else (
    set "DSH_HOME=%USERPROFILE%\.dsh"
  )
)

if not exist "%NODE%" goto :missing
if not exist "%BIN%" goto :missing
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%" >nul 2>nul

"%NODE%" "%BIN%" %*
exit /b %ERRORLEVEL%

:missing
echo.
echo DeepSeek Harness launcher: installation looks incomplete.
echo   node runtime : %NODE%
echo   dsh entry    : %BIN%
echo Please reinstall, or report the paths above.
echo.
pause
exit /b 1
