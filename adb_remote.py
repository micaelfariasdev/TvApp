import subprocess
import tkinter as tk
from tkinter import messagebox

KEYS = {"up":19,"down":20,"left":21,"right":22,"ok":23,"back":4,"home":3,"play":85,"pause":127,"stop":86,"volup":24,"voldown":25,"mute":164}
device = ""

def adb(args):
    cmd = ["adb"] + (["-s", device] if device else []) + args
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.returncode: raise RuntimeError((result.stderr or result.stdout).strip())
    return result.stdout.strip()

def connect():
    global device
    value = address.get().strip()
    if not value:
        messagebox.showwarning("ADB", "Informe o IP:porta da TV Box."); return
    try:
        result = subprocess.run(["adb", "connect", value], capture_output=True, text=True, timeout=10)
        if result.returncode: raise RuntimeError(result.stderr.strip())
        device = value; status.set("Conectado: " + value)
    except Exception as error: status.set(str(error))

def key(name):
    try: adb(["shell", "input", "keyevent", str(KEYS[name])])
    except Exception as error: status.set(str(error))

def button(parent, text, action, width=8):
    return tk.Button(parent, text=text, command=lambda: key(action), width=width, height=2, bg="#2e3d58", fg="white", activebackground="#0da9df", relief="flat")

root = tk.Tk(); root.title("Controle TV Box"); root.geometry("360x530"); root.configure(bg="#101827"); root.resizable(False, False)
status = tk.StringVar(value="Informe o IP da TV Box"); address = tk.StringVar()
tk.Label(root, text="Controle TV Box", fg="white", bg="#101827", font=("Arial",20,"bold")).pack(pady=16)
row = tk.Frame(root, bg="#101827"); row.pack(fill="x", padx=18)
tk.Entry(row, textvariable=address, bg="#202d42", fg="white", insertbackground="white", relief="flat").pack(side="left", fill="x", expand=True, ipady=9)
tk.Button(row, text="Conectar", command=connect).pack(side="right", padx=(8,0), ipady=5)
tk.Label(root, textvariable=status, fg="#aebbd0", bg="#101827", wraplength=320).pack(pady=12)
pad = tk.Frame(root, bg="#101827"); pad.pack()
button(pad,"▲","up").grid(row=0,column=1,padx=5,pady=5); button(pad,"◀","left").grid(row=1,column=0,padx=5,pady=5); button(pad,"OK","ok").grid(row=1,column=1,padx=5,pady=5); button(pad,"▶","right").grid(row=1,column=2,padx=5,pady=5); button(pad,"▼","down").grid(row=2,column=1,padx=5,pady=5)
actions = tk.Frame(root, bg="#101827"); actions.pack(pady=15)
for i, item in enumerate([("↩ Voltar","back"),("⌂ Home","home"),("🔊 +","volup"),("🔉 −","voldown"),("▶ Play","play"),("Ⅱ Pausar","pause"),("🔇 Mudo","mute"),("■ Parar","stop")]):
    button(actions, *item, 12).grid(row=i//2,column=i%2,padx=5,pady=5)
for event, action in [("<Up>","up"),("<Down>","down"),("<Left>","left"),("<Right>","right"),("<Return>","ok"),("<Escape>","back")]: root.bind(event, lambda _, a=action: key(a))
root.mainloop()
