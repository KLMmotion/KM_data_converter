import { useEffect, useMemo, useState } from "react";
import { Cpu, Database, Gauge, Layers3, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { ConversionPanel } from "./components/ConversionPanel";
import { LanguageToggle } from "./components/LanguageToggle";
import { LogConsole } from "./components/LogConsole";
import { PathSelector } from "./components/PathSelector";
import { RerunViewer } from "./components/RerunViewer";
import { TaskDescriptionInput } from "./components/TaskDescriptionInput";
import { createTranslator } from "./i18n";

const DEFAULT_REPO_ID = "rerun/droid_lerobot_full";
const STEP_PROGRESS = [14, 32, 56, 82, 94];

function isElectronReady() {
  return typeof window !== "undefined" && Boolean(window.kernelMind);
}

function normalizeForPreview(pathValue: string) {
  const trimmed = pathValue.trim().replaceAll("/", "\\");
  return trimmed.endsWith("\\") ? trimmed.slice(0, -1) : trimmed;
}

function previewDatasetPath(outputPath: string) {
  const normalized = normalizeForPreview(outputPath);
  if (!normalized) {
    return "";
  }
  const leaf = normalized.split("\\").pop()?.toLowerCase();
  if (leaf === "lerobot_output") {
    return `${normalized}\\lerobot_datasets-<timestamp>`;
  }
  return `${normalized}\\lerobot_output\\lerobot_datasets-<timestamp>`;
}

function parseStepIndex(message: string) {
  if (message.includes("[4/4]")) return 3;
  if (message.includes("[3/4]")) return 2;
  if (message.includes("[2/4]")) return 1;
  if (message.includes("[1/4]")) return 0;
  return null;
}

function parseDatasetPath(message: string) {
  const outputMatch = message.match(/output=(.+?)(?:\r?\n|$)/);
  if (outputMatch?.[1]) {
    return outputMatch[1].trim();
  }

  const finalizedMatch = message.match(/at:\s*(.+?)(?:\r?\n|$)/);
  if (finalizedMatch?.[1]) {
    return finalizedMatch[1].trim();
  }

  return null;
}

function buildStepStates(status: ConversionStatus, activeStep: number, labels: string[]) {
  return labels.map((label, index) => {
    if (status === "success") {
      return { label, state: "done" as const };
    }
    if (status === "failed" && index === activeStep) {
      return { label, state: "failed" as const };
    }
    if (status === "running" && index === activeStep) {
      return { label, state: "active" as const };
    }
    if ((status === "running" || status === "failed") && index < activeStep) {
      return { label, state: "done" as const };
    }
    return { label, state: "pending" as const };
  });
}

export default function App() {
  const [language, setLanguage] = useState<Language>("zh");
  const t = useMemo(() => createTranslator(language), [language]);
  const [sourcePath, setSourcePath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [fps, setFps] = useState("30");
  const [repoId, setRepoId] = useState(DEFAULT_REPO_ID);
  const [endEffector, setEndEffector] = useState<EndEffectorMode>("gripper");
  const [taskDescription, setTaskDescription] = useState("");
  const [strict, setStrict] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [sourceValidation, setSourceValidation] = useState<PathValidation | null>(null);
  const [outputValidation, setOutputValidation] = useState<PathValidation | null>(null);
  const [validatingSource, setValidatingSource] = useState(false);
  const [validatingOutput, setValidatingOutput] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [commandPreview, setCommandPreview] = useState("");
  const [datasetPath, setDatasetPath] = useState("");
  const [rerunCommand, setRerunCommand] = useState("");
  const [rerunLaunched, setRerunLaunched] = useState(false);
  const [openingRerun, setOpeningRerun] = useState(false);

  const electronReady = isElectronReady();
  const fpsValue = Number(fps);
  const fpsValid = Number.isFinite(fpsValue) && fpsValue > 0;
  const sourceValid = Boolean(sourceValidation?.exists && sourceValidation.isDirectory && sourceValidation.hasBagDirs);
  const outputValid = Boolean(outputPath.trim());
  const configLocked = status === "running";
  const canStart = electronReady && sourceValid && outputValid && fpsValid && status !== "running";
  const finalDatasetPreview = datasetPath || previewDatasetPath(outputPath) || t("waitingDataset");
  const progress = status === "success" ? 100 : status === "idle" ? 0 : STEP_PROGRESS[activeStep] ?? 8;
  const steps = buildStepStates(status, activeStep, [t("step1"), t("step2"), t("step3"), t("step4"), t("step5")]);

  useEffect(() => {
    if (!electronReady || !sourcePath.trim()) {
      setSourceValidation(null);
      return;
    }

    setValidatingSource(true);
    const timeout = window.setTimeout(() => {
      window.kernelMind.validatePath(sourcePath, "source").then(setSourceValidation).finally(() => setValidatingSource(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [electronReady, sourcePath]);

  useEffect(() => {
    if (!electronReady || !outputPath.trim()) {
      setOutputValidation(null);
      return;
    }

    setValidatingOutput(true);
    const timeout = window.setTimeout(() => {
      window.kernelMind.validatePath(outputPath, "output").then(setOutputValidation).finally(() => setValidatingOutput(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [electronReady, outputPath]);

  useEffect(() => {
    if (!electronReady) {
      return;
    }

    const removeLogListener = window.kernelMind.onConversionLog((event) => {
      setLogs((current) => [...current, event]);

      const stepIndex = parseStepIndex(event.message);
      if (stepIndex !== null) {
        setActiveStep((current) => Math.max(current, stepIndex));
      }

      const parsedDatasetPath = parseDatasetPath(event.message);
      if (parsedDatasetPath) {
        setDatasetPath(parsedDatasetPath);
      }
    });

    const removeExitListener = window.kernelMind.onConversionExit((event) => {
      if (event.code === 0) {
        setStatus("success");
        setActiveStep(4);
      } else {
        setStatus("failed");
      }
    });

    return () => {
      removeLogListener();
      removeExitListener();
    };
  }, [electronReady]);

  async function browse(kind: DirectoryKind) {
    if (!electronReady) {
      return;
    }

    const selected = await window.kernelMind.selectDirectory(kind);
    if (!selected) {
      return;
    }

    if (kind === "source") {
      setSourcePath(selected);
    } else if (kind === "output") {
      setOutputPath(selected);
    } else {
      setDatasetPath(selected);
      setRerunLaunched(false);
      setRerunCommand("");
    }
  }

  async function startConversion() {
    if (!canStart) {
      return;
    }

    setStatus("running");
    setActiveStep(0);
    setDatasetPath("");
    setRerunLaunched(false);
    setRerunCommand("");
    setLogs([]);

    const result = await window.kernelMind.runConversion({
      sourcePath: sourcePath.trim(),
      outputPath: outputPath.trim(),
      fps: fpsValue,
      repoId: repoId.trim() || DEFAULT_REPO_ID,
      endEffector,
      taskDescription: taskDescription.trim() || undefined,
      strict
    });

    if (!result.ok) {
      setStatus("failed");
      setLogs((current) => [
        ...current,
        {
          id: `${Date.now()}-start-error`,
          level: "stderr",
          message: `${result.message ?? "Failed to start conversion."}\n`,
          timestamp: new Date().toISOString()
        }
      ]);
      return;
    }

    setCommandPreview(result.command ?? result.paths?.commandPreview ?? "");
  }

  async function openRerun() {
    const targetPath = datasetPath.trim();
    if (!electronReady || !targetPath) {
      return;
    }

    setOpeningRerun(true);
    try {
      const result = await window.kernelMind.openRerun(targetPath);
      if (result.ok) {
        setRerunCommand(result.command ?? `rerun ${targetPath}`);
        setRerunLaunched(true);
      } else {
        setLogs((current) => [
          ...current,
          {
            id: `${Date.now()}-rerun-error`,
            level: "stderr",
            message: `${result.message ?? "Failed to open Rerun."}\n`,
            timestamp: new Date().toISOString()
          }
        ]);
      }
    } finally {
      setOpeningRerun(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#06101f] text-slate-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(56,189,248,0.24),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(45,212,191,0.16),transparent_30%),linear-gradient(135deg,#07172f_0%,#07111f_42%,#0b1d35_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-5 py-5 lg:px-8">
        <header className="mb-6 flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/[0.08] px-6 py-5 shadow-panel backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-200 to-cyan-300 text-slate-950 shadow-glow">
              <Cpu size={27} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-normal text-white">{t("brand")}</h1>
                <span className="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                  {t("brandLine")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-300">{t("subtitle")}</p>
            </div>
          </div>
          <LanguageToggle language={language} onChange={setLanguage} label={t("language")} />
        </header>

        {!electronReady && (
          <div className="mb-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-5 py-4 text-sm text-amber-100">
            {t("electronMissing")}
          </div>
        )}

        <div className="grid flex-1 gap-5 xl:grid-cols-[460px_minmax(420px,1fr)_minmax(430px,0.9fr)]">
          <aside className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.08] p-6 shadow-panel backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-300/12 text-sky-100">
                <Database size={19} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200/75">Configuration</p>
                <h2 className="text-lg font-semibold text-white">Pipeline Inputs</h2>
              </div>
            </div>

            <PathSelector
              title={t("sourceTitle")}
              hint={t("sourceHint")}
              value={sourcePath}
              placeholder={t("sourcePlaceholder")}
              browseLabel={t("browse")}
              disabled={configLocked}
              validation={sourceValidation}
              isValidating={validatingSource}
              onChange={setSourcePath}
              onBrowse={() => browse("source")}
            />

            <PathSelector
              title={t("outputTitle")}
              hint={t("outputHint")}
              value={outputPath}
              placeholder={t("outputPlaceholder")}
              browseLabel={t("browse")}
              disabled={configLocked}
              validation={outputValidation}
              isValidating={validatingOutput}
              onChange={setOutputPath}
              onBrowse={() => browse("output")}
            />

            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-300/12 text-sky-100">
                  <Gauge size={17} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{t("videoTitle")}</h3>
                  <p className="mt-1 text-xs text-slate-400">{t("fpsHint")}</p>
                </div>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("fps")}</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={fps}
                  disabled={configLocked}
                  onChange={(event) => setFps(event.target.value)}
                  className={`w-full rounded-xl border bg-slate-950/55 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${
                    fpsValid ? "border-white/10 focus:border-sky-300/70 focus:ring-sky-400/10" : "border-rose-300/50 focus:border-rose-300 focus:ring-rose-400/10"
                  }`}
                />
              </label>
              {!fpsValid && <p className="text-xs text-rose-200">{t("invalidFps")}</p>}
            </section>

            <TaskDescriptionInput
              title={t("taskTitle")}
              hint={t("taskHint")}
              value={taskDescription}
              placeholder={t("taskPlaceholder")}
              disabled={configLocked}
              onChange={setTaskDescription}
            />

            <section className="rounded-2xl border border-white/10 bg-slate-950/35">
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <Settings2 size={16} />
                  {t("advanced")}
                </span>
                <span className="text-slate-400">{advancedOpen ? "-" : "+"}</span>
              </button>
              {advancedOpen && (
                <div className="space-y-4 border-t border-white/10 p-4">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("repoId")}</span>
                    <input
                      value={repoId}
                      disabled={configLocked}
                      onChange={(event) => setRepoId(event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-300/70 focus:ring-4 focus:ring-sky-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  <div>
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("endEffector")}</span>
                    <div className="grid grid-cols-2 gap-2">
                      {(["gripper", "hand"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={configLocked}
                          onClick={() => setEndEffector(mode)}
                          className={`rounded-xl border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            endEffector === mode
                              ? "border-cyan-200/50 bg-cyan-200/16 text-cyan-50"
                              : "border-white/10 bg-slate-950/35 text-slate-300 hover:bg-white/[0.08]"
                          }`}
                        >
                          {mode === "gripper" ? t("gripper") : t("hand")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                    <span>
                      <span className="block font-semibold text-slate-200">{t("strict")}</span>
                      <span className="mt-1 block text-xs text-slate-500">{t("strictHint")}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={strict}
                      disabled={configLocked}
                      onChange={(event) => setStrict(event.target.checked)}
                      className="h-5 w-5 accent-cyan-300"
                    />
                  </label>
                </div>
              )}
            </section>
          </aside>

          <section className="space-y-5">
            <ConversionPanel
              status={status}
              canStart={canStart}
              progress={progress}
              steps={steps}
              commandPreview={commandPreview}
              labels={{
                title: t("conversionStatus"),
                start: t("start"),
                idle: t("idle"),
                running: t("running"),
                success: t("success"),
                failed: t("failed"),
                command: t("command")
              }}
              onStart={startConversion}
            />

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/[0.08] p-5 shadow-panel backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-300/12 text-emerald-100">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("ready")}</p>
                    <p className="mt-1 text-sm text-slate-300">{sourceValid ? sourceValidation?.message : t("invalidSource")}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.08] p-5 shadow-panel backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-300/12 text-cyan-100">
                    <Layers3 size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("finalDataset")}</p>
                    <p className="mt-1 truncate font-mono text-sm text-slate-300" title={finalDatasetPreview}>
                      {finalDatasetPreview}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <RerunViewer
              title={t("rerunTitle")}
              hint={t("rerunHint")}
              openLabel={t("openRerun")}
              commandLabel={t("rerunCommand")}
              browseLabel={t("browse")}
              idleLabel={t("rerunIdle")}
              launchedLabel={t("rerunLaunched")}
              datasetLabel={t("finalDataset")}
              datasetPath={datasetPath}
              datasetPlaceholder={previewDatasetPath(outputPath) || "C:\\path\\to\\lerobot_datasets-yy-MM-dd-HH-mm-ss"}
              command={rerunCommand || (datasetPath ? `rerun ${datasetPath}` : "")}
              canOpen={Boolean(datasetPath.trim())}
              isOpening={openingRerun}
              launched={rerunLaunched}
              onPathChange={(path) => {
                setDatasetPath(path);
                setRerunLaunched(false);
                setRerunCommand("");
              }}
              onBrowse={() => browse("dataset")}
              onOpen={openRerun}
            />
          </section>

          <LogConsole title={t("logs")} clearLabel={t("clear")} copyLabel={t("copy")} emptyLabel={t("logsEmpty")} logs={logs} onClear={() => setLogs([])} />
        </div>

        {/* <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-2">
            <Sparkles size={14} className="text-cyan-300" />
            KernelMind conversion cockpit
          </span>
          <span>python -m km_data_converter run-full</span>
        </footer> */}
      </div>
    </main>
  );
}
