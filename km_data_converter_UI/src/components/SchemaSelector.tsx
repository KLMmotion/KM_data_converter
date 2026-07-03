import { Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export const GRIPPER_TOPICS: SchemaTopic[] = [
  "/joint_states/effort_L",
  "/joint_states/effort_R",
  "/joint_states/position_L",
  "/joint_states/position_R",
  "/joint_states/velocity_L",
  "/joint_states/velocity_R",
  "/control/joint_cmd_A",
  "/control/joint_cmd_B",
  "eef_left",
  "eef_right",
  "gripper_feedback_L",
  "gripper_feedback_R"
];

export const HAND_TOPICS: SchemaTopic[] = [
  ...GRIPPER_TOPICS,
  "/hand_left/joint_commands/position",
  "/hand_right/joint_commands/position",
  "/hand_left/joint_states/position",
  "/hand_right/joint_states/position",
  "/hand_left/joint_states/effort",
  "/hand_right/joint_states/effort"
];

export const TOPIC_DIMS: Record<SchemaTopic, number> = {
  "/joint_states/effort_L": 7,
  "/joint_states/effort_R": 7,
  "/joint_states/position_L": 7,
  "/joint_states/position_R": 7,
  "/joint_states/velocity_L": 7,
  "/joint_states/velocity_R": 7,
  "/control/joint_cmd_A": 7,
  "/control/joint_cmd_B": 7,
  eef_left: 7,
  eef_right: 7,
  gripper_feedback_L: 1,
  gripper_feedback_R: 1,
  "/hand_left/joint_commands/position": 20,
  "/hand_right/joint_commands/position": 20,
  "/hand_left/joint_states/position": 20,
  "/hand_right/joint_states/position": 20,
  "/hand_left/joint_states/effort": 20,
  "/hand_right/joint_states/effort": 20
};

type SchemaTarget = "action" | "observation";

const LABELS = {
  zh: {
    topics: "topics",
    dims: "dims",
    dim: "dim",
    emptySelected: "未选择 topic。",
    layoutPreview: "Layout 预览",
    emptyLayout: "暂无 layout 条目。",
    availableTopics: "可用 Topics",
    availableHint: "点击 topic 会添加到当前目标末尾，再次点击会从当前目标移除。",
    addTo: "添加到"
  },
  en: {
    topics: "topics",
    dims: "dims",
    dim: "dim",
    emptySelected: "No topics selected.",
    layoutPreview: "Layout Preview",
    emptyLayout: "No layout entries.",
    availableTopics: "Available Topics",
    availableHint: "Click a topic to append it to the current target. Click again to remove it from that target.",
    addTo: "Add to"
  }
} as const;

interface SchemaSelectorProps {
  language: Language;
  endEffector: EndEffectorMode;
  value: LeRobotSchemaConfig;
  disabled: boolean;
  onChange: (value: LeRobotSchemaConfig) => void;
}

export function getTopicDim(topic: SchemaTopic) {
  return TOPIC_DIMS[topic] ?? 0;
}

export function totalDims(selected: SchemaTopic[]) {
  return selected.reduce((sum, topic) => sum + getTopicDim(topic), 0);
}

export function buildLayoutRows(selected: SchemaTopic[]) {
  let cursor = 0;
  return selected.map((topic) => {
    const dim = getTopicDim(topic);
    const start = cursor;
    const end = cursor + dim - 1;
    cursor += dim;
    return { topic, dim, start, end, range: dim === 1 ? `${start}` : `${start}-${end}` };
  });
}

function removeTopic(topics: SchemaTopic[], topic: SchemaTopic) {
  return topics.filter((item) => item !== topic);
}

function toggleTopic(topics: SchemaTopic[], topic: SchemaTopic) {
  if (topics.includes(topic)) {
    return removeTopic(topics, topic);
  }
  return [...topics, topic];
}

function SelectedTopicsCard({
  title,
  topics,
  disabled,
  labels,
  onChange
}: {
  title: string;
  topics: SchemaTopic[];
  disabled: boolean;
  labels: (typeof LABELS)[Language];
  onChange: (topics: SchemaTopic[]) => void;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <span className="font-mono text-xs text-cyan-100">
          {topics.length} {labels.topics} / {totalDims(topics)} {labels.dims}
        </span>
      </div>
      <div className="space-y-2">
        {topics.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-500">{labels.emptySelected}</p>
        ) : (
          topics.map((topic, index) => (
            <div key={`${title}-${topic}`} className="grid grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_4rem_2rem] items-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-xs">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 font-mono text-white">{index + 1}</span>
              <GripVertical size={14} className="text-slate-600" />
              <span className="min-w-0 break-all font-mono text-slate-100">{topic}</span>
              <span className="text-right font-mono text-slate-500">{getTopicDim(topic)} {labels.dim}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(removeTopic(topics, topic))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition hover:border-rose-300/50 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function LayoutPreview({ title, topics, labels }: { title: string; topics: SchemaTopic[]; labels: (typeof LABELS)[Language] }) {
  const rows = buildLayoutRows(topics);

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title} {labels.layoutPreview}</h3>
        <span className="font-mono text-xs text-cyan-100">{totalDims(topics)} {labels.dims}</span>
      </div>
      <div className="space-y-1.5">
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500">{labels.emptyLayout}</p>
        ) : (
          rows.map((row) => (
            <div key={`${title}-${row.topic}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem] items-center gap-3 text-xs">
              <span className="font-mono text-sky-300">{row.range}</span>
              <span className="min-w-0 break-all font-mono text-slate-200">{row.topic}</span>
              <span className="text-right font-mono text-slate-500">{row.dim} {labels.dim}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function SchemaSelector({ language, endEffector, value, disabled, onChange }: SchemaSelectorProps) {
  const [target, setTarget] = useSchemaTarget();
  const topics = endEffector === "hand" ? HAND_TOPICS : GRIPPER_TOPICS;
  const selectedForTarget = value[target];
  const labels = LABELS[language];

  function updateTarget(nextTopics: SchemaTopic[]) {
    onChange({ ...value, [target]: nextTopics });
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <SelectedTopicsCard title="Action" topics={value.action} disabled={disabled} labels={labels} onChange={(topics) => onChange({ ...value, action: topics })} />
        <SelectedTopicsCard title="Observation" topics={value.observation} disabled={disabled} labels={labels} onChange={(topics) => onChange({ ...value, observation: topics })} />
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">{labels.availableTopics}</h3>
            <p className="mt-1 text-sm text-slate-400">{labels.availableHint}</p>
          </div>
          <div className="inline-grid grid-cols-2 rounded-xl border border-white/10 bg-slate-950/55 p-1">
            {(["action", "observation"] as const).map((item) => (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => setTarget(item)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  target === item ? "bg-blue-500 text-white shadow-glow" : "text-slate-400 hover:text-white"
                }`}
              >
                {labels.addTo}: {item === "action" ? "Action" : "Observation"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => {
            const selected = selectedForTarget.includes(topic);
            return (
              <button
                key={`${target}-${topic}`}
                type="button"
                disabled={disabled}
                onClick={() => updateTarget(toggleTopic(selectedForTarget, topic))}
                className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-50" : "border-white/10 bg-slate-950/45 text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-slate-950/60">
                  {selected ? <Check size={13} /> : <Plus size={13} />}
                </span>
                <span className="min-w-0 flex-1 break-all font-mono">{topic}</span>
                <span className="shrink-0 font-mono text-slate-500">{getTopicDim(topic)} {labels.dim}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <LayoutPreview title="Action" topics={value.action} labels={labels} />
        <LayoutPreview title="Observation" topics={value.observation} labels={labels} />
      </div>
    </section>
  );
}

function useSchemaTarget(): [SchemaTarget, (target: SchemaTarget) => void] {
  return useState<SchemaTarget>("action");
}
