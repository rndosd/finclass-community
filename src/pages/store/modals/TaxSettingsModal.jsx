import React, { useEffect, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Landmark, Percent } from "lucide-react";

import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { Button, Modal, ToggleSwitch } from "../../../components/ui";
import { getStoreTreasuryMode } from "../../../utils/taxPolicy";

const TaxSettingsModal = ({ isOpen, onClose }) => {
  const { classId, classData, userData } = useUser();
  const { showFeedback } = useFeedback();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taxRate, setTaxRate] = useState("");
  const [isConsumptionTaxEnabled, setIsConsumptionTaxEnabled] = useState(false);

  useEffect(() => {
    if (!classData || !isOpen) return;
    setTaxRate(classData?.settings?.taxRate ?? classData?.taxRate ?? 10);
    setIsConsumptionTaxEnabled(getStoreTreasuryMode(classData) !== "NONE");
  }, [classData, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!classId) return;

    setIsSubmitting(true);
    try {
      const storeMode = isConsumptionTaxEnabled ? "TAX_ONLY" : "NONE";
      await updateDoc(doc(db, "classes", classId), {
        "settings.taxRate": Number(taxRate) || 0,
        "settings.updatedAt": serverTimestamp(),
        "settings.updatedBy": userData?.uid || null,
        "taxPolicy.treasury.store.mode": storeMode,
        "taxSettings.storeMode": storeMode,
      });

      showFeedback("상점 소비세 설정을 저장했습니다.", "success");
      onClose?.();
    } catch (error) {
      showFeedback(
        error.message || "상점 소비세 설정 저장 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      closeOnOverlayClick={!isSubmitting}
    >
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-600 p-2 text-white">
            <Landmark className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">상점 소비세 설정</h2>
            <p className="text-sm text-gray-600">
              현금 구매에 적용할 소비세를 간단히 설정합니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <form id="tax-settings-form" onSubmit={handleSubmit} className="space-y-6">
          <div
            className={`rounded-2xl border p-4 ${
              isConsumptionTaxEnabled
                ? "border-indigo-200 bg-indigo-50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-900">
                  상점 소비세 사용
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {isConsumptionTaxEnabled
                    ? "현금 구매의 소비세가 기록되고 국고 집계에 포함됩니다."
                    : "학생에게 소비세가 표시되거나 기록되지 않습니다."}
                </p>
              </div>
              <ToggleSwitch
                id="store-consumption-tax-enabled"
                checked={isConsumptionTaxEnabled}
                onChange={setIsConsumptionTaxEnabled}
                disabled={isSubmitting}
                srLabel="상점 소비세 사용"
                tone="indigo"
              />
            </div>
          </div>

          <div
            className={`rounded-2xl border p-4 transition-opacity ${
              isConsumptionTaxEnabled
                ? "border-blue-200 bg-blue-50"
                : "border-slate-200 bg-slate-50 opacity-60"
            }`}
          >
            <div className="mb-3 flex items-center gap-2">
              <Percent className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-bold text-blue-900">
                기본 소비세율 (%)
              </span>
            </div>
            <input
              type="number"
              min="0"
              step="0.1"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              disabled={!isConsumptionTaxEnabled || isSubmitting}
              className="w-full rounded-xl border border-blue-300 px-4 py-2 font-bold outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-2 text-xs text-slate-600">
              상품별 개별 세율과 면세 여부는 상품 편집에서 설정합니다.
            </p>
          </div>
        </form>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full gap-3">
          <Button kind="outline" fullWidth onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            type="submit"
            form="tax-settings-form"
            tone="blue"
            fullWidth
            isLoading={isSubmitting}
          >
            설정 저장
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default TaxSettingsModal;
