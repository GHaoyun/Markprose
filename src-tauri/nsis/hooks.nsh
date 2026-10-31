; Markprose 安装器钩子
; 装完就把文档目录建好，第一次打开软件时保存位置已经是可用的

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$DOCUMENTS\Markprose"
!macroend
