import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-webgl");

let mainWindow: BrowserWindow | null = null;
let activeConversion: ChildProcessWithoutNullStreams | null = null;
let activeConversionPaused = false;
let activeRerunViewer: ActiveRerunViewer | null = null;
let lastRerunLogs: string[] = [];

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

function timestampForFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function formatLogsForExport(logs: LogEvent[]) {
  return logs.map((log) => `[${log.timestamp}] [${log.level}] ${log.message}`).join("").trimEnd() + "\n";
}

function exportLogs(request: ExportLogsRequest): ExportLogsResult {
  const outputPath = request.outputPath.trim();
  if (!outputPath) {
    return { ok: false, message: "Output path is required before exporting logs." };
  }
  if (!Array.isArray(request.logs) || request.logs.length === 0) {
    return { ok: false, message: "No logs to export." };
  }

  const targetDir = path.normalize(outputPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, `conversion_logs_${timestampForFilename()}.txt`);
  fs.writeFileSync(filePath, formatLogsForExport(request.logs), "utf8");
  return { ok: true, filePath };
}

function writeSchemaConfig(config: ConversionConfig, paths: ReturnType<typeof outputBaseToPipelinePaths>) {
  const schema = config.schemaConfig;
  if (!schema || !Array.isArray(schema.action) || !Array.isArray(schema.observation)) {
    throw new Error("LeRobot schema config is missing action or observation topics.");
  }
  if (schema.action.length === 0 || schema.observation.length === 0) {
    throw new Error("LeRobot schema action and observation must both contain at least one topic.");
  }

  fs.mkdirSync(paths.outputRoot, { recursive: true });
  const schemaConfigPath = path.join(paths.outputRoot, "lerobot_schema.json");
  fs.writeFileSync(schemaConfigPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  return schemaConfigPath;
}

function writeVideoStreamConfig(config: ConversionConfig, paths: ReturnType<typeof outputBaseToPipelinePaths>) {
  const streams = config.videoStreams;
  if (!Array.isArray(streams) || streams.length === 0) {
    throw new Error("Video stream mapping must contain at least one selected stream.");
  }

  const validGrids = new Set(["top_left", "top_right", "bottom_left", "bottom_right"]);
  const validRoles = new Set(["left_eye", "right_eye", "left_wrist", "right_wrist"]);
  const seenGrids = new Set<string>();
  const seenRoles = new Set<string>();

  for (const stream of streams) {
    if (!validGrids.has(stream.grid)) {
      throw new Error(`Invalid video grid: ${stream.grid}`);
    }
    if (!validRoles.has(stream.role)) {
      throw new Error(`Invalid video role: ${stream.role}`);
    }
    if (seenGrids.has(stream.grid)) {
      throw new Error(`Duplicate video grid: ${stream.grid}`);
    }
    if (seenRoles.has(stream.role)) {
      throw new Error(`Duplicate video role: ${stream.role}`);
    }
    seenGrids.add(stream.grid);
    seenRoles.add(stream.role);
  }

  fs.mkdirSync(paths.outputRoot, { recursive: true });
  const videoStreamConfigPath = path.join(paths.outputRoot, "video_stream_config.json");
  fs.writeFileSync(videoStreamConfigPath, `${JSON.stringify({ video_streams: streams }, null, 2)}\n`, "utf8");
  return videoStreamConfigPath;
}

function execFileAsync(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getActiveConversionPid() {
  const pid = activeConversion?.pid;
  return typeof pid === "number" && Number.isFinite(pid) ? pid : null;
}

function windowsProcessTreeControlScript(pid: number, action: "suspend" | "resume") {
  const nativeCall = action === "suspend" ? "NtSuspendProcess" : "NtResumeProcess";

  return `
$ErrorActionPreference = "Stop"
$rootPid = ${pid}
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeProcessControl {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);

  [DllImport("ntdll.dll")]
  public static extern uint NtSuspendProcess(IntPtr processHandle);

  [DllImport("ntdll.dll")]
  public static extern uint NtResumeProcess(IntPtr processHandle);
}
"@

function Get-ProcessTreeIds([int]$parentPid) {
  $ids = @($parentPid)
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentPid"
  foreach ($child in $children) {
    $ids += Get-ProcessTreeIds ([int]$child.ProcessId)
  }
  return $ids
}

$processIds = Get-ProcessTreeIds $rootPid
if ("${action}" -eq "suspend") {
  [array]::Reverse($processIds)
}

foreach ($processId in $processIds) {
  $handle = [NativeProcessControl]::OpenProcess(0x0800, $false, [uint32]$processId)
  if ($handle -eq [IntPtr]::Zero) {
    continue
  }

  try {
    $status = [NativeProcessControl]::${nativeCall}($handle)
    if ($status -ne 0) {
      throw "${nativeCall} failed for PID $processId with status $status"
    }
  } finally {
    [void][NativeProcessControl]::CloseHandle($handle)
  }
}
`;
}

async function pauseProcess(pid: number) {
  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", windowsProcessTreeControlScript(pid, "suspend")]);
    return;
  }

  process.kill(pid, "SIGSTOP");
}

async function resumeProcess(pid: number) {
  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", windowsProcessTreeControlScript(pid, "resume")]);
    return;
  }

  process.kill(pid, "SIGCONT");
}

async function stopProcessTree(pid: number) {
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  process.kill(pid, "SIGTERM");
}

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function getRerunConfig(): RerunConfig {
  const sourceDir = process.env.RERUN_SOURCE_DIR || path.resolve(getRepoRoot(), "rerun-0.32.2");
  const builtExecutable = process.platform === "win32" ? path.join(sourceDir, "target", "release", "rerun.exe") : path.join(sourceDir, "target", "release", "rerun");
  const condaExecutable =
    process.env.CONDA_PREFIX && (process.platform === "win32" ? path.join(process.env.CONDA_PREFIX, "Scripts", "rerun.exe") : path.join(process.env.CONDA_PREFIX, "bin", "rerun"));
  const executablePath = process.env.RERUN_EXECUTABLE_PATH || (condaExecutable && fs.existsSync(condaExecutable) ? condaExecutable : fs.existsSync(builtExecutable) ? builtExecutable : "rerun");

  return {
    sourceDir,
    executablePath,
    grpcPort: parsePort(process.env.RERUN_GRPC_PORT, 9876),
    serverMemoryLimit: process.env.RERUN_SERVER_MEMORY_LIMIT || "",
    dataPath: process.env.RERUN_DATA_PATH || ""
  };
}

function normalizeRerunPaths(paths: string[]) {
  return paths.map((value) => path.normalize(value.trim())).filter(Boolean);
}

function sameRerunPaths(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value.toLowerCase() === right[index].toLowerCase());
}

function appendRerunMemoryLimitArgs(args: string[], serverMemoryLimit: string) {
  const trimmed = serverMemoryLimit.trim();
  if (!trimmed || trimmed.toLowerCase() === "unlimited") {
    return;
  }

  args.push("--server-memory-limit", trimmed);
}

function buildRerunDataSourceUrl(grpcPort: number) {
  return `rerun+http://localhost:${grpcPort}/proxy`;
}

function getRerunStatus(): RerunStatus {
  const config = getRerunConfig();
  return {
    running: Boolean(activeRerunViewer),
    success: true,
    url: activeRerunViewer?.url,
    grpcPort: activeRerunViewer?.grpcPort ?? config.grpcPort,
    command: activeRerunViewer?.command,
    paths: activeRerunViewer?.paths ?? [],
    logs: activeRerunViewer?.logs ?? lastRerunLogs,
    executablePath: config.executablePath,
    sourceDir: config.sourceDir,
    dataPath: config.dataPath
  };
}

function addRerunLog(message: string) {
  if (!activeRerunViewer) {
    return;
  }

  const trimmed = message.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
  if (!trimmed) {
    return;
  }

  activeRerunViewer.logs.push(trimmed);
  activeRerunViewer.logs = activeRerunViewer.logs.slice(-120);
  lastRerunLogs = activeRerunViewer.logs;
}

function validateRerunInputPaths(paths: string[]): string | null {
  if (paths.length === 0) {
    return "Select an .rrd, .rbl, .mcap file, or a LeRobot dataset directory.";
  }

  for (const targetPath of paths) {
    if (!fs.existsSync(targetPath)) {
      return `Path does not exist: ${targetPath}`;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      continue;
    }

    if (!stat.isFile()) {
      return `Path is not a file or directory: ${targetPath}`;
    }

    const extension = path.extname(targetPath).toLowerCase();
    if (![".rrd", ".rbl", ".mcap"].includes(extension)) {
      return `Unsupported Rerun input file type: ${targetPath}`;
    }
  }

  return null;
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(preferredPort: number, reservedPorts: number[] = []) {
  for (let offset = 0; offset < 100; offset += 1) {
    const port = preferredPort + offset;
    if (port > 65535 || reservedPorts.includes(port)) {
      continue;
    }
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return null;
}

function waitForRerunServer(child: ChildProcessWithoutNullStreams, port: number, timeoutMs = 10000) {
  const startedAt = Date.now();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(ready);
    };

    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        settle(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (settled) {
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          settle(false);
          return;
        }
        setTimeout(attempt, 150);
      });
    };

    child.once("close", () => settle(false));
    attempt();
  });
}

function stopRerunViewerProcess(message = "Rerun Viewer stopped."): RerunIpcResult {
  if (!activeRerunViewer) {
    return {
      success: true,
      running: false,
      message: "Rerun Viewer is not running.",
      logs: lastRerunLogs
    };
  }

  const logs = [...activeRerunViewer.logs, message];
  lastRerunLogs = logs.slice(-120);
  activeRerunViewer.child.kill();
  activeRerunViewer = null;

  return {
    success: true,
    running: false,
    message,
    logs: lastRerunLogs
  };
}

async function selectRerunPath(kind: RerunSelectKind) {
  const options: OpenDialogOptions = {
    title: kind === "directory" ? "Select Rerun input directory" : "Select Rerun input file",
    properties: kind === "directory" ? ["openDirectory", "multiSelections"] : ["openFile", "multiSelections"],
    filters: [
      { name: "Rerun / MCAP", extensions: ["rrd", "rbl", "mcap"] },
      { name: "All Files", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths;
}

async function startRerunViewer(request: RerunStartRequest): Promise<RerunIpcResult> {
  const config = getRerunConfig();
  const requestedPaths = normalizeRerunPaths(request.paths ?? (request.path ? [request.path] : config.dataPath ? [config.dataPath] : []));
  const validationError = validateRerunInputPaths(requestedPaths);

  if (validationError) {
    return {
      success: false,
      running: Boolean(activeRerunViewer),
      error: validationError,
      logs: activeRerunViewer?.logs ?? lastRerunLogs
    };
  }

  const grpcPort = await findAvailablePort(config.grpcPort);

  if (grpcPort === null) {
    return {
      success: false,
      running: Boolean(activeRerunViewer),
      error: "No available ports found for the Rerun data service. Close old Rerun processes or set RERUN_GRPC_PORT.",
      logs: activeRerunViewer?.logs ?? lastRerunLogs
    };
  }

  if (activeRerunViewer && sameRerunPaths(activeRerunViewer.paths, requestedPaths)) {
    return {
      success: true,
      running: true,
      url: activeRerunViewer.url,
      grpcPort: activeRerunViewer.grpcPort,
      command: activeRerunViewer.command,
      paths: activeRerunViewer.paths,
      logs: activeRerunViewer.logs,
      message: "Rerun Viewer is already running for the selected input."
    };
  }

  if (activeRerunViewer) {
    stopRerunViewerProcess("Restarting Rerun Viewer for a new input.");
  }

  const args = [
    "--serve-grpc",
    "--bind",
    "127.0.0.1",
    "--port",
    String(grpcPort)
  ];
  appendRerunMemoryLimitArgs(args, config.serverMemoryLimit);
  args.push(...requestedPaths);
  const command = commandPreview(config.executablePath, args);
  const url = buildRerunDataSourceUrl(grpcPort);
  lastRerunLogs = [`cwd: ${getRepoRoot()}`, `command: ${command}`, `data source: ${url}`];
  const child = spawn(config.executablePath, args, {
    cwd: getRepoRoot(),
    shell: false,
    windowsHide: true
  });

  activeRerunViewer = {
    child,
    paths: requestedPaths,
    url,
    grpcPort,
    command,
    logs: lastRerunLogs
  };

  child.stdout.on("data", (chunk: Buffer) => addRerunLog(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => addRerunLog(chunk.toString()));
  child.on("close", (code, signal) => {
    if (activeRerunViewer?.child === child) {
      addRerunLog(`Rerun Viewer exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`);
      activeRerunViewer = null;
    }
  });

  const spawnError = await new Promise<Error | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 600);
    child.once("spawn", () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve(error);
    });
  });

  if (spawnError) {
    const error = spawnError.message;
    lastRerunLogs = [error];
    activeRerunViewer = null;
    return {
      success: false,
      running: false,
      error,
      logs: lastRerunLogs
    };
  }

  const serverReady = await waitForRerunServer(child, grpcPort);
  if (!serverReady) {
    const logs = [...(activeRerunViewer?.logs ?? lastRerunLogs), `Rerun data service did not start listening on port ${grpcPort}.`].slice(-120);
    lastRerunLogs = logs;
    activeRerunViewer?.child.kill();
    activeRerunViewer = null;
    return {
      success: false,
      running: false,
      error: `Rerun data service did not start listening on port ${grpcPort}.`,
      logs
    };
  }

  return {
    success: true,
    running: true,
    url,
    grpcPort,
    command,
    paths: requestedPaths,
    logs: activeRerunViewer.logs,
    message: "Rerun data service started."
  };
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
  const schemaConfigPath = writeSchemaConfig(config, paths);
  const videoStreamConfigPath = writeVideoStreamConfig(config, paths);
  const args = [
    "-u",
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
    config.endEffector,
    "--lerobot-schema-config",
    schemaConfigPath,
    "--video-stream-config",
    videoStreamConfigPath
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
    paths: {
      ...paths,
      schemaConfigPath,
      videoStreamConfigPath
    }
  };
}

ipcMain.handle("dialog:select-directory", (_, kind: DirectoryKind) => selectDirectory(kind));
ipcMain.handle("path:validate", (_, targetPath: string, kind: DirectoryKind) => validatePath(targetPath, kind));
ipcMain.handle("logs:export", (_, request: ExportLogsRequest) => exportLogs(request));

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
  let commandConfig: ReturnType<typeof buildConversionCommand>;
  try {
    commandConfig = buildConversionCommand(config);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Failed to prepare conversion command." };
  }
  const { command, args, paths } = commandConfig;
  const preview = commandPreview(command, args);

  sendLog("system", `cwd: ${repoRoot}`);
  sendLog("system", `command: ${preview}`);
  activeConversionPaused = false;

  activeConversion = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1"
    },
    shell: false,
    windowsHide: true
  });

  activeConversion.stdout.on("data", (chunk: Buffer) => sendLog("stdout", chunk.toString()));
  activeConversion.stderr.on("data", (chunk: Buffer) => sendLog("stderr", chunk.toString()));
  activeConversion.on("error", (error) => {
    sendLog("stderr", error.message);
    mainWindow?.webContents.send("conversion:exit", { code: 1, signal: null });
    activeConversion = null;
    activeConversionPaused = false;
  });
  activeConversion.on("close", (code, signal) => {
    sendLog(code === 0 ? "system" : "stderr", `Conversion exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`);
    mainWindow?.webContents.send("conversion:exit", { code, signal });
    activeConversion = null;
    activeConversionPaused = false;
  });

  return {
    ok: true,
    command: preview,
    paths: {
      repoRoot,
      mcap2rrdDir: paths.mcap2rrdDir,
      video2rrdDir: paths.video2rrdDir,
      lerobotOutputBase: paths.lerobotOutputBase,
      schemaConfigPath: paths.schemaConfigPath,
      videoStreamConfigPath: paths.videoStreamConfigPath,
      commandPreview: preview
    }
  };
});

ipcMain.handle("conversion:pause", async (): Promise<ConversionControlResult> => {
  const pid = getActiveConversionPid();
  if (pid === null) {
    return { ok: false, paused: false, message: "No active conversion process." };
  }
  if (activeConversionPaused) {
    return { ok: true, paused: true, message: "Conversion is already paused." };
  }

  try {
    await pauseProcess(pid);
    activeConversionPaused = true;
    sendLog("system", "Conversion paused.");
    return { ok: true, paused: true, message: "Conversion paused." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to pause conversion.";
    sendLog("stderr", message);
    return { ok: false, paused: false, message };
  }
});

ipcMain.handle("conversion:resume", async (): Promise<ConversionControlResult> => {
  const pid = getActiveConversionPid();
  if (pid === null) {
    return { ok: false, paused: false, message: "No active conversion process." };
  }
  if (!activeConversionPaused) {
    return { ok: true, paused: false, message: "Conversion is already running." };
  }

  try {
    await resumeProcess(pid);
    activeConversionPaused = false;
    sendLog("system", "Conversion resumed.");
    return { ok: true, paused: false, message: "Conversion resumed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resume conversion.";
    sendLog("stderr", message);
    return { ok: false, paused: true, message };
  }
});

ipcMain.handle("conversion:stop", async (): Promise<ConversionControlResult> => {
  const pid = getActiveConversionPid();
  if (pid === null) {
    return { ok: false, paused: false, message: "No active conversion process." };
  }

  try {
    sendLog("system", "Stopping conversion...");
    await stopProcessTree(pid);
    activeConversionPaused = false;
    return { ok: true, paused: false, message: "Conversion stop requested." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop conversion.";
    sendLog("stderr", message);
    return { ok: false, paused: activeConversionPaused, message };
  }
});

ipcMain.handle("rerun:open", (_, datasetPath: string): RerunResult => {
  const paths = datasetPath
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    return { ok: false, message: "Dataset path is required." };
  }

  const firstPath = paths[0];
  const cwd = fs.existsSync(firstPath) && fs.statSync(firstPath).isDirectory() ? path.dirname(firstPath) : getRepoRoot();
  const child = spawn("rerun", paths, {
    cwd,
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();

  return {
    ok: true,
    command: commandPreview("rerun", paths)
  };
});

ipcMain.handle("rerun:selectPath", (_, kind: RerunSelectKind) => selectRerunPath(kind));
ipcMain.handle("rerun:startViewer", (_, request: RerunStartRequest) => startRerunViewer(request));
ipcMain.handle("rerun:stopViewer", () => stopRerunViewerProcess());
ipcMain.handle("rerun:getStatus", () => getRerunStatus());

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
    activeConversionPaused = false;
  }
  if (activeRerunViewer) {
    activeRerunViewer.child.kill();
    activeRerunViewer = null;
  }
});
