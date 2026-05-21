import { Box, ExternalLink, FolderOpen, Loader2 } from "lucide-react";

interface RerunViewerProps {
  title: string;
  hint: string;
  openLabel: string;
  commandLabel: string;
  browseLabel: string;
  idleLabel: string;
  launchedLabel: string;
  datasetLabel: string;
  datasetPath?: string;
  datasetPlaceholder?: string;
  command?: string;
  canOpen: boolean;
  isOpening: boolean;
  launched: boolean;
  onPathChange: (path: string) => void;
  onBrowse: () => void;
  onOpen: () => void;
}

export function RerunViewer({
  title,
  hint,
  openLabel,
  commandLabel,
  browseLabel,
  idleLabel,
  launchedLabel,
  datasetLabel,
  datasetPath,
  datasetPlaceholder,
  command,
  canOpen,
  isOpening,
  launched,
  onPathChange,
  onBrowse,
  onOpen
}: RerunViewerProps) {
  return (
    <section className="rounded-3xl border border-cyan-200/15 bg-gradient-to-br from-white/10 via-sky-300/[0.08] to-slate-950/80 p-6 shadow-panel backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/14 text-cyan-100 shadow-glow">
            <Box size={21} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">{hint}</p>
          </div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${launched ? "bg-emerald-300/15 text-emerald-100" : "bg-slate-300/10 text-slate-300"}`}>
          {launched ? launchedLabel : idleLabel}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{datasetLabel}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={datasetPath ?? ""}
                placeholder={datasetPlaceholder ?? "C:\\path\\to\\lerobot_datasets-yy-MM-dd-HH-mm-ss"}
                onChange={(event) => onPathChange(event.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-400/10"
              />
              <button
                type="button"
                onClick={onBrowse}
                className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-cyan-200/25 bg-cyan-200/10 px-3 py-2.5 text-xs font-semibold text-cyan-50 transition hover:border-cyan-100/55 hover:bg-cyan-200/18"
              >
                <FolderOpen size={14} />
                {browseLabel}
              </button>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{commandLabel}</p>
            <p className="mt-3 max-w-full overflow-hidden break-all font-mono text-xs leading-6 text-cyan-100">{command || "rerun .\\lerobot_datasets-yy-MM-dd-HH-mm-ss\\"}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={!canOpen || isOpening}
          onClick={onOpen}
          className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-cyan-200/30 bg-cyan-200/12 px-6 text-sm font-bold text-cyan-50 transition hover:border-cyan-100/60 hover:bg-cyan-200/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isOpening ? <Loader2 size={18} className="animate-spin" /> : <ExternalLink size={18} />}
          {openLabel}
        </button>
      </div>
    </section>
  );
}
