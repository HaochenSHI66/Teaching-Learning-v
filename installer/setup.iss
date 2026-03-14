[Setup]
AppName=幻灯片研习台
AppVersion=1.0.0
DefaultDirName={autopf}\幻灯片研习台
DefaultGroupName=幻灯片研习台
OutputDir=..
OutputBaseFilename=幻灯片研习台_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标"

[Files]
Source: "win\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\幻灯片研习台"; Filename: "{app}\启动.bat"
Name: "{userdesktop}\幻灯片研习台"; Filename: "{app}\启动.bat"; Tasks: desktopicon

[Run]
Filename: "{app}\启动.bat"; Description: "立即启动"; Flags: postinstall nowait

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
