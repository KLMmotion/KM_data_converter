/// <reference types="vite/client" />

type Language = "zh" | "en";
type ConversionStatus = "idle" | "running" | "success" | "failed";
type EndEffectorMode = "gripper" | "hand";
type LogLevel = "stdout" | "stderr" | "system";
type DirectoryKind = "source" | "output" | "dataset";
type RerunSelectKind = "file" | "directory";
type VideoGrid = "top_left" | "top_right" | "bottom_left" | "bottom_right";
type VideoRole = "left_eye" | "right_eye" | "left_wrist" | "right_wrist";
type SchemaTopic =
  | "/joint_states/effort_L"
  | "/joint_states/effort_R"
  | "/joint_states/position_L"
  | "/joint_states/position_R"
  | "/joint_states/velocity_L"
  | "/joint_states/velocity_R"
  | "/control/joint_cmd_A"
  | "/control/joint_cmd_B"
  | "eef_left"
  | "eef_right"
  | "gripper_feedback_L"
  | "gripper_feedback_R"
  | "/hand_left/joint_commands/position"
  | "/hand_right/joint_commands/position"
  | "/hand_left/joint_states/position"
  | "/hand_right/joint_states/position"
  | "/hand_left/joint_states/effort"
  | "/hand_right/joint_states/effort";

interface LeRobotSchemaConfig {
  action: SchemaTopic[];
  observation: SchemaTopic[];
}

interface VideoStreamMappingItem {
  grid: VideoGrid;
  role: VideoRole;
}

interface ConversionConfig {
  sourcePath: string;
  outputPath: string;
  fps: number;
  repoId: string;
  endEffector: EndEffectorMode;
  schemaConfig: LeRobotSchemaConfig;
  videoStreams: VideoStreamMappingItem[];
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
    schemaConfigPath?: string;
    videoStreamConfigPath?: string;
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

interface ExportLogsRequest {
  outputPath: string;
  logs: LogEvent[];
}

interface ExportLogsResult {
  ok: boolean;
  filePath?: string;
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
  exportLogs: (request: ExportLogsRequest) => Promise<ExportLogsResult>;
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
