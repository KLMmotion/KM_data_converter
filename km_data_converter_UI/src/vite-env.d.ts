/// <reference types="vite/client" />

type Language = "zh" | "en";
type ConversionStatus = "idle" | "running" | "success" | "failed";
type EndEffectorMode = "gripper" | "hand";
type LogLevel = "stdout" | "stderr" | "system";
type DirectoryKind = "source" | "output" | "dataset";
type RerunSelectKind = "file" | "directory";

interface ConversionConfig {
  sourcePath: string;
  outputPath: string;
  fps: number;
  repoId: string;
  endEffector: EndEffectorMode;
  taskDescription?: string;
  strict: boolean;
}

interface LogEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

interface PathValidation {
  exists: boolean;
  isDirectory: boolean;
  hasBagDirs?: boolean;
  message?: string;
}

interface ConversionStarted {
  ok: boolean;
  message?: string;
  command?: string;
  paths?: {
    repoRoot: string;
    mcap2rrdDir: string;
    video2rrdDir: string;
    lerobotOutputBase: string;
    commandPreview: string;
  };
}

interface ConversionExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ConversionControlResult {
  ok: boolean;
  paused?: boolean;
  message?: string;
}

interface RerunResult {
  ok: boolean;
  command?: string;
  message?: string;
}

interface RerunStartRequest {
  path?: string;
  paths?: string[];
}

interface RerunIpcResult {
  success: boolean;
  running?: boolean;
  url?: string;
  grpcPort?: number;
  command?: string;
  paths?: string[];
  logs?: string[];
  message?: string;
  error?: string;
}

interface RerunStatus extends RerunIpcResult {
  running: boolean;
  executablePath?: string;
  sourceDir?: string;
  dataPath?: string;
}

interface ActiveRerunViewer {
  child: import("node:child_process").ChildProcessWithoutNullStreams;
  paths: string[];
  url: string;
  grpcPort: number;
  command: string;
  logs: string[];
}

interface RerunConfig {
  sourceDir: string;
  executablePath: string;
  grpcPort: number;
  serverMemoryLimit: string;
  dataPath: string;
}

interface KernelMindApi {
  selectDirectory: (kind: DirectoryKind) => Promise<string | null>;
  validatePath: (path: string, kind: DirectoryKind) => Promise<PathValidation>;
  runConversion: (config: ConversionConfig) => Promise<ConversionStarted>;
  pauseConversion: () => Promise<ConversionControlResult>;
  resumeConversion: () => Promise<ConversionControlResult>;
  stopConversion: () => Promise<ConversionControlResult>;
  openRerun: (datasetPath: string) => Promise<RerunResult>;
  selectRerunPath: (kind: RerunSelectKind) => Promise<string[] | null>;
  startRerunViewer: (request: RerunStartRequest) => Promise<RerunIpcResult>;
  stopRerunViewer: () => Promise<RerunIpcResult>;
  getRerunStatus: () => Promise<RerunStatus>;
  onConversionLog: (callback: (event: LogEvent) => void) => () => void;
  onConversionExit: (callback: (event: ConversionExit) => void) => () => void;
}

interface Window {
  kernelMind: KernelMindApi;
}
