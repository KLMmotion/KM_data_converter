import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let activeCheck: ChildProcessWithoutNullStreams | null = null;

const LOAD_RULES_SCRIPT = String.raw`
import json
import sys
from pathlib import Path
import yaml
from km_data_quality_check.raw_checker import REQUIRED_TOPICS

rules_path = Path(sys.argv[1])
with rules_path.open("r", encoding="utf-8") as file:
    config = yaml.safe_load(file) or {}
rules = config.get("rules", []) if isinstance(config, dict) else []
print(json.dumps({"path": str(rules_path), "rules": rules, "requiredTopics": REQUIRED_TOPICS}, ensure_ascii=False))
`;

const SAVE_RULES_SCRIPT = String.raw`
import json
import sys
from pathlib import Path
import yaml

payload = json.load(sys.stdin)
rules_path = Path(payload["path"])
rules_path.parent.mkdir(parents=True, exist_ok=True)
with rules_path.open("w", encoding="utf-8") as file:
    yaml.safe_dump({"rules": payload.get("rules", [])}, file, allow_unicode=True, sort_keys=False)
print(json.dumps({"path": str(rules_path)}, ensure_ascii=False))
`;

function createWindow() {
  const preload = path.join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#07101d",
    title: "KernelMind Data Quality Check",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function getUiRoot() {
  return app.getAppPath();
}

function getRepoRoot() {
  return path.resolve(getUiRoot(), "..");
}

function getDefaultRulesPath() {
  return path.join(getRepoRoot(), "km_data_quality_check", "default_quality_rules.yaml");
}

function sendLog(level: LogLevel, message: string) {
  mainWindow?.webContents.send("quality:log", {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    timestamp: new Date().toISOString()
  });
}

function quoteArg(value: string) {
  if (!value) {
    return "\"\"";
  }
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function commandPreview(command: string, args: string[]) {
  return [command, ...args.map(quoteArg)].join(" ");
}

function resolveReportOutputDir(outputRoot: string) {
  const normalized = path.normalize(outputRoot.trim());
  return path.basename(normalized).toLowerCase() === "quality_report" ? normalized : path.join(normalized, "quality_report");
}

function locateRecordingDir(filePath: string) {
  let current = path.dirname(filePath);
  while (current && current !== path.dirname(current)) {
    if (path.basename(current).startsWith("my_bag-")) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function resolveInputPath(targetPath: string): QualityInputValidation {
  const value = targetPath.trim();
  if (!value) {
    return {
      ok: false,
      exists: false,
      isDirectory: false,
      resolvedPath: "",
      message: "Input data path is required."
    };
  }

  try {
    if (!fs.existsSync(value)) {
      return {
        ok: false,
        exists: false,
        isDirectory: false,
        resolvedPath: value,
        message: "Input path does not exist."
      };
    }

    const stat = fs.statSync(value);
    if (stat.isFile()) {
      const extension = path.extname(value).toLowerCase();
      if (![".mcap", ".db3"].includes(extension)) {
        return {
          ok: false,
          exists: true,
          isDirectory: false,
          resolvedPath: value,
          message: "Only MCAP/DB3 files or BAG_STORAGE/my_bag-* directories are supported."
        };
      }
      const recordingDir = locateRecordingDir(value);
      if (!recordingDir) {
        return {
          ok: false,
          exists: true,
          isDirectory: false,
          resolvedPath: value,
          message: "Could not locate a parent my_bag-* recording directory for this file."
        };
      }
      return {
        ok: true,
        exists: true,
        isDirectory: false,
        resolvedPath: recordingDir,
        message: `Resolved to recording directory: ${recordingDir}`
      };
    }

    if (!stat.isDirectory()) {
      return {
        ok: false,
        exists: true,
        isDirectory: false,
        resolvedPath: value,
        message: "Path exists but is not a directory."
      };
    }

    const isRecordingDir = path.basename(value).startsWith("my_bag-");
    const hasBagDirs = fs.readdirSync(value, { withFileTypes: true }).some((entry) => entry.isDirectory() && entry.name.startsWith("my_bag-"));
    return {
      ok: isRecordingDir || hasBagDirs,
      exists: true,
      isDirectory: true,
      hasBagDirs,
      resolvedPath: value,
      message: isRecordingDir
        ? "Ready: selected one my_bag-* recording directory."
        : hasBagDirs
          ? "Ready: found my_bag-* recording directories."
          : "No my_bag-* recording directories found."
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      isDirectory: false,
      resolvedPath: value,
      message: error instanceof Error ? error.message : "Unable to validate input path."
    };
  }
}

function runPythonJson(script: string, args: string[], input?: string) {
  const result = spawnSync("python", ["-c", script, ...args], {
    cwd: getRepoRoot(),
    input,
    encoding: "utf-8",
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Python helper failed.").trim());
  }
  return JSON.parse(result.stdout.trim() || "{}");
}

function loadRules(rulesPath: string): RulesLoadResult {
  return runPythonJson(LOAD_RULES_SCRIPT, [rulesPath]) as RulesLoadResult;
}

function saveRules(payload: SaveRulesPayload): SaveRulesResult {
  return runPythonJson(SAVE_RULES_SCRIPT, [], JSON.stringify(payload)) as SaveRulesResult;
}

async function selectInputPath() {
  const options: OpenDialogOptions = {
    title: "Select input data path",
    properties: ["openDirectory", "openFile"],
    filters: [
      { name: "ROS bag data", extensions: ["mcap", "db3"] },
      { name: "All files", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function selectOutputDirectory() {
  const options: OpenDialogOptions = {
    title: "Select output report directory",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function selectRulesFile() {
  const options: OpenDialogOptions = {
    title: "Select quality rules YAML",
    properties: ["openFile"],
    filters: [
      { name: "YAML", extensions: ["yaml", "yml"] },
      { name: "All files", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function saveRulesFileDialog(defaultPath: string) {
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: "Save quality rules",
        defaultPath,
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }]
      })
    : await dialog.showSaveDialog({
        title: "Save quality rules",
        defaultPath,
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }]
      });

  if (result.canceled || !result.filePath) {
    return null;
  }
  return result.filePath;
}

ipcMain.handle("dialog:select-input-path", () => selectInputPath());
ipcMain.handle("dialog:select-output-directory", () => selectOutputDirectory());
ipcMain.handle("dialog:select-rules-file", () => selectRulesFile());
ipcMain.handle("dialog:save-rules-file", (_, defaultPath: string) => saveRulesFileDialog(defaultPath));
ipcMain.handle("path:validate-quality-input", (_, targetPath: string) => resolveInputPath(targetPath));
ipcMain.handle("rules:load-default", () => loadRules(getDefaultRulesPath()));
ipcMain.handle("rules:load-file", (_, rulesPath: string) => loadRules(rulesPath));
ipcMain.handle("rules:save-file", (_, payload: SaveRulesPayload) => saveRules(payload));

ipcMain.handle("quality:run", (_, config: QualityRunConfig): QualityRunStarted => {
  if (activeCheck) {
    return { ok: false, message: "A quality check is already running." };
  }

  const inputValidation = resolveInputPath(config.inputPath);
  if (!inputValidation.ok) {
    return { ok: false, message: inputValidation.message ?? "Input path is not valid." };
  }
  if (!config.outputPath.trim()) {
    return { ok: false, message: "Output report path is required." };
  }

  fs.mkdirSync(config.outputPath, { recursive: true });
  const reportDir = resolveReportOutputDir(config.outputPath);
  const args = [
    "-m",
    "km_data_converter",
    "quality-check",
    "--input",
    inputValidation.resolvedPath,
    "--output",
    config.outputPath
  ];

  if (config.rulesPath) {
    args.push("--rules", config.rulesPath);
  }
  if (config.replaceRules) {
    args.push("--replace-rules");
  }
  for (const topic of config.requiredTopics.map((item) => item.trim()).filter(Boolean)) {
    args.push("--required-topic", topic);
  }

  const preview = commandPreview("python", args);
  sendLog("system", `cwd: ${getRepoRoot()}\n`);
  sendLog("system", config.rulesPath ? `Using custom quality rules: ${config.rulesPath}\n` : `Using default quality rules: ${getDefaultRulesPath()}\n`);
  sendLog("system", `command: ${preview}\n`);

  activeCheck = spawn("python", args, {
    cwd: getRepoRoot(),
    shell: false,
    windowsHide: true
  });

  activeCheck.stdout.on("data", (chunk: Buffer) => sendLog("stdout", chunk.toString()));
  activeCheck.stderr.on("data", (chunk: Buffer) => sendLog("stderr", chunk.toString()));
  activeCheck.on("error", (error) => {
    sendLog("stderr", `${error.message}\n`);
    mainWindow?.webContents.send("quality:exit", { code: 1, signal: null });
    activeCheck = null;
  });
  activeCheck.on("close", (code, signal) => {
    sendLog(code === 0 ? "system" : "stderr", `Quality check exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.\n`);
    if (code === 0) {
      const summaryPath = path.join(reportDir, "summary_raw_quality_report.json");
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
        mainWindow?.webContents.send("quality:summary", { reportDir, summary });
      } catch (error) {
        sendLog("stderr", `Could not read summary report: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    mainWindow?.webContents.send("quality:exit", { code, signal });
    activeCheck = null;
  });

  return {
    ok: true,
    command: preview,
    reportDir
  };
});

ipcMain.handle("report:open-folder", async (_, folderPath: string): Promise<OpenFolderResult> => {
  const target = folderPath.trim();
  if (!target) {
    return { ok: false, message: "Report folder path is required." };
  }
  const errorMessage = await shell.openPath(target);
  return errorMessage ? { ok: false, message: errorMessage } : { ok: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (activeCheck) {
    activeCheck.kill();
    activeCheck = null;
  }
});
