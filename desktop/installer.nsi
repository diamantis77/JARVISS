Unicode true
Name "JARVIS"
OutFile "${INSTALLER_OUT}"
InstallDir "$LOCALAPPDATA\Programs\JARVIS"
RequestExecutionLevel user
SetCompressor /SOLID zlib
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
BrandingText "JARVIS Desktop · Owner Edition"

Page components
Page instfiles
UninstPage instfiles

Section "JARVIS" SEC_CORE
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${APP_PAYLOAD}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall JARVIS.exe"
  CreateDirectory "$SMPROGRAMS\JARVIS"
  CreateShortcut "$SMPROGRAMS\JARVIS\JARVIS.lnk" "$INSTDIR\JARVIS.exe"
  CreateShortcut "$SMPROGRAMS\JARVIS\Uninstall JARVIS.lnk" "$INSTDIR\Uninstall JARVIS.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "DisplayName" "JARVIS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "UninstallString" "$\"$INSTDIR\Uninstall JARVIS.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "DisplayIcon" "$INSTDIR\JARVIS.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "NoRepair" 1
SectionEnd

Section /o "Desktop shortcut" SEC_DESKTOP
  CreateShortcut "$DESKTOP\JARVIS.lnk" "$INSTDIR\JARVIS.exe"
SectionEnd

Section "Uninstall"
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\JARVIS" +2
  Abort "The JARVIS install directory is not the expected owner-only path."
  IfFileExists "$INSTDIR\resources\app.asar" +2
  Abort "JARVIS application files are missing. Uninstall stopped safely."
  Delete "$DESKTOP\JARVIS.lnk"
  Delete "$SMPROGRAMS\JARVIS\JARVIS.lnk"
  Delete "$SMPROGRAMS\JARVIS\Uninstall JARVIS.lnk"
  RMDir "$SMPROGRAMS\JARVIS"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS"
  ; %APPDATA%\JARVIS contains owner configuration and is deliberately retained.
SectionEnd
