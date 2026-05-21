import { FileText } from "lucide-react";

interface TaskDescriptionInputProps {
  title: string;
  hint: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function TaskDescriptionInput({ title, hint, value, placeholder, disabled, onChange }: TaskDescriptionInputProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300/12 text-cyan-200">
          <FileText size={17} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
        </div>
      </div>
      <textarea
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </section>
  );
}
