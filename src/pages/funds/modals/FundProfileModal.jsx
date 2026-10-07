import React, { useEffect, useState } from "react";

import { Alert, Button, Modal, TextAreaField } from "../../../components/ui";
const TEXTAREA_CLASSNAME =
  "rounded-xl border-2 border-slate-200 px-4 py-3 text-sm shadow-none";

export default function FundProfileModal({
  isOpen,
  onClose,
  onSubmitProfile,
  isSubmitting = false,
  fund = null,
}) {
  const [summary, setSummary] = useState("");
  const [strategy, setStrategy] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen || !fund) return;

    setSummary(fund.summary || "");
    setStrategy(fund.strategy || "");
    setErrorMessage("");
  }, [fund, isOpen]);

  if (!isOpen || !fund) return null;

  const handleSubmit = async () => {
    const trimmedSummary = summary.trim();
    const trimmedStrategy = strategy.trim();
    const currentSummary = String(fund.summary || "").trim();
    const currentStrategy = String(fund.strategy || "").trim();

    const hasProfileChanges =
      trimmedSummary !== currentSummary ||
      trimmedStrategy !== currentStrategy;
    if (!hasProfileChanges) {
      setErrorMessage("변경된 내용이 없습니다.");
      return;
    }

    if (hasProfileChanges) {
      if (trimmedSummary.length < 5) {
        setErrorMessage("펀드 소개는 5자 이상 입력해 주세요.");
        return;
      }

      if (trimmedStrategy.length < 10) {
        setErrorMessage("운용 전략은 10자 이상 입력해 주세요.");
        return;
      }
    }

    try {
      if (hasProfileChanges) {
        const result = await onSubmitProfile?.({
          fundId: fund.id,
          summary: trimmedSummary,
          strategy: trimmedStrategy,
        });

        if (result?.success === false) {
          setErrorMessage(result.message || "펀드 소개 수정에 실패했습니다.");
          return;
        }

      }

      onClose?.();
    } catch (error) {
      setErrorMessage(error?.message || "펀드 저장 중 오류가 발생했습니다.");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title={`${fund.fundName} 펀드 관리`}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-sky-900">
          소개와 운용 전략은 카드와 상세 보기 화면에 바로 반영됩니다.
        </div>

        <div className="space-y-2">
          <TextAreaField
            id="fundProfileSummary"
            label="카드용 한줄 소개"
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
              setErrorMessage("");
            }}
            rows={3}
            placeholder="학생들이 카드와 소개 모달 상단에서 처음 보게 될 짧은 소개를 적어 주세요."
            className={TEXTAREA_CLASSNAME}
          />
          <p className="text-xs leading-5 text-slate-500">
            둘러보기 카드와 소개 모달 맨 위 요약에 보여집니다.
          </p>
        </div>

        <div className="space-y-2">
          <TextAreaField
            id="fundProfileStrategy"
            label="운용 철학·전략 소개"
            value={strategy}
            onChange={(event) => {
              setStrategy(event.target.value);
              setErrorMessage("");
            }}
            rows={10}
            placeholder="펀드의 철학, 종목을 고르는 기준, 어떤 방식으로 운용할지 자세히 적어 주세요."
            className={TEXTAREA_CLASSNAME}
          />
          <p className="text-xs leading-5 text-slate-500">
            소개 모달의 운용 소개 영역에 고정으로 보여집니다. 기간별 성과나 변경 이유는 보고서에 적는 편이 더 자연스럽습니다.
          </p>
        </div>

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose} kind="soft" tone="slate" disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting} kind="solid" tone="blue">
            저장
          </Button>
        </div>
      </div>
    </Modal>
  );
}
