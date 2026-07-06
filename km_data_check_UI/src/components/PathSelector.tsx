import { CheckCircle2, FolderOpen, Loader2, TriangleAlert } from "lucide-react";

interface PathSelectorProps {
  title: string;
  hint: string;
  value: string;
  placeholder: string;
  browseLabel: string;
  validatingLabel: string;
  disabled?: boolean;
  validation?: QualityInputValidation | null;
  validating?: boolean;
  onChange: (value: string) => void;
  onBrowse: () => void;
}

export function PathSelector({
  title,
  hint,
  value,
  placeholder,
  browseLabel,
  validatingLabel,
  disabled,
  validation,
  validating,
  onChange,
  onBrowse
}: PathSelectorProps) {
  const hasValidation = Boolean(validation);

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
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onBrowse}
          className="inline-flex min-w-28 items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/70 hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FolderOpen size={16} />
          {browseLabel}
        </button>
      </div>
      <div className="flex min-h-5 items-center gap-2 text-xs">
        {validating ? (
          <>
            <Loader2 size={14} className="animate-spin text-cyan-300" />
            <span className="text-slate-400">{validatingLabel}</span>
          </>
        ) : validation?.ok ? (
          <>
            <CheckCircle2 size={14} className="text-emerald-300" />
            <span className="truncate text-emerald-200" title={validation.message}>
              {validation.message}
            </span>
          </>
        ) : hasValidation ? (
          <>
            <TriangleAlert size={14} className="text-amber-300" />
            <span className="truncate text-amber-200" title={validation?.message}>
              {validation?.message}
            </span>
          </>
        ) : (
          <span className="text-slate-500"> </span>
        )}
      </div>
    </section>
  );
}
