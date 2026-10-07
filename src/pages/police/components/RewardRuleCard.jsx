import { appConfirm } from "../../../utils/appDialogs";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useState } from "react";
import { Edit, ReceiptText, Trash2 } from "lucide-react";

import { Button, IconButton } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import PoliceRuleDetailModal from "./PoliceRuleDetailModal";
import { isMissionTokenEnabledForRule } from "../utils/policeRuleUtils";

const RewardRuleCard = ({
  rule,
  canManage = false,
  onEdit,
  onDelete,
  onApplyRule,
  editMode = false,
  selected = false,
  onToggleSelect,
  viewMode = "list",
}) => {
  const { classData, missionTokenLabel: missionTokenTitle } = useUser();
  const currencyUnit = classData?.currencyUnit || "원";
  const {
    text,
    notes = "",
    fineAmount = 0,
    creditChange = 0,
    missionTokenChange = 0,
  } = rule || {};
  const [open, setOpen] = useState(false);

  const { formatClassCurrency: nf } = useNumberFormat();
  const creditLabel =
    creditChange === 0
      ? "0점"
      : creditChange > 0
        ? "+" + creditChange + "점"
        : creditChange + "점";
  const showMissionToken =
    isMissionTokenEnabledForRule(rule) || Number(missionTokenChange) !== 0;
  const missionTokenLabel =
    missionTokenChange === 0
      ? "0개"
      : missionTokenChange > 0
        ? "+" + missionTokenChange + "개"
        : missionTokenChange + "개";

  const handleCardClick = () => {
    if (editMode) onToggleSelect?.();
    else setOpen(true);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleCardClick();
          }
        }}
        className={[
          viewMode === "list"
            ? "group relative flex min-h-0 cursor-pointer select-none flex-col items-stretch gap-3 overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-all duration-200 sm:flex-row sm:items-center sm:gap-5"
            : "group relative flex min-h-56 cursor-pointer select-none flex-col overflow-hidden rounded-3xl border bg-white p-5 shadow-sm transition-all duration-200",
          editMode && selected
            ? "border-emerald-400 bg-emerald-50/30 ring-2 ring-emerald-500/20"
            : "border-slate-200 hover:border-emerald-200 hover:shadow-md",
        ].join(" ")}
      >
        <div className="absolute inset-y-0 left-0 w-1.5 bg-emerald-400" />

        {editMode ? (
          <div className="absolute left-4 top-4 z-20">
            <div
              className={[
                "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
                selected
                  ? "border-emerald-500 bg-emerald-500"
                  : "border-slate-300 bg-white",
              ].join(" ")}
            >
              {selected ? (
                <div className="h-2.5 w-2.5 rounded-full bg-white" />
              ) : null}
            </div>
          </div>
        ) : null}

        {!editMode && canManage ? (
          <div className="absolute right-3 top-3 z-20 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {onApplyRule ? (
              <IconButton
                icon={ReceiptText}
                label="규칙 적용"
                onClick={(event) => {
                  event.stopPropagation();
                  onApplyRule(rule);
                }}
                tone="blue"
                size="sm"
                className="rounded-xl bg-white/90 p-2 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-white hover:text-indigo-600"
                title="이 규칙으로 적용하기"
              />
            ) : null}
            <IconButton
              icon={Edit}
              label="수정"
              onClick={(event) => {
                event.stopPropagation();
                onEdit?.(rule);
              }}
              tone="emerald"
              size="sm"
              className="rounded-xl bg-white/90 p-2 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-white hover:text-emerald-600"
              title="수정"
            />
            <IconButton
              icon={Trash2}
              label="삭제"
              onClick={async (event) => {
                event.stopPropagation();
                if ((await appConfirm("이 규칙을 삭제할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"})))
                  onDelete?.(rule.id, rule.order);
              }}
              tone="red"
              size="sm"
              className="rounded-xl bg-white/90 p-2 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-white hover:text-rose-600"
              title="삭제"
            />
          </div>
        ) : null}

        <div
          className={`relative z-10 pr-24 ${
            viewMode === "list"
              ? `min-w-0 flex-1 ${
                  !editMode && canManage ? "pr-24 sm:pr-0" : "pr-0"
                }`
              : ""
          }`}
        >
          <h3 className="line-clamp-2 min-h-12 break-keep text-base font-bold leading-6 text-slate-800 sm:text-lg">
            {text}
          </h3>
          {notes ? (
            <p className="mt-2 line-clamp-2 whitespace-pre-line text-sm leading-5 text-slate-500">
              {notes}
            </p>
          ) : null}
        </div>

        <div
          className={
            viewMode === "list"
              ? "relative z-10 flex shrink-0 flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"
              : "relative z-10 mt-4 flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-end sm:justify-between"
          }
        >
          <div className="min-w-0">
            <div className="flex items-baseline gap-1 text-emerald-600">
              <span className="text-xs font-bold text-slate-500">보상</span>
              <strong className="text-2xl font-black tracking-tight">
                +{nf(fineAmount)}
              </strong>
              <span className="text-sm font-bold">{currencyUnit}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
              {creditChange !== 0 ? <span>신용 {creditLabel}</span> : null}
              {showMissionToken ? (
                <span>
                  · {missionTokenTitle} {missionTokenLabel}
                </span>
              ) : null}
            </div>
          </div>

          {!editMode && onApplyRule ? (
            <Button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onApplyRule(rule);
              }}
              icon={ReceiptText}
              kind="soft"
              tone="blue"
              size="xs"
              className="w-full justify-center sm:w-auto"
              title="이 규칙으로 적용하기"
            >
              적용하기
            </Button>
          ) : null}
        </div>
      </div>

      {!editMode && open ? (
        <PoliceRuleDetailModal
          rule={rule}
          currencyUnit={currencyUnit}
          onClose={() => setOpen(false)}
          canManage={canManage}
          onEdit={onEdit}
          onDelete={onDelete}
          onApplyRule={onApplyRule}
        />
      ) : null}
    </>
  );
};

export default RewardRuleCard;
