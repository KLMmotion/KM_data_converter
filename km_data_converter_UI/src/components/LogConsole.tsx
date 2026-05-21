import { Copy, Terminal, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

interface LogConsoleProps {
  title: string;
  clearLabel: string;
  copyLabel: string;
  emptyLabel: string;
  logs: LogEvent[];
  onClear: () => void;
}

export function LogConsole({ title, clearLabel, copyLabel, emptyLabel, logs, onClear }: LogConsoleProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs]);

  const copyLogs = async () => {
    await navigator.clipboard.writeText(logs.map((log) => `[${log.level}] ${log.message}`).join(""));
  };

  return (
    <section className="flex h-[calc(100vh-168px)] min-h-[520px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/85 shadow-panel ring-1 ring-cyan-300/10">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/12 text-emerald-200">
            <Terminal size={17} />
          </div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyLogs}
            disabled={logs.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Copy size={14} />
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={logs.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
            {clearLabel}
          </button>
        </div>
      </div>
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto p-5 font-mono text-xs leading-6">
        {logs.length === 0 ? (
          <div className="flex h-full min-h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 text-slate-500">{emptyLabel}</div>
        ) : (
          logs.map((log) => (
            <pre
              key={log.id}
              className={`whitespace-pre-wrap break-words ${
                log.level === "stderr" ? "text-rose-200" : log.level === "system" ? "text-cyan-200" : "text-slate-300"
              }`}
            >
              {log.message}
            </pre>
          ))
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
