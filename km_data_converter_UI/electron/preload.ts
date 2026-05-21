import { contextBridge, ipcRenderer } from "electron";

const api = {
  selectDirectory: (kind: DirectoryKind) => ipcRenderer.invoke("dialog:select-directory", kind),
  validatePath: (path: string, kind: DirectoryKind) => ipcRenderer.invoke("path:validate", path, kind),
  runConversion: (config: ConversionConfig) => ipcRenderer.invoke("conversion:run", config),
  openRerun: (datasetPath: string) => ipcRenderer.invoke("rerun:open", datasetPath),
  onConversionLog: (callback: (event: LogEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: LogEvent) => callback(event);
    ipcRenderer.on("conversion:log", listener);
    return () => ipcRenderer.removeListener("conversion:log", listener);
  },
  onConversionExit: (callback: (event: ConversionExit) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: ConversionExit) => callback(event);
    ipcRenderer.on("conversion:exit", listener);
    return () => ipcRenderer.removeListener("conversion:exit", listener);
  }
};

contextBridge.exposeInMainWorld("kernelMind", api);
