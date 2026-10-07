import React, { useMemo } from "react";
import StudentSelector from "../ui/StudentSelector";
import { Shield, Users, Eye, Save, CalendarClock, Power } from "lucide-react";
import { Button } from "../ui";

function formatDeadlineInputValue(deadline) {
  if (!deadline) return "";
  try {
    const date = deadline?.toDate
      ? deadline.toDate()
      : deadline instanceof Date
        ? deadline
        : new Date(deadline);
    if (Number.isNaN(date.getTime())) return "";

    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  } catch {
    return "";
  }
}

function makeDefaultDeadlineInput() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function SurveyResultsSettings({
  survey,
  onChange,
  onSave,
  disabled = false,
  compact = false,
}) {
  const {
    resultsRelease = "after_submit",
    resultsWhitelistUids = [],
    exposeIdentifiableResponses = false,
    minResponsesToShow = 0,
    deadline = null,
    isActive = true,
  } = survey || {};

  const isAllOpen = useMemo(
    () => !resultsWhitelistUids || resultsWhitelistUids.length === 0,
    [resultsWhitelistUids]
  );
  const deadlineInputValue = useMemo(
    () => formatDeadlineInputValue(deadline),
    [deadline]
  );
  const defaultDeadlineInput = useMemo(() => makeDefaultDeadlineInput(), []);

  const sectionClass = compact
    ? "rounded-xl border border-slate-200 bg-slate-50 p-3"
    : "rounded-xl border border-gray-200 bg-white p-4";
  const rowClass = "flex flex-wrap items-center gap-2";
  const labelClass = "w-[88px] shrink-0 text-sm font-semibold text-gray-900";

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            설문 결과 공개/마감 설정
          </h3>
        </div>
      )}

      <section className={sectionClass}>
        <div className="space-y-3">
          <div className={rowClass}>
            <div className={labelClass}>공개 시점</div>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="resultsRelease"
                value="after_submit"
                checked={resultsRelease === "after_submit"}
                onChange={() => onChange({ resultsRelease: "after_submit" })}
                disabled={disabled}
              />
              제출 후 공개
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="resultsRelease"
                value="after_deadline"
                checked={resultsRelease === "after_deadline"}
                onChange={() => onChange({ resultsRelease: "after_deadline" })}
                disabled={disabled}
              />
              마감 후 공개
            </label>
          </div>

          <div className={rowClass}>
            <div className={`${labelClass} inline-flex items-center gap-1`}>
              <CalendarClock className="h-4 w-4 text-blue-600" />
              자동 마감
            </div>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!deadline}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({
                      deadline: deadlineInputValue || defaultDeadlineInput,
                    });
                  } else {
                    onChange({ deadline: null });
                  }
                }}
                disabled={disabled}
              />
              기한 사용
            </label>
            {!!deadline && (
              <>
                <input
                  type="datetime-local"
                  value={deadlineInputValue}
                  onChange={(e) => onChange({ deadline: e.target.value || null })}
                  disabled={disabled}
                  className="h-8 rounded-md border border-gray-300 px-2 text-xs"
                />
                <Button variant="ghost" kind="ghost"
                  type="button"
                  onClick={() => onChange({ deadline: null })}
                  disabled={disabled}
                  className="h-8 rounded-md bg-gray-100 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  해제
                </Button>
              </>
            )}
          </div>

          <div className={rowClass}>
            <div className={`${labelClass} inline-flex items-center gap-1`}>
              <Power className="h-4 w-4 text-orange-600" />
              수동 마감
            </div>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="isActive"
                checked={isActive !== false}
                onChange={() => onChange({ isActive: true })}
                disabled={disabled}
              />
              진행 중
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="isActive"
                checked={isActive === false}
                onChange={() => onChange({ isActive: false })}
                disabled={disabled}
              />
              수동 마감
            </label>
          </div>

          <div className={rowClass}>
            <div className={labelClass}>식별 공개</div>
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!exposeIdentifiableResponses}
                onChange={(e) =>
                  onChange({ exposeIdentifiableResponses: e.target.checked })
                }
                disabled={disabled}
              />
              개별 응답 이름 표시
            </label>
          </div>

          <div className={rowClass}>
            <div className={labelClass}>최소 응답</div>
            <input
              type="number"
              min={0}
              step={1}
              value={Number(minResponsesToShow) || 0}
              onChange={(e) =>
                onChange({
                  minResponsesToShow: Math.max(0, Number(e.target.value || 0)),
                })
              }
              disabled={disabled}
              className="h-8 w-24 rounded-md border border-gray-300 px-2 text-sm"
            />
            <span className="text-xs text-gray-500">명 이상일 때 공개</span>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="mb-2 font-semibold text-gray-900">공개 대상</div>
        <div className="mb-2 flex items-center gap-2 text-sm text-gray-700">
          <Users className="h-4 w-4 text-gray-500" />
          <span>
            현재: {isAllOpen ? "전체 학생" : `지정 학생 ${resultsWhitelistUids.length}명`}
          </span>
        </div>
        <StudentSelector
          label="결과 보기 허용 학생"
          selectedUids={resultsWhitelistUids || []}
          onChange={(uids) => onChange({ resultsWhitelistUids: uids })}
          multiple
          includeTeacher={false}
        />
      </section>

      {onSave && (
        <div className="flex justify-end">
          <Button variant="ghost" kind="ghost"
            type="button"
            onClick={onSave}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Eye className="h-4 w-4" />
            <Save className="h-4 w-4" />
            <span className="text-sm font-semibold">설정 저장</span>
          </Button>
        </div>
      )}
    </div>
  );
}
