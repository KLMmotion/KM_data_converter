import { Languages } from "lucide-react";

interface LanguageToggleProps {
  language: Language;
  onChange: (language: Language) => void;
  label: string;
}

export function LanguageToggle({ language, onChange, label }: LanguageToggleProps) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-sky-300/20 bg-white/[0.08] p-1 shadow-glow backdrop-blur">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300/12 text-sky-100" title={label}>
        <Languages size={16} />
      </div>
      {(["zh", "en"] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`h-8 rounded-full px-3 text-sm font-medium transition ${
            language === item ? "bg-sky-300 text-slate-950 shadow-glow" : "text-slate-300 hover:bg-white/10 hover:text-white"
          }`}
        >
          {item === "zh" ? "中文" : "English"}
        </button>
      ))}
    </div>
  );
}
