import { Plus, Trash2 } from "lucide-react";

interface TopicsEditorProps {
  title: string;
  hint: string;
  addLabel: string;
  removeLabel: string;
  placeholder: string;
  topics: string[];
  disabled?: boolean;
  onChange: (topics: string[]) => void;
}

export function TopicsEditor({ title, hint, addLabel, removeLabel, placeholder, topics, disabled, onChange }: TopicsEditorProps) {
  function updateTopic(index: number, value: string) {
    onChange(topics.map((topic, topicIndex) => (topicIndex === index ? value : topic)));
  }

  function addTopic() {
    onChange([...topics, ""]);
  }

  function removeTopic(index: number) {
    onChange(topics.filter((_, topicIndex) => topicIndex !== index));
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={addTopic}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} />
          {addLabel}
        </button>
      </div>

      <div className="console-scroll mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {topics.map((topic, index) => (
          <div key={`${index}-${topic}`} className="flex gap-2">
            <input
              value={topic}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(event) => updateTopic(index, event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeTopic(index)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:border-rose-300/35 hover:bg-rose-300/10 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
              title={removeLabel}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
