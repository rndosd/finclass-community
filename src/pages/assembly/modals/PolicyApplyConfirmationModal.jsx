import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useState } from "react";
import { Modal, Button, Badge } from "../../../components/ui";
import {
  Shield,
  AlertCircle,
  AlertTriangle,
  DollarSign,
  CreditCard,
} from "lucide-react";
import { getBillProposerDisplayName } from "../utils/billDisplay";

const DANGER_LEVEL_OPTIONS = [
  {
    value: 1,
    label: "낮음",
    icon: Shield,
    color: "green",
    selectedCardClass:
      "bg-green-50 hover:bg-green-100 border-green-300 shadow-md",
    selectedIconClass: "bg-green-100",
    selectedCheckClass: "bg-green-500",
    textColor: "text-green-700",
    mutedTextColor: "text-green-600",
    iconColor: "text-green-600",
    description: "가벼운 경고성 규칙으로 반영됩니다.",
  },
  {
    value: 2,
    label: "보통",
    icon: AlertCircle,
    color: "yellow",
    selectedCardClass:
      "bg-yellow-50 hover:bg-yellow-100 border-yellow-300 shadow-md",
    selectedIconClass: "bg-yellow-100",
    selectedCheckClass: "bg-yellow-500",
    textColor: "text-yellow-700",
    mutedTextColor: "text-yellow-600",
    iconColor: "text-yellow-600",
    description: "일반적인 생활 규칙으로 반영됩니다.",
  },
  {
    value: 3,
    label: "높음",
    icon: AlertTriangle,
    color: "red",
    selectedCardClass:
      "bg-red-50 hover:bg-red-100 border-red-300 shadow-md",
    selectedIconClass: "bg-red-100",
    selectedCheckClass: "bg-red-500",
    textColor: "text-red-700",
    mutedTextColor: "text-red-600",
    iconColor: "text-red-600",
    description: "위반 시 영향이 큰 규칙으로 반영됩니다.",
  },
];

const PolicyApplyConfirmationModal = ({
  isOpen,
  onClose,
  bill,
  onConfirm,
  isLoading,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const [selectedDangerLevel, setSelectedDangerLevel] = useState(2);

  if (!bill) return null;

  const selectedOption = DANGER_LEVEL_OPTIONS.find(
    (option) => option.value === selectedDangerLevel
  );
  const proposerDisplayName = getBillProposerDisplayName(bill, true);

  const handleConfirm = () => {
    onConfirm(bill.id, selectedDangerLevel);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="정책 반영 확인" size="lg">
      <div className="space-y-6">
        <div className="rounded-lg border bg-slate-50 p-4">
          <h3 className="mb-2 text-lg font-semibold text-slate-800">{bill.title}</h3>
          <p className="mb-3 text-sm text-slate-600">제안자: {proposerDisplayName}</p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-md border bg-white p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
                <DollarSign className="text-amber-600" size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500">벌금/상금</p>
                <p className="font-bold text-slate-800">
                  {formatDisplayMoney(bill.policeRuleData?.fineAmount) || "0"}원
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-md border bg-white p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                <CreditCard className="text-blue-600" size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500">신용점수 변화</p>
                <p className="font-bold text-slate-800">
                  {bill.policeRuleData?.creditChange > 0 && "+"}
                  {bill.policeRuleData?.creditChange || 0}점
                </p>
              </div>
            </div>
          </div>

          {bill.policeRuleData?.notes && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm text-blue-800">
                <span className="font-medium">참고사항:</span> {bill.policeRuleData.notes}
              </p>
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-3 font-semibold text-slate-800">위험도 선택</h4>
          <p className="mb-4 text-sm text-slate-600">
            반영할 규칙의 위험도를 선택해 주세요. 위험도에 따라 정렬과 분류가
            달라집니다.
          </p>

          <div className="grid grid-cols-1 gap-3">
            {DANGER_LEVEL_OPTIONS.map((option) => {
              const IconComponent = option.icon;
              const isSelected = selectedDangerLevel === option.value;

              return (
                <Button
                  key={option.value}
                  onClick={() => setSelectedDangerLevel(option.value)}
                  className={[
                    "relative rounded-lg border-2 p-4 text-left transition-all duration-200",
                    isSelected
                      ? option.selectedCardClass
                      : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={[
                        "flex h-10 w-10 items-center justify-center rounded-full",
                        isSelected ? option.selectedIconClass : "bg-gray-100",
                      ].join(" ")}
                    >
                      <IconComponent
                        className={isSelected ? option.iconColor : "text-gray-500"}
                        size={20}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={[
                            "font-semibold",
                            isSelected ? option.textColor : "text-gray-700",
                          ].join(" ")}
                        >
                          위험도 {option.label}
                        </span>
                        {isSelected && (
                          <Badge color={option.color} size="sm">
                            선택됨
                          </Badge>
                        )}
                      </div>
                      <p
                        className={[
                          "text-sm",
                          isSelected ? option.mutedTextColor : "text-gray-500",
                        ].join(" ")}
                      >
                        {option.description}
                      </p>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="absolute right-2 top-2">
                      <div
                        className={[
                          "flex h-6 w-6 items-center justify-center rounded-full",
                          option.selectedCheckClass,
                        ].join(" ")}
                      >
                        <svg
                          className="h-4 w-4 text-white"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    </div>
                  )}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100">
              <svg
                className="h-4 w-4 text-indigo-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="mb-1 text-sm font-medium text-indigo-800">반영 전 안내</p>
              <p className="text-sm text-indigo-700">
                이 법안은 "<strong>{selectedOption?.label}</strong>" 위험도로
                반영됩니다. 반영 후에는 경찰 규칙 목록에 추가되고 다시 적용할 수
                없습니다.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            취소
          </Button>
          <Button
            color="blue"
            onClick={handleConfirm}
            isLoading={isLoading}
            disabled={isLoading}
          >
            규칙에 적용
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default PolicyApplyConfirmationModal;
