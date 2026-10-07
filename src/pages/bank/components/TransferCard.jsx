import React, { useState } from "react";
import { Button, Card, InputField } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import StudentSelector from "../../../components/ui/StudentSelector";
import useTransferActions from "../hooks/useTransferActions";
import { Send, Info, AlertCircle } from "lucide-react";
import { formatBankMoney, getSpendableBankBalance } from "../../../utils/bankMoney";

function TransferCard({
  classId,
  currentStudent,
  currentRateModifiers,
  currencyUnit,
  onTransferSuccess,
  embedded = false,
}) {
  const [localTransferAmount, setLocalTransferAmount] = useState("");
  const [selectedRecipientUids, setSelectedRecipientUids] = useState([]);
  const [localMemo, setLocalMemo] = useState("");

  const { showFeedback } = useFeedback();

  // 1. 송금 액션 훅 연결 (성공 여부만 반환받는 개선된 버전 사용)
  const { isTransferring, handleTransfer, hasPendingTransfer } = useTransferActions({
    classId,
    currentStudent
  });

  // 🌟 [데이터 매핑] 실시간 등급 정보 및 수수료
  const myTierName = currentStudent?.creditTier?.name || "분석 중";
  const myFee = Number(currentRateModifiers?.transferFee || 0);

  // --- 실시간 계산 로직 ---
  const transferAmountNum = Math.floor(Number(localTransferAmount)) || 0;
  const recipientCount = selectedRecipientUids.length;

  // 총 차감액 = (1인당 금액 + 수수료) * 인원수
  const totalExpectedDeduction = transferAmountNum > 0
    ? (transferAmountNum + myFee) * recipientCount
    : 0;

  // 가용 잔액 계산 (현금 - 예약금)
  const availableCash = getSpendableBankBalance(currentStudent?.assets);

  // 유효성 검사
  const newRecipientCount = selectedRecipientUids.filter(
    (uid) => !hasPendingTransfer(uid, transferAmountNum, localMemo),
  ).length;
  const isBalanceShort = transferAmountNum > 0 &&
    (transferAmountNum + myFee) * newRecipientCount > availableCash;
  const isTransferDisabled =
    recipientCount === 0 ||
    transferAmountNum <= 0 ||
    isBalanceShort ||
    isTransferring;

  /**
   * 🚀 송금 실행 핸들러 (통합 알림 로직)
   */
  const handleTransferClick = async () => {
    if (isTransferDisabled) return;

    let successCount = 0;
    const completedUids = new Set();

    // 선택된 학생들에게 순차적으로 송금 실행
    for (const toUid of selectedRecipientUids) {
      const result = await handleTransfer(toUid, transferAmountNum, localMemo.trim(), myFee);

      if (result.success) {
        successCount++;
        completedUids.add(toUid);
      } else {
        // 실패 시 에러 메시지 한 번 띄우고 중단
        showFeedback(`송금 중 오류가 발생했습니다: ${result.message}`, "error");
        break;
      }
    }

    // 🚀 모든 송금이 끝난 뒤 딱 한 번만 피드백 제공
    if (successCount > 0) {
      const finalMsg = successCount === 1
        ? "송금이 성공적으로 완료되었습니다."
        : `총 ${successCount}명에게 각 ${formatBankMoney(transferAmountNum)}${currencyUnit}씩 송금했습니다!`;

      showFeedback(finalMsg, "success");

      // 입력 필드 초기화
      const remainingUids = selectedRecipientUids.filter((uid) => !completedUids.has(uid));
      setSelectedRecipientUids(remainingUids);
      if (remainingUids.length === 0) {
        setLocalTransferAmount("");
        setLocalMemo("");
      }
      onTransferSuccess?.();
    }
  };

  return (
    <Card
      variant={embedded ? "flat" : "surface"}
      noPadding
      className={
        "relative h-full overflow-hidden border-0 bg-white " +
        (embedded
          ? "rounded-none shadow-none"
          : "rounded-2xl")
      }
    >

      <Card.Content noPadding className="relative z-10 flex flex-col h-full min-w-0">
        {/* 상단 헤더: 가용 잔액 표시 */}
        <div
          className={
            "mb-5 flex items-start gap-3 sm:mb-8 sm:items-center " +
            (embedded ? "justify-end" : "justify-between")
          }
        >
          {!embedded ? (
            <div className="flex items-center space-x-2">
              <div className="p-2 sm:p-2.5 bg-indigo-100 rounded-xl text-indigo-600 shadow-sm shadow-indigo-200/50">
                <Send size={18} strokeWidth={3} className="sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-[11px] sm:text-sm font-black text-slate-400 uppercase tracking-[0.12em] sm:tracking-[0.15em]">
                송금하기
              </h2>
            </div>
          ) : null}
          <div className="text-right">
            <span className="text-xs text-slate-600 block font-semibold mb-0.5">
              송금 가능 잔액
            </span>
            <span className={`text-lg sm:text-xl font-bold tabular-nums transition-colors ${isBalanceShort ? "text-rose-500" : "text-slate-800"}`}>
              {formatBankMoney(availableCash)}
              <span className="text-sm font-semibold text-slate-600 ml-1">{currencyUnit}</span>
            </span>
          </div>
        </div>

        {/* 입력 영역 */}
        <div className="space-y-4 sm:space-y-6 flex-grow">
          {/* 학생 선택 셀렉터 (본인 제외 옵션 포함) */}
          <StudentSelector
            label="누구에게 보낼까요?"
            selectedUids={selectedRecipientUids}
            onChange={setSelectedRecipientUids}
            singleSelect={false}
            excludeSelf={true}
            includeTeacher={true}
          />

          <div className="space-y-3">
            <InputField
              id="transferAmount"
              label="1인당 보낼 금액"
              type="number"
              value={localTransferAmount}
              onChange={(e) => setLocalTransferAmount(e.target.value)}
              placeholder="0"
              className="text-base font-bold tabular-nums"
              disabled={isTransferring}
              suffix={currencyUnit}
            />

            {/* 🚀 실시간 영수증 영역 (상세 계산식 포함) */}
            {transferAmountNum > 0 && recipientCount > 0 && (
              <div
                className={`p-3.5 sm:p-5 rounded-2xl sm:rounded-[1.5rem] border transition-all duration-300 ${
                  isBalanceShort
                    ? "bg-rose-50 border-rose-100"
                    : "bg-slate-50 border-slate-100"
                }`}
              >
                <div className="space-y-2.5 text-[11px] font-bold">
                  <div className="flex justify-between text-slate-500">
                    <span>1인당 보낼 금액</span>
                    <span className="text-slate-800">
                      {formatBankMoney(transferAmountNum)} {currencyUnit}
                    </span>
                  </div>

                  <div className="flex justify-between text-slate-400">
                    <span>보낼 인원</span>
                    <span className="text-indigo-600 font-black">{recipientCount}명</span>
                  </div>

                  <div className="flex justify-between text-slate-400">
                    <span className="flex items-center gap-1">
                      <Info size={12} /> 인당 수수료 ({myTierName})
                    </span>
                    <span className="text-slate-600">
                      {myFee > 0 ? `${formatBankMoney(myFee)} ${currencyUnit}` : "면제"}
                    </span>
                  </div>

                  <div className="h-px bg-slate-200/50 my-1.5" />

                  <div className="flex justify-between items-end">
                    <div className="flex flex-col">
                      <span className="text-slate-800 text-xs font-black">총 차감액</span>
                      <span className="text-[9px] text-slate-400 font-normal">
                        ({formatBankMoney(transferAmountNum + myFee)} × {recipientCount}명)
                      </span>
                    </div>
                    <span className={`text-base font-black ${isBalanceShort ? "text-rose-600" : "text-rose-500"}`}>
                      -{formatBankMoney(totalExpectedDeduction)} {currencyUnit}
                    </span>
                  </div>
                </div>

                {isBalanceShort && (
                  <div className="flex items-center gap-1.5 mt-4 text-[11px] text-rose-500 font-black animate-pulse">
                    <AlertCircle size={14} strokeWidth={3} /> 가용 잔액이 부족하여 송금할 수 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          <InputField
            id="transferMemo"
            label="메모"
            value={localMemo}
            onChange={(e) => e.target.value.length <= 50 && setLocalMemo(e.target.value)}
            placeholder="입금 확인용 메모 (선택)"
            className="text-sm"
            disabled={isTransferring}
          />
        </div>

        {/* 송금 버튼 */}
        <div className="mt-5 sm:mt-8">
          <Button
            onClick={handleTransferClick}
            tone={isBalanceShort ? "slate" : "blue"}
            size="md"
            fullWidth
            disabled={isTransferDisabled}
            isLoading={isTransferring}
          >
            {isBalanceShort ? "잔액 부족" : `${recipientCount > 0 ? `${recipientCount}명에게 ` : ""}돈 보내기`}
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}

export default TransferCard;
