import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

interface RulesTableProps {
  title: string;
  hint: string;
  rules: QualityRuleRecord[];
  language: Language;
  disabled?: boolean;
  labels: {
    addRule: string;
    remove: string;
    enabled: string;
    ruleName: string;
    ruleNameHint: string;
    scope: string;
    metric: string;
    metricHint: string;
    operator: string;
    threshold: string;
    severity: string;
    topicPattern: string;
    invalidThreshold: string;
  };
  onChange: (rules: QualityRuleRecord[]) => void;
}

const BASE_OPERATORS = [">", ">=", "<", "<=", "==", "!="];
const BASE_SEVERITIES = ["error", "warning"];
const BASE_SCOPES = ["file", "bag", "topic", "video", "alignment"];

const METRIC_DESCRIPTIONS: Record<string, Record<Language, string>> = {
  recording_dir_exists: {
    zh: "录制目录是否存在。",
    en: "Whether the recording directory exists."
  },
  metadata_yaml_exists: {
    zh: "ROS bag metadata.yaml 是否存在。",
    en: "Whether ROS bag metadata.yaml exists."
  },
  metadata_yaml_size_bytes: {
    zh: "metadata.yaml 文件大小，单位为字节。",
    en: "Size of metadata.yaml in bytes."
  },
  ros_data_file_exists: {
    zh: "MCAP/DB3 原始 ROS 数据文件是否存在。",
    en: "Whether raw ROS MCAP/DB3 data files exist."
  },
  ros_data_file_size_bytes: {
    zh: "MCAP/DB3 原始 ROS 数据文件总大小，单位为字节。",
    en: "Total size of raw ROS MCAP/DB3 data files in bytes."
  },
  cameras_mp4_exists: {
    zh: "拼接相机视频 cameras.mp4 是否存在。",
    en: "Whether tiled camera video cameras.mp4 exists."
  },
  cameras_mp4_size_bytes: {
    zh: "cameras.mp4 文件大小，单位为字节。",
    en: "Size of cameras.mp4 in bytes."
  },
  recording_duration_sec: {
    zh: "录制时长，单位为秒。",
    en: "Recording duration in seconds."
  },
  timestamp_regression_count: {
    zh: "时间戳倒退次数，用于发现时间顺序异常。",
    en: "Number of timestamp regressions, used to detect time ordering issues."
  },
  reference_frequency_hz: {
    zh: "参考 topic 的消息频率，单位 Hz。",
    en: "Message frequency of the reference topic in Hz."
  },
  frame_interval_p99_ms: {
    zh: "参考时间间隔的 99 分位值，单位毫秒。",
    en: "99th percentile of reference frame/message interval in milliseconds."
  },
  dropped_frame_count: {
    zh: "疑似丢帧或异常长间隔的数量。",
    en: "Count of suspected dropped frames or unusually long intervals."
  },
  message_count_total: {
    zh: "ROS bag 中读取到的消息总数。",
    en: "Total number of messages read from the ROS bag."
  },
  topic_exists: {
    zh: "目标 topic 是否存在并有消息。",
    en: "Whether the target topic exists and has messages."
  },
  frequency_hz: {
    zh: "目标 topic 的消息频率，单位 Hz。",
    en: "Message frequency of the target topic in Hz."
  },
  max_interval_ms: {
    zh: "目标 topic 相邻消息的最大间隔，单位毫秒。",
    en: "Maximum interval between adjacent messages on the target topic in milliseconds."
  },
  message_count: {
    zh: "目标 topic 的消息数量。",
    en: "Number of messages on the target topic."
  },
  opened: {
    zh: "视频文件是否能被 OpenCV 成功打开。",
    en: "Whether the video file can be opened by OpenCV."
  },
  fps: {
    zh: "视频帧率，单位 FPS。",
    en: "Video frame rate in FPS."
  },
  duration_sec: {
    zh: "视频时长，单位为秒。",
    en: "Video duration in seconds."
  },
  frame_count: {
    zh: "视频总帧数。",
    en: "Total number of video frames."
  },
  blur_score: {
    zh: "视频清晰度评分，数值越低通常越模糊。",
    en: "Video sharpness score; lower values usually mean blurrier video."
  },
  exposure_abnormal_ratio: {
    zh: "曝光异常帧比例，过暗或过亮都会计入。",
    en: "Ratio of frames with abnormal exposure, including too dark or too bright frames."
  },
  is_black_screen: {
    zh: "相机视角是否疑似黑屏。",
    en: "Whether the camera view appears to be a black screen."
  },
  overlap_ratio: {
    zh: "视频时间段和 ROS bag 时间段的重叠比例。",
    en: "Overlap ratio between video time span and ROS bag time span."
  },
  duration_diff_abs_sec: {
    zh: "视频时长和 ROS bag 时长的绝对差值，单位为秒。",
    en: "Absolute duration difference between video and ROS bag in seconds."
  },
  sync_error_p99_ms: {
    zh: "同步误差的 99 分位值，单位毫秒。",
    en: "99th percentile synchronization error in milliseconds."
  },
  sync_error_max_ms: {
    zh: "最大同步误差，单位毫秒。",
    en: "Maximum synchronization error in milliseconds."
  }
};

function ruleName(rule: QualityRuleRecord) {
  return String(rule.name ?? rule.rule_name ?? "");
}

function ruleMetric(rule: QualityRuleRecord) {
  return String(rule.metric ?? rule.check_item ?? "");
}

function parseThreshold(value: string): ScalarValue {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  return value;
}

function optionsWithExisting(base: string[], values: unknown[]) {
  return base;
}

function formatThreshold(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function operatorText(operator: unknown, language: Language) {
  const value = String(operator ?? "");
  const zh: Record<string, string> = {
    "==": "等于",
    "!=": "不等于",
    ">=": "大于等于",
    ">": "大于",
    "<=": "小于等于",
    "<": "小于"
  };
  const en: Record<string, string> = {
    "==": "equals",
    "!=": "does not equal",
    ">=": "is at least",
    ">": "is greater than",
    "<=": "is at most",
    "<": "is less than"
  };
  return (language === "zh" ? zh[value] : en[value]) ?? value;
}

function scopeText(scope: unknown, topicPattern: unknown, language: Language) {
  const scopeValue = String(scope ?? "");
  const pattern = String(topicPattern ?? "").trim();
  if (pattern) {
    return language === "zh" ? `匹配 ${pattern} 的目标` : `targets matching ${pattern}`;
  }
  const zh: Record<string, string> = {
    file: "文件完整性",
    bag: "ROS bag 整体",
    topic: "topic",
    video: "视频",
    alignment: "视频与 ROS bag 对齐"
  };
  const en: Record<string, string> = {
    file: "file integrity",
    bag: "overall ROS bag",
    topic: "topic",
    video: "video",
    alignment: "video and ROS bag alignment"
  };
  return (language === "zh" ? zh[scopeValue] : en[scopeValue]) ?? scopeValue;
}

function metricDescription(metric: string, language: Language) {
  return (
    METRIC_DESCRIPTIONS[metric]?.[language] ??
    (language === "zh"
      ? `quality_check 计算出的 ${metric} 指标。`
      : `${metric} metric produced by quality_check.`)
  );
}

function ruleDescription(rule: QualityRuleRecord, language: Language) {
  const metric = ruleMetric(rule);
  const threshold = formatThreshold(rule.threshold);
  const target = scopeText(rule.scope, rule.topic_pattern, language);
  const comparison = operatorText(rule.operator, language);
  const metricText = metricDescription(metric, language).replace(/[。.]$/, "");

  if (!threshold) {
    return language === "zh"
      ? `检查${target}的${metricText}。`
      : `Checks ${metricText.toLowerCase()} for ${target}.`;
  }

  return language === "zh"
    ? `检查${target}的${metricText}，要求 ${metric} ${comparison} ${threshold}。`
    : `Checks ${metricText.toLowerCase()} for ${target}; expects ${metric} ${comparison} ${threshold}.`;
}

export function RulesTable({ title, hint, rules, language, disabled, labels, onChange }: RulesTableProps) {
  const operatorOptions = optionsWithExisting(BASE_OPERATORS, rules.map((rule) => rule.operator));
  const severityOptions = optionsWithExisting(BASE_SEVERITIES, rules.map((rule) => rule.severity));
  const scopeOptions = optionsWithExisting(BASE_SCOPES, rules.map((rule) => rule.scope));

  function updateRule(index: number, patch: Partial<QualityRuleRecord>) {
    onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  function addRule() {
    onChange([
      ...rules,
      {
        name: `custom_rule_${rules.length + 1}`,
        scope: "bag",
        metric: "message_count_total",
        operator: ">=",
        threshold: 1,
        severity: "warning",
        enabled: true
      }
    ]);
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  }

  return (
    <section className="flex h-[520px] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07] shadow-panel">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={addRule}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} />
          {labels.addRule}
        </button>
      </div>

      <div className="console-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="sticky top-0 z-10 grid grid-cols-[48px_minmax(170px,1.35fr)_112px_minmax(160px,1.15fr)_96px_minmax(120px,0.75fr)_120px_minmax(130px,0.9fr)_64px] bg-slate-950 text-left text-xs text-slate-300">
          <HeadCell>{labels.enabled}</HeadCell>
          <HeadCell>{labels.ruleName}</HeadCell>
          <HeadCell>{labels.scope}</HeadCell>
          <HeadCell>{labels.metric}</HeadCell>
          <HeadCell>{labels.operator}</HeadCell>
          <HeadCell>{labels.threshold}</HeadCell>
          <HeadCell>{labels.severity}</HeadCell>
          <HeadCell>{labels.topicPattern}</HeadCell>
          <HeadCell>{labels.remove}</HeadCell>
        </div>

        <div className="text-xs">
          {rules.map((rule, index) => {
            const thresholdText = rule.threshold === null || rule.threshold === undefined ? "" : String(rule.threshold);
            const thresholdInvalid = thresholdText.trim() === "";
            return (
              <div
                key={`${index}-${ruleName(rule)}`}
                className="grid grid-cols-[48px_minmax(170px,1.35fr)_112px_minmax(160px,1.15fr)_96px_minmax(120px,0.75fr)_120px_minmax(130px,0.9fr)_64px] border-b border-white/10 odd:bg-white/[0.03] even:bg-slate-950/20"
              >
                <BodyCell compact>
                  <input
                    type="checkbox"
                    checked={rule.enabled !== false}
                    disabled={disabled}
                    onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-cyan-300"
                  />
                </BodyCell>
                <BodyCell>
                  <TextInput disabled={disabled} value={ruleName(rule)} helper={ruleDescription(rule, language)} onChange={(value) => updateRule(index, { name: value })} />
                </BodyCell>
                <BodyCell>
                  <SelectInput disabled={disabled} value={String(rule.scope ?? "")} options={scopeOptions} onChange={(value) => updateRule(index, { scope: value })} />
                </BodyCell>
                <BodyCell>
                  <TextInput disabled={disabled} value={ruleMetric(rule)} helper={metricDescription(ruleMetric(rule), language)} onChange={(value) => updateRule(index, { metric: value })} />
                </BodyCell>
                <BodyCell>
                  <SelectInput disabled={disabled} value={String(rule.operator ?? "")} options={operatorOptions} onChange={(value) => updateRule(index, { operator: value })} />
                </BodyCell>
                <BodyCell>
                  <input
                    value={thresholdText}
                    disabled={disabled}
                    title={thresholdInvalid ? labels.invalidThreshold : ""}
                    onChange={(event) => updateRule(index, { threshold: parseThreshold(event.target.value) })}
                    className={`w-full min-w-0 truncate rounded-lg border bg-slate-950/70 px-2.5 py-2 font-mono text-xs text-slate-100 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                      thresholdInvalid ? "border-rose-300/60 focus:border-rose-300 focus:ring-rose-400/10" : "border-white/10 focus:border-cyan-300/70 focus:ring-cyan-400/10"
                    }`}
                  />
                </BodyCell>
                <BodyCell>
                  <SelectInput disabled={disabled} value={String(rule.severity ?? "error")} options={severityOptions} onChange={(value) => updateRule(index, { severity: value })} />
                </BodyCell>
                <BodyCell>
                  <TextInput disabled={disabled} value={String(rule.topic_pattern ?? "")} onChange={(value) => updateRule(index, { topic_pattern: value || undefined })} />
                </BodyCell>
                <BodyCell compact>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeRule(index)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:border-rose-300/35 hover:bg-rose-300/10 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                    title={labels.remove}
                  >
                    <Trash2 size={14} />
                  </button>
                </BodyCell>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HeadCell({ children }: { children: string }) {
  return <div className="min-w-0 border-b border-white/10 px-3 py-3 font-semibold">{children}</div>;
}

function BodyCell({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <div className={`min-w-0 px-3 py-2 align-top ${compact ? "text-center" : ""}`}>{children}</div>;
}

function TextInput({ value, helper, disabled, onChange }: { value: string; helper?: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <input
        value={value}
        disabled={disabled}
        title={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 truncate rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 font-mono text-xs text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {helper && <p className="line-clamp-2 whitespace-normal text-[10px] leading-4 text-slate-500">{helper}</p>}
    </div>
  );
}

function SelectInput({ value, options, disabled, onChange }: { value: string; options: string[]; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-2.5 py-2 font-mono text-xs text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
