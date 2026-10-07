import React, { useEffect, useState } from "react";
import dayjs from "dayjs";

import { Button, Modal, TextAreaField } from "../../../components/ui";
import { formatManagementFeeLabel, formatWeightBps } from "../utils/displayFormat";
import { formatReportCycleLabel } from "../utils/reportCycle";
import FundRiskSummary, { isFundRiskFeatureVisible } from "../components/FundRiskSummary";
import useFundRiskPreview from "../hooks/useFundRiskPreview";

function benchmarkLabel(application = {}) {
  if (
    Array.isArray(application.benchmarkSymbols) &&
    application.benchmarkSymbols.length > 0
  ) {
    return application.benchmarkSymbols.join(" / ");
  }
  if (application.benchmarkSymbol) return application.benchmarkSymbol;
  return "SPY / QQQ";
}

function applicationFeeLabel(application = {}) {
  if (application.managementFeeBpsAnnual != null) {
    return formatManagementFeeLabel(application);
  }
  const legacyWeeklyFee = Number(application.managementFeeBpsWeekly || 0);
  const annualFeeBps = legacyWeeklyFee <= 0 ? 0 : legacyWeeklyFee <= 10 ? 100 : 200;
  return formatManagementFeeLabel({
    ...application,
    managementFeeBpsAnnual: annualFeeBps,
  });
}

export default function FundApprovalModal({
  isOpen,
  application,
  classId,
  onClose,
  onReview,
  isSubmitting = false,
}) {
  const [reviewNote, setReviewNote] = useState("");
  const [reviewError, setReviewError] = useState("");
  const holdings = Array.isArray(application?.holdings) ? application.holdings : [];
  const riskPreview = useFundRiskPreview(classId, holdings, {
    enabled: isOpen && Boolean(application),
  });

  useEffect(() => {
    if (!isOpen) return;
    setReviewNote(application?.reviewNote || "");
    setReviewError("");
  }, [application?.reviewNote, isOpen]);

  if (!isOpen || !application) return null;

  const submittedAt =
    application.submittedAt?.toDate?.() || application.submittedAt;
  const displayedRisk = riskPreview.data || application.riskSummary;

  const handleReview = async (decision) => {
    if (decision === "rejected" && !String(reviewNote || "").trim()) {
      setReviewError("반려하는 이유를 학생이 이해할 수 있게 적어 주세요.");
      const schedule = window.requestAnimationFrame || window.setTimeout;
      schedule(() => {
        const target = document.getElementById("reviewNote");
        target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        target?.focus?.();
      });
      return;
    }

    const result = await onReview?.({
      applicationId: application.id,
      decision,
      reviewNote,
    });

    if (result?.success !== false) {
      onClose?.();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="펀드 신청서 심사">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-400">
              신청 정보
            </p>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex justify-between gap-4">
                <dt>펀드명</dt>
                <dd className="font-black text-slate-900">{application.fundName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>신청자</dt>
                <dd className="font-bold text-slate-900">{application.applicantName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>제출 시각</dt>
                <dd className="font-bold text-slate-900">
                  {submittedAt ? dayjs(submittedAt).format("YYYY.MM.DD HH:mm") : "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>운용보수</dt>
                <dd className="font-bold text-slate-900">{applicationFeeLabel(application)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>보고서 주기</dt>
                <dd className="font-bold text-slate-900">
                  {formatReportCycleLabel(application)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-400">
              기본 조건
            </p>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex justify-between gap-4">
                <dt>최소 가입금액</dt>
                <dd className="font-bold text-slate-900">
                  {application.minInvestmentUSD} FIN
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>비교 기준</dt>
                <dd className="font-bold text-slate-900">
                  {benchmarkLabel(application)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>편입 종목 수</dt>
                <dd className="font-bold text-slate-900">{holdings.length}개</dd>
              </div>
            </dl>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h4 className="text-lg font-extrabold text-slate-900">학생이 작성한 내용</h4>
          <dl className="mt-4 divide-y divide-slate-200">
            <div className="pb-4">
              <dt className="text-xs font-extrabold text-indigo-600">어떤 회사에 투자하는 펀드인가요?</dt>
              <dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {application.summary || "작성된 소개가 없습니다."}
              </dd>
            </div>
            <div className="pt-4">
              <dt className="text-xs font-extrabold text-indigo-600">어떻게 운용할 계획인가요?</dt>
              <dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {application.strategy || "작성된 운용 방법이 없습니다."}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h4 className="text-lg font-black text-slate-900">편입 비중</h4>
          <div className="mt-4 flex flex-wrap gap-2">
            {holdings.map((holding) => (
              <span
                key={`${application.id}-${holding.symbol}`}
                className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700"
              >
                {holding.symbol} {formatWeightBps(holding.weightBps)}
              </span>
            ))}
          </div>
        </section>

        <FundRiskSummary
          risk={displayedRisk}
          isLoading={riskPreview.isLoading && !displayedRisk}
          title="승인 전 다시 확인한 가격 움직임"
        />
        {isFundRiskFeatureVisible(displayedRisk) ? (
          <p className="-mt-4 text-xs font-semibold leading-5 text-slate-500">
            승인 직전 서버가 현재 가격 자료와 같은 편입 구성으로 다시 계산합니다. 자료가 부족해도 심사는 계속할 수 있습니다.
          </p>
        ) : null}

        <TextAreaField
          id="reviewNote"
          label="학생에게 전할 메모"
          value={reviewNote}
          onChange={(event) => {
            setReviewNote(event.target.value);
            setReviewError("");
          }}
          rows={4}
          placeholder="승인할 때는 선택 사항이며, 반려할 때는 고칠 내용을 적어 주세요."
          error={reviewError}
        />

        <div className="flex justify-end gap-3">
          <Button tone="slate" kind="soft" onClick={onClose} disabled={isSubmitting}>
            닫기
          </Button>
          <Button
            tone="red"
            kind="soft"
            onClick={() => handleReview("rejected")}
            isLoading={isSubmitting}
          >
            반려
          </Button>
          <Button
            tone="emerald"
            kind="solid"
            onClick={() => handleReview("approved")}
            isLoading={isSubmitting}
          >
            승인하고 펀드 생성
          </Button>
        </div>
      </div>
    </Modal>
  );
}
