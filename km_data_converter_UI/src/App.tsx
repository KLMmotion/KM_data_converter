import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  Cpu,
  Database,
  FileJson,
  FolderOpen,
  Loader2,
  Play,
  Trash2,
  Video
} from "lucide-react";
import { ConversionPanel } from "./components/ConversionPanel";
import { LanguageToggle } from "./components/LanguageToggle";
import { LogConsole } from "./components/LogConsole";
import { PathSelector } from "./components/PathSelector";
import { SchemaSelector, buildLayoutRows, totalDims } from "./components/SchemaSelector";
import { TaskDescriptionInput } from "./components/TaskDescriptionInput";
import { VideoStreamMapping } from "./components/VideoStreamMapping";
import { createTranslator } from "./i18n";

const DEFAULT_REPO_ID = "rerun/droid_lerobot_full";
const STEP_PROGRESS = [14, 32, 56, 82, 94];
const DEFAULT_GRIPPER_SCHEMA_CONFIG: LeRobotSchemaConfig = {
  action: ["/control/joint_cmd_A", "/control/joint_cmd_B", "eef_left", "eef_right", "gripper_feedback_L", "gripper_feedback_R"],
  observation: ["/joint_states/position_L", "/joint_states/position_R", "eef_left", "eef_right", "gripper_feedback_L", "gripper_feedback_R"]
};
const DEFAULT_HAND_SCHEMA_CONFIG: LeRobotSchemaConfig = {
  action: ["/control/joint_cmd_A", "/control/joint_cmd_B", "eef_left", "eef_right", "/hand_left/joint_commands/position", "/hand_right/joint_commands/position"],
  observation: [
    "/joint_states/position_L",
    "/joint_states/position_R",
    "eef_left",
    "eef_right",
    "/hand_left/joint_states/position",
    "/hand_right/joint_states/position",
    "/hand_left/joint_states/effort",
    "/hand_right/joint_states/effort"
  ]
};
const DEFAULT_VIDEO_STREAMS: VideoStreamMappingItem[] = [
  { grid: "top_left", role: "left_eye" },
  { grid: "top_right", role: "left_wrist" },
  { grid: "bottom_left", role: "right_wrist" },
  { grid: "bottom_right", role: "right_eye" }
];
const UI_TEXT = {
  zh: {
    subtitle: "遥操作数据对齐与 LeRobot 导出工具",
    wizardSteps: ["输入路径", "视频流映射", "末端执行器与 LeRobot Schema", "开始转换", "Rerun 可视化"],
    inputTitle: "输入路径",
    inputDesc: "选择原始数据目录和输出目录，设置视频帧率与任务描述。",
    sourceDir: "原始数据目录",
    sourceHint: "包含 rosbag / mcap / video 等原始数据的目录",
    outputDir: "输出目录",
    outputHint: "生成的 LeRobot Dataset 输出目录",
    browseFolder: "选择文件夹",
    videoFps: "视频帧率 FPS",
    videoFpsHint: "设置输出视频的帧率",
    taskDescription: "任务描述（可选）",
    taskDescriptionHint: "用于写入 language_instruction 或任务描述，建议 500 字以内。",
    taskPlaceholder: "双臂操作数据采集",
    videoTitle: "视频流映射",
    videoDesc: "配置拼接后 2x2 视频的映射关系，选择每个位置对应的原始视频流。",
    videoRule: "角色映射不能重复；未选择的位置不会被导出，也不会写入最终数据集。",
    schemaTitle: "末端执行器与 LeRobot Schema",
    schemaDesc: "先选择末端执行器类型，再配置 LeRobot 的 Action / Observation 组成与顺序。",
    endEffector: "末端执行器",
    gripper: "夹爪",
    hand: "灵巧手",
    gripperHint: "使用 gripper_feedback 与 eef topics",
    handHint: "使用现有 /hand_* topics",
    startTitle: "开始转换",
    startDesc: "请在开始前检查以下配置，确认无误后启动数据转换流水线。",
    inputSummary: "输入路径",
    rawDataDir: "原始数据目录",
    outputSummary: "输出目录",
    fpsSummary: "视频帧率",
    taskSummary: "任务描述",
    videoSummary: "视频流映射",
    videoCountSuffix: "个视频流",
    schemaSummary: "LeRobot Schema",
    actionDim: "Action 维度",
    observationDim: "Observation 维度",
    configPreview: "配置预览",
    confirmed: "我已确认以上配置",
    clearSettings: "清除所有设置",
    previous: "上一步",
    nextVideo: "下一步：视频流映射",
    nextSchema: "下一步：末端执行器与 LeRobot Schema",
    nextStart: "下一步：开始转换",
    startConversion: "开始转换",
    nextRerun: "下一步：Rerun 可视化",
    done: "完成",
    conversionStatus: "转换状态",
    pause: "暂停",
    resume: "继续",
    stop: "停止转换",
    idle: "Idle / 空闲",
    running: "Running / 运行中",
    paused: "Paused / 已暂停",
    success: "Success / 成功",
    failed: "Failed / 失败",
    runtimeSteps: ["读取原始数据", "解析 rosbag / mcap / video", "时间戳对齐", "生成 LeRobot Dataset", "打开 Rerun 可视化"],
    logsTitle: "实时日志 Console",
    clear: "清空",
    export: "导出",
    logsEmpty: "日志将实时输出在这里...",
    exportLogsNoOutput: "请先选择输出目录，再导出日志。",
    exportLogsEmpty: "当前没有可导出的日志。",
    exportLogsSuccess: "日志已导出到",
    footerConfig: "提示：您可以随时点击顶部步骤切换，所有设置将保留在当前页面状态中。",
    footerRerun: "Rerun 可视化可使用转换输出目录、RRD、RBL 或 MCAP 文件。",
    loadingViewer: "启动 Viewer",
    rerunTitle: "Rerun 可视化",
    rerunHint: "mcap、rrd 或 LeRobot 数据可视化。",
    rerunBrowseFile: "选择文件",
    rerunBrowseDirectory: "选择文件夹",
    rerunStart: "启动 Viewer",
    rerunStop: "停止 Viewer",
    rerunOpenNative: "原生 Rerun",
    rerunInput: "Rerun 输入",
    rerunUrl: "数据源地址",
    rerunCommand: "服务命令",
    rerunLogs: "Viewer 日志",
    rerunIdle: "Viewer 空闲",
    rerunRunning: "Viewer 运行中",
    rerunPlaceholder: "选择或输入路径，每行一个：.mcap / .rrd / .rbl / LeRobot 目录。",
    rerunEmptyLogs: "Rerun 数据服务日志会显示在这里。",
    resetRunning: "转换运行中，无法清除设置。",
    resetConfirm: "确认清除所有设置？\n\n这将清空当前填写的路径、任务描述、视频流映射、LeRobot Schema 配置，并恢复默认配置。该操作不可撤销。",
    resetNotice: "已清除所有设置，并恢复默认配置。",
    selectSource: "请选择原始数据目录",
    selectOutput: "请选择输出目录",
    invalidFps: "视频帧率 FPS 必须大于 0",
    needVideo: "至少需要选择一个视频流",
    duplicateGrid: "视频流 grid 不能重复",
    duplicateRole: "视频流 role 不能重复",
    chooseEndEffector: "请选择末端执行器",
    emptyAction: "Action Schema 不能为空",
    emptyObservation: "Observation Schema 不能为空",
    needConfirm: "请先勾选“我已确认以上配置”"
  },
  en: {
    subtitle: "Teleoperation Data Alignment & LeRobot Export Tool",
    wizardSteps: ["Input Paths", "Video Mapping", "End Effector & LeRobot Schema", "Start Conversion", "Rerun Visualization"],
    inputTitle: "Input Paths",
    inputDesc: "Choose the raw data directory and output directory, then set video FPS and task description.",
    sourceDir: "Raw Data Directory",
    sourceHint: "Directory containing rosbag / mcap / video raw data",
    outputDir: "Output Directory",
    outputHint: "Directory for generated LeRobot Dataset output",
    browseFolder: "Choose Folder",
    videoFps: "Video FPS",
    videoFpsHint: "Set output video frame rate",
    taskDescription: "Task Description (optional)",
    taskDescriptionHint: "Used for language_instruction or task description, recommended within 500 characters.",
    taskPlaceholder: "dual-arm operation data collection",
    videoTitle: "Video Stream Mapping",
    videoDesc: "Configure the mapping for the stitched 2x2 video and choose which stream each position represents.",
    videoRule: "Roles cannot repeat. Unselected positions will not be exported or written to the final dataset.",
    schemaTitle: "End Effector & LeRobot Schema",
    schemaDesc: "Choose the end effector first, then configure Action / Observation composition and order.",
    endEffector: "End Effector",
    gripper: "Gripper",
    hand: "Dexterous Hand",
    gripperHint: "Use gripper_feedback and eef topics",
    handHint: "Use existing /hand_* topics",
    startTitle: "Start Conversion",
    startDesc: "Review the configuration before starting the data conversion pipeline.",
    inputSummary: "Input Paths",
    rawDataDir: "Raw Data Directory",
    outputSummary: "Output Directory",
    fpsSummary: "Video FPS",
    taskSummary: "Task Description",
    videoSummary: "Video Stream Mapping",
    videoCountSuffix: "video streams",
    schemaSummary: "LeRobot Schema",
    actionDim: "Action Dims",
    observationDim: "Observation Dims",
    configPreview: "Config Preview",
    confirmed: "I have confirmed the configuration above",
    clearSettings: "Clear All Settings",
    previous: "Previous",
    nextVideo: "Next: Video Mapping",
    nextSchema: "Next: End Effector & LeRobot Schema",
    nextStart: "Next: Start Conversion",
    startConversion: "Start Conversion",
    nextRerun: "Next: Rerun Visualization",
    done: "Done",
    conversionStatus: "Conversion Status",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop Conversion",
    idle: "Idle",
    running: "Running",
    paused: "Paused",
    success: "Success",
    failed: "Failed",
    runtimeSteps: ["Read raw data", "Parse rosbag / mcap / video", "Align timestamps", "Generate LeRobot Dataset", "Open Rerun visualization"],
    logsTitle: "Realtime Logs Console",
    clear: "Clear",
    export: "Export",
    logsEmpty: "Logs will appear here in realtime...",
    exportLogsNoOutput: "Choose an output directory before exporting logs.",
    exportLogsEmpty: "There are no logs to export.",
    exportLogsSuccess: "Logs exported to",
    footerConfig: "Tip: You can switch steps at the top anytime. Settings are kept in the current page state.",
    footerRerun: "Rerun visualization can use conversion output directories, RRD, RBL, or MCAP files.",
    loadingViewer: "Starting Viewer",
    rerunTitle: "Rerun Visualization",
    rerunHint: "Visualize MCAP, RRD, or LeRobot data.",
    rerunBrowseFile: "Select File",
    rerunBrowseDirectory: "Select Folder",
    rerunStart: "Start Viewer",
    rerunStop: "Stop Viewer",
    rerunOpenNative: "Native Rerun",
    rerunInput: "Rerun Input",
    rerunUrl: "Data Source URL",
    rerunCommand: "Service Command",
    rerunLogs: "Viewer Logs",
    rerunIdle: "Viewer Idle",
    rerunRunning: "Viewer Running",
    rerunPlaceholder: "Select or enter paths, one per line: .mcap / .rrd / .rbl / LeRobot directory.",
    rerunEmptyLogs: "Rerun data service logs will appear here.",
    resetRunning: "Conversion is running. Settings cannot be cleared.",
    resetConfirm: "Clear all settings?\n\nThis will clear paths, task description, video stream mapping, LeRobot Schema configuration, and restore defaults. This action cannot be undone.",
    resetNotice: "All settings have been cleared and defaults restored.",
    selectSource: "Please choose a raw data directory",
    selectOutput: "Please choose an output directory",
    invalidFps: "Video FPS must be greater than 0",
    needVideo: "Select at least one video stream",
    duplicateGrid: "Video stream grid cannot repeat",
    duplicateRole: "Video stream role cannot repeat",
    chooseEndEffector: "Please choose an end effector",
    emptyAction: "Action Schema cannot be empty",
    emptyObservation: "Observation Schema cannot be empty",
    needConfirm: "Please check “I have confirmed the configuration above” first"
  }
} as const;
const RerunViewer = lazy(() => import("./components/RerunViewer").then((module) => ({ default: module.RerunViewer })));

type WizardStep = 1 | 2 | 3 | 4 | 5;

function isElectronReady() {
  return typeof window !== "undefined" && Boolean(window.kernelMind);
}

function parseStepIndex(message: string) {
  if (message.includes("[4/4]")) return 3;
  if (message.includes("[3/4]")) return 2;
  if (message.includes("[2/4]")) return 1;
  if (message.includes("[1/4]")) return 0;
  return null;
}

function parseDatasetPath(message: string) {
  const outputMatch = message.match(/output=(.+?)(?:\r?\n|$)/);
  if (outputMatch?.[1]) return outputMatch[1].trim();
  const finalizedMatch = message.match(/at:\s*(.+?)(?:\r?\n|$)/);
  if (finalizedMatch?.[1]) return finalizedMatch[1].trim();
  return null;
}

function parseRerunPathInput(value: string) {
  return value
    .split(/\r?\n/)
    .map((pathValue) => pathValue.trim())
    .filter(Boolean);
}

function buildStepStates(status: ConversionStatus, activeStep: number, labels: string[]) {
  return labels.map((label, index) => {
    if (status === "success") return { label, state: "done" as const };
    if (status === "failed" && index === activeStep) return { label, state: "failed" as const };
    if (status === "running" && index === activeStep) return { label, state: "active" as const };
    if ((status === "running" || status === "failed") && index < activeStep) return { label, state: "done" as const };
    return { label, state: "pending" as const };
  });
}

function configPaths(outputPath: string) {
  const normalized = outputPath.trim();
  return {
    schema: normalized ? `${normalized}\\lerobot_schema.json` : "<output_dir>\\lerobot_schema.json",
    video: normalized ? `${normalized}\\video_stream_config.json` : "<output_dir>\\video_stream_config.json"
  };
}

function endEffectorLabel(mode: EndEffectorMode, labels: { gripper: string; hand: string }) {
  return mode === "hand" ? labels.hand : labels.gripper;
}

function Stepper({ currentStep, disabled, steps, onStepChange }: { currentStep: WizardStep; disabled: boolean; steps: readonly string[]; onStepChange: (step: WizardStep) => void }) {
  return (
    <nav className="rounded-3xl border border-white/10 bg-white/[0.08] px-6 py-5 shadow-panel backdrop-blur-xl">
      <div className="grid grid-cols-5 gap-3">
        {steps.map((label, index) => {
          const step = (index + 1) as WizardStep;
          const active = step === currentStep;
          const done = step < currentStep;
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onStepChange(step)}
              className={`relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-2 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? "border-blue-300/50 bg-blue-500/15 text-white shadow-glow"
                  : done
                    ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-50"
                    : "border-white/10 bg-slate-950/25 text-slate-400 hover:bg-white/[0.06]"
              }`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm ${active ? "border-blue-200 bg-blue-500" : "border-white/20 bg-slate-950/55"}`}>
                {done ? <Check size={16} /> : step}
              </span>
              <span className="text-xs font-semibold leading-5">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SectionHeader({ step, title, description, icon }: { step: number; title: string; description: string; icon: ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-glow">{step}</div>
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sky-300">{icon}</span>
          <h2 className="text-2xl font-bold text-white">{title}</h2>
        </div>
        <p className="text-sm leading-6 text-slate-400">{description}</p>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b border-white/10 py-2 text-sm last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-slate-200">{value}</span>
    </div>
  );
}

export default function App() {
  const [language, setLanguage] = useState<Language>("zh");
  const t = useMemo(() => createTranslator(language), [language]);
  const ui = UI_TEXT[language];
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [sourcePath, setSourcePath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [fps, setFps] = useState("30");
  const [repoId] = useState(DEFAULT_REPO_ID);
  const [endEffector, setEndEffector] = useState<EndEffectorMode>("gripper");
  const [schemaConfig, setSchemaConfig] = useState<LeRobotSchemaConfig>(DEFAULT_GRIPPER_SCHEMA_CONFIG);
  const [videoStreams, setVideoStreams] = useState<VideoStreamMappingItem[]>(DEFAULT_VIDEO_STREAMS);
  const [taskDescription, setTaskDescription] = useState("");
  const [strict] = useState(false);
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [conversionPaused, setConversionPaused] = useState(false);
  const [controllingConversion, setControllingConversion] = useState(false);
  const [sourceValidation, setSourceValidation] = useState<PathValidation | null>(null);
  const [outputValidation, setOutputValidation] = useState<PathValidation | null>(null);
  const [validatingSource, setValidatingSource] = useState(false);
  const [validatingOutput, setValidatingOutput] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [confirmedConfig, setConfirmedConfig] = useState(false);
  const [errorBanner, setErrorBanner] = useState("");
  const [noticeBanner, setNoticeBanner] = useState("");
  const [rerunPathInput, setRerunPathInput] = useState("");
  const [rerunStatus, setRerunStatus] = useState<RerunStatus | null>(null);
  const [rerunLogs, setRerunLogs] = useState<string[]>([]);
  const [startingRerun, setStartingRerun] = useState(false);
  const [stoppingRerun, setStoppingRerun] = useState(false);

  const electronReady = isElectronReady();
  const fpsValue = Number(fps);
  const fpsValid = Number.isFinite(fpsValue) && fpsValue > 0;
  const configLocked = status === "running";
  const progress = status === "success" ? 100 : status === "idle" ? 0 : STEP_PROGRESS[activeStep] ?? 8;
  const steps = buildStepStates(status, activeStep, [...ui.runtimeSteps]);
  const canStartConversion = electronReady && status !== "running" && confirmedConfig && validateAll(false);
  const canGoToRerunStep = status === "success";
  const paths = configPaths(outputPath);

  function handleEndEffectorChange(mode: EndEffectorMode) {
    setEndEffector(mode);
    setSchemaConfig(mode === "hand" ? DEFAULT_HAND_SCHEMA_CONFIG : DEFAULT_GRIPPER_SCHEMA_CONFIG);
  }

  function showError(message: string) {
    setErrorBanner(message);
    setNoticeBanner("");
    return false;
  }

  function validateStep1(show = true) {
    if (!sourcePath.trim()) return show ? showError(ui.selectSource) : false;
    if (!outputPath.trim()) return show ? showError(ui.selectOutput) : false;
    if (!fpsValid) return show ? showError(ui.invalidFps) : false;
    return true;
  }

  function validateStep2(show = true) {
    const grids = new Set(videoStreams.map((item) => item.grid));
    const roles = new Set(videoStreams.map((item) => item.role));
    if (videoStreams.length === 0) return show ? showError(ui.needVideo) : false;
    if (grids.size !== videoStreams.length) return show ? showError(ui.duplicateGrid) : false;
    if (roles.size !== videoStreams.length) return show ? showError(ui.duplicateRole) : false;
    return true;
  }

  function validateStep3(show = true) {
    if (!["gripper", "hand"].includes(endEffector)) return show ? showError(ui.chooseEndEffector) : false;
    if (schemaConfig.action.length === 0) return show ? showError(ui.emptyAction) : false;
    if (schemaConfig.observation.length === 0) return show ? showError(ui.emptyObservation) : false;
    return true;
  }

  function validateAll(show = true) {
    return validateStep1(show) && validateStep2(show) && validateStep3(show);
  }

  function goNext() {
    if (configLocked) return;
    const ok = currentStep === 1 ? validateStep1() : currentStep === 2 ? validateStep2() : currentStep === 3 ? validateStep3() : true;
    if (!ok) return;
    setErrorBanner("");
    setCurrentStep(Math.min(5, currentStep + 1) as WizardStep);
  }

  function goPrevious() {
    if (configLocked) return;
    setErrorBanner("");
    setCurrentStep(Math.max(1, currentStep - 1) as WizardStep);
  }

  function resetAllSettings() {
    if (configLocked) {
      showError(ui.resetRunning);
      return;
    }

    const confirmed = window.confirm(ui.resetConfirm);
    if (!confirmed) return;

    setSourcePath("");
    setOutputPath("");
    setFps("30");
    setEndEffector("gripper");
    setSchemaConfig(DEFAULT_GRIPPER_SCHEMA_CONFIG);
    setVideoStreams(DEFAULT_VIDEO_STREAMS);
    setTaskDescription("");
    setCurrentStep(1);
    setConfirmedConfig(false);
    setErrorBanner("");
    setNoticeBanner(ui.resetNotice);
    setSourceValidation(null);
    setOutputValidation(null);
    setValidatingSource(false);
    setValidatingOutput(false);
    setStatus("idle");
    setConversionPaused(false);
    setControllingConversion(false);
    setActiveStep(0);
    setRerunPathInput("");
    setRerunStatus(null);
    setRerunLogs([]);
    setLogs([]);
  }

  useEffect(() => {
    if (!electronReady || !sourcePath.trim()) {
      setSourceValidation(null);
      return;
    }
    setValidatingSource(true);
    const timeout = window.setTimeout(() => {
      window.kernelMind.validatePath(sourcePath, "source").then(setSourceValidation).finally(() => setValidatingSource(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [electronReady, sourcePath]);

  useEffect(() => {
    if (!electronReady || !outputPath.trim()) {
      setOutputValidation(null);
      return;
    }
    setValidatingOutput(true);
    const timeout = window.setTimeout(() => {
      window.kernelMind.validatePath(outputPath, "output").then(setOutputValidation).finally(() => setValidatingOutput(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [electronReady, outputPath]);

  useEffect(() => {
    if (!noticeBanner) return;
    const timeout = window.setTimeout(() => {
      setNoticeBanner("");
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [noticeBanner]);

  useEffect(() => {
    if (!errorBanner) return;
    const timeout = window.setTimeout(() => {
      setErrorBanner("");
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [errorBanner]);

  useEffect(() => {
    if (!electronReady) return;

    const removeLogListener = window.kernelMind.onConversionLog((event) => {
      setLogs((current) => [...current, event]);
      const stepIndex = parseStepIndex(event.message);
      if (stepIndex !== null) setActiveStep((current) => Math.max(current, stepIndex));
      const parsedDatasetPath = parseDatasetPath(event.message);
      if (parsedDatasetPath) setRerunPathInput(parsedDatasetPath);
    });

    const removeExitListener = window.kernelMind.onConversionExit((event) => {
      if (event.code === 0) {
        setStatus("success");
        setActiveStep(4);
      } else {
        setStatus("failed");
      }
      setConversionPaused(false);
      setControllingConversion(false);
    });

    return () => {
      removeLogListener();
      removeExitListener();
    };
  }, [electronReady]);

  useEffect(() => {
    if (!electronReady || currentStep !== 5) return;
    let mounted = true;
    const refreshStatus = () => {
      window.kernelMind.getRerunStatus().then((status) => {
        if (!mounted) return;
        setRerunStatus(status);
        setRerunLogs(status.logs ?? []);
        setRerunPathInput((current) => current || status.dataPath || "");
      });
    };
    refreshStatus();
    const interval = window.setInterval(refreshStatus, 2500);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [electronReady, currentStep]);

  async function browse(kind: DirectoryKind) {
    if (!electronReady || configLocked) return;
    const selected = await window.kernelMind.selectDirectory(kind);
    if (!selected) return;
    if (kind === "source") setSourcePath(selected);
    else if (kind === "output") setOutputPath(selected);
    else setRerunPathInput(selected);
  }

  async function browseRerunInput(kind: RerunSelectKind) {
    if (!electronReady) return;
    const selected = await window.kernelMind.selectRerunPath(kind);
    if (!selected || selected.length === 0) return;
    setRerunPathInput(selected.join("\n"));
  }

  function pushRerunLog(message: string) {
    setRerunLogs((current) => [...current, message].slice(-120));
  }

  async function startRerunViewer() {
    if (!electronReady) return;
    const paths = parseRerunPathInput(rerunPathInput);
    if (paths.length === 0) {
      pushRerunLog("Select an .rrd, .rbl, .mcap file, or a LeRobot dataset directory first.");
      return;
    }
    setStartingRerun(true);
    setRerunStatus((current) => ({ ...(current ?? { running: false, success: true }), success: true, running: false, error: undefined, message: "Starting Rerun data service..." }));
    setRerunLogs((current) => [...current, `Starting Rerun data service for: ${paths.join(", ")}`].slice(-120));
    try {
      const result = await window.kernelMind.startRerunViewer({ paths });
      setRerunStatus({ ...result, running: Boolean(result.running) });
      setRerunLogs(result.logs ?? []);
      if (!result.success) pushRerunLog(result.error ?? result.message ?? "Failed to start Rerun data service.");
    } catch (error) {
      pushRerunLog(error instanceof Error ? error.message : "Failed to start Rerun data service.");
    } finally {
      setStartingRerun(false);
    }
  }

  async function stopRerunViewer() {
    if (!electronReady) return;
    setStoppingRerun(true);
    try {
      const result = await window.kernelMind.stopRerunViewer();
      setRerunStatus({ ...result, running: false });
      setRerunLogs(result.logs ?? []);
      if (!result.success) pushRerunLog(result.error ?? result.message ?? "Failed to stop Rerun data service.");
    } catch (error) {
      pushRerunLog(error instanceof Error ? error.message : "Failed to stop Rerun data service.");
    } finally {
      setStoppingRerun(false);
    }
  }

  async function openNativeRerunViewer() {
    if (!electronReady) return;
    const paths = parseRerunPathInput(rerunPathInput);
    if (paths.length === 0) {
      pushRerunLog("Select an .rrd, .rbl, .mcap file, or a LeRobot dataset directory first.");
      return;
    }
    try {
      const result = await window.kernelMind.openRerun(paths.join("\n"));
      pushRerunLog(result.ok ? result.command ?? `rerun ${paths.join(" ")}` : result.message ?? "Failed to open native Rerun Viewer.");
    } catch (error) {
      pushRerunLog(error instanceof Error ? error.message : "Failed to open native Rerun Viewer.");
    }
  }

  async function startConversion() {
    if (!confirmedConfig) {
      showError(ui.needConfirm);
      return;
    }
    if (!validateAll()) return;
    if (!electronReady || status === "running") return;

    setStatus("running");
    setConversionPaused(false);
    setControllingConversion(false);
    setActiveStep(0);
    setLogs([]);
    setErrorBanner("");

    const result = await window.kernelMind.runConversion({
      sourcePath: sourcePath.trim(),
      outputPath: outputPath.trim(),
      fps: fpsValue,
      repoId,
      endEffector,
      schemaConfig,
      videoStreams,
      taskDescription: taskDescription.trim() || undefined,
      strict
    });

    if (!result.ok) {
      setStatus("failed");
      setConversionPaused(false);
      setControllingConversion(false);
      setLogs((current) => [
        ...current,
        {
          id: `${Date.now()}-start-error`,
          level: "stderr",
          message: `${result.message ?? "Failed to start conversion."}\n`,
          timestamp: new Date().toISOString()
        }
      ]);
      return;
    }

    if (result.paths?.lerobotOutputBase) setRerunPathInput(result.paths.lerobotOutputBase);
  }

  async function pauseConversion() {
    if (!electronReady || status !== "running" || conversionPaused || controllingConversion) return;
    setControllingConversion(true);
    try {
      const result = await window.kernelMind.pauseConversion();
      if (result.ok) setConversionPaused(Boolean(result.paused));
    } finally {
      setControllingConversion(false);
    }
  }

  async function resumeConversion() {
    if (!electronReady || status !== "running" || !conversionPaused || controllingConversion) return;
    setControllingConversion(true);
    try {
      const result = await window.kernelMind.resumeConversion();
      if (result.ok) setConversionPaused(Boolean(result.paused));
    } finally {
      setControllingConversion(false);
    }
  }

  async function stopConversion() {
    if (!electronReady || status !== "running" || controllingConversion) return;
    setControllingConversion(true);
    const result = await window.kernelMind.stopConversion();
    if (result.ok) setConversionPaused(false);
    else setControllingConversion(false);
  }

  async function exportConversionLogs() {
    if (!outputPath.trim()) {
      showError(ui.exportLogsNoOutput);
      return;
    }
    if (logs.length === 0) {
      showError(ui.exportLogsEmpty);
      return;
    }

    const result = await window.kernelMind.exportLogs({ outputPath: outputPath.trim(), logs });
    if (!result.ok) {
      showError(result.message ?? ui.exportLogsEmpty);
      return;
    }
    setNoticeBanner(`${ui.exportLogsSuccess}: ${result.filePath}`);
    setErrorBanner("");
  }

  const rerunViewerPanel = (
    <RerunViewer
      labels={{
        title: ui.rerunTitle,
        hint: ui.rerunHint,
        browseFile: ui.rerunBrowseFile,
        browseDirectory: ui.rerunBrowseDirectory,
        start: ui.rerunStart,
        stop: ui.rerunStop,
        openNative: ui.rerunOpenNative,
        input: ui.rerunInput,
        url: ui.rerunUrl,
        command: ui.rerunCommand,
        logs: ui.rerunLogs,
        idle: ui.rerunIdle,
        running: ui.rerunRunning,
        placeholder: ui.rerunPlaceholder,
        emptyLogs: ui.rerunEmptyLogs
      }}
      pathInput={rerunPathInput}
      status={rerunStatus}
      logs={rerunLogs}
      isStarting={startingRerun}
      isStopping={stoppingRerun}
      onPathChange={setRerunPathInput}
      onBrowseFile={() => browseRerunInput("file")}
      onBrowseDirectory={() => browseRerunInput("directory")}
      onStart={startRerunViewer}
      onStop={stopRerunViewer}
      onOpenNative={openNativeRerunViewer}
    />
  );

  function renderInputStep() {
    return (
      <>
        <SectionHeader step={1} title={ui.inputTitle} description={ui.inputDesc} icon={<FolderOpen size={22} />} />
        <div className="space-y-4">
          <PathSelector
            title={ui.sourceDir}
            hint={ui.sourceHint}
            value={sourcePath}
            placeholder="D:\\data\\my_bag"
            browseLabel={ui.browseFolder}
            disabled={configLocked}
            validation={sourceValidation}
            isValidating={validatingSource}
            onChange={setSourcePath}
            onBrowse={() => browse("source")}
          />
          <PathSelector
            title={ui.outputDir}
            hint={ui.outputHint}
            value={outputPath}
            placeholder="D:\\output\\lerobot_dataset"
            browseLabel={ui.browseFolder}
            disabled={configLocked}
            validation={outputValidation}
            isValidating={validatingOutput}
            onChange={setOutputPath}
            onBrowse={() => browse("output")}
          />
          <label className="block rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <span className="mb-1 block text-sm font-semibold text-white">{ui.videoFps}</span>
            <span className="mb-3 block text-xs text-slate-500">{ui.videoFpsHint}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={fps}
              disabled={configLocked}
              onChange={(event) => setFps(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-300/70 focus:ring-4 focus:ring-sky-400/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <TaskDescriptionInput title={ui.taskDescription} hint={ui.taskDescriptionHint} value={taskDescription} placeholder={ui.taskPlaceholder} disabled={configLocked} onChange={(value) => setTaskDescription(value.slice(0, 500))} />
        </div>
      </>
    );
  }

  function renderVideoStep() {
    return (
      <>
        <SectionHeader step={2} title={ui.videoTitle} description={ui.videoDesc} icon={<Video size={22} />} />
        <VideoStreamMapping language={language} value={videoStreams} disabled={configLocked} onChange={setVideoStreams} />
        <div className="mt-5 rounded-2xl border border-sky-300/15 bg-sky-300/10 p-4 text-sm leading-6 text-slate-300">
          {ui.videoRule}
        </div>
      </>
    );
  }

  function renderSchemaStep() {
    return (
      <>
        <SectionHeader step={3} title={ui.schemaTitle} description={ui.schemaDesc} icon={<Database size={22} />} />
        <section className="mb-5 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <h3 className="mb-3 text-base font-semibold text-white">{ui.endEffector}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["gripper", "hand"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={configLocked}
                onClick={() => handleEndEffectorChange(mode)}
                className={`min-h-20 rounded-2xl border px-5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  endEffector === mode ? "border-blue-300/50 bg-blue-500/16 text-white shadow-glow" : "border-white/10 bg-slate-950/35 text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                <span className="block text-base font-semibold">{mode === "gripper" ? ui.gripper : ui.hand}</span>
                <span className="mt-1 block text-xs text-slate-400">{mode === "gripper" ? ui.gripperHint : ui.handHint}</span>
              </button>
            ))}
          </div>
        </section>
        <SchemaSelector language={language} endEffector={endEffector} value={schemaConfig} disabled={configLocked} onChange={setSchemaConfig} />
      </>
    );
  }

  function renderStartStep() {
    const actionRows = buildLayoutRows(schemaConfig.action);
    const observationRows = buildLayoutRows(schemaConfig.observation);
    return (
      <>
        <SectionHeader step={4} title={ui.startTitle} description={ui.startDesc} icon={<Play size={22} />} />
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white"><FolderOpen size={17} className="text-sky-300" />{ui.inputSummary}</h3>
            <SummaryRow label={ui.rawDataDir} value={sourcePath || "-"} />
            <SummaryRow label={ui.outputSummary} value={outputPath || "-"} />
            <SummaryRow label={ui.fpsSummary} value={`${fpsValue || 0} FPS`} />
            <SummaryRow label={ui.taskSummary} value={taskDescription || "-"} />
          </section>
          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white"><Video size={17} className="text-sky-300" />{ui.videoSummary} ({videoStreams.length} {ui.videoCountSuffix})</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {videoStreams.map((item) => (
                <div key={`${item.grid}-${item.role}`} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-3">
                  <span className="block font-mono text-sm text-white">{item.role}</span>
                  <span className="mt-1 block font-mono text-xs text-sky-300">{item.grid}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white"><Database size={17} className="text-sky-300" />LeRobot Schema</h3>
            <SummaryRow label={ui.actionDim} value={`${totalDims(schemaConfig.action)} dims`} />
            <SummaryRow label={ui.observationDim} value={`${totalDims(schemaConfig.observation)} dims`} />
            <SummaryRow label={ui.endEffector} value={endEffectorLabel(endEffector, ui)} />
            <div className="mt-3 flex flex-wrap gap-2">
              {[...schemaConfig.action, ...schemaConfig.observation].slice(0, 12).map((topic, index) => (
                <span key={`${topic}-${index}`} className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 font-mono text-[11px] text-emerald-100">{topic}</span>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white"><FileJson size={17} className="text-sky-300" />{ui.configPreview}</h3>
            <SummaryRow label="Schema JSON" value={<span className="font-mono text-xs">{paths.schema}</span>} />
            <SummaryRow label="Video JSON" value={<span className="font-mono text-xs">{paths.video}</span>} />
            <pre className="mt-4 max-h-44 overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono text-xs leading-5 text-slate-300">
{`action_dim: ${totalDims(schemaConfig.action)}
observation_dim: ${totalDims(schemaConfig.observation)}
end_effector: ${endEffector}
action:
${actionRows.map((row) => `  ${row.range}  ${row.topic}`).join("\n")}
observation:
${observationRows.map((row) => `  ${row.range}  ${row.topic}`).join("\n")}`}
            </pre>
          </section>
        </div>
        <label className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm font-semibold text-white">
          <input type="checkbox" checked={confirmedConfig} disabled={configLocked} onChange={(event) => setConfirmedConfig(event.target.checked)} className="h-5 w-5 accent-blue-500" />
          {ui.confirmed}
        </label>
        {status === "success" && (
          <button
            type="button"
            onClick={() => setCurrentStep(5)}
            className="hidden"
          >
            {ui.nextRerun}
            <ArrowRight size={16} />
          </button>
        )}
      </>
    );
  }

  function renderStepContent() {
    if (currentStep === 1) return renderInputStep();
    if (currentStep === 2) return renderVideoStep();
    if (currentStep === 3) return renderSchemaStep();
    if (currentStep === 4) return renderStartStep();
    return (
      <Suspense
        fallback={
          <section className="flex min-h-64 items-center justify-center rounded-3xl border border-cyan-200/15 bg-slate-950/70 text-sm text-slate-400 shadow-panel backdrop-blur-xl">
            <Loader2 size={24} className="mr-3 animate-spin text-cyan-200" />
            {ui.loadingViewer}
          </section>
        }
      >
        {rerunViewerPanel}
      </Suspense>
    );
  }

  const navLabel = currentStep === 1 ? ui.nextVideo : currentStep === 2 ? ui.nextSchema : currentStep === 3 ? ui.nextStart : currentStep === 4 ? ui.startConversion : ui.done;

  return (
    <main className="min-h-screen overflow-hidden bg-[#06101f] text-slate-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(56,189,248,0.18),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(45,212,191,0.12),transparent_30%),linear-gradient(135deg,#07172f_0%,#07111f_42%,#0b1d35_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-5 px-5 py-5 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-200 to-cyan-300 text-slate-950 shadow-glow">
              <Cpu size={27} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-normal text-white">{t("brand")}</h1>
              <p className="mt-1 text-sm text-slate-300">{ui.subtitle}</p>
            </div>
          </div>
          <LanguageToggle language={language} onChange={setLanguage} label={t("language")} />
        </header>

        <Stepper currentStep={currentStep} disabled={configLocked} steps={ui.wizardSteps} onStepChange={(step) => setCurrentStep(step)} />

        {!electronReady && <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-5 py-4 text-sm text-amber-100">{t("electronMissing")}</div>}
        {errorBanner && (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-300/25 bg-rose-300/10 px-5 py-4 text-sm text-rose-100">
            <AlertCircle size={18} />
            {errorBanner}
          </div>
        )}
        {noticeBanner && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-5 py-4 text-sm text-emerald-100">
            <CheckCircle2 size={18} />
            {noticeBanner}
          </div>
        )}

        <div className={currentStep === 5 ? "min-h-0 flex-1" : "grid min-h-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_430px]"}>
          <section
            className={
              currentStep === 5
                ? "self-start overflow-visible rounded-3xl border border-white/10 bg-white/[0.08] p-6 shadow-panel backdrop-blur-xl"
                : "flex min-h-[calc(100vh-220px)] flex-col self-start overflow-hidden rounded-3xl border border-white/10 bg-white/[0.08] p-6 shadow-panel backdrop-blur-xl"
            }
          >
            <div className={currentStep === 5 ? "" : "flex-1 pr-1"}>
              {renderStepContent()}
            </div>
            {currentStep < 5 && (
              <div className={`mt-6 grid gap-3 border-t border-white/10 pt-5 ${currentStep === 4 ? "md:grid-cols-[1fr_1.4fr_1.4fr]" : "md:grid-cols-[1fr_2fr]"}`}>
                <button
                  type="button"
                  disabled={configLocked}
                  title={configLocked ? ui.resetRunning : undefined}
                  onClick={currentStep === 1 ? resetAllSettings : goPrevious}
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    currentStep === 1
                      ? "border border-red-400/60 bg-red-500/12 text-red-300 hover:bg-red-500/25"
                      : "border border-white/10 bg-slate-950/45 text-slate-200 hover:bg-white/[0.08]"
                  }`}
                >
                  {currentStep === 1 ? <Trash2 size={16} /> : <ArrowLeft size={16} />}
                  {currentStep === 1 ? ui.clearSettings : `${ui.previous}: ${ui.wizardSteps[currentStep - 2]}`}
                </button>
                <button
                  type="button"
                  disabled={configLocked || (currentStep === 4 && !confirmedConfig)}
                  onClick={currentStep === 4 ? startConversion : goNext}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 text-sm font-bold text-white shadow-glow transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {currentStep === 4 ? <Play size={16} /> : null}
                  {navLabel}
                  {currentStep < 4 ? <ArrowRight size={16} /> : null}
                </button>
                {currentStep === 4 && (
                  <button
                    type="button"
                    disabled={!canGoToRerunStep}
                    onClick={() => setCurrentStep(5)}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 text-sm font-bold text-emerald-100 transition hover:border-emerald-200/55 hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-950/45 disabled:text-slate-500"
                  >
                    {ui.nextRerun}
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            )}
          </section>

          {currentStep < 5 && (
            <aside className="sticky top-5 flex h-[calc(100vh-220px)] min-h-0 flex-col gap-5 self-start overflow-hidden">
              <ConversionPanel
                status={status}
                canStart={currentStep === 4 && canStartConversion}
                isPaused={conversionPaused}
                isControlling={controllingConversion}
                progress={progress}
                steps={steps}
                labels={{
                  title: ui.conversionStatus,
                  start: ui.startConversion,
                  pause: ui.pause,
                  resume: ui.resume,
                  stop: ui.stop,
                  idle: ui.idle,
                  running: ui.running,
                  paused: ui.paused,
                  success: ui.success,
                  failed: ui.failed
                }}
                onStart={startConversion}
                onPause={pauseConversion}
                onResume={resumeConversion}
                onStop={stopConversion}
              />
              <LogConsole className="min-h-0 flex-1" title={ui.logsTitle} clearLabel={ui.clear} copyLabel={ui.export} emptyLabel={ui.logsEmpty} logs={logs} onClear={() => setLogs([])} onExport={exportConversionLogs} />
            </aside>
          )}
        </div>

        <div className="rounded-2xl border border-sky-300/15 bg-sky-300/10 px-5 py-3 text-sm text-slate-400">
          <Activity size={16} className="mr-2 inline text-sky-300" />
          {currentStep === 5 ? ui.footerRerun : ui.footerConfig}
        </div>
      </div>
    </main>
  );
}
