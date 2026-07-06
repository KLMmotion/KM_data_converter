import { Activity, Check, FolderOpen, Loader2, Play, X } from "lucide-react";

interface StatusPanelProps {
  status: QualityStatus;
  canRun: boolean;
  reportDir: string;
  summary: QualitySummary | null;
  labels: {
    status: string;
    idle: string;
    running: string;
    success: string;
    failed: string;
    run: string;
    summary: string;
    waitingSummary: string;
    recordings: string;
    passed: string;
    warnings: string;
    errors: string;
    reportPath: string;
    openReport: string;
  };
  onRun: () => void;
  onOpenReport: () => void;
}

const statusClasses: Record<QualityStatus, string> = {
  idle: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  running: "border-cyan-300/30 bg-cyan-300/12 text-cyan-100",
  success: "border-emerald-300/30 bg-emerald-300/12 text-emerald-100",
  failed: "border-rose-300/30 bg-rose-300/12 text-rose-100"
};

function statusText(status: QualityStatus, labels: StatusPanelProps["labels"]) {
  if (status === "running") return labels.running;
  if (status === "success") return labels.success;
  if (status === "failed") return labels.failed;
  return labels.idle;
}

export function StatusPanel({ status, canRun, reportDir, summary, labels, onRun, onOpenReport }: StatusPanelProps) {
  const statusCounts = summary?.status_counts;

  return (
    <section className="flex h-[360px] min-h-[300px] flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/80">{labels.status}</p>
          <div className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${statusClasses[status]}`}>
            {status === "running" ? <Loader2 size={15} className="animate-spin" /> : status === "success" ? <Check size={15} /> : status === "failed" ? <X size={15} /> : <Activity size={15} />}
            {statusText(status, labels)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canRun}
            onClick={onRun}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-emerald-200 px-5 text-sm font-bold text-slate-950 shadow-glow transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
          >
            {status === "running" ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} fill="currentColor" />}
            {labels.run}
          </button>
          <button
            type="button"
            disabled={!reportDir}
            onClick={onOpenReport}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FolderOpen size={16} />
            {labels.openReport}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={labels.recordings} value={summary?.recording_count ?? "-"} />
        <Metric label={labels.passed} value={statusCounts?.passed ?? "-"} />
        <Metric label={labels.warnings} value={statusCounts?.warning ?? "-"} />
        <Metric label={labels.errors} value={statusCounts?.failed ?? "-"} />
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{labels.summary}</p>
        <p className="mt-3 break-all font-mono text-xs leading-6 text-slate-300">
          {summary ? `${labels.reportPath}: ${reportDir}` : labels.waitingSummary}
        </p>
      </div>

    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/45 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-white">{value}</p>
    </div>
  );
}
