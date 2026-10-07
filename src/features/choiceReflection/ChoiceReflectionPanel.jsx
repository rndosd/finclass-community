import React, { useEffect, useId, useState } from "react";
import { BookOpen, Check, ChevronRight, Heart, HelpCircle, Info, LineChart, MoreHorizontal, ShoppingBag, Tags, Target, Users, Wallet, Shuffle } from "lucide-react";
import Alert from "../../components/ui/Alert";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import Textarea from "../../components/ui/Textarea";
import { CHOICE_NOTE_MAX_LENGTH, CHOICE_PROMPT_REASONS, CHOICE_QUESTIONS } from "./choiceReflectionModel";

export function ChoiceOptions({ question, options, selected, disabled, onSelect }) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-bold text-slate-900">{question}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([id, label]) => (
          <Button key={id} size="sm" tone="blue" kind={selected === id ? "solid" : "outline"}
            aria-pressed={selected === id} disabled={disabled} onClick={() => onSelect(id)}
            className="!min-h-11 !h-auto !whitespace-normal !text-left">
            {label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

const REASON_ICONS = {
  need: ShoppingBag, enjoyment: Heart, price: Tags, recommendation: Users,
  information: Info, plan: Target, use_money: Wallet, allocation: Shuffle,
  other: MoreHorizontal, unsure: HelpCircle,
};

export default function ChoiceReflectionPanel({ controller }) {
  const { prompt, busyIds, errorId, save, dismissPrompt } = controller;
  const titleId = useId();
  const descriptionId = useId();
  const noteId = useId();
  const [draft, setDraft] = useState(null);
  const selectedReason = draft && draft.id === prompt?.id ? draft.reason : null;
  const note = draft && draft.id === prompt?.id ? draft.note : "";
  const config = prompt && CHOICE_QUESTIONS[prompt.sourceType];
  const busy = Boolean(prompt && busyIds.includes(prompt.id));
  const failed = Boolean(prompt && errorId === prompt.id);
  useEffect(() => {
    if (prompt?.reason) dismissPrompt();
  }, [prompt?.reason, dismissPrompt]);
  if (!config || prompt.reason) return null;
  const isStore = config.domain === "store";
  const HeroIcon = isStore ? ShoppingBag : LineChart;
  return (
    <Modal isOpen={Boolean(prompt)} size="md" showDefaultCloseButton={false}
      closeOnOverlayClick={false} onClose={failed && !busy ? dismissPrompt : undefined}
      aria-labelledby={titleId} aria-describedby={descriptionId}>
      <Modal.Header className="!border-blue-100 !bg-blue-50/60 !py-5 sm:!py-6">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
            <HeroIcon aria-hidden="true" className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <Check aria-hidden="true" className="h-3.5 w-3.5" />{config.actionLabel} 완료
            </span>
            <h2 id={titleId} className="mt-1 text-xl font-extrabold leading-7 text-slate-900 sm:text-2xl">내 선택, 잠깐 돌아보기</h2>
            <p className="mt-2 break-words text-sm leading-5 text-slate-600">{prompt.label}</p>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="!py-5 sm:!py-6">
        <fieldset disabled={busy}>
          <legend className="text-base font-bold leading-6 text-slate-900">{config.question}</legend>
          <p id={descriptionId} className="mt-2 text-sm leading-5 text-slate-600">가장 가까운 이유 하나를 골라 주세요.</p>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3">
            {CHOICE_PROMPT_REASONS[prompt.sourceType].map(([id, label]) => {
              const Icon = REASON_ICONS[id] || HelpCircle;
              return <Button key={id} tone="slate" kind="outline" disabled={busy}
                aria-pressed={selectedReason === id}
                onClick={() => isStore ? save(prompt, { reason: id }) : setDraft({ id: prompt.id, reason: id, note })}
                className={`group !min-h-[88px] !flex-col !gap-2 !whitespace-normal !rounded-2xl !px-3 !py-4 !text-center hover:!border-blue-300 hover:!bg-blue-50 hover:!text-blue-800 focus-visible:!ring-blue-500 ${selectedReason === id ? "!border-blue-400 !bg-blue-50 !text-blue-800" : ""}`}>
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-blue-600" />
                <span className="text-sm leading-5">{selectedReason === id && <Check aria-hidden="true" className="mr-1 inline h-4 w-4" />}{label}</span>
              </Button>;
            })}
          </div>
        </fieldset>
        {!isStore && <div className="mt-5 space-y-2">
          <label htmlFor={noteId} className="text-sm font-bold text-slate-900">내 생각 덧붙이기 <span className="font-normal text-slate-500">· 선택</span></label>
          <Textarea id={noteId} rows={2} maxLength={CHOICE_NOTE_MAX_LENGTH} value={note} disabled={busy}
            placeholder="어떤 생각으로 결정했는지 짧게 적어도 좋아요."
            onChange={(event) => setDraft({ id: prompt.id, reason: selectedReason, note: event.target.value })} />
          <p className="text-right text-xs text-slate-500">{note.length}/{CHOICE_NOTE_MAX_LENGTH}</p>
        </div>}
        {busy && <p role="status" className="mt-4 text-center text-sm text-slate-600">선택 기록을 저장하고 있어요.</p>}
        {failed && <div className="mt-4 space-y-3">
          <Alert type="warning" message="거래는 완료됐어요. 이유를 저장하지 못했어요. 다시 선택하거나 창을 닫아 주세요." />
          <Button size="sm" kind="outline" tone="slate" disabled={busy} onClick={dismissPrompt}>오류로 닫기</Button>
        </div>}
      </Modal.Body>
      <Modal.Footer className="!justify-between !gap-2 !bg-slate-50/70">
        <p className="flex items-center gap-2 text-xs leading-5 text-slate-500"><BookOpen aria-hidden="true" className="h-4 w-4 shrink-0" />정답이나 점수는 없어요.</p>
        {isStore ? <p className="flex items-center gap-1 text-xs leading-5 text-slate-500">선택하면 저장하고 닫혀요<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></p> :
          <Button disabled={busy || !selectedReason} onClick={() => save(prompt, { reason: selectedReason, note })}>저장하고 닫기</Button>}
      </Modal.Footer>
    </Modal>
  );
}
