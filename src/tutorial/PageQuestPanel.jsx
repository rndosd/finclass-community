import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  Circle,
  Compass,
  MapPinned,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";

import { Button, IconButton } from "../components/ui";

export const loadQuestState = (storageKey) => {
  if (!storageKey || typeof window === "undefined") {
    return { completed: {}, skipped: {} };
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return { completed: {}, skipped: {} };
    const parsed = JSON.parse(stored);
    return {
      completed: parsed?.completed || {},
      skipped: parsed?.skipped || {},
    };
  } catch (_error) {
    return { completed: {}, skipped: {} };
  }
};

const saveQuestState = (storageKey, nextState) => {
  if (!storageKey || typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(nextState));
};

export const buildResolvedQuestGuide = (
  guide,
  manualState = { completed: {}, skipped: {} },
) => {
  const resolveQuest = (quest) => ({
    ...quest,
    resolvedCompleted:
      Boolean(quest.completed) || Boolean(manualState.completed?.[quest.id]),
    resolvedSkipped: Boolean(manualState.skipped?.[quest.id]),
  });

  const mainQuests = (guide?.quests || []).map(resolveQuest);
  const extraQuests = (guide?.extraQuests || []).map(resolveQuest);
  const current =
    mainQuests.find(
      (quest) => !quest.resolvedCompleted && !quest.resolvedSkipped,
    ) ||
    extraQuests.find(
      (quest) => !quest.resolvedCompleted && !quest.resolvedSkipped,
    ) ||
    mainQuests[0] ||
    extraQuests[0] ||
    null;

  const completedMainCount = mainQuests.filter(
    (quest) => quest.resolvedCompleted,
  ).length;
  const pendingMainCount = mainQuests.filter(
    (quest) => !quest.resolvedCompleted && !quest.resolvedSkipped,
  ).length;

  return {
    mainQuests,
    extraQuests,
    current,
    completedMainCount,
    pendingMainCount,
    totalMainCount: mainQuests.length,
  };
};

export const resolveQuestGuideProgress = (guide) =>
  buildResolvedQuestGuide(guide, loadQuestState(guide?.storageKey));

const getActiveTabStorageKey = (storageKey) =>
  storageKey ? `${storageKey}:active-tab` : null;

const hasOperationTabContent = (guide) =>
  Boolean(
    guide?.insights?.length ||
      guide?.recommendations?.length ||
      guide?.operation,
  );

const resolveInitialActiveTab = (guide, manualState) => {
  if (!hasOperationTabContent(guide)) return "quests";

  const storageKey = getActiveTabStorageKey(guide?.storageKey);
  if (storageKey && typeof window !== "undefined") {
    try {
      const savedTab = window.localStorage.getItem(storageKey);
      if (savedTab === "quests" || savedTab === "operation") return savedTab;
    } catch (_error) {
      // Use the progress-based default when browser storage is unavailable.
    }
  }

  const progress = buildResolvedQuestGuide(guide, manualState);
  return progress.pendingMainCount === 0 ? "operation" : "quests";
};

const saveActiveTab = (storageKey, tab) => {
  const activeTabStorageKey = getActiveTabStorageKey(storageKey);
  if (!activeTabStorageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(activeTabStorageKey, tab);
  } catch (_error) {
    // Tab persistence is optional; the helper remains usable without it.
  }
};

const cx = (...classes) => classes.filter(Boolean).join(" ");

function QuestRow({ quest, active = false, onSelect }) {
  const isDone = quest.resolvedCompleted;
  const isSkipped = quest.resolvedSkipped && !isDone;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(quest)}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition",
        active
          ? "border-indigo-200 bg-indigo-50/80 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
        isSkipped ? "opacity-60" : "",
      )}
    >
      <span className="shrink-0">
        {isDone ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <Circle className="h-4 w-4 text-slate-300" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">
        {quest.title}
      </span>
      {isDone || isSkipped || active ? (
        <span
          className={cx(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black",
            isDone
              ? "bg-emerald-50 text-emerald-700"
              : isSkipped
                ? "bg-slate-100 text-slate-500"
                : "bg-indigo-100 text-indigo-700",
          )}
        >
          {isDone ? "완료" : isSkipped ? "건너뜀" : "선택"}
        </span>
      ) : null}
    </button>
  );
}

function ObjectiveList({ objectives = [] }) {
  if (!objectives.length) return null;

  return (
    <div className="space-y-2">
      {objectives.map((objective) => (
        <div
          key={objective.id || objective.label}
          className="flex items-start gap-2 text-sm"
        >
          {objective.completed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
          )}
          <span
            className={objective.completed ? "text-slate-500" : "text-slate-700"}
          >
            {objective.label}
          </span>
        </div>
      ))}
    </div>
  );
}

const insightToneClassNames = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

function QuestInsightList({ insights = [], recommendations = [] }) {
  if (!insights.length && !recommendations.length) return null;

  return (
    <div className="mt-4 space-y-3">
      {insights.length ? (
        <div className="grid grid-cols-2 gap-2">
          {insights.map((insight) => (
            <div
              key={insight.id || insight.label}
              className={cx(
                "rounded-lg border px-3 py-2.5",
                insightToneClassNames[insight.tone] ||
                  insightToneClassNames.slate,
              )}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">
                {insight.label}
              </p>
              <p className="mt-1 truncate text-sm font-black">
                {insight.value}
              </p>
              {insight.description ? (
                <p className="mt-1 text-[11px] leading-4 opacity-75">
                  {insight.description}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {recommendations.length ? (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2.5">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-500">
            운영 힌트
          </p>
          <ul className="mt-2 space-y-1.5">
            {recommendations.map((recommendation) => (
              <li
                key={recommendation}
                className="text-xs leading-5 text-indigo-900"
              >
                {recommendation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function GuideOperationAction({ operation, onRun }) {
  if (!operation) return null;

  return (
    <button
      type="button"
      onClick={() => onRun?.(operation)}
      className="mt-4 flex w-full items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-slate-900">
          {operation.title}
        </span>
        {operation.description ? (
          <span className="mt-1 block text-xs leading-5 text-slate-600">
            {operation.description}
          </span>
        ) : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black text-indigo-700">
        {operation.actionLabel || "열기"}
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

export default function PageQuestPanel({
  guide,
  isOpen,
  onClose,
  onRunLocation,
  onRunOperation,
  onOpenGuide,
  onProgressChange,
}) {
  const [manualState, setManualState] = useState(() =>
    loadQuestState(guide?.storageKey),
  );
  const [selectedQuestId, setSelectedQuestId] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    const initialManualState = loadQuestState(guide?.storageKey);
    return resolveInitialActiveTab(guide, initialManualState);
  });
  const [showExtra, setShowExtra] = useState(false);
  const [clearToast, setClearToast] = useState(null);
  const completedSnapshotRef = useRef(new Set());
  const hasHydratedCompletionRef = useRef(false);
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  const questsTabRef = useRef(null);
  const operationTabRef = useRef(null);
  const guideRef = useRef(guide);
  guideRef.current = guide;

  useEffect(() => {
    const currentGuide = guideRef.current;
    const nextManualState = loadQuestState(currentGuide?.storageKey);
    setManualState(nextManualState);
    setSelectedQuestId(null);
    setActiveTab(resolveInitialActiveTab(currentGuide, nextManualState));
    setClearToast(null);
    completedSnapshotRef.current = new Set();
    hasHydratedCompletionRef.current = false;
  }, [guide?.storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    const currentGuide = guideRef.current;
    const nextManualState = loadQuestState(currentGuide?.storageKey);
    setManualState(nextManualState);
    setActiveTab(resolveInitialActiveTab(currentGuide, nextManualState));
  }, [isOpen]);

  const resolvedGuide = useMemo(
    () => buildResolvedQuestGuide(guide, manualState),
    [guide, manualState],
  );

  const selectedQuest = useMemo(() => {
    const allQuests = [
      ...resolvedGuide.mainQuests,
      ...resolvedGuide.extraQuests,
    ];
    return (
      allQuests.find((quest) => quest.id === selectedQuestId) ||
      resolvedGuide.current
    );
  }, [resolvedGuide, selectedQuestId]);

  useEffect(() => {
    const allQuests = [
      ...resolvedGuide.mainQuests,
      ...resolvedGuide.extraQuests,
    ];
    const completedIds = new Set(
      allQuests
        .filter((quest) => quest.resolvedCompleted)
        .map((quest) => quest.id),
    );

    if (!isOpen || !guide) {
      completedSnapshotRef.current = completedIds;
      hasHydratedCompletionRef.current = false;
      return;
    }

    if (!hasHydratedCompletionRef.current) {
      completedSnapshotRef.current = completedIds;
      hasHydratedCompletionRef.current = true;
      return;
    }

    const newlyCompletedQuest = allQuests.find(
      (quest) =>
        quest.resolvedCompleted && !completedSnapshotRef.current.has(quest.id),
    );
    completedSnapshotRef.current = completedIds;

    if (!newlyCompletedQuest) return;

    const nextQuest =
      allQuests.find(
        (quest) =>
          quest.id !== newlyCompletedQuest.id &&
          !quest.resolvedCompleted &&
          !quest.resolvedSkipped,
      ) || null;

    setClearToast({ quest: newlyCompletedQuest, nextQuest });
  }, [guide, isOpen, resolvedGuide.extraQuests, resolvedGuide.mainQuests]);

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen || !guide) return null;

  const progressPercent =
    resolvedGuide.totalMainCount > 0
      ? Math.round(
          (resolvedGuide.completedMainCount / resolvedGuide.totalMainCount) * 100,
        )
      : 0;

  const updateManualState = (updater) => {
    setManualState((previous) => {
      const next = updater(previous);
      saveQuestState(guide.storageKey, next);
      window.setTimeout(() => onProgressChange?.(), 0);
      return next;
    });
  };

  const markCompleted = (quest) => {
    if (!quest) return;
    updateManualState((previous) => ({
      ...previous,
      completed: { ...previous.completed, [quest.id]: true },
      skipped: { ...previous.skipped, [quest.id]: false },
    }));
  };

  const markSkipped = (quest) => {
    if (!quest) return;
    updateManualState((previous) => ({
      ...previous,
      skipped: { ...previous.skipped, [quest.id]: true },
    }));
  };

  const hasLocationSteps = selectedQuest?.locationSteps?.length > 0;
  const hasOperationTab = hasOperationTabContent(guide);
  const currentTab = hasOperationTab ? activeTab : "quests";
  const canManualComplete =
    selectedQuest && selectedQuest.manualComplete !== false;
  const showNextQuestFromToast = () => {
    if (clearToast?.nextQuest) {
      setSelectedQuestId(clearToast.nextQuest.id);
    }
    setClearToast(null);
  };
  const selectActiveTab = (nextTab) => {
    setActiveTab(nextTab);
    saveActiveTab(guide?.storageKey, nextTab);
  };
  const handlePanelKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      panelRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    ).filter((element) => element.offsetParent !== null);
    if (!focusableElements.length) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };
  const handleTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = activeTab === "quests" ? "operation" : "quests";
    selectActiveTab(nextTab);
    const nextTabRef = nextTab === "quests" ? questsTabRef : operationTabRef;
    window.setTimeout(() => nextTabRef.current?.focus(), 0);
  };

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px]"
        aria-label={`${guide.title} 닫기`}
        onClick={onClose}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-quest-panel-title"
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl shadow-slate-900/20 outline-none"
      >
        <header className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                  <Compass className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Quest Guide
                  </p>
                  <h2
                    id="page-quest-panel-title"
                    className="text-lg font-black text-slate-900"
                  >
                    {guide.title}
                  </h2>
                </div>
              </div>
              {guide.subtitle ? (
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {guide.subtitle}
                </p>
              ) : null}
            </div>
            <IconButton
              label={`${guide.title} 닫기`}
              onClick={onClose}
              size="sm"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-slate-700">상점 첫 운영</span>
              <span className="font-black text-indigo-700">
                {resolvedGuide.completedMainCount} / {resolvedGuide.totalMainCount}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {hasOperationTab ? (
            <div
              role="tablist"
              aria-label={`${guide.title} 도우미 영역`}
              className="mb-4 grid grid-cols-2 rounded-lg bg-slate-200/70 p-1"
            >
              <button
                ref={questsTabRef}
                type="button"
                role="tab"
                id="page-guide-quests-tab"
                aria-selected={currentTab === "quests"}
                aria-controls="page-guide-quests-panel"
                tabIndex={currentTab === "quests" ? 0 : -1}
                onClick={() => selectActiveTab("quests")}
                onKeyDown={handleTabKeyDown}
                className={cx(
                  "rounded-xl px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  currentTab === "quests"
                    ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                퀘스트
              </button>
              <button
                ref={operationTabRef}
                type="button"
                role="tab"
                id="page-guide-operation-tab"
                aria-selected={currentTab === "operation"}
                aria-controls="page-guide-operation-panel"
                tabIndex={currentTab === "operation" ? 0 : -1}
                onClick={() => selectActiveTab("operation")}
                onKeyDown={handleTabKeyDown}
                className={cx(
                  "rounded-xl px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  currentTab === "operation"
                    ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                운영 점검
              </button>
            </div>
          ) : null}

          {currentTab === "operation" ? (
            <section
              role="tabpanel"
              id="page-guide-operation-panel"
              aria-labelledby="page-guide-operation-tab"
              className="rounded-lg border border-indigo-100 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    운영 점검
                  </p>
                  <h3 className="text-base font-black text-slate-900">
                    {guide.operationTitle || "현재 상태"}
                  </h3>
                </div>
              </div>
              <QuestInsightList
                insights={guide.insights}
                recommendations={guide.recommendations}
              />
              <GuideOperationAction
                operation={guide.operation}
                onRun={onRunOperation}
              />
            </section>
          ) : null}

          {currentTab === "quests" && selectedQuest ? (
            <div
              role={hasOperationTab ? "tabpanel" : undefined}
              id={hasOperationTab ? "page-guide-quests-panel" : undefined}
              aria-labelledby={
                hasOperationTab ? "page-guide-quests-tab" : undefined
              }
            >
              <section className="rounded-lg border border-indigo-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    현재 추천
                  </p>
                  <h3 className="truncate text-base font-black text-slate-900">
                    {selectedQuest.title}
                  </h3>
                </div>
              </div>

              <p className="text-sm leading-6 text-slate-600">
                {selectedQuest.description}
              </p>

              <QuestInsightList
                insights={selectedQuest.insights}
                recommendations={selectedQuest.recommendations}
              />

              <div className="mt-4">
                <ObjectiveList objectives={selectedQuest.objectives} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  tone="indigo"
                  kind="solid"
                  icon={MapPinned}
                  disabled={!hasLocationSteps}
                  onClick={() => onRunLocation?.(selectedQuest)}
                >
                  위치 보기
                </Button>
                <Button
                  size="sm"
                  tone="slate"
                  kind="outline"
                  icon={BookOpenText}
                  disabled={!guide.guidePath && !selectedQuest.guidePath}
                  onClick={() =>
                    onOpenGuide?.(selectedQuest.guidePath || guide.guidePath)
                  }
                >
                  가이드북
                </Button>
                {canManualComplete && !selectedQuest.resolvedCompleted ? (
                  <Button
                    size="sm"
                    tone="emerald"
                    kind="outline"
                    icon={CheckCircle2}
                    onClick={() => markCompleted(selectedQuest)}
                  >
                    완료로 표시
                  </Button>
                ) : null}
                {!selectedQuest.resolvedCompleted ? (
                  <Button
                    size="sm"
                    tone="slate"
                    kind="ghost"
                    onClick={() => markSkipped(selectedQuest)}
                  >
                    건너뛰기
                  </Button>
                ) : null}
              </div>
              </section>
            </div>
          ) : null}

          {currentTab === "quests" ? (
            <>
              <section className="mt-5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-800">
                    메인 퀘스트
                  </h3>
                  {progressPercent === 100 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      <Trophy className="h-3.5 w-3.5" />
                      준비 완료
                    </span>
                  ) : null}
                </div>
                {resolvedGuide.mainQuests.map((quest) => (
                  <QuestRow
                    key={quest.id}
                    quest={quest}
                    active={selectedQuest?.id === quest.id}
                    onSelect={(nextQuest) => setSelectedQuestId(nextQuest.id)}
                  />
                ))}
              </section>

              {resolvedGuide.extraQuests.length > 0 ? (
                <section className="mt-5">
                  <button
                    type="button"
                    onClick={() => setShowExtra((value) => !value)}
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left text-sm font-black text-slate-800"
                  >
                    <span>더 해볼 수 있는 기능</span>
                    <ChevronDown
                      className={cx(
                        "h-4 w-4 text-slate-400 transition-transform",
                        showExtra ? "rotate-180" : "",
                      )}
                    />
                  </button>
                  {showExtra ? (
                    <div className="mt-2 space-y-2">
                      {resolvedGuide.extraQuests.map((quest) => (
                        <QuestRow
                          key={quest.id}
                          quest={quest}
                          active={selectedQuest?.id === quest.id}
                          onSelect={(nextQuest) =>
                            setSelectedQuestId(nextQuest.id)
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        {clearToast ? (
          <div className="absolute bottom-5 left-5 right-5 z-20 rounded-xl border border-emerald-200 bg-white p-4 shadow-2xl shadow-emerald-900/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">
                  Quest Clear
                </p>
                <h3 className="mt-1 truncate text-base font-black text-slate-900">
                  {clearToast.quest.title}
                </h3>
                {clearToast.nextQuest ? (
                  <p className="mt-2 text-sm leading-5 text-slate-600">
                    다음 퀘스트:{" "}
                    <span className="font-bold text-slate-800">
                      {clearToast.nextQuest.title}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-5 text-slate-600">
                    지금 페이지의 메인 준비가 끝났습니다.
                  </p>
                )}
              </div>
              <IconButton
                label="닫기"
                onClick={() => setClearToast(null)}
                size="sm"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {clearToast.nextQuest ? (
                <Button
                  size="sm"
                  tone="indigo"
                  kind="solid"
                  onClick={showNextQuestFromToast}
                >
                  다음 퀘스트 보기
                </Button>
              ) : null}
              {clearToast.nextQuest?.locationSteps?.length ? (
                <Button
                  size="sm"
                  tone="slate"
                  kind="outline"
                  icon={MapPinned}
                  onClick={() => {
                    const nextQuest = clearToast.nextQuest;
                    setSelectedQuestId(nextQuest.id);
                    setClearToast(null);
                    onRunLocation?.(nextQuest);
                  }}
                >
                  위치 보기
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
