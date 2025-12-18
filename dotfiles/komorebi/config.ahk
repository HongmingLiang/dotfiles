#Requires AutoHotkey v2.0
#SingleInstance Force

; Physically block Esc
$Esc:: return

; Disable the CapsLock key
SetCapsLockState "AlwaysOff"

; Send esc key when Capslock is pressed as default
g_DoNotAbortSendEsc := true
$*Capslock:: {                           ; Capture CapsLock key press
    global g_DoNotAbortSendEsc           ; use global variable g_DoNotAbortSendEsc
    g_DoNotAbortSendEsc := true          ; set g_DoNotAbortSendEsc to true
    Send("{LControl Down}")              ; send Ctrl key down
    KeyWait("CapsLock")                  ; capture CapsLock key up
    Send("{LControl Up}")                ; send Ctrl key up
    if (A_PriorKey == "CapsLock"         ; if the last key is Capslock
        && g_DoNotAbortSendEsc) {        ; if the g_DoNotAbortSendEsc is true
        Send("{Esc}")                    ; send Esc key
    }
    return
}

; LAlt + home row -> arrow keys
LAlt & h:: Send "{Left}"
LAlt & j:: Send "{Down}"
LAlt & k:: Send "{Up}"
LAlt & l:: Send "{Right}"
LAlt & =:: Send "{Delete}"

; RAlt + home row -> special characters
RAlt & a:: Send "{Text}!"
RAlt & s:: Send "{Text}@"
RAlt & d:: Send "{Text}#"
RAlt & f:: Send "{Text}$"
RAlt & g:: Send "{Text}%"
RAlt & z:: Send "{Text}^"
RAlt & x:: Send "{Text}&"
RAlt & c:: Send "{Text}*"

RAlt:: return

; Komorebic control
Komorebic(cmd) {
    RunWait(format("komorebic.exe {}", cmd), , "Hide")
}

#q:: Komorebic("close")
#m:: Komorebic("minimize")

; Focus windows
#h:: Komorebic("focus left")
#j:: Komorebic("focus down")
#k:: Komorebic("focus up")
#l:: Komorebic("focus right")

#^[:: Komorebic("cycle-focus previous")
#^]:: Komorebic("cycle-focus next")

; Move windows (Win+Ctrl; Ctrl is remapped via CapsLock)
#^h:: Komorebic("move left")
#^j:: Komorebic("move down")
#^k:: Komorebic("move up")
#^l:: Komorebic("move right")

; Stack windows
#Left:: Komorebic("stack left")
#Down:: Komorebic("stack down")
#Up:: Komorebic("stack up")
#Right:: Komorebic("stack right")
#;:: Komorebic("unstack")
#[:: Komorebic("cycle-stack previous")
#]:: Komorebic("cycle-stack next")

; Resize
#=:: Komorebic("resize-axis horizontal increase")
#-:: Komorebic("resize-axis horizontal decrease")
#^=:: Komorebic("resize-axis vertical increase")
#^-:: Komorebic("resize-axis vertical decrease")

; Manipulate windows
#t:: Komorebic("toggle-float")
#f:: Komorebic("toggle-monocle")

; Window manager options
#^r:: Komorebic("retile")
#p:: Komorebic("toggle-pause")

; Layouts
#x:: Komorebic("flip-layout horizontal")
#y:: Komorebic("flip-layout vertical")

; Workspaces
#1:: Komorebic("focus-workspace 0")
#2:: Komorebic("focus-workspace 1")
#3:: Komorebic("focus-workspace 2")
#4:: Komorebic("focus-workspace 3")
#5:: Komorebic("focus-workspace 4")
#6:: Komorebic("focus-workspace 5")
#7:: Komorebic("focus-workspace 6")
#8:: Komorebic("focus-workspace 7")

; Move windows across workspaces
#^1:: Komorebic("move-to-workspace 0")
#^2:: Komorebic("move-to-workspace 1")
#^3:: Komorebic("move-to-workspace 2")
#^4:: Komorebic("move-to-workspace 3")
#^5:: Komorebic("move-to-workspace 4")
#^6:: Komorebic("move-to-workspace 5")
#^7:: Komorebic("move-to-workspace 6")
#^8:: Komorebic("move-to-workspace 7")