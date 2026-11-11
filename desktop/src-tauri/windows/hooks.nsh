; Topo's additions to Tauri's NSIS installer (tauri.conf.json
; bundle.windows.nsis.installerHooks; docs/SCOPE.md D125). Tauri includes
; this file near the top of its installer.nsi (Tauri CLI 2.12), before the
; pages, so:
;
; - The Welcome page gets one more tick box, "Use this PC as the server for
;   your network" (off unless this PC already is the server): the define
;   below is the Welcome page's SHOW callback, the first page Tauri
;   inserts after this file (installMode perMachine: no install-mode page).
;   Translated at run time from $LANGUAGE (en, es, pt-BR, ja, ru), so no
;   LangString is needed before the languages load.
; - After the files are copied, a tick installs the bundled server as the
;   Windows service TopoServer (`topo-desktop-server.exe service install
;   --start`: automatic delayed start, Local Service, %ProgramData%\Topo
;   with its ACL, a firewall rule for private and domain networks). Its
;   settings (owner, email) are left to the app's first run.
; - Silent and passive installs (/S, /P): /SERVER turns it on, /NOSERVER
;   off; neither keeps what the PC has.
; - An update stops the service before the files are replaced and starts
;   it again after. Unticking removes it. Uninstalling removes it; the data
;   in %ProgramData%\Topo stays.
;
; Not built here (no makensis on the Linux build machine): CI (builds.yml)
; builds this installer and runs it silently on a Windows runner.
;
; This file is UTF-8 with a BOM (Tauri runs makensis -INPUTCHARSET UTF8).

!include LogicLib.nsh
!include nsDialogs.nsh

Var TopoSrvBox    ; the tick box (Welcome page)
Var TopoSrvAsked  ; 1 once the Welcome page showed the box
Var TopoSrvWant   ; 1 = this PC is to be the server
Var TopoSrvHad    ; 1 = the service was installed before this run

!define MUI_PAGE_CUSTOMFUNCTION_SHOW TopoWelcomeShow

; $0 = 1 when the service TopoServer exists (sc.exe needs no administrator
; to ask; 1060 = no such service).
!macro TopoSrvProbe
  nsExec::Exec '"$SYSDIR\sc.exe" query TopoServer'
  Pop $0
  ${If} $0 == 0
    StrCpy $0 1
  ${Else}
    StrCpy $0 0
  ${EndIf}
!macroend

; Stops the service and waits for it (the graceful stop takes up to 45 s):
; through the installed binary when there is one (it waits by itself, 70 s
; at most), else sc.exe and a wait for STOPPED (70 s at most).
!macro TopoSrvStop
  ${If} ${FileExists} "$INSTDIR\topo-desktop-server.exe"
    nsExec::ExecToLog '"$INSTDIR\topo-desktop-server.exe" service stop'
    Pop $1
  ${Else}
    nsExec::Exec '"$SYSDIR\sc.exe" stop TopoServer'
    Pop $1
    StrCpy $2 0
    ${Do}
      nsExec::ExecToStack '"$SYSDIR\sc.exe" query TopoServer'
      Pop $1
      Pop $3
      ${StrLoc} $4 $3 "STOPPED" ">"
      ${If} $4 != ""
      ${OrIf} $2 > 70
        ${Break}
      ${EndIf}
      IntOp $2 $2 + 1
      Sleep 1000
    ${Loop}
  ${EndIf}
!macroend

; $1 = the tick box's text in the installer's language.
Function TopoSrvText
  IntOp $2 $LANGUAGE & 0x3FF
  ${If} $2 = 0x0A
    StrCpy $1 "Usar este PC como servidor de tu red (funciona en segundo plano desde el arranque, aunque Topo esté cerrado)"
  ${ElseIf} $2 = 0x16
    StrCpy $1 "Usar este PC como servidor da sua rede (funciona em segundo plano desde a inicialização, mesmo com o Topo fechado)"
  ${ElseIf} $2 = 0x11
    StrCpy $1 "このPCをネットワークのサーバーとして使う (Topo を閉じていても、起動時からバックグラウンドで動きます)"
  ${ElseIf} $2 = 0x19
    StrCpy $1 "Использовать этот ПК как сервер для вашей сети (работает в фоне с момента загрузки, даже когда Topo закрыт)"
  ${Else}
    StrCpy $1 "Use this PC as the server for your network (runs in the background from startup, even when Topo is closed)"
  ${EndIf}
FunctionEnd

Function TopoWelcomeShow
  !insertmacro TopoSrvProbe
  StrCpy $TopoSrvHad $0
  ${If} $TopoSrvAsked != 1
    StrCpy $TopoSrvWant $TopoSrvHad
  ${EndIf}
  StrCpy $TopoSrvAsked 1
  Call TopoSrvText
  ; Below the Welcome text, in the page's right-hand column.
  ${NSD_CreateCheckbox} 120u 156u 195u 30u "$1"
  Pop $TopoSrvBox
  ${NSD_AddStyle} $TopoSrvBox 0x00002000 ; BS_MULTILINE
  SetCtlColors $TopoSrvBox "000000" "FFFFFF"
  ${If} $TopoSrvWant == 1
    ${NSD_Check} $TopoSrvBox
  ${EndIf}
  ${NSD_OnClick} $TopoSrvBox TopoSrvClick
FunctionEnd

Function TopoSrvClick
  Pop $0
  ${NSD_GetState} $TopoSrvBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $TopoSrvWant 1
  ${Else}
    StrCpy $TopoSrvWant 0
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TopoSrvProbe
  StrCpy $TopoSrvHad $0
  ${If} $TopoSrvAsked != 1
    ; Silent or passive: the command line, else what the PC has.
    StrCpy $TopoSrvWant $TopoSrvHad
    ${GetOptions} $CMDLINE "/SERVER" $1
    ${IfNot} ${Errors}
      StrCpy $TopoSrvWant 1
    ${EndIf}
    ${GetOptions} $CMDLINE "/NOSERVER" $1
    ${IfNot} ${Errors}
      StrCpy $TopoSrvWant 0
    ${EndIf}
  ${EndIf}
  ; The running service holds topo-desktop-server.exe: stop it before the
  ; new one is copied.
  ${If} $TopoSrvHad == 1
    DetailPrint "Stopping the Topo server service..."
    !insertmacro TopoSrvStop
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $TopoSrvWant == 1
    ${If} $TopoSrvHad == 1
      DetailPrint "Starting the Topo server service..."
      nsExec::Exec '"$SYSDIR\sc.exe" start TopoServer'
      Pop $1
    ${Else}
      DetailPrint "Installing the Topo server service..."
      nsExec::ExecToLog '"$INSTDIR\topo-desktop-server.exe" service install --start'
      Pop $1
      ${If} $1 != 0
        MessageBox MB_ICONEXCLAMATION|MB_OK "The Topo server service was not installed (code $1). Topo can try again from Settings, This PC as the server." /SD IDOK
      ${EndIf}
    ${EndIf}
  ${ElseIf} $TopoSrvHad == 1
    DetailPrint "Removing the Topo server service (its data stays)..."
    nsExec::ExecToLog '"$INSTDIR\topo-desktop-server.exe" service uninstall'
    Pop $1
  ${EndIf}
  ; The app asks once on its first start unless this installer already did
  ; (desktop/src-tauri/src/server.rs reads this value).
  ${If} $TopoSrvAsked == 1
  ${OrIf} $TopoSrvWant == 1
    WriteRegStr HKLM "Software\${MANUFACTURER}\${PRODUCTNAME}" "ServerQuestion" "asked"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode = 1
    ; Tauri's update path uninstalls the old copy first: the service stays,
    ; stopped so its files can be replaced (the new copy starts it again).
    ; The installed binary waits for the stop.
    nsExec::ExecToLog '"$INSTDIR\topo-desktop-server.exe" service stop'
    Pop $1
  ${Else}
    nsExec::ExecToLog '"$INSTDIR\topo-desktop-server.exe" service uninstall'
    Pop $1
    DeleteRegValue HKLM "Software\${MANUFACTURER}\${PRODUCTNAME}" "ServerQuestion"
  ${EndIf}
!macroend
