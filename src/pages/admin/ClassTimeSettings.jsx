import React, { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Clock3, Plus, Save, Trash2 } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import {
  Button,
  Card,
  CardSkeleton,
  PageHeader,
  PageSkeleton,
  ToggleSwitch,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";
import { db } from "../../firebase";
import {
  DAY_META,
  DEFAULT_TIMEZONE,
  createEmptyUsageRules,
  normalizeUsageSchedule,
  validateUsageRules,
  toMinutes,
} from "../../utils/usageSchedule";

const DEFAULT_RANGE = { start: "09:00", end: "10:00" };

const cloneRules = (rules) =>
  DAY_META.reduce((acc, day) => {
    acc[day.key] = Array.isArray(rules?.[day.key])
      ? rules[day.key].map((range) => ({ ...range }))
      : [];
    return acc;
  }, {});

const createSelectedDays = () =>
  DAY_META.reduce((acc, day) => {
    acc[day.key] = false;
    return acc;
  }, {});

const createLocalState = (rawSchedule) => {
  const normalized = normalizeUsageSchedule(rawSchedule);
  return {
    enabled: normalized.enabled,
    timezone: normalized.timezone || DEFAULT_TIMEZONE,
    rules: cloneRules(normalized.rules),
  };
};

const ClassTimeSettings = () => {
  const { classId, classData, loading: userLoading } = useUser();
  const { showFeedback } = useFeedback();

  const [schedule, setSchedule] = useState(() => createLocalState());
  const [isSaving, setIsSaving] = useState(false);
  const [isToggleSaving, setIsToggleSaving] = useState(false);
  const [selectedDays, setSelectedDays] = useState(() => createSelectedDays());
  const [bulkStart, setBulkStart] = useState(DEFAULT_RANGE.start);
  const [bulkEnd, setBulkEnd] = useState(DEFAULT_RANGE.end);

  const rawUsageSchedule = classData?.settings?.usageSchedule;
  useEffect(() => {
    setSchedule(createLocalState(rawUsageSchedule));
  }, [rawUsageSchedule, classId]);

  const selectedDayKeys = useMemo(
    () => DAY_META.map((day) => day.key).filter((dayKey) => selectedDays[dayKey]),
    [selectedDays],
  );

  const totalRanges = useMemo(
    () =>
      DAY_META.reduce(
        (sum, day) =>
          sum + (Array.isArray(schedule.rules?.[day.key]) ? schedule.rules[day.key].length : 0),
        0,
      ),
    [schedule.rules],
  );

  const updateDayRanges = (dayKey, updater) => {
    setSchedule((prev) => {
      const nextRules = cloneRules(prev.rules);
      nextRules[dayKey] = updater(nextRules[dayKey] || []);
      return { ...prev, rules: nextRules };
    });
  };

  const handleAddRange = (dayKey) => {
    updateDayRanges(dayKey, (ranges) => [...ranges, { ...DEFAULT_RANGE }]);
  };

  const handleRemoveRange = (dayKey, index) => {
    updateDayRanges(dayKey, (ranges) => ranges.filter((_, idx) => idx !== index));
  };

  const handleChangeRange = (dayKey, index, field, value) => {
    updateDayRanges(dayKey, (ranges) =>
      ranges.map((range, idx) => (idx === index ? { ...range, [field]: value } : range)),
    );
  };

  const handleToggleSelectDay = (dayKey) => {
    setSelectedDays((prev) => ({ ...prev, [dayKey]: !prev[dayKey] }));
  };

  const handleSelectWeekdays = () => {
    setSelectedDays((prev) => {
      const next = { ...prev };
      ["mon", "tue", "wed", "thu", "fri"].forEach((dayKey) => {
        next[dayKey] = true;
      });
      return next;
    });
  };

  const handleSelectAllDays = () => {
    setSelectedDays(
      DAY_META.reduce((acc, day) => {
        acc[day.key] = true;
        return acc;
      }, {}),
    );
  };

  const handleClearDaySelection = () => {
    setSelectedDays(createSelectedDays());
  };

  const handleBulkAddSelectedDays = () => {
    if (selectedDayKeys.length === 0) {
      showFeedback("일괄 추가할 요일을 먼저 선택해 주세요.", "warning");
      return;
    }
    if (toMinutes(bulkStart) === null || toMinutes(bulkEnd) === null || bulkStart === bulkEnd) {
      showFeedback("일괄 추가 시간대를 확인해 주세요.", "warning");
      return;
    }

    setSchedule((prev) => {
      const nextRules = cloneRules(prev.rules);
      selectedDayKeys.forEach((dayKey) => {
        nextRules[dayKey] = [...nextRules[dayKey], { start: bulkStart, end: bulkEnd }];
      });
      return { ...prev, rules: nextRules };
    });
    showFeedback("선택한 요일에 시간대를 추가했습니다.", "success");
  };

  const handleBulkDeleteSelectedDays = () => {
    if (selectedDayKeys.length === 0) {
      showFeedback("일괄 삭제할 요일을 먼저 선택해 주세요.", "warning");
      return;
    }
    setSchedule((prev) => {
      const nextRules = cloneRules(prev.rules);
      selectedDayKeys.forEach((dayKey) => {
        nextRules[dayKey] = [];
      });
      return { ...prev, rules: nextRules };
    });
    showFeedback("선택한 요일의 시간대를 모두 삭제했습니다.", "info");
  };

  const handleResetRules = () => {
    setSchedule((prev) => ({ ...prev, rules: createEmptyUsageRules() }));
  };

  const handleToggleEnabled = async (nextEnabled) => {
    const prevEnabled = schedule.enabled === true;
    setSchedule((prev) => ({ ...prev, enabled: nextEnabled === true }));

    if (!classId) {
      return;
    }

    setIsToggleSaving(true);
    try {
      await setDoc(
        doc(db, "classes", classId),
        {
          settings: {
            usageSchedule: {
              enabled: nextEnabled === true,
              studentOnly: true,
              timezone: schedule.timezone || DEFAULT_TIMEZONE,
            },
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true },
      );
    } catch (error) {
      console.error("[ClassTimeSettings] toggle save failed:", error);
      setSchedule((prev) => ({ ...prev, enabled: prevEnabled }));
      showFeedback("토글 저장 중 오류가 발생했습니다. 다시 시도해 주세요.", "error");
    } finally {
      setIsToggleSaving(false);
    }
  };

  const handleSave = async () => {
    if (!classId) {
      showFeedback("학급 정보를 찾을 수 없습니다.", "error");
      return;
    }

    const validation = validateUsageRules(schedule.rules);
    if (!validation.valid) {
      showFeedback(validation.errors[0] || "시간대 설정을 확인해 주세요.", "warning");
      return;
    }

    const payload = {
      enabled: schedule.enabled === true,
      studentOnly: true,
      timezone: schedule.timezone || DEFAULT_TIMEZONE,
      rules: validation.rules,
    };

    setIsSaving(true);
    try {
      await setDoc(
        doc(db, "classes", classId),
        {
          settings: {
            usageSchedule: payload,
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true },
      );
      showFeedback("사용 시간 설정이 저장되었습니다.", "success");
    } catch (error) {
      console.error("[ClassTimeSettings] save failed:", error);
      showFeedback("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };
  const timeSettingsQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "사용 시간 도우미",
      launcherTitle: "사용 시간 도우미",
      launcherDescription: "시간 제한 토글, 요일별 시간대, 일괄 설정 흐름을 체크합니다.",
      subtitle: "학생 페이지를 사용할 수 있는 시간을 학급 운영에 맞춰 제한합니다.",
      storageKey: classId
        ? `finclass_time_settings_quest_${classId}`
        : "finclass_time_settings_quest",
      tourKey: "TEACHER_MANAGE_TIME_SETTINGS_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "enable-setting",
          title: "시간 제한 사용 여부 결정하기",
          description: "학생 사용 시간 제한을 켤지 말지 현재 운영 방식에 맞게 결정합니다.",
          completed: true,
          manualComplete: true,
          objectives: [
            {
              id: "enabled",
              label: schedule.enabled === true
                ? "현재 시간 제한을 사용 중입니다."
                : "현재 시간 제한을 사용하지 않습니다.",
              completed: true,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-time-overview"]',
              title: "시간 제한 사용",
              content: "이 영역에서 학생 페이지 사용 시간 제한을 켜고 끕니다.",
            },
          ],
        },
        {
          id: "day-ranges",
          title: "요일별 시간대 만들기",
          description: "시간 제한을 사용한다면 요일별 허용 시간대를 하나 이상 준비합니다.",
          doneText: `${totalRanges}개의 시간대가 설정되어 있습니다.`,
          completed: schedule.enabled !== true || totalRanges > 0,
          manualComplete: false,
          objectives: [
            {
              id: "range-count",
              label: schedule.enabled === true
                ? "시간대 1개 이상 설정"
                : "시간 제한을 사용하지 않으면 시간대 설정이 필요 없습니다.",
              completed: schedule.enabled !== true || totalRanges > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-time-days"]',
              title: "요일별 시간대",
              content: "요일 카드에서 허용 시간대를 추가하거나 삭제합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "bulk-days",
          title: "요일 일괄 설정 확인하기",
          description: "여러 요일을 선택해 같은 시간대를 한 번에 추가합니다.",
          completed: selectedDayKeys.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "selected-days",
              label: "요일 1개 이상 선택",
              completed: selectedDayKeys.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-time-overview"]',
              title: "요일 일괄 설정",
              content: "평일 선택, 전체 선택, 시간대 일괄 추가를 사용할 수 있습니다.",
            },
          ],
        },
        {
          id: "save",
          title: "저장 흐름 확인하기",
          description: "변경한 시간 제한 규칙을 저장합니다.",
          completed: isSaving || isToggleSaving,
          manualComplete: true,
          objectives: [
            {
              id: "saving",
              label: "저장 동작 확인",
              completed: isSaving || isToggleSaving,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-time-days"]',
              title: "저장 전 확인",
              content: "요일별 시간대를 확인한 뒤 하단 저장 버튼을 사용합니다.",
            },
          ],
        },
      ],
    }),
    [
      classId,
      isSaving,
      isToggleSaving,
      schedule.enabled,
      selectedDayKeys.length,
      totalRanges,
    ],
  );

  if (userLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <PageSkeleton summaryCards={0} showChart={false} showTable={false} />
          <CardSkeleton rows={5} showFooter />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {DAY_META.map((day) => (
              <CardSkeleton key={day.key} rows={4} showFooter={false} />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }


  return (
    <AppLayout pageGuide={timeSettingsQuestGuide}>
      <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="학생 사용 시간 설정"
          subtitle="허용 시간대에만 학생 페이지를 이용하도록 제한할 수 있습니다."
          icon={Clock3}
        />

        <Card noPadding data-tour="manage-time-overview">
          <Card.Content className="p-5 sm:p-6 space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-base sm:text-lg font-black text-slate-800">시간 제한 사용</p>
                <p className="text-sm sm:text-base text-slate-600">
                  설정한 시간대에만 학생 페이지 이용이 허용됩니다.
                </p>
              </div>
              <ToggleSwitch
                id="usage-window-enabled"
                srLabel="학생 사용 시간 제한"
                checked={schedule.enabled}
                onChange={handleToggleEnabled}
                disabled={isToggleSaving || isSaving}
              />
            </div>
            <p className="text-xs text-slate-500">사용 여부는 즉시 저장됩니다. 아래 시간대 변경은 별도로 저장해 주세요.</p>
          </Card.Content>
        </Card>
        <Card noPadding>
          <Card.Content className="p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">허용 시간대 설정</h2>
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-slate-800">요일 일괄 설정</p>
                <span className="text-xs text-slate-500">선택 {selectedDayKeys.length}일</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {DAY_META.map((day) => {
                  const selected = !!selectedDays[day.key];
                  return (
                    <Button
                      key={day.key}
                      type="button"
                      aria-pressed={selected}
                      tone={selected ? "blue" : "slate"}
                      kind={selected ? "soft" : "outline"}
                      size="sm"
                      onClick={() => handleToggleSelectDay(day.key)}
                    >
                      {day.label}
                    </Button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button kind="soft" tone="slate" size="sm" onClick={handleSelectWeekdays}>
                  월~금 선택
                </Button>
                <Button kind="soft" tone="slate" size="sm" onClick={handleSelectAllDays}>
                  전체 선택
                </Button>
                <Button kind="outline" tone="slate" size="sm" onClick={handleClearDaySelection}>
                  전체 선택 해제
                </Button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="time"
                  aria-label="일괄 추가 시작 시간"
                  value={bulkStart}
                  onChange={(e) => setBulkStart(e.target.value)}
                  className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500"
                />
                <span className="text-xs text-slate-400">~</span>
                <input
                  type="time"
                  aria-label="일괄 추가 종료 시간"
                  value={bulkEnd}
                  onChange={(e) => setBulkEnd(e.target.value)}
                  className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500"
                />
                <Button
                  kind="soft"
                  tone="blue"
                  size="sm"
                  onClick={handleBulkAddSelectedDays}
                >
                  선택 요일에 시간대 추가
                </Button>
                <Button
                  kind="outline"
                  tone="rose"
                  size="sm"
                  onClick={handleBulkDeleteSelectedDays}
                >
                  선택 요일 일괄 삭제
                </Button>
                <Button kind="outline" tone="slate" size="sm" onClick={handleResetRules}>
                  전체 시간대 초기화
                </Button>
              </div>

              <div className="flex items-center">
                <span className="ml-auto text-xs text-slate-400">총 시간대 {totalRanges}개</span>
              </div>
            </div>
          </Card.Content>
        </Card>

        <div data-tour="manage-time-days" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DAY_META.map((day) => {
            const ranges = schedule.rules?.[day.key] || [];
            return (
              <Card
                key={day.key}
                noPadding
              >
                <Card.Content className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-800">{day.label}요일</h3>
                    <Button
                      kind="soft"
                      tone="blue"
                      size="sm"
                      icon={Plus}
                      onClick={() => handleAddRange(day.key)}
                    >
                      시간대 추가
                    </Button>
                  </div>

                  {ranges.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-400">
                      허용 시간대가 없습니다.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {ranges.map((range, index) => (
                        <div
                          key={`${day.key}-${index}`}
                          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2"
                        >
                          <input
                            type="time"
                            value={range.start}
                            onChange={(e) =>
                              handleChangeRange(day.key, index, "start", e.target.value)
                            }
                            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
                          />
                          <span className="text-xs text-slate-400">~</span>
                          <input
                            type="time"
                            value={range.end}
                            onChange={(e) =>
                              handleChangeRange(day.key, index, "end", e.target.value)
                            }
                            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
                          />
                          <Button tone="rose" kind="ghost" size="icon-md"
                            type="button"
                            onClick={() => handleRemoveRange(day.key, index)}
                            className="inline-flex w-8 items-center justify-center transition"
                            aria-label="시간대 삭제"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Content>
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-slate-200 pt-4">
          <Button
            tone="blue"
            size="lg"
            icon={Save}
            isLoading={isSaving || isToggleSaving}
            onClick={handleSave}
            
          >
            시간 설정 저장
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default ClassTimeSettings;
