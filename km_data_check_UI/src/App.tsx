import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ClipboardCheck, FileCode2, RotateCcw, Save, Upload } from "lucide-react";
import { createTranslator } from "./i18n";
import { LanguageToggle } from "./components/LanguageToggle";
import { LogConsole } from "./components/LogConsole";
import { PathSelector } from "./components/PathSelector";
import { RulesTable } from "./components/RulesTable";
import { StatusPanel } from "./components/StatusPanel";
import { TopicsEditor } from "./components/TopicsEditor";

function isElectronReady() {
  return typeof window !== "undefined" && Boolean(window.kernelMindQuality);
}

function nowLog(level: LogLevel, message: string): LogEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    timestamp: new Date().toISOString()
  };
}

function appendPath(basePath: string, leaf: string) {
  const trimmed = basePath.trim().replace(/[\\/]+$/, "");
  return trimmed ? `${trimmed}\\${leaf}` : leaf;
}

function normalizeRulesForSave(rules: QualityRuleRecord[]) {
  return rules.map((rule) => {
    const { rule_name: ruleNameAlias, check_item: metricAlias, ...rest } = rule;
    return {
      ...rest,
      name: String(rule.name ?? ruleNameAlias ?? ""),
      scope: String(rule.scope ?? "bag"),
      metric: String(rule.metric ?? metricAlias ?? ""),
      operator: String(rule.operator ?? "=="),
      threshold: rule.threshold ?? "",
      severity: String(rule.severity) === "warning" ? "warning" : "error",
      enabled: rule.enabled !== false
    };
  });
}

function hasInvalidThreshold(rules: QualityRuleRecord[]) {
  return rules.some((rule) => String(rule.threshold ?? "").trim() === "");
}

function outputErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [language, setLanguage] = useState<Language>("zh");
  const t = useMemo(() => createTranslator(language), [language]);
  const electronReady = isElectronReady();

  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [inputValidation, setInputValidation] = useState<QualityInputValidation | null>(null);
  const [validatingInput, setValidatingInput] = useState(false);
  const [requiredTopics, setRequiredTopics] = useState<string[]>([]);
  const [rules, setRules] = useState<QualityRuleRecord[]>([]);
  const [ruleSource, setRuleSource] = useState<RuleSource>("default");
  const [defaultRulesPath, setDefaultRulesPath] = useState("");
  const [lastSavedRulesPath, setLastSavedRulesPath] = useState("");
  const [status, setStatus] = useState<QualityStatus>("idle");
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [reportDir, setReportDir] = useState("");
  const [summary, setSummary] = useState<QualitySummary | null>(null);

  const configLocked = status === "running";
  const customRulesPath = outputPath.trim() ? appendPath(outputPath, "custom_quality_rules.yaml") : "";
  const canRun = electronReady && status !== "running" && Boolean(inputValidation?.ok) && Boolean(outputPath.trim()) && !hasInvalidThreshold(rules);

  function addLog(level: LogLevel, message: string) {
    setLogs((current) => [...current, nowLog(level, message.endsWith("\n") ? message : `${message}\n`)]);
  }

  function updateRules(nextRules: QualityRuleRecord[]) {
    setRules(nextRules);
    setRuleSource("custom");
  }

  async function loadDefaultRules() {
    if (!electronReady) {
      return;
    }
    try {
      const result = await window.kernelMindQuality.loadDefaultRules();
      setRules(result.rules);
      setRequiredTopics(result.requiredTopics);
      setDefaultRulesPath(result.path);
      setLastSavedRulesPath("");
      setRuleSource("default");
      addLog("system", `${t("defaultLoaded")} ${result.path}`);
    } catch (error) {
      addLog("stderr", `${t("loadFailed")} ${outputErrorMessage(error)}`);
    }
  }

  useEffect(() => {
    void loadDefaultRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electronReady]);

  useEffect(() => {
    if (!electronReady || !inputPath.trim()) {
      setInputValidation(null);
      return;
    }

    setValidatingInput(true);
    const timeout = window.setTimeout(() => {
      window.kernelMindQuality.validateQualityInput(inputPath).then(setInputValidation).finally(() => setValidatingInput(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [electronReady, inputPath]);

  useEffect(() => {
    if (!electronReady) {
      return;
    }

    const removeLogListener = window.kernelMindQuality.onQualityLog((event) => {
      setLogs((current) => [...current, event]);
    });
    const removeSummaryListener = window.kernelMindQuality.onQualitySummary((event) => {
      setSummary(event.summary);
      setReportDir(event.reportDir);
    });
    const removeExitListener = window.kernelMindQuality.onQualityExit((event) => {
      setStatus(event.code === 0 ? "success" : "failed");
    });

    return () => {
      removeLogListener();
      removeSummaryListener();
      removeExitListener();
    };
  }, [electronReady]);

  async function browseInput() {
    if (!electronReady || configLocked) {
      return;
    }
    const selected = await window.kernelMindQuality.selectInputPath();
    if (selected) {
      setInputPath(selected);
    }
  }

  async function browseOutput() {
    if (!electronReady || configLocked) {
      return;
    }
    const selected = await window.kernelMindQuality.selectOutputDirectory();
    if (selected) {
      setOutputPath(selected);
    }
  }

  async function loadRulesFile() {
    if (!electronReady || configLocked) {
      return;
    }
    const selected = await window.kernelMindQuality.selectRulesFile();
    if (!selected) {
      return;
    }
    try {
      const result = await window.kernelMindQuality.loadRulesFile(selected);
      setRules(result.rules);
      setRuleSource("custom");
      setLastSavedRulesPath(result.path);
      addLog("system", `${t("rulesLoaded")} ${result.path}`);
    } catch (error) {
      addLog("stderr", `${t("loadFailed")} ${outputErrorMessage(error)}`);
    }
  }

  async function saveRulesTo(pathValue: string) {
    const result = await window.kernelMindQuality.saveRulesFile({
      path: pathValue,
      rules: normalizeRulesForSave(rules)
    });
    setRuleSource("custom");
    setLastSavedRulesPath(result.path);
    addLog("system", `${t("customSaved")} ${result.path}`);
    return result.path;
  }

  async function saveRules() {
    if (!electronReady || configLocked) {
      return;
    }
    if (!outputPath.trim()) {
      addLog("stderr", t("missingOutput"));
      return;
    }
    if (hasInvalidThreshold(rules)) {
      addLog("stderr", t("invalidThreshold"));
      return;
    }
    try {
      await saveRulesTo(customRulesPath);
    } catch (error) {
      addLog("stderr", `${t("saveFailed")} ${outputErrorMessage(error)}`);
    }
  }

  async function saveRulesAs() {
    if (!electronReady || configLocked) {
      return;
    }
    if (hasInvalidThreshold(rules)) {
      addLog("stderr", t("invalidThreshold"));
      return;
    }
    const selected = await window.kernelMindQuality.saveRulesFileDialog(customRulesPath || lastSavedRulesPath || "custom_quality_rules.yaml");
    if (!selected) {
      return;
    }
    try {
      await saveRulesTo(selected);
    } catch (error) {
      addLog("stderr", `${t("saveFailed")} ${outputErrorMessage(error)}`);
    }
  }

  async function resetToDefault() {
    await loadDefaultRules();
    addLog("system", t("resetDone"));
  }

  async function startQualityCheck() {
    if (!electronReady || status === "running") {
      return;
    }
    if (!inputPath.trim()) {
      addLog("stderr", t("missingInput"));
      return;
    }
    if (!outputPath.trim()) {
      addLog("stderr", t("missingOutput"));
      return;
    }
    if (hasInvalidThreshold(rules)) {
      addLog("stderr", t("invalidThreshold"));
      return;
    }

    setStatus("running");
    setSummary(null);
    setReportDir("");
    setLogs([]);

    try {
      const activeRulesPath = ruleSource === "custom" ? await saveRulesTo(customRulesPath) : undefined;
      const result = await window.kernelMindQuality.runQualityCheck({
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        requiredTopics: requiredTopics.map((topic) => topic.trim()).filter(Boolean),
        rulesPath: activeRulesPath,
        replaceRules: Boolean(activeRulesPath)
      });

      if (!result.ok) {
        setStatus("failed");
        addLog("stderr", `${t("runFailed")} ${result.message ?? ""}`);
        return;
      }

      setReportDir(result.reportDir ?? "");
    } catch (error) {
      setStatus("failed");
      addLog("stderr", `${t("runFailed")} ${outputErrorMessage(error)}`);
    }
  }

  async function openReportFolder() {
    if (!electronReady || !reportDir) {
      return;
    }
    const result = await window.kernelMindQuality.openReportFolder(reportDir);
    if (!result.ok) {
      addLog("stderr", `${t("openFailed")} ${result.message ?? ""}`);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#07101d] text-slate-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(45,212,191,0.18),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(251,191,36,0.10),transparent_26%),linear-gradient(135deg,#07101d_0%,#111827_48%,#082f2f_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1900px] flex-col gap-5 px-4 py-5 lg:px-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.08] px-6 py-5 shadow-panel backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-200 to-emerald-200 p-3 text-slate-950 shadow-glow">
              <ClipboardCheck size={28} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-normal text-white">{t("brand")}</h1>
                <span className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                  {t("brandLine")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-300">{t("subtitle")}</p>
            </div>
          </div>
          <LanguageToggle language={language} label={t("language")} onChange={setLanguage} />
        </header>

        {!electronReady && (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-5 py-4 text-sm text-amber-100">{t("electronMissing")}</div>
        )}

        <section className="grid gap-5 xl:h-[560px] xl:grid-cols-[minmax(680px,0.95fr)_minmax(680px,1.05fr)]">
          <div className="h-full min-w-0 space-y-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-panel">
            <PathSelector
              title={t("inputTitle")}
              hint={t("inputHint")}
              value={inputPath}
              placeholder={t("inputPlaceholder")}
              browseLabel={t("browse")}
              validatingLabel={t("validating")}
              disabled={configLocked}
              validation={inputValidation}
              validating={validatingInput}
              onChange={setInputPath}
              onBrowse={browseInput}
            />
            <PathSelector
              title={t("outputTitle")}
              hint={t("outputHint")}
              value={outputPath}
              placeholder={t("outputPlaceholder")}
              browseLabel={t("browse")}
              validatingLabel={t("validating")}
              disabled={configLocked}
              onChange={setOutputPath}
              onBrowse={browseOutput}
            />
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-4 py-3 text-sm">
              <span className="text-slate-400">{t("ruleSource")}:</span>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${ruleSource === "default" ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-amber-300/25 bg-amber-300/10 text-amber-100"}`}>
                {ruleSource === "default" ? t("defaultRules") : t("customRules")}
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-slate-500" title={ruleSource === "default" ? defaultRulesPath : lastSavedRulesPath}>
                {ruleSource === "default" ? defaultRulesPath : lastSavedRulesPath}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ToolbarButton icon={<Upload size={15} />} label={t("loadRules")} disabled={configLocked} onClick={loadRulesFile} />
              <ToolbarButton icon={<Save size={15} />} label={t("saveRules")} disabled={configLocked} onClick={saveRules} />
              <ToolbarButton icon={<FileCode2 size={15} />} label={t("saveAs")} disabled={configLocked} onClick={saveRulesAs} />
              <ToolbarButton icon={<RotateCcw size={15} />} label={t("resetDefault")} disabled={configLocked} onClick={resetToDefault} />
            </div>
          </div>

          <TopicsEditor
            title={t("topicsTitle")}
            hint={t("topicsHint")}
            addLabel={t("addTopic")}
            removeLabel={t("removeTopic")}
            placeholder={t("topicPlaceholder")}
            topics={requiredTopics}
            disabled={configLocked}
            onChange={setRequiredTopics}
          />
        </section>

        <RulesTable
          title={t("rulesTitle")}
          hint={t("rulesHint")}
          rules={rules}
          language={language}
          disabled={configLocked}
          labels={{
            addRule: t("addRule"),
            remove: t("remove"),
            enabled: t("enabled"),
            ruleName: t("ruleName"),
            ruleNameHint: t("ruleNameHint"),
            scope: t("scope"),
            metric: t("metric"),
            metricHint: t("metricHint"),
            operator: t("operator"),
            threshold: t("threshold"),
            severity: t("severity"),
            topicPattern: t("topicPattern"),
            invalidThreshold: t("invalidThreshold")
          }}
          onChange={updateRules}
        />

        <section className="grid gap-5 xl:grid-cols-[minmax(560px,1fr)_minmax(560px,0.9fr)]">
          <LogConsole title={t("logs")} clearLabel={t("clear")} copyLabel={t("copy")} emptyLabel={t("logsEmpty")} logs={logs} onClear={() => setLogs([])} />
          <StatusPanel
            status={status}
            canRun={canRun}
            reportDir={reportDir}
            summary={summary}
            labels={{
              status: t("status"),
              idle: t("idle"),
              running: t("running"),
              success: t("success"),
              failed: t("failed"),
              run: t("run"),
              summary: t("summary"),
              waitingSummary: t("waitingSummary"),
              recordings: t("recordings"),
              passed: t("passed"),
              warnings: t("warnings"),
              errors: t("errors"),
              reportPath: t("reportPath"),
              openReport: t("openReport")
            }}
            onRun={startQualityCheck}
            onOpenReport={openReportFolder}
          />
        </section>
      </div>
    </main>
  );
}

function ToolbarButton({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {label}
    </button>
  );
}
