import { Activity, Check, Circle, Loader2, Play, X } from "lucide-react";

interface StepItem {
  label: string;
  state: "pending" | "active" | "done" | "failed";
}

interface ConversionPanelProps {
  status: ConversionStatus;
  canStart: boolean;
  progress: number;
  steps: StepItem[];
  labels: {
    title: string;
    start: string;
    idle: string;
    running: string;
    success: string;
    failed: string;
    command: string;
  };
  commandPreview?: string;
  onStart: () => void;
}

const statusClasses: Record<ConversionStatus, string> = {
  idle: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  running: "border-sky-300/30 bg-sky-300/12 text-sky-100",
  success: "border-emerald-300/30 bg-emerald-300/12 text-emerald-100",
  failed: "border-rose-300/30 bg-rose-300/12 text-rose-100"
};

function statusLabel(status: ConversionStatus, labels: ConversionPanelProps["labels"]) {
  if (status === "running") return labels.running;
  if (status === "success") return labels.success;
  if (status === "failed") return labels.failed;
  return labels.idle;
}

function StepIcon({ state }: { state: StepItem["state"] }) {
  if (state === "done") return <Check size={15} />;
  if (state === "active") return <Loader2 size={15} className="animate-spin" />;
  if (state === "failed") return <X size={15} />;
  return <Circle size={13} />;
}

export function ConversionPanel({ status, canStart, progress, steps, labels, commandPreview, onStart }: ConversionPanelProps) {
  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.08] p-6 shadow-panel backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/80">{labels.title}</p>
          <div className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${statusClasses[status]}`}>
            <Activity size={15} className={status === "running" ? "animate-pulse" : ""} />
            {statusLabel(status, labels)}
          </div>
        </div>
        <button
          type="button"
          disabled={!canStart || status === "running"}
          onClick={onStart}
          className="group inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-sky-300 to-cyan-200 px-7 text-base font-bold text-slate-950 shadow-glow transition hover:scale-[1.01] hover:from-sky-200 hover:to-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
        >
          {status === "running" ? <Loader2 size={19} className="animate-spin" /> : <Play size={19} fill="currentColor" />}
          {labels.start}
        </button>
      </div>

      <div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-950/70 ring-1 ring-white/10">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              status === "failed" ? "bg-rose-400" : "bg-gradient-to-r from-sky-300 via-cyan-200 to-emerald-200"
            }`}
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
        <div className="mt-2 text-right font-mono text-xs text-slate-400">{Math.round(progress)}%</div>
      </div>

      <div className="grid gap-3">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
              step.state === "active"
                ? "border-sky-300/40 bg-sky-300/12 text-white"
                : step.state === "done"
                  ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-50"
                  : step.state === "failed"
                    ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
                    : "border-white/[0.08] bg-slate-950/35 text-slate-400"
            }`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] font-mono text-xs">{index + 1}</div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/45">
              <StepIcon state={step.state} />
            </div>
            <span className="text-sm font-medium">{step.label}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{labels.command}</p>
        <p className="mt-3 break-all font-mono text-xs leading-6 text-slate-300">{commandPreview || "python -m km_data_converter run-full ..."}</p>
      </div>
    </section>
  );
}
