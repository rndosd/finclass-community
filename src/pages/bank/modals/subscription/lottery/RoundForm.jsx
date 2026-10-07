import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../../components/ui";

const RoundForm = ({
  product,
  nextRoundNumber = 1,
  isEditMode = false,
  editingRound,
  createRound,
  updateRound,
  onSuccess,
  onCancel,
  showFeedback,
  roundsLoading,
}) => {
  const [roundForm, setRoundForm] = useState({
    title: "",
    description: "",
    selectionMethod: "lottery",
    requiredPayments: 10,
    winnerCount: 3,
    weights: { paymentCount: 0.6, totalAmount: 0.4 },
    preventDuplicateWinners: true,
  });

  useEffect(() => {
    if (isEditMode && editingRound) {
      setRoundForm({
        title: editingRound.title || "",
        description: editingRound.description || "",
        selectionMethod: editingRound.selectionMethod || "lottery",
        requiredPayments: Number(editingRound.requiredPayments || 10),
        winnerCount: Number(editingRound.winnerCount || 3),
        weights: editingRound.weights || { paymentCount: 0.6, totalAmount: 0.4 },
        preventDuplicateWinners: editingRound.preventDuplicateWinners !== false,
      });
      return;
    }

    setRoundForm({
      title: "",
      description: "",
      selectionMethod: "lottery",
      requiredPayments: 10,
      winnerCount: 3,
      weights: { paymentCount: 0.6, totalAmount: 0.4 },
      preventDuplicateWinners: true,
    });
  }, [isEditMode, editingRound]);

  const effectiveTitle = useMemo(() => {
    return roundForm.title?.trim()
      ? roundForm.title.trim()
      : `${product?.title || "상품"} ${nextRoundNumber}회차 추첨`;
  }, [roundForm.title, product?.title, nextRoundNumber]);

  const handleWeightChange = (type, value) => {
    const target = Math.max(0, Math.min(1, Number(value)));
    const other = 1 - target;
    setRoundForm((prev) => ({
      ...prev,
      weights: {
        paymentCount: type === "paymentCount" ? target : other,
        totalAmount: type === "totalAmount" ? target : other,
      },
    }));
  };

  const validate = () => {
    if (!effectiveTitle) {
      showFeedback?.("회차명을 입력하거나 기본 제목을 사용하세요.", "error");
      return false;
    }
    if (Number(roundForm.requiredPayments) < 1) {
      showFeedback?.("필요 납입 횟수는 1 이상이어야 합니다.", "error");
      return false;
    }
    if (Number(roundForm.winnerCount) < 1) {
      showFeedback?.("당첨자 수는 1 이상이어야 합니다.", "error");
      return false;
    }
    if (roundForm.selectionMethod === "score_ranking") {
      const w = roundForm.weights || {};
      const sum = Number(w.paymentCount || 0) + Number(w.totalAmount || 0);
      if (sum <= 0) {
        showFeedback?.("가점제 가중치가 올바르지 않습니다.", "error");
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload = {
      title: effectiveTitle,
      description: roundForm.description,
      selectionMethod: roundForm.selectionMethod,
      requiredPayments: Number(roundForm.requiredPayments),
      winnerCount: Number(roundForm.winnerCount),
      preventDuplicateWinners: !!roundForm.preventDuplicateWinners,
      ...(roundForm.selectionMethod === "score_ranking" && {
        weights: roundForm.weights,
      }),
    };

    const rawResult = isEditMode
      ? await updateRound(editingRound.id, payload)
      : await createRound(payload);
    const result = rawResult?.data || rawResult;

    if (result?.success) {
      showFeedback?.(
        isEditMode
          ? "추첨 회차가 수정되었습니다."
          : "추첨 회차가 생성되었습니다.",
        "success",
      );
      onSuccess?.(isEditMode ? "updated" : "created", result);
      return;
    }

    showFeedback?.("요청 처리에 실패했습니다.", "error");
  };

  return (
    <div className="space-y-5">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-purple-800">
            {isEditMode ? "수정 대상" : "생성될 회차 미리보기"}
          </span>
          <span className="text-purple-900 font-semibold">
            {isEditMode
              ? editingRound?.title ||
                `${product?.title || "상품"} ${editingRound?.roundNumber ?? "-"}회차 추첨`
              : `${product?.title || "상품"} ${nextRoundNumber}회차 추첨`}
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-100 text-indigo-800">
              {roundForm.selectionMethod === "lottery" ? "추첨제" : "가점제"}
            </span>
            <span className="inline-flex items-center px-2 py-1 rounded-full bg-blue-100 text-blue-800">
              필요 납입 {roundForm.requiredPayments}회
            </span>
            <span className="inline-flex items-center px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">
              당첨자 {roundForm.winnerCount}명
            </span>
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full ${
                roundForm.preventDuplicateWinners
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {roundForm.preventDuplicateWinners ? "중복 당첨 방지 ON" : "중복 당첨 방지 OFF"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            회차명
          </label>
          <input
            type="text"
            value={roundForm.title}
            onChange={(e) =>
              setRoundForm((prev) => ({ ...prev, title: e.target.value }))
            }
            placeholder={`${product?.title || ""} ${nextRoundNumber}회차 추첨`}
            className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            추첨 방식
          </label>
          <select
            value={roundForm.selectionMethod}
            onChange={(e) =>
              setRoundForm((prev) => ({
                ...prev,
                selectionMethod: e.target.value,
              }))
            }
            className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
          >
            <option value="lottery">추첨제 (완전 랜덤)</option>
            <option value="score_ranking">가점제 (점수 순위)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            필요 납입 횟수
          </label>
          <input
            type="number"
            min="1"
            value={roundForm.requiredPayments}
            onChange={(e) =>
              setRoundForm((prev) => ({
                ...prev,
                requiredPayments: parseInt(e.target.value || "1", 10),
              }))
            }
            className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            당첨자 수
          </label>
          <input
            type="number"
            min="1"
            value={roundForm.winnerCount}
            onChange={(e) =>
              setRoundForm((prev) => ({
                ...prev,
                winnerCount: parseInt(e.target.value || "1", 10),
              }))
            }
            className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            설명 (선택)
          </label>
          <textarea
            value={roundForm.description}
            onChange={(e) =>
              setRoundForm((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="추첨 회차에 대한 설명을 입력하세요."
            rows="3"
            className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-1 bg-amber-50 p-4 rounded-lg border border-amber-200">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={roundForm.preventDuplicateWinners}
            onChange={(e) =>
              setRoundForm((prev) => ({
                ...prev,
                preventDuplicateWinners: e.target.checked,
              }))
            }
            className="w-5 h-5 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
          />
          <div>
            <span className="font-medium text-amber-900">중복 당첨 방지</span>
            <p className="text-sm text-amber-700 mt-1">
              활성화하면 이전 회차 당첨자는 이번 추첨에서 제외됩니다.
            </p>
          </div>
        </label>
      </div>

      {roundForm.selectionMethod === "score_ranking" && (
        <div className="mt-1 bg-blue-50 p-4 rounded-lg">
          <h5 className="font-medium text-blue-900 mb-3">가중치 설정</h5>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium text-blue-800">
                  납입 횟수 비중
                </label>
                <span className="text-sm text-blue-600">
                  {Math.round(roundForm.weights.paymentCount * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={roundForm.weights.paymentCount}
                onChange={(e) => handleWeightChange("paymentCount", e.target.value)}
                className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium text-green-800">
                  총 납입액 비중
                </label>
                <span className="text-sm text-green-600">
                  {Math.round(roundForm.weights.totalAmount * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={roundForm.weights.totalAmount}
                onChange={(e) => handleWeightChange("totalAmount", e.target.value)}
                className="w-full h-2 bg-green-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          onClick={onCancel}
          tone="slate"
          size="sm"
          rounded="lg"
          className="bg-gray-500 hover:bg-gray-600 text-white px-5 py-2.5 rounded-lg font-medium"
        >
          취소
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={roundsLoading}
          tone="blue"
          size="sm"
          rounded="lg"
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-lg font-medium disabled:opacity-50"
        >
          {isEditMode ? "회차 수정" : "회차 생성"}
        </Button>
      </div>
    </div>
  );
};

export default RoundForm;
