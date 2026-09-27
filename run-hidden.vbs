Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Check if dist\server.cjs exists, otherwise npm start
If fso.FileExists(currentDir & "\dist\server.cjs") Then
    WshShell.Run "node """ & currentDir & "\dist\server.cjs""", 0, False
Else
    WshShell.Run "cmd /c npm start", 0, False
End If
