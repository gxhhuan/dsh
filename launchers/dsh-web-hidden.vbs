' DeepSeek Harness - start the Web GUI without a console window.
'
' Double-click behaviour: dsh starts, picks a free port, and opens the browser at
' its authenticated URL. Everything the process prints is captured to
' %USERPROFILE%\.dsh\logs\web-<timestamp>.log. If startup fails, a dialog names
' that log and points at the console launcher, which is the supported way to
' debug.
'
' The GUI binds 127.0.0.1 only and needs no administrator rights.
Option Explicit

Dim fso, shell, here, root, home, logDir, logFile, line, exitCode
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)
home = shell.ExpandEnvironmentStrings("%DSH_HOME%")
If home = "%DSH_HOME%" Or home = "" Then
  If UCase(shell.ExpandEnvironmentStrings("%DSH_PORTABLE%")) = "1" Then
    home = root & "\home"
  Else
    home = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.dsh"
  End If
End If

If Not fso.FileExists(root & "\node.exe") Then
  MsgBox "DeepSeek Harness installation looks incomplete:" & vbCrLf & root & vbCrLf & vbCrLf & _
         "Please reinstall.", vbCritical, "DeepSeek Harness"
  WScript.Quit 1
End If

logDir = home & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir

logFile = logDir & "\web-" & Replace(Replace(Replace(CStr(Now), ":", "-"), "/", "-"), " ", "_") & ".log"

' /d skips AutoRun, /s gives exact outer quoting, and the quoted launcher path is
' carried inside the /c argument. Standard output and error both land in the log.
line = "cmd.exe /d /s /c """"" & root & "\launchers\dsh.cmd"" --profile web > """ & logFile & """ 2>&1"""
exitCode = shell.Run(line, 0, True)

If exitCode <> 0 Then
  MsgBox "DeepSeek Harness could not start (exit code " & exitCode & ")." & vbCrLf & vbCrLf & _
         "Details: " & logFile & vbCrLf & vbCrLf & _
         "For live output, run: launchers\dsh.cmd --profile web", _
         vbCritical, "DeepSeek Harness"
  WScript.Quit exitCode
End If
