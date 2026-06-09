import { contextBridge, ipcRenderer } from "electron";

const api = {
  selectInputPath: () => ipcRenderer.invoke("dialog:select-input-path"),
  selectOutputDirectory: () => ipcRenderer.invoke("dialog:select-output-directory"),
  selectRulesFile: () => ipcRenderer.invoke("dialog:select-rules-file"),
  saveRulesFileDialog: (defaultPath: string) => ipcRenderer.invoke("dialog:save-rules-file", defaultPath),
  validateQualityInput: (targetPath: string) => ipcRenderer.invoke("path:validate-quality-input", targetPath),
  loadDefaultRules: () => ipcRenderer.invoke("rules:load-default"),
  loadRulesFile: (rulesPath: string) => ipcRenderer.invoke("rules:load-file", rulesPath),
  saveRulesFile: (payload: SaveRulesPayload) => ipcRenderer.invoke("rules:save-file", payload),
  runQualityCheck: (config: QualityRunConfig) => ipcRenderer.invoke("quality:run", config),
  openReportFolder: (folderPath: string) => ipcRenderer.invoke("report:open-folder", folderPath),
  onQualityLog: (callback: (event: LogEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: LogEvent) => callback(event);
    ipcRenderer.on("quality:log", listener);
    return () => ipcRenderer.removeListener("quality:log", listener);
  },
  onQualityExit: (callback: (event: QualityExit) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: QualityExit) => callback(event);
    ipcRenderer.on("quality:exit", listener);
    return () => ipcRenderer.removeListener("quality:exit", listener);
  },
  onQualitySummary: (callback: (event: QualitySummaryEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: QualitySummaryEvent) => callback(event);
    ipcRenderer.on("quality:summary", listener);
    return () => ipcRenderer.removeListener("quality:summary", listener);
  }
};

contextBridge.exposeInMainWorld("kernelMindQuality", api);
