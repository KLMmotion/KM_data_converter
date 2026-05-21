/// <reference types="vite/client" />

type Language = "zh" | "en";
type ConversionStatus = "idle" | "running" | "success" | "failed";
type EndEffectorMode = "gripper" | "hand";
type LogLevel = "stdout" | "stderr" | "system";
type DirectoryKind = "source" | "output" | "dataset";

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

interface RerunResult {
  ok: boolean;
  command?: string;
  message?: string;
}

interface KernelMindApi {
  selectDirectory: (kind: DirectoryKind) => Promise<string | null>;
  validatePath: (path: string, kind: DirectoryKind) => Promise<PathValidation>;
  runConversion: (config: ConversionConfig) => Promise<ConversionStarted>;
  openRerun: (datasetPath: string) => Promise<RerunResult>;
  onConversionLog: (callback: (event: LogEvent) => void) => () => void;
  onConversionExit: (callback: (event: ConversionExit) => void) => () => void;
}

interface Window {
  kernelMind: KernelMindApi;
}
