# End-to-end acceptance checklist (Windows)

Run this on a real Windows machine before publishing a release. The CI smoke
test proves the staged app boots and serves the Web UI; this list proves the
*installer experience* around it. Tick every box; if something fails, note the
Windows build number and whether the user account was an administrator.

Test machine: Windows version ____________  account: standard / admin

## Install

- [ ] `DeepSeek-Harness-Setup-<version>-x64.exe` downloads and its SHA256 matches `SHA256SUMS.txt`
- [ ] Double-clicking the installer shows the wizard in Simplified Chinese (switch to English works)
- [ ] **No UAC prompt** appears at any point
- [ ] Install finishes; no error dialog; `%LOCALAPPDATA%\Programs\DeepSeek Harness\node.exe` exists
- [ ] Start Menu group `DeepSeek Harness` contains: main shortcut, （终端）, 使用说明, 诊断, 卸载
- [ ] Desktop shortcut appears (it is checked by default) and the "quick launch" task is unchecked
- [ ] The post-install "立即启动" checkbox starts the app

## First run

- [ ] Double-clicking the Start Menu shortcut opens no console window (a one-second flash is acceptable)
- [ ] The default browser opens `http://127.0.0.1:<port>/?token=...` and the page loads
- [ ] The page title is `DeepSeek Harness` and the first-run dialogs appear
- [ ] Completing the API key step in 设置 → 模型 shows a green dot for the DeepSeek row
- [ ] `%USERPROFILE%\.dsh\.credentials.yaml` exists and contains `DEEPSEEK_API_KEY`
- [ ] `%USERPROFILE%\.dsh\profiles\web\package.json` exists
- [ ] A real prompt returns an answer (streaming works, no timeout)
- [ ] `%USERPROFILE%\.dsh\logs\` contains a `web-<timestamp>.log` from the shortcut launch

## Day-to-day

- [ ] Closing the browser tab and reopening the Start Menu shortcut brings the UI back
- [ ] Starting twice in a row does not error (the second launch reuses/restarts cleanly, or reports clearly)
- [ ] `DeepSeek Harness（终端）` shortcut shows live output and `Ctrl+C` exits it
- [ ] `launchers\dsh.cmd --profile headless "回答 1+1"` prints an answer and exits 0
- [ ] Working directory semantics: launching from a folder via `dsh.cmd` uses that folder as the workspace
- [ ] Chinese/non-ASCII paths work: install stays ASCII, but a workspace under `C:\Users\<user>\项目` is usable
- [ ] Native directory picker (workspace selection) opens a Windows folder dialog
- [ ] `dsh-diagnose.ps1` runs and prints versions, paths, ports, and the log tail
- [ ] The app is reachable at `127.0.0.1` only: from another device on the LAN, the port refuses connections

## Upgrade

- [ ] Install version N; configure a key and create one session
- [ ] Install version N+1 over it without uninstalling
- [ ] Key and session history are still present; the UI opens; Add/Remove Programs shows the new version
- [ ] If the app was running during the upgrade, the installer warns instead of failing silently

## Uninstall

- [ ] 设置 → 应用 → 已安装的应用 → DeepSeek Harness → 卸载
- [ ] The uninstaller stops a running instance (no "file in use" error)
- [ ] It asks about `%USERPROFILE%\.dsh` and defaulting to "No" keeps the folder
- [ ] Answering "Yes" on a second uninstall run removes `%USERPROFILE%\.dsh` entirely
- [ ] Install directory is gone; shortcuts are gone; no HKLM entries were ever created

## Notes to record

- Browser used and version:
- PowerShell version (`$PSVersionTable.PSVersion`):
- Was PowerShell execution policy an obstacle for `dsh-diagnose.ps1`? (the shortcut passes `-ExecutionPolicy Bypass`)
- Antivirus / EDR alerts on first run:
- SmartScreen prompt shown? ("仍要运行" expected without code signing)
