import { Activity, Check, Circle, Loader2, Pause, Play, Square, X } from "lucide-react";

interface StepItem {
  label: string;
  state: "pending" | "active" | "done" | "failed";
}

interface ConversionPanelProps {
  status: ConversionStatus;
  canStart: boolean;
  isPaused: boolean;
  isControlling: boolean;
  progress: number;
  steps: StepItem[];
  labels: {
    title: string;
    start: string;
    pause: string;
    resume: string;
    stop: string;
    idle: string;
    running: string;
    paused: string;
    success: string;
    failed: string;
  };
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const statusClasses: Record<ConversionStatus, string> = {
  idle: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  running: "border-sky-300/30 bg-sky-300/12 text-sky-100",
  success: "border-emerald-300/30 bg-emerald-300/12 text-emerald-100",
  failed: "border-rose-300/30 bg-rose-300/12 text-rose-100"
};

function statusLabel(status: ConversionStatus, labels: ConversionPanelProps["labels"], isPaused: boolean) {
  if (isPaused) return labels.paused;
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

export function ConversionPanel({ status, canStart, isPaused, isControlling, progress, steps, labels, onStart, onPause, onResume, onStop }: ConversionPanelProps) {
  const isRunning = status === "running";

  return (
    <section className="flex h-full flex-col space-y-6 rounded-3xl border border-white/10 bg-white/[0.08] p-6 shadow-panel backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/80">{labels.title}</p>
          <div className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${statusClasses[status]}`}>
            <Activity size={15} className={isRunning && !isPaused ? "animate-pulse" : ""} />
            {statusLabel(status, labels, isPaused)}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          {!isRunning ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={onStart}
              className="group inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-sky-300 to-cyan-200 px-7 text-base font-bold text-slate-950 shadow-glow transition hover:scale-[1.01] hover:from-sky-200 hover:to-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
            >
              <Play size={19} fill="currentColor" />
              {labels.start}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={isControlling}
                onClick={isPaused ? onResume : onPause}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-200/30 bg-cyan-200/10 px-5 text-sm font-bold text-cyan-50 transition hover:border-cyan-100/60 hover:bg-cyan-200/18 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isControlling ? <Loader2 size={17} className="animate-spin" /> : isPaused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
                {isPaused ? labels.resume : labels.pause}
              </button>
              <button
                type="button"
                disabled={isControlling}
                onClick={onStop}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-300/35 bg-rose-400/10 px-5 text-sm font-bold text-rose-100 transition hover:border-rose-200/65 hover:bg-rose-400/18 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Square size={16} fill="currentColor" />
                {labels.stop}
              </button>
            </>
          )}
        </div>
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
    </section>
  );
}
