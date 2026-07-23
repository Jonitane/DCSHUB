!macro customRemoveFiles
  ${if} ${isUpdated}
    ClearErrors
    Rename "$INSTDIR\data" "$PLUGINSDIR\dcshub-preserved-data"
    ${if} ${Errors}
      RMDir /r "$INSTDIR"
    ${else}
      RMDir /r "$INSTDIR"
      CreateDirectory "$INSTDIR"
      Rename "$PLUGINSDIR\dcshub-preserved-data" "$INSTDIR\data"
    ${endif}
  ${else}
    RMDir /r "$INSTDIR"
  ${endif}
!macroend
