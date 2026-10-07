import React, { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AlertCircle } from "lucide-react";

import { db } from "../../../firebase";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { Button, InputField, Modal } from "../../../components/ui";
import { getTaxBillLateFeePolicy } from "../../../utils/taxPolicy";

const toFormState = (classData = {}) => {
  const policy = getTaxBillLateFeePolicy(classData);
  return {
    enabled: policy.enabled === true,
    mode: policy.mode === "rate" ? "rate" : "fixed",
    dailyAmount: String(Number(policy.dailyAmount || 0)),
    dailyRate: String(Number(policy.dailyRate || 0)),
  };
};

const sanitizeFormState = (formState) => {
  const enabled = formState.enabled === true;
  const mode = formState.mode === "rate" ? "rate" : "fixed";
  const dailyAmount = Math.max(0, Math.round(Number(formState.dailyAmount || 0)));
  const dailyRate = Math.max(0, Number(formState.dailyRate || 0));

  return {
    enabled,
    mode,
    dailyAmount: enabled && mode === "fixed" ? dailyAmount : 0,
    dailyRate: enabled && mode === "rate" ? dailyRate : 0,
    graceDays: 0,
  };
};

export default function TaxBillLateFeeSettingsModal({
  isOpen,
  onClose,
  classId,
  classData,
}) {
  const { userData } = useUser();
  const { showFeedback } = useFeedback();
  const [formState, setFormState] = useState(() => toFormState(classData));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormState(toFormState(classData));
    }
  }, [classData, isOpen]);

  const sanitizedPolicy = useMemo(
    () => sanitizeFormState(formState),
    [formState],
  );

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target;
    setFormState((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSave = async () => {
    if (!classId) return;

    if (
      sanitizedPolicy.enabled &&
      sanitizedPolicy.mode === "fixed" &&
      sanitizedPolicy.dailyAmount <= 0
    ) {
      showFeedback("고정 연체료를 1 이상으로 입력해 주세요.", "error");
      return;
    }

    if (
      sanitizedPolicy.enabled &&
      sanitizedPolicy.mode === "rate" &&
      sanitizedPolicy.dailyRate <= 0
    ) {
      showFeedback("비율 연체료를 0보다 크게 입력해 주세요.", "error");
      return;
    }

    setIsSaving(true);
    try {
      await updateDoc(doc(db, "classes", classId), {
        "taxPolicy.billLateFee": sanitizedPolicy,
        "taxPolicy.updatedAt": serverTimestamp(),
        "taxPolicy.updatedBy": userData?.uid || null,
      });
      showFeedback("고지서 기본 연체료 설정을 저장했습니다.", "success");
      onClose();
    } catch (error) {
      console.error("[TaxBillLateFeeSettingsModal] save failed:", error);
      showFeedback("고지서 기본 연체료 설정 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="고지서 연체료 기본 설정" size="md">
      <div className="space-y-5">
        <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span>
            <span className="block text-sm font-black text-slate-800">
              새 고지서에 기본 연체료 적용
            </span>
            <span className="block text-xs font-medium text-slate-500">
              수동 고지서, 소득정산 고지서, 보유세 고지서에 발급 시점 정책이 저장됩니다.
            </span>
          </span>
          <input
            type="checkbox"
            name="enabled"
            checked={formState.enabled}
            onChange={handleChange}
            className="h-5 w-5 rounded border-slate-300 text-indigo-600"
          />
        </label>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
            <Button
              type="button"
              onClick={() => setFormState((prev) => ({ ...prev, mode: "fixed" }))}
              size="sm"
              tone="blue"
              kind={formState.mode === "fixed" ? "soft" : "ghost"}
              rounded="xl"
              className={`rounded-xl px-3 py-2 text-sm font-black transition ${
                formState.mode === "fixed"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              하루 고정액
            </Button>
            <Button
              type="button"
              onClick={() => setFormState((prev) => ({ ...prev, mode: "rate" }))}
              size="sm"
              tone="blue"
              kind={formState.mode === "rate" ? "soft" : "ghost"}
              rounded="xl"
              className={`rounded-xl px-3 py-2 text-sm font-black transition ${
                formState.mode === "rate"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              하루 비율
            </Button>
          </div>

          <div className="grid gap-4">
            {formState.mode === "fixed" ? (
              <InputField
                label="하루 연체료"
                name="dailyAmount"
                type="number"
                min="0"
                value={formState.dailyAmount}
                onChange={handleChange}
                disabled={!formState.enabled}
              />
            ) : (
              <InputField
                label="하루 연체율(%)"
                name="dailyRate"
                type="number"
                min="0"
                step="0.1"
                value={formState.dailyRate}
                onChange={handleChange}
                disabled={!formState.enabled}
              />
            )}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            이미 발급된 고지서는 바뀌지 않습니다. 새 고지서에는 발급 당시의 연체료
            설정이 적용됩니다.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
            닫기
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            저장
          </Button>
        </div>
      </div>
    </Modal>
  );
}
