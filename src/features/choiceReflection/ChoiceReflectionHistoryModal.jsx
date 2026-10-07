import React, { useState } from "react";
import Alert from "../../components/ui/Alert";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import SectionLoader from "../../components/ui/SectionLoader";
import { ChoiceOptions } from "./ChoiceReflectionPanel";
import { CHOICE_QUESTIONS, CHOICE_REVIEW_OPTIONS, getChoiceFeedback, getChoiceReasonLabel, getChoiceReviewLabel } from "./choiceReflectionModel";

const dateLabel = (value) => value ? new Date(value).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }) : "";

export default function ChoiceReflectionHistoryModal({ controller }) {
  const { historyOpen, closeHistory, records, isLoading, readError, retryRead, busyIds, errorId, save } = controller;
  const [expandedId, setExpandedId] = useState(null);
  return (
    <Modal isOpen={historyOpen} onClose={closeHistory} size="md" title="내 선택 기록"
      subtitle="내가 고른 이유와, 시간이 지난 뒤의 생각을 함께 돌아봐요.">
      <div className="space-y-4">
        {isLoading ? <SectionLoader message="선택 기록을 불러오고 있어요." /> : readError ? (
          <div className="space-y-3"><Alert type="error" message="선택 기록을 불러오지 못했어요." /><Button size="sm" onClick={retryRead}>다시 불러오기</Button></div>
        ) : records.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-600">아직 선택 기록이 없어요. 거래가 끝난 뒤 짧게 이유를 남겨 보세요.</p>
        ) : records.map((entry) => {
          const config = CHOICE_QUESTIONS[entry.sourceType];
          if (!config) return null;
          const expanded = expandedId === entry.id;
          const busy = busyIds.includes(entry.id);
          return <article key={entry.id} className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{dateLabel(entry.createdAtMs)} · {config.actionLabel}</p>
            <h3 className="mt-1 font-bold text-slate-900">{entry.label}</h3>
            <p className="mt-2 text-sm text-slate-700">선택한 이유: {getChoiceReasonLabel(entry)}</p>
            {typeof entry.note === "string" && entry.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">덧붙인 생각: {entry.note}</p>}
            {entry.review && <p className="mt-1 text-sm text-slate-700">다시 생각해 보니: {getChoiceReviewLabel(entry)}</p>}
            <Button size="sm" kind="ghost" tone="blue" className="mt-2" aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : entry.id)}>{expanded ? "접기" : entry.reason ? "생각 이어 쓰기" : "이유 남기기"}</Button>
            {expanded && <div className="mt-3 space-y-3 border-t border-slate-100 pt-4">
              <ChoiceOptions question={entry.reason ? "지금 다시 선택한다면?" : config.question}
                options={entry.reason ? CHOICE_REVIEW_OPTIONS : config.reasons}
                selected={entry.reason ? entry.review : null} disabled={busy}
                onSelect={(value) => save(entry, entry.reason ? { review: value } : { reason: value })} />
              <p className="text-sm leading-relaxed text-slate-600">{entry.review ? "지금의 생각도 기록했어요. 다음 선택을 할 때 함께 살펴보세요." : getChoiceFeedback(entry)}</p>
              {busy && <p role="status" className="text-sm text-slate-600">저장하고 있어요.</p>}
              {errorId === entry.id && <Alert type="warning" message="답변을 저장하지 못했어요. 다시 선택해 주세요." />}
            </div>}
          </article>;
        })}
        {records.length > 0 && <p className="text-xs text-slate-500">이 페이지의 최근 선택 기록을 최대 40개 보여 줘요. 답변은 점수나 거래 조건에 영향을 주지 않아요.</p>}
      </div>
    </Modal>
  );
}
