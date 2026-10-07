import React, { useState } from "react";
import { Save, Trophy } from "lucide-react";
import { Button, Modal, ToggleSwitch } from "../../../components/ui";

const toMoneyValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
};

const ToggleRow = ({ title, description, checked, onChange }) => (
  <div
    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition ${
      checked
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-slate-50"
    }`}
  >
    <span>
      <span className="block text-sm font-black text-slate-800">{title}</span>
      <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
        {description}
      </span>
    </span>
    <ToggleSwitch checked={checked} onChange={onChange} tone="emerald" srLabel={title} />
  </div>
);

const RewardInput = ({
  label,
  description,
  value,
  onChange,
  currencyName,
}) => (
  <label className="block rounded-2xl border border-slate-200 bg-white p-4">
    <span className="block text-sm font-black text-slate-800">{label}</span>
    <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
      {description}
    </span>
    <div className="mt-3 flex items-center gap-2">
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-xl border border-blue-200 px-3 py-2 text-right text-sm font-black text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        placeholder="0"
      />
      <span className="shrink-0 text-sm font-bold text-slate-400">
        {currencyName}
      </span>
    </div>
  </label>
);

const MatchPredictionSettingsModal = ({
  settings = {},
  currencyName = "원",
  onSave,
  onClose,
}) => {
  const [rewardEnabled, setRewardEnabled] = useState(
    settings.rewardEnabled !== false,
  );
  const [autoPayoutEnabled, setAutoPayoutEnabled] = useState(
    settings.autoPayoutEnabled !== false,
  );
  const [outcomeRewardAmount, setOutcomeRewardAmount] = useState(
    String(settings.outcomeRewardAmount ?? 100),
  );
  const [exactScoreRewardAmount, setExactScoreRewardAmount] = useState(
    String(settings.exactScoreRewardAmount ?? 300),
  );

  const handleSave = () => {
    onSave({
      ...settings,
      price: 0,
      feeAmount: 0,
      dailyLimit: 0,
      weeklyLimit: 0,
      allowedPaymentTypes: ["cash"],
      rewardEnabled,
      autoPayoutEnabled,
      outcomeRewardAmount: toMoneyValue(outcomeRewardAmount, 100),
      exactScoreRewardAmount: toMoneyValue(exactScoreRewardAmount, 300),
    });
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="md">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-sm shadow-blue-200">
            <Trophy size={22} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900">
              경기 예측 보상 설정
            </h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              승무패와 점수 차 보상을 각각 관리합니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-4 bg-slate-50">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-900">
          승리 팀과 점수 차 구간을 모두 맞히면 추가 보상을 받습니다. 무승부는 기본 보상만 지급합니다.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RewardInput
            label="승무패 보상"
            description="승/무/패 결과를 맞췄을 때 지급"
            value={outcomeRewardAmount}
            onChange={setOutcomeRewardAmount}
            currencyName={currencyName}
          />
          <RewardInput
            label="점수 차 보상"
            description="승리 팀과 점수 차 구간을 모두 맞혔을 때 추가 지급"
            value={exactScoreRewardAmount}
            onChange={setExactScoreRewardAmount}
            currencyName={currencyName}
          />
        </div>

        <div className="space-y-2">
          <ToggleRow
            title="보상 지급"
            description="꺼두면 채점은 가능해도 학생 자산 지급은 하지 않습니다."
            checked={rewardEnabled}
            onChange={setRewardEnabled}
          />
          <ToggleRow
            title="자동 지급"
            description="매일 자동 일정 갱신에서 결과가 확정된 경기를 자동으로 지급합니다."
            checked={autoPayoutEnabled}
            onChange={setAutoPayoutEnabled}
          />
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose}>
          취소
        </Button>
        <Button tone="blue" icon={Save} onClick={handleSave}>
          저장
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default MatchPredictionSettingsModal;
