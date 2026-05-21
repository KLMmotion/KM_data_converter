import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let activeConversion: ChildProcessWithoutNullStreams | null = null;

function createWindow() {
  const preload = path.join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#06101f",
    title: "KernelMind Data Converter",
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
    // mainWindow.webContents.openDevTools({ mode: "detach" });
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

function sendLog(level: LogLevel, message: string) {
  mainWindow?.webContents.send("conversion:log", {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    timestamp: new Date().toISOString()
  });
}

function outputBaseToPipelinePaths(outputPath: string) {
  const normalized = path.normalize(outputPath.trim());
  const leaf = path.basename(normalized).toLowerCase();
  const outputRoot = leaf === "lerobot_output" ? path.dirname(normalized) : normalized;
  const lerobotOutputBase = leaf === "lerobot_output" ? path.join(normalized, "lerobot_datasets") : path.join(normalized, "lerobot_output", "lerobot_datasets");

  return {
    outputRoot,
    mcap2rrdDir: path.join(outputRoot, "mcap2rrd"),
    video2rrdDir: path.join(outputRoot, "video2rrd"),
    lerobotOutputBase
  };
}

function quoteArg(value: string) {
  if (!value) {
    return "\"\"";
  }
  return /\s/.test(value) ? `"${value.replaceAll("\"", "\\\"")}"` : value;
}

function commandPreview(command: string, args: string[]) {
  return [command, ...args.map(quoteArg)].join(" ");
}

async function selectDirectory(kind: DirectoryKind) {
  const titles: Record<DirectoryKind, string> = {
    source: "Select BAG_STORAGE directory",
    output: "Select LeRobot output directory",
    dataset: "Select converted LeRobot dataset directory"
  };
  const options: OpenDialogOptions = {
    title: titles[kind],
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

function validatePath(targetPath: string, kind: DirectoryKind): PathValidation {
  const value = targetPath.trim();
  if (!value) {
    return {
      exists: false,
      isDirectory: false,
      message: kind === "source" ? "Source path is required." : kind === "dataset" ? "Dataset path is required." : "Output path is required."
    };
  }

  try {
    if (!fs.existsSync(value)) {
      if (kind === "output") {
        return {
          exists: false,
          isDirectory: false,
          message: "Output directory does not exist yet and will be created by the conversion."
        };
      }

      return {
        exists: false,
        isDirectory: false,
        hasBagDirs: false,
        message: kind === "dataset" ? "Dataset directory does not exist." : "Source directory does not exist."
      };
    }

    const stat = fs.statSync(value);
    const isDirectory = stat.isDirectory();
    if (!isDirectory) {
      return {
        exists: true,
        isDirectory: false,
        hasBagDirs: false,
        message: "Path exists but is not a directory."
      };
    }

    if (kind === "source") {
      const hasBagDirs = fs.readdirSync(value, { withFileTypes: true }).some((entry) => entry.isDirectory() && entry.name.startsWith("my_bag-"));
      return {
        exists: true,
        isDirectory: true,
        hasBagDirs,
        message: hasBagDirs ? "Ready: found my_bag-* episode directories." : "No my_bag-* episode directories found."
      };
    }

    return {
      exists: true,
      isDirectory: true,
      message: "Ready: output directory is available."
    };
  } catch (error) {
    return {
      exists: false,
      isDirectory: false,
      hasBagDirs: false,
      message: error instanceof Error ? error.message : "Unable to validate path."
    };
  }
}

function buildConversionCommand(config: ConversionConfig) {
  const paths = outputBaseToPipelinePaths(config.outputPath);
  const args = [
    "-m",
    "km_data_converter",
    "run-full",
    "--bag-storage",
    config.sourcePath,
    "--mcap2rrd-dir",
    paths.mcap2rrdDir,
    "--video2rrd-dir",
    paths.video2rrdDir,
    "--lerobot-output",
    paths.lerobotOutputBase,
    "--split-target-fps",
    String(config.fps),
    "--repo-id",
    config.repoId || "rerun/droid_lerobot_full",
    "--end-effector",
    config.endEffector
  ];

  const taskDescription = config.taskDescription?.trim();
  if (taskDescription) {
    args.push("--task-description", taskDescription);
  }
  if (config.strict) {
    args.push("--strict");
  }

  return {
    command: "python",
    args,
    paths
  };
}

ipcMain.handle("dialog:select-directory", (_, kind: DirectoryKind) => selectDirectory(kind));
ipcMain.handle("path:validate", (_, targetPath: string, kind: DirectoryKind) => validatePath(targetPath, kind));

ipcMain.handle("conversion:run", (_, config: ConversionConfig): ConversionStarted => {
  if (activeConversion) {
    return { ok: false, message: "A conversion is already running." };
  }

  const sourceValidation = validatePath(config.sourcePath, "source");
  if (!sourceValidation.exists || !sourceValidation.isDirectory || !sourceValidation.hasBagDirs) {
    return { ok: false, message: sourceValidation.message ?? "Source path is not valid." };
  }
  if (!config.outputPath.trim()) {
    return { ok: false, message: "Output path is required." };
  }
  if (!Number.isFinite(config.fps) || config.fps <= 0) {
    return { ok: false, message: "FPS must be a positive number." };
  }

  const repoRoot = getRepoRoot();
  const { command, args, paths } = buildConversionCommand(config);
  const preview = commandPreview(command, args);

  sendLog("system", `cwd: ${repoRoot}`);
  sendLog("system", `command: ${preview}`);

  activeConversion = spawn(command, args, {
    cwd: repoRoot,
    shell: false,
    windowsHide: true
  });

  activeConversion.stdout.on("data", (chunk: Buffer) => sendLog("stdout", chunk.toString()));
  activeConversion.stderr.on("data", (chunk: Buffer) => sendLog("stderr", chunk.toString()));
  activeConversion.on("error", (error) => {
    sendLog("stderr", error.message);
    mainWindow?.webContents.send("conversion:exit", { code: 1, signal: null });
    activeConversion = null;
  });
  activeConversion.on("close", (code, signal) => {
    sendLog(code === 0 ? "system" : "stderr", `Conversion exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`);
    mainWindow?.webContents.send("conversion:exit", { code, signal });
    activeConversion = null;
  });

  return {
    ok: true,
    command: preview,
    paths: {
      repoRoot,
      mcap2rrdDir: paths.mcap2rrdDir,
      video2rrdDir: paths.video2rrdDir,
      lerobotOutputBase: paths.lerobotOutputBase,
      commandPreview: preview
    }
  };
});

ipcMain.handle("rerun:open", (_, datasetPath: string): RerunResult => {
  const trimmedPath = datasetPath.trim();
  if (!trimmedPath) {
    return { ok: false, message: "Dataset path is required." };
  }

  const cwd = fs.existsSync(trimmedPath) && fs.statSync(trimmedPath).isDirectory() ? path.dirname(trimmedPath) : getRepoRoot();
  const child = spawn("rerun", [trimmedPath], {
    cwd,
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();

  return {
    ok: true,
    command: commandPreview("rerun", [trimmedPath])
  };
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
  if (activeConversion) {
    activeConversion.kill();
    activeConversion = null;
  }
});
