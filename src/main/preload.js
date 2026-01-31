const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  saveTextFile: (opts) => ipcRenderer.invoke("saveTextFile", opts)
});

