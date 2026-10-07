import React, { useEffect, useState } from "react";
import dayjs from "dayjs";

import {
  Alert,
  Button,
  InputField,
  Modal,
  TextAreaField,
} from "../../../components/ui";
import { formatSignedPercentValue, getFundReturnPct } from "../utils/displayFormat";
import { formatReportCycleLabel } from "../utils/reportCycle";
import { isFundReportOverdue } from "../utils/fundReportStatus";

const INPUT_CLASSNAME =
  "min-h-[52px] rounded-xl border-2 border-slate-200 px-4 text-sm shadow-none";
const TEXTAREA_CLASSNAME =
  "rounded-xl border-2 border-slate-200 px-4 py-3 text-sm shadow-none";

const REPORT_STARTERS = {
  summary: [
    ["올랐어요", "펀드 가치가 올랐어요. "],
    ["내렸어요", "펀드 가치가 내렸어요. "],
    ["비슷해요", "펀드 가치가 전과 비슷해요. "],
  ],
  reason: [
    ["회사 뉴스", "회사 뉴스 때문에 변화했다고 생각해요. "],
    ["회사 실적", "회사의 실적 때문에 변화했다고 생각해요. "],
    ["경제 변화", "경제 상황이 달라져서 변화했다고 생각해요. "],
    ["아직 모르겠어요", "정확한 이유는 아직 모르겠어요. 다음에는 관련 뉴스를 더 찾아볼게요. "],
  ],
  nextPlan: [
    ["그대로 유지", "지금 구성을 그대로 유지할 계획이에요. "],
    ["일부 변경", "일부 종목의 비중을 바꿀 계획이에요. "],
    ["조금 더 관찰", "조금 더 지켜본 뒤 결정할 계획이에요. "],
  ],
};

function StarterChoices({ label, options, value, onSelect }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label={label}>
      {options.map(([optionLabel, starter]) => {
        const selected = String(value || "").startsWith(starter.trim());
        return (
          <button
            key={optionLabel}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(starter)}
            className={`min-h-10 rounded-full border px-3 py-2 text-xs font-bold transition ${
              selected
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
            }`}
          >
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}

export default function FundReportModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  fund = null,
  report = null,
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const isEditMode = Boolean(report?.id);

  useEffect(() => {
    if (!isOpen || !fund) return;

    if (isEditMode) {
      setTitle(report?.title || "");
      setSummary(report?.summary || "");
      setReason(report?.reason || report?.content || "");
      setNextPlan(report?.nextPlan || "");
    } else {
      const todayLabel = dayjs().format("YYYY.MM.DD");
      setTitle(`${fund.fundName} 운용 보고서 (${todayLabel})`);
      setSummary("");
      setReason("");
      setNextPlan("");
    }

    setErrorMessage("");
    setFieldErrors({});
  }, [fund, isEditMode, isOpen, report]);

  if (!isOpen || !fund) return null;

  const nextReportDueAt =
    fund.nextReportDueAt?.toDate?.() || fund.nextReportDueAt || null;
  const reportOverdue = isFundReportOverdue(fund);
  const currentNav = Number(fund.currentNav ?? fund.baseNav ?? 100);
  const returnPct = getFundReturnPct(fund);
  const reportHoldings = Array.isArray(fund.holdingsCurrent)
    ? fund.holdingsCurrent
    : Array.isArray(fund.holdings)
      ? fund.holdings
      : [];
  const holdingsCount = reportHoldings.length;

  const focusField = (id) => {
    const schedule = window.requestAnimationFrame || window.setTimeout;
    schedule(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      target?.focus?.();
    });
  };

  const applyStarter = (field, starter) => {
    const setters = { summary: setSummary, reason: setReason, nextPlan: setNextPlan };
    const currentValues = { summary, reason, nextPlan };
    const currentValue = String(currentValues[field] || "");
    const previousStarter = REPORT_STARTERS[field]
      ?.map(([, optionStarter]) => optionStarter)
      .find((optionStarter) => currentValue.startsWith(optionStarter.trim()));
    const remainingText = previousStarter
      ? currentValue.slice(previousStarter.trim().length).trimStart()
      : currentValue;
    setters[field]?.(`${starter}${remainingText}`);
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    const errors = {};
    if (String(title || "").trim().length < 2) errors.title = "보고서 제목을 2자 이상 적어 주세요.";
    if (String(summary || "").trim().length < 5) errors.summary = "이번 기간의 변화를 한 문장으로 적어 주세요.";
    if (String(reason || "").trim().length < 5) errors.reason = "그렇게 생각한 이유를 한 문장으로 적어 주세요.";
    if (String(nextPlan || "").trim().length < 5) errors.nextPlan = "다음 기간의 계획을 한 문장으로 적어 주세요.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const firstField = ["title", "summary", "reason", "nextPlan"].find((field) => errors[field]);
      const fieldIds = {
        title: "fundReportTitle",
        summary: "fundReportSummary",
        reason: "fundReportReason",
        nextPlan: "fundReportNextPlan",
      };
      setErrorMessage(`작성하지 않은 답변이 ${Object.keys(errors).length}개 있어요.`);
      focusField(fieldIds[firstField]);
      return;
    }

    const normalizedReason = reason.trim();
    const normalizedNextPlan = nextPlan.trim();
    const content = `변화한 이유\n${normalizedReason}\n\n다음 운용 계획\n${normalizedNextPlan}`;

    try {
      const result = await onSubmit?.({
        fundId: fund.id,
        reportId: report?.id || null,
        title: title.trim(),
        summary: summary.trim(),
        reason: normalizedReason,
        nextPlan: normalizedNextPlan,
        content,
      });

      if (result?.success === false) {
        setErrorMessage(result.message || `운용 보고서 ${isEditMode ? "수정" : "제출"}에 실패했습니다.`);
        return;
      }

      onClose?.();
    } catch (error) {
      setErrorMessage(
        error?.message || `운용 보고서 ${isEditMode ? "수정" : "제출"} 중 오류가 발생했습니다.`,
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={`${fund.fundName} 운용 보고서 ${isEditMode ? "수정" : "제출"}`}
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-sm font-extrabold text-slate-900">이번 기간 한눈에 보기</p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <p className="text-xs font-bold text-slate-500">현재 기준가</p>
              <p className="mt-1 text-base font-extrabold tabular-nums text-slate-900">
                {currentNav.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} FIN
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">개설 이후 변화</p>
              <p className={`mt-1 text-base font-extrabold tabular-nums ${returnPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {formatSignedPercentValue(returnPct, 1)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">편입 종목</p>
              <p className="mt-1 text-base font-extrabold text-slate-900">
                {holdingsCount}개
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">제출 주기</p>
              <p className="mt-1 text-base font-extrabold text-slate-900">
                {formatReportCycleLabel(fund)}
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold text-slate-500">
            다음 마감 {nextReportDueAt ? dayjs(nextReportDueAt).format("YYYY.MM.DD HH:mm") : "아직 없음"}
          </p>
        </div>

        {reportOverdue && !isEditMode ? (
          <Alert
            type="warning"
            message="보고서 제출 기한이 지났어요. 작성한 뒤 제출해 주세요."
          />
        ) : null}

        {isEditMode ? (
          <Alert
            type="info"
            message="가장 최근에 제출한 보고서만 수정할 수 있습니다. 제출 시각은 유지되고 내용만 업데이트됩니다."
          />
        ) : null}

        <div>
          <p className="text-sm font-bold text-slate-600">
            선택지를 고른 뒤 내 생각을 한 문장씩 덧붙이면 됩니다.
          </p>
          <details className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <summary className="cursor-pointer text-sm font-bold text-slate-600">보고서 제목 바꾸기</summary>
            <InputField
              id="fundReportTitle"
              label="보고서 제목"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setFieldErrors((prev) => ({ ...prev, title: "" }));
                setErrorMessage("");
              }}
              error={fieldErrors.title}
              wrapperClassName="mt-3"
              className={INPUT_CLASSNAME}
            />
          </details>
        </div>

        <section className="space-y-3">
          <TextAreaField
            id="fundReportSummary"
            label="1. 이번 기간에 펀드가 어떻게 달라졌나요?"
            required
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
              setFieldErrors((prev) => ({ ...prev, summary: "" }));
              setErrorMessage("");
            }}
            rows={3}
            placeholder="선택지 뒤에 가장 눈에 띈 종목이나 변화를 덧붙여 보세요."
            error={fieldErrors.summary}
            className={TEXTAREA_CLASSNAME}
          />
          <StarterChoices
            label="펀드 변화 선택"
            options={REPORT_STARTERS.summary}
            value={summary}
            onSelect={(starter) => applyStarter("summary", starter)}
          />
        </section>

        <section className="space-y-3">
          <TextAreaField
            id="fundReportReason"
            label="2. 왜 그렇게 됐다고 생각하나요?"
            required
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setFieldErrors((prev) => ({ ...prev, reason: "" }));
              setErrorMessage("");
            }}
            rows={4}
            placeholder="관련 뉴스나 회사의 변화를 떠올려 한두 문장으로 적어 보세요."
            error={fieldErrors.reason}
            className={TEXTAREA_CLASSNAME}
          />
          <StarterChoices
            label="변화 이유 선택"
            options={REPORT_STARTERS.reason}
            value={reason}
            onSelect={(starter) => applyStarter("reason", starter)}
          />
        </section>

        <section className="space-y-3">
          <TextAreaField
            id="fundReportNextPlan"
            label="3. 다음 기간에는 어떻게 할까요?"
            required
            value={nextPlan}
            onChange={(event) => {
              setNextPlan(event.target.value);
              setFieldErrors((prev) => ({ ...prev, nextPlan: "" }));
              setErrorMessage("");
            }}
            rows={4}
            placeholder="유지하거나 바꿀 종목, 앞으로 확인할 내용을 적어 보세요."
            error={fieldErrors.nextPlan}
            className={TEXTAREA_CLASSNAME}
          />
          <StarterChoices
            label="다음 운용 계획 선택"
            options={REPORT_STARTERS.nextPlan}
            value={nextPlan}
            onSelect={(starter) => applyStarter("nextPlan", starter)}
          />
        </section>

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose} kind="soft" tone="slate" disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            tone="blue"
            kind="solid"
          >
            {isEditMode ? "보고서 수정" : "보고서 제출"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
