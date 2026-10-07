// src/pages/bank/bankadmin/modals/TierRateAdjustmentModal.jsx
import React, { useState, useEffect, useCallback } from "react";
import { db } from "../../../../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  Button,
  Modal,
  InputField,
  Spinner,
  Alert, // Alert 컴포넌트 활용
} from "../../../../components/ui";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import {
  CreditCard,
  Info,
  CheckCircle2,
  HandCoins,
  PiggyBank,
} from "lucide-react"; // 아이콘이 없다면 이 부분은 제거하거나 텍스트로 대체 가능
import {
  describeRateAdjustment,
  parseSignedRateModifier,
} from "./tierRateAdjustmentPolicy";

export default function TierRateAdjustmentModal({
  isOpen,
  onClose,
  classId,
  currencyUnit = "단위",
  ...modalProps
}) {
  const { showFeedback } = useFeedback();
  const [adjustments, setAdjustments] = useState({});
  const [definedTiers, setDefinedTiers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 설정 불러오기
  const fetchSettings = useCallback(async () => {
    if (!classId) return;
    setIsLoading(true);

    try {
      // 1) 등급 목록
      const tierCriteriaRef = doc(
        db,
        "classes",
        classId,
        "tierCriteria",
        "default",
      );
      const tierSnap = await getDoc(tierCriteriaRef);
      const tiers = tierSnap.exists() ? tierSnap.data()?.tiers || [] : [];
      const sortedTiers = [...tiers].sort((a, b) => b.minScore - a.minScore);
      setDefinedTiers(sortedTiers);

      // 2) 저장된 설정
      const adjRef = doc(
        db,
        "classes",
        classId,
        "bankConfig",
        "tierAdjustments",
      );
      const adjSnap = await getDoc(adjRef);
      const savedByTier = adjSnap.exists() ? adjSnap.data()?.byTier || {} : {};

      const initial = {};
      sortedTiers.forEach((t) => {
        const saved = savedByTier[t.name] || {};

        initial[t.name] = {
          depositRateModifier: saved.depositRateModifier?.toString() || "",
          loanRateModifier: saved.loanRateModifier?.toString() || "",
          transferFee: saved.transferFee?.toString() || "0",
        };
      });
      setAdjustments(initial);
    } catch (e) {
      console.error("설정 로딩 오류:", e);
      showFeedback("설정 정보를 불러오는 중 오류가 발생했습니다.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [classId, showFeedback]);

  useEffect(() => {
    if (isOpen) fetchSettings();
  }, [isOpen, fetchSettings]);

  const handleChange = (tierName, field, value) => {
    setAdjustments((prev) => ({
      ...prev,
      [tierName]: { ...prev[tierName], [field]: value },
    }));
  };

  const handleSave = async () => {
    const byTierToSave = {};

    for (const t of definedTiers) {
      const entry = adjustments[t.name] || {};

      const depInput =
        entry.depositRateModifier === ""
          ? 0
          : parseSignedRateModifier(entry.depositRateModifier);
      const loanInput =
        entry.loanRateModifier === ""
          ? 0
          : parseSignedRateModifier(entry.loanRateModifier);
      const feeInput =
        entry.transferFee === "" ? 0 : parseInt(entry.transferFee, 10);

      // 유효성 검사
      if (isNaN(depInput) || isNaN(loanInput)) {
        showFeedback(`'${t.name}' 등급에 유효한 숫자를 입력해주세요.`, "error");
        return;
      }
      if (isNaN(feeInput) || feeInput < 0) {
        showFeedback(
          `'${t.name}' 등급의 수수료는 0 이상의 정수여야 합니다.`,
          "error",
        );
        return;
      }

      byTierToSave[t.name] = {
        depositRateModifier: depInput,
        loanRateModifier: loanInput,
        transferFee: feeInput,
      };
    }

    try {
      const ref = doc(db, "classes", classId, "bankConfig", "tierAdjustments");
      await setDoc(ref, { byTier: byTierToSave }, { merge: true });
      showFeedback("등급별 금리 조정을 저장했습니다.", "success");
      onClose?.();
    } catch (e) {
      console.error("저장 오류:", e);
      showFeedback(`저장 실패: ${e.message}`, "error");
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="신용등급별 금리 조정"
      size="xl" // 모달 크기 살짝 키움
      {...modalProps}
    >
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : definedTiers.length === 0 ? (
        <Alert
          type="info"
          message="설정된 신용등급이 없습니다. '신용등급 관리' 메뉴에서 먼저 등급을 생성해주세요."
        />
      ) : (
        <div className="flex flex-col h-full">
          {/* 💡 상단 안내 가이드 (Card 형태) */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mb-5 shadow-sm">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
              <div className="text-sm text-indigo-800 space-y-1">
                <p className="font-bold text-base mb-1">
                  부호를 포함한 주간 금리 조정값을 입력합니다.
                </p>
                <ul className="list-disc list-inside space-y-1 ml-1 text-indigo-700">
                  <li>
                    금리 조정값은 <strong>1주(7일) 기준</strong>으로 계산되어
                    적용됩니다.
                  </li>
                  <li>
                    <strong>양수(+)</strong>는 금리를 올리고, <strong>음수(-)</strong>는 금리를 낮춥니다.
                  </li>
                  <li>
                    <strong>예금 -1:</strong> 기본 예금금리에서 주당 1%p 차감
                  </li>
                  <li>
                    <strong>대출 +1:</strong> 기본 대출금리에 주당 1%p 가산
                  </li>
                  <li>
                    <strong>수수료:</strong> 퍼센트(%)가 아닌{" "}
                    <strong>{`고정 금액(${currencyUnit})`}</strong>입니다.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* 등급 리스트 영역 */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-4 max-h-[60vh]">
            {definedTiers.map((tier) => (
              <div
                key={tier.id || tier.name}
                className="border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden"
              >
                {/* 등급 헤더 */}
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="bg-slate-800 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                      {tier.name}
                    </span>
                    <span className="text-slate-500 text-xs">
                      기준: {tier.minScore}점 이상
                    </span>
                  </div>
                </div>

                {/* 입력 필드 그리드 */}
                <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* 1. 예금 금리 조정 */}
                  <div className="space-y-1">
                    <label
                      htmlFor={`dep-${tier.name}`}
                      className="block text-sm font-semibold text-blue-700 flex items-center gap-1"
                    >
                      <PiggyBank className="w-4 h-4" /> 예금 금리 조정 (%p/주)
                    </label>
                    <div className="relative">
                      <InputField
                        id={`dep-${tier.name}`}
                        type="number"
                        step="0.1"
                        placeholder="예: -1 또는 0.5"
                        value={
                          adjustments[tier.name]?.depositRateModifier ?? ""
                        }
                        onChange={(e) =>
                          handleChange(
                            tier.name,
                            "depositRateModifier",
                            e.target.value,
                          )
                        }
                        className="pl-2 pr-8 border-blue-200 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-slate-400">
                        %p
                      </span>
                    </div>
                    <p className="text-xs text-blue-600/80">
                      {describeRateAdjustment(
                        "deposit",
                        adjustments[tier.name]?.depositRateModifier,
                      )}
                    </p>
                  </div>

                  {/* 2. 대출 금리 조정 */}
                  <div className="space-y-1">
                    <label
                      htmlFor={`loan-${tier.name}`}
                      className="block text-sm font-semibold text-rose-700 flex items-center gap-1"
                    >
                      <HandCoins className="w-4 h-4" /> 대출 금리 조정
                      (%p/주)
                    </label>
                    <div className="relative">
                      <InputField
                        id={`loan-${tier.name}`}
                        type="number"
                        step="0.1"
                        placeholder="예: 1 또는 -0.5"
                        value={adjustments[tier.name]?.loanRateModifier ?? ""}
                        onChange={(e) =>
                          handleChange(
                            tier.name,
                            "loanRateModifier",
                            e.target.value,
                          )
                        }
                        className="pl-2 pr-8 border-rose-200 focus:ring-rose-500 focus:border-rose-500"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-slate-400">
                        %p
                      </span>
                    </div>
                    <p className="text-xs text-rose-600/80">
                      {describeRateAdjustment(
                        "loan",
                        adjustments[tier.name]?.loanRateModifier,
                      )}
                    </p>
                  </div>

                  {/* 3. 송금 수수료 (회색/중립) */}
                  <div className="space-y-1">
                    <label
                      htmlFor={`fee-${tier.name}`}
                      className="block text-sm font-semibold text-slate-700 flex items-center gap-1"
                    >
                      <CreditCard className="w-4 h-4" /> 송금 수수료
                    </label>
                    <div className="relative">
                      <InputField
                        id={`fee-${tier.name}`}
                        type="number"
                        step="1"
                        placeholder="0"
                        value={adjustments[tier.name]?.transferFee ?? ""}
                        onChange={(e) =>
                          handleChange(tier.name, "transferFee", e.target.value)
                        }
                        className="pl-2 pr-12 border-slate-300"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-slate-400">
                        {`${currencyUnit}(건)`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {adjustments[tier.name]?.transferFee === "0" ||
                      adjustments[tier.name]?.transferFee === 0 ? (
                        <span className="text-emerald-600 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> 수수료 무료
                        </span>
                      ) : (
                        `건당 ${adjustments[tier.name]?.transferFee || 0}${currencyUnit} 차감`
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-5 border-t border-slate-100 mt-4 bg-white sticky bottom-0">
            <Button size="md" onClick={onClose} variant="secondary" >
              취소
            </Button>
            <Button tone="blue" kind="solid" size="md"
              onClick={handleSave}
              
            >
              모든 설정 저장하기
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
