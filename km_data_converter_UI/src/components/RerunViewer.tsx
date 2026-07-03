import { Box, FolderOpen, Loader2, Play, Power, Square } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, type ComponentType } from "react";

type RerunWebViewerProps = {
  rrd: string;
  width?: string;
  height?: string;
  theme?: "dark" | "light" | "system";
  render_backend?: "webgl" | "webgpu";
  hide_welcome_screen?: boolean;
};

const RerunWebViewer = lazy(async () => {
  const module = await import("@rerun-io/web-viewer-react");
  return {
    default: module.default as unknown as ComponentType<RerunWebViewerProps>
  };
});

interface RerunViewerLabels {
  title: string;
  hint: string;
  browseFile: string;
  browseDirectory: string;
  start: string;
  stop: string;
  openNative: string;
  input: string;
  url: string;
  command: string;
  logs: string;
  idle: string;
  running: string;
  placeholder: string;
  emptyLogs: string;
}

interface RerunViewerProps {
  labels: RerunViewerLabels;
  pathInput: string;
  status: RerunStatus | null;
  logs: string[];
  isStarting: boolean;
  isStopping: boolean;
  onPathChange: (path: string) => void;
  onBrowseFile: () => void;
  onBrowseDirectory: () => void;
  onStart: () => void;
  onStop: () => void;
  onOpenNative: () => void;
}

export function RerunViewer({ labels, pathInput, status, logs, isStarting, isStopping, onPathChange, onBrowseFile, onBrowseDirectory, onStart, onStop, onOpenNative }: RerunViewerProps) {
  const running = Boolean(status?.running);
  const dataSourceUrl = status?.url ?? "";
  const error = status?.error;
  const canStart = Boolean(pathInput.trim()) && !isStarting && !isStopping;
  const viewerRegionRef = useRef<HTMLDivElement | null>(null);
  const savedScrollRef = useRef({ x: 0, y: 0 });
  const protectScrollUntilRef = useRef(0);

  const armScrollProtection = useCallback(() => {
    savedScrollRef.current = {
      x: window.scrollX,
      y: window.scrollY
    };
    protectScrollUntilRef.current = Date.now() + 450;
  }, []);

  useEffect(() => {
    let restoring = false;

    const restoreOuterScroll = () => {
      if (restoring || Date.now() > protectScrollUntilRef.current) {
        return;
      }

      const { x, y } = savedScrollRef.current;
      const jumpedUp = window.scrollY < y - 24;
      if (!jumpedUp) {
        return;
      }

      restoring = true;
      window.scrollTo(x, y);
      window.requestAnimationFrame(() => {
        restoring = false;
      });
    };

    window.addEventListener("scroll", restoreOuterScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", restoreOuterScroll, { capture: true });
  }, []);

  return (
    <section className="overflow-hidden rounded-3xl border border-cyan-200/15 bg-slate-950/70 shadow-panel backdrop-blur-xl [overflow-anchor:none]">
      <div className="border-b border-white/10 bg-white/[0.08] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/14 text-cyan-100 shadow-glow">
            <Box size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">{labels.title}</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{labels.hint}</p>
              </div>
              <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${running ? "bg-emerald-300/15 text-emerald-100" : "bg-slate-300/10 text-slate-300"}`}>
                {running ? <Power size={13} /> : <Square size={12} />}
                {running ? labels.running : labels.idle}
              </div>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto_auto_auto_auto_auto]">
              <input
                value={pathInput}
                placeholder={labels.placeholder}
                onChange={(event) => onPathChange(event.target.value)}
                className="min-h-11 min-w-0 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-400/10"
              />
              <button
                type="button"
                onClick={onBrowseFile}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-cyan-200/25 bg-cyan-200/10 px-4 py-2.5 text-xs font-semibold text-cyan-50 transition hover:border-cyan-100/55 hover:bg-cyan-200/18"
              >
                <FolderOpen size={14} />
                {labels.browseFile}
              </button>
              <button
                type="button"
                onClick={onBrowseDirectory}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-cyan-200/25 bg-cyan-200/10 px-4 py-2.5 text-xs font-semibold text-cyan-50 transition hover:border-cyan-100/55 hover:bg-cyan-200/18"
              >
                <FolderOpen size={14} />
                {labels.browseDirectory}
              </button>
              <button
                type="button"
                disabled={!canStart}
                onClick={onStart}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-emerald-200/25 bg-emerald-200/10 px-4 py-2.5 text-xs font-semibold text-emerald-50 transition hover:border-emerald-100/55 hover:bg-emerald-200/18 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {labels.start}
              </button>
              <button
                type="button"
                disabled={!running || isStopping}
                onClick={onStop}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-rose-200/25 bg-rose-200/10 px-4 py-2.5 text-xs font-semibold text-rose-50 transition hover:border-rose-100/55 hover:bg-rose-200/18 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isStopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                {labels.stop}
              </button>
              <button
                type="button"
                disabled={!canStart}
                onClick={onOpenNative}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/15 bg-white/[0.08] px-4 py-2.5 text-xs font-semibold text-slate-100 transition hover:border-white/35 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Box size={14} />
                {labels.openNative}
              </button>
            </div>
            <div className="mt-3 grid gap-3 text-xs xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <p className="min-h-5 truncate font-mono text-cyan-100" title={dataSourceUrl || "rerun+http://localhost:9876/proxy"}>
                <span className="font-sans font-semibold uppercase tracking-[0.16em] text-slate-500">{labels.url}: </span>
                {dataSourceUrl || "rerun+http://localhost:9876/proxy"}
              </p>
              <p className="min-h-5 truncate font-mono text-slate-300" title={status?.command || "rerun --serve-grpc --port 9876 ..."}>
                <span className="font-sans font-semibold uppercase tracking-[0.16em] text-slate-500">{labels.command}: </span>
                {status?.command || "rerun --serve-grpc --port 9876 ..."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={viewerRegionRef}
        className="min-h-[720px] bg-black [overflow-anchor:none]"
        onMouseEnter={armScrollProtection}
        onMouseMove={armScrollProtection}
        onPointerDownCapture={armScrollProtection}
        onFocusCapture={armScrollProtection}
      >
        {dataSourceUrl ? (
          <div className="h-[min(78vh,900px)] min-h-[720px] w-full">
            <Suspense
              fallback={
                <div className="flex h-full min-h-[720px] flex-col items-center justify-center gap-4 px-6 text-center text-sm text-slate-500">
                  <Loader2 size={28} className="animate-spin text-cyan-200" />
                  <p className="max-w-3xl break-words text-slate-500">{labels.start}</p>
                </div>
              }
            >
              <RerunWebViewer key={dataSourceUrl} rrd={dataSourceUrl} width="100%" height="100%" theme="dark" render_backend="webgl" hide_welcome_screen />
            </Suspense>
          </div>
        ) : (
          <div className="flex h-[min(78vh,900px)] min-h-[720px] flex-col items-center justify-center gap-4 px-6 text-center text-sm text-slate-500">
            {isStarting && <Loader2 size={28} className="animate-spin text-cyan-200" />}
            <p className={error ? "max-w-3xl break-words text-rose-200" : "max-w-3xl break-words text-slate-500"}>
              {isStarting ? labels.start : error || labels.placeholder}
            </p>
          </div>
        )}
      </div>

      <details className="border-t border-white/10 bg-slate-950/80 px-5 py-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{labels.logs}</summary>
        <div className="pt-3">
          <pre className="console-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950/80 p-3 font-mono text-xs leading-5 text-slate-300">
            {logs.length > 0 ? logs.join("\n") : labels.emptyLogs}
          </pre>
        </div>
      </details>
    </section>
  );
}
