import { CheckCircle2, Grid3X3, Video } from "lucide-react";

const LABELS = {
  zh: {
    gridLabels: {
      top_left: "左上角",
      top_right: "右上角",
      bottom_left: "左下角",
      bottom_right: "右下角"
    },
    layout: "2x2 映射布局",
    none: "None / 不使用",
    summary: "映射摘要",
    selectedPrefix: "已选择",
    selectedSuffix: "个视频流",
    empty: "至少需要选择一个视频流。"
  },
  en: {
    gridLabels: {
      top_left: "Top left",
      top_right: "Top right",
      bottom_left: "Bottom left",
      bottom_right: "Bottom right"
    },
    layout: "2x2 Mapping Layout",
    none: "None / Not used",
    summary: "Mapping Summary",
    selectedPrefix: "Selected",
    selectedSuffix: "video streams",
    empty: "Select at least one video stream."
  }
} as const;

const GRIDS: VideoGrid[] = ["top_left", "top_right", "bottom_left", "bottom_right"];
const ROLES: VideoRole[] = ["left_eye", "right_eye", "left_wrist", "right_wrist"];

interface VideoStreamMappingProps {
  language: Language;
  value: VideoStreamMappingItem[];
  disabled: boolean;
  onChange: (value: VideoStreamMappingItem[]) => void;
}

function roleForGrid(value: VideoStreamMappingItem[], grid: VideoGrid) {
  return value.find((item) => item.grid === grid)?.role ?? "";
}

function updateMapping(value: VideoStreamMappingItem[], grid: VideoGrid, role: VideoRole | "") {
  const withoutGridOrRole = value.filter((item) => item.grid !== grid && item.role !== role);
  if (!role) {
    return withoutGridOrRole;
  }
  return [...withoutGridOrRole, { grid, role }].sort((left, right) => GRIDS.indexOf(left.grid) - GRIDS.indexOf(right.grid));
}

export function VideoStreamMapping({ language, value, disabled, onChange }: VideoStreamMappingProps) {
  const labels = LABELS[language];

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-5">
        <div className="mb-4 flex items-center gap-3">
          <Grid3X3 size={18} className="text-sky-300" />
          <h3 className="text-base font-semibold text-white">{labels.layout}</h3>
        </div>
        <div className="grid overflow-hidden rounded-2xl border border-white/10 sm:grid-cols-2">
          {GRIDS.map((grid, index) => {
            const selectedRole = roleForGrid(value, grid);
            return (
              <label key={grid} className="min-h-40 border-white/10 bg-slate-950/35 p-5 sm:border-r sm:border-t odd:border-r even:border-r-0 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
                <span className="mb-2 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-sky-300">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-white">{index + 1}</span>
                  {grid.toUpperCase()}
                </span>
                <span className="mb-4 block text-sm text-slate-300">{labels.gridLabels[grid]}</span>
                <select
                  value={selectedRole}
                  disabled={disabled}
                  onChange={(event) => onChange(updateMapping(value, grid, event.target.value as VideoRole | ""))}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-300/70 focus:ring-4 focus:ring-sky-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{labels.none}</option>
                  {ROLES.map((role) => (
                    <option key={`${grid}-${role}`} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>

      <aside className="rounded-2xl border border-white/10 bg-slate-950/35 p-5">
        <div className="mb-4 flex items-center gap-3">
          <Video size={18} className="text-sky-300" />
          <h3 className="text-base font-semibold text-white">{labels.summary}</h3>
        </div>
        <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-4 text-sm font-semibold text-emerald-200">
          <CheckCircle2 size={18} />
          {labels.selectedPrefix} {value.length} {labels.selectedSuffix}
        </div>
        <div className="space-y-3">
          {value.length === 0 ? (
            <p className="text-sm text-slate-500">{labels.empty}</p>
          ) : (
            value.map((item) => (
              <div key={`${item.grid}-${item.role}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm">
                <span className="min-w-0 font-mono text-slate-100">{item.role}</span>
                <span className="text-slate-500">&lt;-</span>
                <span className="min-w-0 font-mono text-sky-300">{item.grid}</span>
              </div>
            ))
          )}
        </div>
      </aside>
    </section>
  );
}
