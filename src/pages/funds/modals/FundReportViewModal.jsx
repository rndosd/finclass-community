import React from "react";
import dayjs from "dayjs";

import { Button, Modal } from "../../../components/ui";

export default function FundReportViewModal({
  isOpen,
  onClose,
  report = null,
  canEdit = false,
  onEdit,
}) {
  if (!isOpen || !report) return null;

  const submittedAt = report.submittedAt?.toDate?.() || report.submittedAt || null;
  const lastEditedAt = report.lastEditedAt?.toDate?.() || report.lastEditedAt || null;
  const hasStructuredAnswers = Boolean(report.reason || report.nextPlan);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={report.title || `${report.fundName || "펀드"} 보고서`}
    >
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-bold text-slate-700">
              {report.fundName || "펀드"}
            </span>
            <span>
              제출자 {report.submittedByName || report.managerName || "미상"}
            </span>
            <span className="text-slate-300">|</span>
            <span>
              제출 {submittedAt ? dayjs(submittedAt).format("YYYY.MM.DD HH:mm") : "-"}
            </span>
            {lastEditedAt ? (
              <>
                <span className="text-slate-300">|</span>
                <span>
                  수정 {dayjs(lastEditedAt).format("YYYY.MM.DD HH:mm")}
                </span>
              </>
            ) : null}
          </div>

        </section>

        {[
          {
            label: "이번 기간의 변화",
            value: report.summary || "기록된 변화가 없습니다.",
          },
          {
            label: hasStructuredAnswers ? "변화한 이유" : "운용 기록",
            value: report.reason || report.content || "기록된 내용이 없습니다.",
          },
          ...(hasStructuredAnswers
            ? [
                {
                  label: "다음 운용 계획",
                  value: report.nextPlan || "기록된 계획이 없습니다.",
                },
              ]
            : []),
        ].map((section) => (
          <section
            key={section.label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-xs font-black uppercase tracking-wider text-indigo-500">
              {section.label}
            </p>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {section.value}
            </div>
          </section>
        ))}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose} kind="soft" tone="slate">
            닫기
          </Button>
          {canEdit ? (
            <Button
              onClick={() => onEdit?.(report)}
              kind="outline"
              tone="slate"
            >
              보고서 수정
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
