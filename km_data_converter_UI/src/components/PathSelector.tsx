import { CheckCircle2, FolderOpen, Loader2, TriangleAlert } from "lucide-react";

interface PathSelectorProps {
  title: string;
  hint: string;
  value: string;
  placeholder: string;
  browseLabel: string;
  disabled?: boolean;
  validation?: PathValidation | null;
  isValidating?: boolean;
  onChange: (value: string) => void;
  onBrowse: () => void;
}

export function PathSelector({
  title,
  hint,
  value,
  placeholder,
  browseLabel,
  disabled,
  validation,
  isValidating,
  onChange,
  onBrowse
}: PathSelectorProps) {
  const isGood = validation?.isDirectory && (validation.hasBagDirs ?? true);
  const hasWarning = validation && !isGood;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/55 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-300/70 focus:ring-4 focus:ring-sky-400/10 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onBrowse}
          className="inline-flex min-w-32 items-center justify-center gap-2 rounded-xl border border-sky-300/30 bg-sky-300/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:border-sky-200/70 hover:bg-sky-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FolderOpen size={16} />
          {browseLabel}
        </button>
      </div>
      <div className="flex min-h-5 items-center gap-2 text-xs">
        {isValidating ? (
          <>
            <Loader2 size={14} className="animate-spin text-sky-300" />
            <span className="text-slate-400">Validating...</span>
          </>
        ) : isGood ? (
          <>
            <CheckCircle2 size={14} className="text-emerald-300" />
            <span className="text-emerald-200">{validation?.message}</span>
          </>
        ) : hasWarning ? (
          <>
            <TriangleAlert size={14} className="text-amber-300" />
            <span className="text-amber-200">{validation?.message}</span>
          </>
        ) : (
          <span className="text-slate-500"> </span>
        )}
      </div>
    </section>
  );
}
