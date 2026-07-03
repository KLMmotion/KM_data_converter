import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Box, Cpu, Database, Gauge, Loader2, Settings2 } from "lucide-react";
import { ConversionPanel } from "./components/ConversionPanel";
import { LanguageToggle } from "./components/LanguageToggle";
import { LogConsole } from "./components/LogConsole";
import { PathSelector } from "./components/PathSelector";
import { TaskDescriptionInput } from "./components/TaskDescriptionInput";
import { createTranslator } from "./i18n";

const DEFAULT_REPO_ID = "rerun/droid_lerobot_full";
const STEP_PROGRESS = [14, 32, 56, 82, 94];
const RerunViewer = lazy(() => import("./components/RerunViewer").then((module) => ({ default: module.RerunViewer })));

function isElectronReady() {
  return typeof window !== "undefined" && Boolean(window.kernelMind);
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

function parseRerunPathInput(value: string) {
  return value
    .split(/\r?\n/)
    .map((pathValue) => pathValue.trim())
    .filter(Boolean);
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [conversionPaused, setConversionPaused] = useState(false);
  const [controllingConversion, setControllingConversion] = useState(false);
  const [sourceValidation, setSourceValidation] = useState<PathValidation | null>(null);
  const [outputValidation, setOutputValidation] = useState<PathValidation | null>(null);
  const [validatingSource, setValidatingSource] = useState(false);
  const [validatingOutput, setValidatingOutput] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [rerunPathInput, setRerunPathInput] = useState("");
  const [rerunStatus, setRerunStatus] = useState<RerunStatus | null>(null);
  const [rerunLogs, setRerunLogs] = useState<string[]>([]);
  const [startingRerun, setStartingRerun] = useState(false);
  const [stoppingRerun, setStoppingRerun] = useState(false);
  const [rerunPanelOpen, setRerunPanelOpen] = useState(false);

  const electronReady = isElectronReady();
  const fpsValue = Number(fps);
  const fpsValid = Number.isFinite(fpsValue) && fpsValue > 0;
  const sourceValid = Boolean(sourceValidation?.exists && sourceValidation.isDirectory && sourceValidation.hasBagDirs);
  const outputValid = Boolean(outputPath.trim());
  const configLocked = status === "running";
  const canStart = electronReady && sourceValid && outputValid && fpsValid && status !== "running";
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
        setRerunPathInput(parsedDatasetPath);
      }
    });

    const removeExitListener = window.kernelMind.onConversionExit((event) => {
      if (event.code === 0) {
        setStatus("success");
        setActiveStep(4);
      } else {
        setStatus("failed");
      }
      setConversionPaused(false);
      setControllingConversion(false);
    });

    return () => {
      removeLogListener();
      removeExitListener();
    };
  }, [electronReady]);

  useEffect(() => {
    if (!electronReady || !rerunPanelOpen) {
      return;
    }

    let mounted = true;
    const refreshStatus = () => {
      window.kernelMind.getRerunStatus().then((status) => {
        if (!mounted) {
          return;
        }
        setRerunStatus(status);
        setRerunLogs(status.logs ?? []);
        setRerunPathInput((current) => current || status.dataPath || "");
      });
    };

    refreshStatus();
    const interval = window.setInterval(refreshStatus, 2500);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [electronReady, rerunPanelOpen]);

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
      setRerunPathInput(selected);
    }
  }

  async function browseRerunInput(kind: RerunSelectKind) {
    if (!electronReady) {
      return;
    }

    const selected = await window.kernelMind.selectRerunPath(kind);
    if (!selected || selected.length === 0) {
      return;
    }

    setRerunPathInput(selected.join("\n"));
  }

  function pushRerunLog(message: string) {
    setRerunLogs((current) => [...current, message].slice(-120));
  }

  async function startRerunViewer() {
    if (!electronReady) {
      return;
    }

    const paths = parseRerunPathInput(rerunPathInput);
    if (paths.length === 0) {
      pushRerunLog("Select an .rrd, .rbl, .mcap file, or a LeRobot dataset directory first.");
      return;
    }

    setStartingRerun(true);
    setRerunStatus((current) => ({
      ...(current ?? { running: false, success: true }),
      success: true,
      running: false,
      error: undefined,
      message: "Starting Rerun data service..."
    }));
    setRerunLogs((current) => [...current, `Starting Rerun data service for: ${paths.join(", ")}`].slice(-120));
    try {
      const result = await window.kernelMind.startRerunViewer({ paths });
      setRerunStatus({
        ...result,
        running: Boolean(result.running)
      });
      setRerunLogs(result.logs ?? []);
      if (!result.success) {
        pushRerunLog(result.error ?? result.message ?? "Failed to start Rerun data service.");
      }
    } catch (error) {
      pushRerunLog(error instanceof Error ? error.message : "Failed to start Rerun data service.");
    } finally {
      setStartingRerun(false);
    }
  }

  async function stopRerunViewer() {
    if (!electronReady) {
      return;
    }

    setStoppingRerun(true);
    try {
      const result = await window.kernelMind.stopRerunViewer();
      setRerunStatus({
        ...result,
        running: false
      });
      setRerunLogs(result.logs ?? []);
      if (!result.success) {
        pushRerunLog(result.error ?? result.message ?? "Failed to stop Rerun data service.");
      }
    } catch (error) {
      pushRerunLog(error instanceof Error ? error.message : "Failed to stop Rerun data service.");
    } finally {
      setStoppingRerun(false);
    }
  }

  async function openNativeRerunViewer() {
    if (!electronReady) {
      return;
    }

    const paths = parseRerunPathInput(rerunPathInput);
    if (paths.length === 0) {
      pushRerunLog("Select an .rrd, .rbl, .mcap file, or a LeRobot dataset directory first.");
      return;
    }

    try {
      const result = await window.kernelMind.openRerun(paths.join("\n"));
      if (result.ok) {
        pushRerunLog(result.command ?? `rerun ${paths.join(" ")}`);
      } else {
        pushRerunLog(result.message ?? "Failed to open native Rerun Viewer.");
      }
    } catch (error) {
      pushRerunLog(error instanceof Error ? error.message : "Failed to open native Rerun Viewer.");
    }
  }

  async function startConversion() {
    if (!canStart) {
      return;
    }

    setStatus("running");
    setConversionPaused(false);
    setControllingConversion(false);
    setActiveStep(0);
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
      setConversionPaused(false);
      setControllingConversion(false);
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

    if (result.paths?.video2rrdDir) {
      setRerunPathInput(result.paths.video2rrdDir);
    }
  }

  async function pauseConversion() {
    if (!electronReady || status !== "running" || conversionPaused || controllingConversion) {
      return;
    }

    setControllingConversion(true);
    try {
      const result = await window.kernelMind.pauseConversion();
      if (result.ok) {
        setConversionPaused(Boolean(result.paused));
      }
    } finally {
      setControllingConversion(false);
    }
  }

  async function resumeConversion() {
    if (!electronReady || status !== "running" || !conversionPaused || controllingConversion) {
      return;
    }

    setControllingConversion(true);
    try {
      const result = await window.kernelMind.resumeConversion();
      if (result.ok) {
        setConversionPaused(Boolean(result.paused));
      }
    } finally {
      setControllingConversion(false);
    }
  }

  async function stopConversion() {
    if (!electronReady || status !== "running" || controllingConversion) {
      return;
    }

    setControllingConversion(true);
    const result = await window.kernelMind.stopConversion();
    if (result.ok) {
      setConversionPaused(false);
    } else {
      setControllingConversion(false);
    }
  }

  const rerunViewerPanel = (
    <RerunViewer
      labels={{
        title: t("rerunTitle"),
        hint: t("rerunHint"),
        browseFile: t("rerunBrowseFile"),
        browseDirectory: t("rerunBrowseDirectory"),
        start: t("rerunStart"),
        stop: t("rerunStop"),
        openNative: t("openRerun"),
        input: t("rerunInput"),
        url: t("rerunViewerUrl"),
        command: t("rerunCommand"),
        logs: t("rerunLogs"),
        idle: t("rerunIdle"),
        running: t("rerunRunning"),
        placeholder: t("rerunPlaceholder"),
        emptyLogs: t("rerunLogsEmpty")
      }}
      pathInput={rerunPathInput}
      status={rerunStatus}
      logs={rerunLogs}
      isStarting={startingRerun}
      isStopping={stoppingRerun}
      onPathChange={setRerunPathInput}
      onBrowseFile={() => browseRerunInput("file")}
      onBrowseDirectory={() => browseRerunInput("directory")}
      onStart={startRerunViewer}
      onStop={stopRerunViewer}
      onOpenNative={openNativeRerunViewer}
    />
  );

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

        <div className="mb-5 grid flex-1 items-stretch gap-5 xl:grid-cols-[460px_minmax(420px,1fr)_minmax(430px,0.9fr)]">
          <aside className="h-full space-y-5 rounded-3xl border border-white/10 bg-white/[0.08] p-6 shadow-panel backdrop-blur-xl">
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

          <section className="h-full min-h-0 overflow-hidden">
            <ConversionPanel
              status={status}
              canStart={canStart}
              isPaused={conversionPaused}
              isControlling={controllingConversion}
              progress={progress}
              steps={steps}
              labels={{
                title: t("conversionStatus"),
                start: t("start"),
                pause: t("pause"),
                resume: t("resume"),
                stop: t("stop"),
                idle: t("idle"),
                running: t("running"),
                paused: t("paused"),
                success: t("success"),
                failed: t("failed")
              }}
              onStart={startConversion}
              onPause={pauseConversion}
              onResume={resumeConversion}
              onStop={stopConversion}
            />
          </section>

          <LogConsole title={t("logs")} clearLabel={t("clear")} copyLabel={t("copy")} emptyLabel={t("logsEmpty")} logs={logs} onClear={() => setLogs([])} />
        </div>

        {rerunPanelOpen ? (
          <Suspense
            fallback={
              <section className="flex min-h-64 items-center justify-center rounded-3xl border border-cyan-200/15 bg-slate-950/70 text-sm text-slate-400 shadow-panel backdrop-blur-xl">
                <Loader2 size={24} className="mr-3 animate-spin text-cyan-200" />
                {t("rerunStart")}
              </section>
            }
          >
            {rerunViewerPanel}
          </Suspense>
        ) : (
          <section className="flex flex-col gap-4 rounded-3xl border border-cyan-200/15 bg-slate-950/70 p-5 shadow-panel backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/14 text-cyan-100 shadow-glow">
                <Box size={21} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{t("rerunTitle")}</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{t("rerunHint")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRerunPanelOpen(true)}
              className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-cyan-200/25 bg-cyan-200/10 px-4 py-2.5 text-xs font-semibold text-cyan-50 transition hover:border-cyan-100/55 hover:bg-cyan-200/18"
            >
              <Box size={14} />
              {t("rerunStart")}
            </button>
          </section>
        )}

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
