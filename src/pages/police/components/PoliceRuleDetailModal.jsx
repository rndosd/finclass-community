import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React from "react";
import { Coins, CreditCard, DollarSign, ReceiptText } from "lucide-react";

import Badge from "../../../components/ui/Badge";
import { Button, Modal } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { isMissionTokenEnabledForRule } from "../utils/policeRuleUtils";

const PoliceRuleDetailModal = ({
  rule,
  currencyUnit,
  onClose,
  canManage = false,
  onApplyRule,
}) => {
  const { missionTokenLabel: missionTokenTitle } = useUser();
  const { text, fineAmount, creditChange, missionTokenChange = 0, notes } = rule;
  const { formatClassCurrency: nf } = useNumberFormat();
  const creditTone =
    creditChange > 0 ? "emerald" : creditChange < 0 ? "rose" : "slate";
  const creditLabel =
    creditChange === 0 ? "변경 없음" : creditChange > 0 ? `+${creditChange}` : `${creditChange}`;
  const showMissionToken =
    isMissionTokenEnabledForRule(rule) || Number(missionTokenChange) !== 0;
  const missionTokenTone =
    missionTokenChange > 0 ? "amber" : missionTokenChange < 0 ? "rose" : "slate";
  const missionTokenLabel =
    missionTokenChange === 0
      ? "0개"
      : missionTokenChange > 0
        ? `+${missionTokenChange}개`
        : `${missionTokenChange}개`;

  return (
    <Modal onClose={onClose} title="규칙 상세 보기">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{text}</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone="amber" variant="soft" size="md" leadingIcon={DollarSign}>
            벌금: {nf(fineAmount)} {currencyUnit}
          </Badge>
          <Badge tone={creditTone} variant="soft" size="md" leadingIcon={CreditCard}>
            신용점수: {creditLabel}
          </Badge>
          {showMissionToken ? (
            <Badge tone={missionTokenTone} variant="soft" size="md" leadingIcon={Coins}>
              {missionTokenTitle}: {missionTokenLabel}
            </Badge>
          ) : null}
        </div>

        {notes ? (
          <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-1 text-xs font-medium text-slate-500">메모</div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              {notes}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          {canManage && onApplyRule ? (
            <Button
              onClick={() => {
                onClose?.();
                onApplyRule(rule);
              }}
              tone="blue"
              icon={ReceiptText}
            >
              부과하기
            </Button>
          ) : null}
          <Button tone="slate" kind="soft" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </Modal>
  );
};

export default PoliceRuleDetailModal;
