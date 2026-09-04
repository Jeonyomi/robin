Set WshShell = CreateObject("WScript.Shell")
Set FileSystem = CreateObject("Scripting.FileSystemObject")
ScriptDirectory = FileSystem.GetParentFolderName(WScript.ScriptFullName)
CommandLine = "cmd /c " & Chr(34) & ScriptDirectory & "\sync-hourly.cmd" & Chr(34)
ExitCode = WshShell.Run(CommandLine, 0, True)
WScript.Quit ExitCode
