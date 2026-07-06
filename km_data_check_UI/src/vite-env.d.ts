/// <reference types="vite/client" />

type Language = "zh" | "en";
type QualityStatus = "idle" | "running" | "success" | "failed";
type LogLevel = "stdout" | "stderr" | "system";
type RuleSource = "default" | "custom";
type ScalarValue = string | number | boolean | null;

interface QualityRuleRecord {
  [key: string]: unknown;
  name?: string;
  rule_name?: string;
  scope?: string;
  metric?: string;
  check_item?: string;
  operator?: string;
  threshold?: ScalarValue;
  severity?: string;
  topic_pattern?: string;
  enabled?: boolean;
}

interface RulesLoadResult {
  path: string;
  rules: QualityRuleRecord[];
  requiredTopics: string[];
}

interface SaveRulesPayload {
  path: string;
  rules: QualityRuleRecord[];
}

interface SaveRulesResult {
  path: string;
}

interface QualityInputValidation {
  ok: boolean;
  exists: boolean;
  isDirectory: boolean;
  hasBagDirs?: boolean;
  resolvedPath: string;
  message?: string;
}

interface QualityRunConfig {
  inputPath: string;
  outputPath: string;
  requiredTopics: string[];
  rulesPath?: string;
  replaceRules?: boolean;
}

interface QualityRunStarted {
  ok: boolean;
  message?: string;
  command?: string;
  reportDir?: string;
}

interface QualityExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface LogEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

interface QualitySummaryRecording {
  recording_name: string;
  overall_status: string;
  report_dir: string;
  error_count: number;
  warning_count: number;
}

interface QualitySummary {
  recording_count: number;
  status_counts: {
    passed: number;
    warning: number;
    failed: number;
  };
  recordings: QualitySummaryRecording[];
  output_path: string;
}

interface QualitySummaryEvent {
  reportDir: string;
  summary: QualitySummary;
}

interface OpenFolderResult {
  ok: boolean;
  message?: string;
}

interface KernelMindQualityApi {
  selectInputPath: () => Promise<string | null>;
  selectOutputDirectory: () => Promise<string | null>;
  selectRulesFile: () => Promise<string | null>;
  saveRulesFileDialog: (defaultPath: string) => Promise<string | null>;
  validateQualityInput: (targetPath: string) => Promise<QualityInputValidation>;
  loadDefaultRules: () => Promise<RulesLoadResult>;
  loadRulesFile: (rulesPath: string) => Promise<RulesLoadResult>;
  saveRulesFile: (payload: SaveRulesPayload) => Promise<SaveRulesResult>;
  runQualityCheck: (config: QualityRunConfig) => Promise<QualityRunStarted>;
  openReportFolder: (folderPath: string) => Promise<OpenFolderResult>;
  onQualityLog: (callback: (event: LogEvent) => void) => () => void;
  onQualityExit: (callback: (event: QualityExit) => void) => () => void;
  onQualitySummary: (callback: (event: QualitySummaryEvent) => void) => () => void;
}

interface Window {
  kernelMindQuality: KernelMindQualityApi;
}
