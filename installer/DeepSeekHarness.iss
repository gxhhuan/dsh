; DeepSeek Harness — Windows x64 installer (per-user, no administrator rights).
;
; Compiled by the GitHub Actions windows-latest workflow, or locally with
; scripts/build-local.ps1. The version comes from the command line:
;
;   ISCC.exe /DMyAppVersion=0.1.5-rc.3 installer\DeepSeekHarness.iss
;
; The [Files] source is the staged portable tree produced by
; scripts/prepare-portable.mjs (build/portable): node.exe + app\ (npm layout) +
; launchers\ + docs\. The installed tree is read-only at runtime; all user data
; lives in %USERPROFILE%\.dsh and survives upgrades and uninstall.
;
; Quoting rule for this file: run it through ISCC (not the ISPP IDE quick
; preprocessor) because [#emit] is used, and never put double quotes inside a
; double-quoted [UninstallRun] Parameters value — the PowerShell payload below
; uses only single quotes and #13#10 for line breaks.

#ifndef MyAppVersion
  #error Pass /DMyAppVersion=<version> to ISCC.exe
#endif

#define MyAppName "DeepSeek Harness"
#define MyAppPublisher "DeepSeek Harness community build"
#define MyAppId "{{9C1F3D2A-7B45-4E8C-9F1A-2D6E5B4C7A81}"
#define DshDataDirName ".dsh"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription={#MyAppName} setup
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
AllowNoIcons=yes
OutputDir=..\dist
OutputBaseFilename=DeepSeek-Harness-Setup-{#MyAppVersion}-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-user install: never prompt for elevation, never touch HKLM or Program Files.
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupLogging=yes
UninstallDisplayName={#MyAppName} {#MyAppVersion}
#if FileExists(AddBackslash(SourcePath) + "..\assets\app.ico")
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\launchers\app.ico
#endif
#if FileExists(AddBackslash(SourcePath) + "..\assets\wizard-image.bmp")
WizardImageFile=..\assets\wizard-image.bmp
#endif

[Languages]
; The Simplified Chinese translation is vendored in this repository because
; Inno Setup does not ship it in its own Languages folder. See
; installer/languages/README.md for its source and license note.
Name: "chinese"; MessagesFile: "languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The whole staged tree: node.exe, app\, launchers\, docs\, VERSION.txt.
Source: "..\build\portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#if FileExists(AddBackslash(SourcePath) + "..\assets\app.ico")
Source: "..\assets\app.ico"; DestDir: "{app}\launchers"; Flags: ignoreversion
#endif

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\launchers\dsh-web-hidden.vbs"; WorkingDir: "{userdocs}"; Comment: "启动 DeepSeek Harness 图形界面"
Name: "{group}\{#MyAppName}（终端）"; Filename: "{cmd}"; Parameters: "/k ""{app}\launchers\dsh.cmd"""; WorkingDir: "{app}"; Comment: "命令行启动，可看到完整输出"
Name: "{group}\使用说明（API Key 配置）"; Filename: "{app}\docs\API-KEY.txt"; Comment: "怎么配置自己的 DeepSeek API Key"
Name: "{group}\诊断（无法启动时）"; Filename: "{cmd}"; Parameters: "/k powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File ""{app}\launchers\dsh-diagnose.ps1"""; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\launchers\dsh-web-hidden.vbs"; WorkingDir: "{userdocs}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\launchers\dsh-web-hidden.vbs"; WorkingDir: "{userdocs}"; Tasks: quicklaunchicon

[Run]
Filename: "{app}\launchers\dsh-web-hidden.vbs"; Description: "立即启动 {#MyAppName}"; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Bounded cleanup: kill the node process that holds our loopback listener, or
; the running launcher shell. Never a blanket "kill every node.exe".
; Single-quoted PowerShell payload, #13#10 for the semicolon-separated script.
Filename: "{cmd}"; Parameters: "/c powershell -NoProfile -ExecutionPolicy Bypass -Command ""$ErrorActionPreference='SilentlyContinue'; $ids = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty OwningProcess -Unique); $ids += @(Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | Where-Object { $_.CommandLine -like '*dsh*' } | Select-Object -ExpandProperty ProcessId); $ids | Sort-Object -Unique | ForEach-Object { taskkill /PID $_ /T /F }"""; Flags: runhidden; RunOnceId: "StopDsh"

[UninstallDelete]
; Only files this installer created. %USERPROFILE%\.dsh is handled in code and
; kept unless the user explicitly asks for it to be deleted.
Type: files; Name: "{app}\VERSION.txt"
Type: dirifempty; Name: "{app}\launchers"
Type: dirifempty; Name: "{app}\docs"
Type: dirifempty; Name: "{app}\app"
Type: dirifempty; Name: "{app}"

[Code]
{ Any running copy holds app files open, so an upgrade would fail halfway. }
function DshIsRunning(): Boolean;
var
  Locator, Services, ProcessList, Process: Variant;
  CommandLine: string;
  Index: Integer;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('.', 'root\cimv2');
    ProcessList := Services.ExecQuery('SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = ''node.exe''');
    for Index := 0 to ProcessList.Count - 1 do
    begin
      Process := ProcessList.ItemIndex(Index);
      CommandLine := Process.CommandLine;
      if (Pos('@deepseek-ai', CommandLine) > 0) or (Pos('launchers\dsh.cmd', CommandLine) > 0) then
      begin
        Result := True;
        Exit;
      end;
    end;
  except
    { WMI unavailable: treat as not running rather than blocking the install. }
    Result := False;
  end;
end;

{ A running copy holds node.exe open. Detect it by its command line and let the
  user close it; the uninstaller does the killing, and never a blanket kill. }
function InitializeSetup(): Boolean;
begin
  Result := True;
  if DshIsRunning() then
  begin
    if MsgBox('DeepSeek Harness 似乎正在运行。' + #13#10 + #13#10 +
              '请先从“DeepSeek Harness（终端）”窗口按 Ctrl+C 退出，' + #13#10 +
              '或在任务管理器里结束对应的 node.exe，然后点“重试”。' + #13#10 + #13#10 +
              '点“是”继续（文件占用可能导致安装失败），点“否”返回。',
              mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

function InitializeUninstall(): Boolean;
var
  DataDir: string;
begin
  Result := True;
  DataDir := ExpandConstant('{userprofile}\{#DshDataDirName}');
  if not DirExists(DataDir) then
    Exit;
  { Asked on every uninstall, defaulting to "keep": a silent uninstall must never
    delete an API key and a session history. }
  if MsgBox('是否同时删除你的配置、API Key 和历史会话？' + #13#10 + #13#10 + DataDir + #13#10 + #13#10 +
            '点“是”= 删除全部数据；点“否”= 保留（推荐，重新安装后配置仍然可用）。',
            mbConfirmation, MB_YESNO) = IDYES then
  begin
    DelTree(DataDir, True, True, True);
  end;
end;
