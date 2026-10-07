import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Button,
  Tabs,
  InputField,
  StudentSelector,
} from "../../../components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  popupEnabled: false,
  popupMode: "dismissible", // dismissible | mandatory_phrase
  popupTarget: "all", // all | selected_students
  popupTargetUids: [],
  popupStartAt: "",
  popupEndAt: "",
  popupDismissUntilType: "today", // today | days | until_end
  popupDismissDays: 3,
  popupAckPhrase: "",
};

const sanitizeUidList = (value) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set(
    value
      .map((uid) => String(uid || "").trim())
      .filter((uid) => uid.length > 0),
  );
  return Array.from(unique);
};

const toDateSafe = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getPopupWindowMaxDismissDays = (startAt, endAt) => {
  const start = toDateSafe(startAt);
  const end = toDateSafe(endAt);
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  if (diff < 0) return null;
  return Math.max(1, Math.ceil(diff / DAY_MS));
};

const PopupSettingsModal = ({ isOpen, onClose, initialSettings, onSave }) => {
  const [draft, setDraft] = useState(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState("dismissible");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const next = { ...DEFAULT_SETTINGS, ...(initialSettings || {}) };
    next.popupTarget =
      next.popupTarget === "selected_students" ? "selected_students" : "all";
    next.popupTargetUids = sanitizeUidList(next.popupTargetUids);
    setDraft(next);
    setActiveTab(
      next.popupMode === "mandatory_phrase" ? "mandatory_phrase" : "dismissible",
    );
    setError("");
  }, [isOpen, initialSettings]);

  const tabItems = useMemo(
    () => [
      { id: "dismissible", label: "닫기 가능" },
      { id: "mandatory_phrase", label: "문구 입력 필수" },
    ],
    [],
  );

  const maxDismissDays = useMemo(
    () => getPopupWindowMaxDismissDays(draft.popupStartAt, draft.popupEndAt),
    [draft.popupStartAt, draft.popupEndAt],
  );

  useEffect(() => {
    if (draft.popupDismissUntilType !== "days") return;
    if (!maxDismissDays) return;
    const current = Number(draft.popupDismissDays || 1);
    if (current <= maxDismissDays) return;
    setDraft((prev) => ({ ...prev, popupDismissDays: maxDismissDays }));
  }, [draft.popupDismissUntilType, draft.popupDismissDays, maxDismissDays]);

  const updateDraft = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError("");
  };

  const validate = () => {
    if (!draft.popupEnabled) return "";
    if (activeTab === "dismissible" && (!draft.popupStartAt || !draft.popupEndAt)) {
      return "팝업 사용 시 시작/종료 시간을 입력해 주세요.";
    }
    if (
      activeTab === "dismissible" &&
      new Date(draft.popupStartAt) > new Date(draft.popupEndAt)
    ) {
      return "시작 시간은 종료 시간보다 늦을 수 없습니다.";
    }
    if (
      draft.popupTarget === "selected_students" &&
      sanitizeUidList(draft.popupTargetUids).length === 0
    ) {
      return "선택 학생 대상을 사용하려면 최소 1명 이상 선택해 주세요.";
    }
    if (
      activeTab === "mandatory_phrase" &&
      !String(draft.popupAckPhrase || "").trim()
    ) {
      return "문구 입력 필수 모드에서는 확인 문구가 필요합니다.";
    }
    if (
      activeTab === "dismissible" &&
      draft.popupDismissUntilType === "days" &&
      Number(draft.popupDismissDays || 0) <= 0
    ) {
      return "다시 보지 않기 일수는 1일 이상이어야 합니다.";
    }
    if (
      activeTab === "dismissible" &&
      draft.popupDismissUntilType === "days" &&
      maxDismissDays &&
      Number(draft.popupDismissDays || 1) > maxDismissDays
    ) {
      return `N일은 팝업 기간 기준 최대 ${maxDismissDays}일까지 설정할 수 있습니다.`;
    }
    return "";
  };

  const handleSave = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const rawDismissDays = Math.max(1, Number(draft.popupDismissDays || 1));
    const cappedDismissDays = maxDismissDays
      ? Math.min(rawDismissDays, maxDismissDays)
      : rawDismissDays;

    const payload = {
      ...draft,
      popupMode: activeTab,
      popupTarget:
        draft.popupTarget === "selected_students" ? "selected_students" : "all",
      popupTargetUids:
        draft.popupTarget === "selected_students"
          ? sanitizeUidList(draft.popupTargetUids)
          : [],
      popupDismissDays: cappedDismissDays,
      popupAckPhrase:
        activeTab === "mandatory_phrase"
          ? String(draft.popupAckPhrase || "").trim()
          : "",
      popupStartAt: activeTab === "dismissible" ? draft.popupStartAt : "",
      popupEndAt: activeTab === "dismissible" ? draft.popupEndAt : "",
    };
    onSave?.(payload);
    onClose?.();
  };

  const selectedStudentCount = sanitizeUidList(draft.popupTargetUids).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="팝업 설정" size="lg">
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/70">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={!!draft.popupEnabled}
              onChange={(e) => updateDraft("popupEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm font-semibold text-slate-700">
              이 뉴스를 긴급 팝업으로 사용
            </span>
          </label>
        </div>

        <Tabs
          tabs={tabItems}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
        />

        {activeTab === "dismissible" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputField
            type="datetime-local"
            label="팝업 시작"
            value={draft.popupStartAt || ""}
            onChange={(e) => updateDraft("popupStartAt", e.target.value)}
            disabled={!draft.popupEnabled}
          />
          <InputField
            type="datetime-local"
            label="팝업 종료"
            value={draft.popupEndAt || ""}
            onChange={(e) => updateDraft("popupEndAt", e.target.value)}
            disabled={!draft.popupEnabled}
          />
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            문구 입력 필수 모드에서는 기간 설정이 필요 없습니다.
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-700">팝업 대상</p>
          <div className="space-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="popupTarget"
                checked={draft.popupTarget === "all"}
                onChange={() => updateDraft("popupTarget", "all")}
                disabled={!draft.popupEnabled}
              />
              전체
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="popupTarget"
                checked={draft.popupTarget === "selected_students"}
                onChange={() => updateDraft("popupTarget", "selected_students")}
                disabled={!draft.popupEnabled}
              />
              선택 학생
            </label>
          </div>

          {draft.popupTarget === "selected_students" && (
            <div className="pt-2">
              <StudentSelector
                label={`대상 학생 선택 (${selectedStudentCount}명)`}
                selectedUids={sanitizeUidList(draft.popupTargetUids)}
                onChange={(uids) =>
                  updateDraft("popupTargetUids", sanitizeUidList(uids))
                }
                disabled={!draft.popupEnabled}
              />
            </div>
          )}
        </div>

        {activeTab === "dismissible" ? (
          <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
            <p className="text-sm font-semibold text-slate-700">닫기/숨김 규칙</p>
            <div className="space-y-2 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="popupDismissRule"
                  checked={draft.popupDismissUntilType === "today"}
                  onChange={() => updateDraft("popupDismissUntilType", "today")}
                  disabled={!draft.popupEnabled}
                />
                오늘 하루 보지 않기
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="popupDismissRule"
                  checked={draft.popupDismissUntilType === "days"}
                  onChange={() => updateDraft("popupDismissUntilType", "days")}
                  disabled={!draft.popupEnabled}
                />
                N일 동안 보지 않기
              </label>
              {draft.popupDismissUntilType === "days" && (
                <div>
                  <InputField
                    type="number"
                    min={1}
                    max={maxDismissDays || undefined}
                    label="일수"
                    value={draft.popupDismissDays || 1}
                    onChange={(e) =>
                      updateDraft("popupDismissDays", e.target.value)
                    }
                    disabled={!draft.popupEnabled}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {maxDismissDays
                      ? `팝업 기간 기준 최대 ${maxDismissDays}일까지 설정할 수 있습니다.`
                      : "팝업 시작/종료 시간을 먼저 입력하면 최대치를 자동으로 계산합니다."}
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="popupDismissRule"
                  checked={draft.popupDismissUntilType === "until_end"}
                  onChange={() =>
                    updateDraft("popupDismissUntilType", "until_end")
                  }
                  disabled={!draft.popupEnabled}
                />
                팝업 종료 시각까지 숨김
              </label>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">
              확인 문구(필수 입력)
            </p>
            <InputField
              label="필수 문구"
              value={draft.popupAckPhrase || ""}
              onChange={(e) => updateDraft("popupAckPhrase", e.target.value)}
              placeholder="사용자가 정확히 입력해야 할 문구를 입력하세요"
              disabled={!draft.popupEnabled}
            />
            <p className="text-xs text-slate-500">
              이 모드에서는 문구를 정확히 입력해야 팝업을 닫을 수 있습니다.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button tone="blue" onClick={handleSave}>
            팝업 설정 저장
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default PopupSettingsModal;
