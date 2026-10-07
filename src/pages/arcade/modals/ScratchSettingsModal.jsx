import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Gift,
  Percent,
  Plus,
  Save,
  Ticket,
  Trash2,
} from "lucide-react";
import { Modal, Button } from "../../../components/ui";
import { analyzeChancePrizes } from "../utils/prizeAnalytics";
import {
  CHANCE_PRESET_OPTIONS,
  autoDistributeChanceWeights,
  applyChancePreset,
  createEditablePrize,
  isPrizeDraftValid,
  normalizeChanceWeights,
  normalizePrizeDraft,
  toEditablePrize,
} from "../utils/prizeForms";

const toneStyles = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  sky: "border-sky-200 bg-sky-50 text-slate-700",
};

const formatPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  if (Math.abs(n) >= 10) return `${n.toFixed(0)}%`;
  if (Math.abs(n) >= 1) return `${n.toFixed(1)}%`;
  return `${n.toFixed(2)}%`;
};



const createPrize = () =>
  createEditablePrize({
    chance: 0,
    label: "새 스크래치 보상",
  });

const ToggleChip = ({ active, icon: Icon, children, onClick, tone }) => (
  <Button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black transition ${
      active
        ? `${tone} border-current text-white`
        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
    }`}
  >
    <Icon size={13} />
    {children}
  </Button>
);

const ScratchSettingsModal = ({
  settings,
  storeItems = [],
  currencyName = "빌",
  onSave,
  onClose,
}) => {
  const { formatClassCurrency } = useNumberFormat();
  const formatMoney = (value, unit) => `${formatClassCurrency(value)} ${unit}`;
  const feeAmount = Math.max(0, Number(settings?.feeAmount || 0));
  const [prizes, setPrizes] = useState(
    Array.isArray(settings?.prizes) && settings.prizes.length > 0
      ? settings.prizes.map((prize) => toEditablePrize(prize))
      : [createPrize()],
  );

  const entryPrice = Number(settings?.price || 0);
  const totalCharge = Math.max(0, entryPrice + feeAmount);
  const totalChance = prizes.reduce((sum, prize) => sum + (Number(prize.chance) || 0), 0);
  const hasNoPrize = prizes.length === 0;
  const hasInvalidPrize = prizes.some((prize) =>
    !isPrizeDraftValid(prize, { quantityField: "chance" }),
  );
  const isValid = !hasNoPrize && !hasInvalidPrize && totalChance > 0;

  const stats = useMemo(
    () => analyzeChancePrizes(prizes, entryPrice, storeItems, feeAmount),
    [prizes, entryPrice, storeItems, feeAmount],
  );

  const handlePrizePatch = (id, updater) => {
    setPrizes((prev) =>
      prev.map((prize) => (prize.id === id ? { ...prize, ...updater(prize) } : prize)),
    );
  };

  const handleItemChange = (id, itemId) => {
    handlePrizePatch(id, (prize) => {
      const prevItem = storeItems.find((item) => item.id === prize.itemId);
      const nextItem = storeItems.find((item) => item.id === itemId);
      const shouldSyncLabel =
        !String(prize.label || "").trim() ||
        (prevItem && prize.label === prevItem.name);

      return {
        itemEnabled: true,
        itemId,
        label: shouldSyncLabel && nextItem ? nextItem.name : prize.label,
      };
    });
  };

  const handleAutoDistribute = () => {
    setPrizes((prev) =>
      autoDistributeChanceWeights(prev, {
        entryPrice,
        storeItems,
      }),
    );
  };

  const handleApplyPreset = (presetId) => {
    setPrizes((prev) =>
      applyChancePreset(prev, {
        presetId,
        entryPrice,
        storeItems,
      }),
    );
  };

  const handleSave = () => {
    if (!isValid) return;

    const normalizedPrizes = normalizeChanceWeights(prizes).map((prize, index) =>
      normalizePrizeDraft(prize, {
        index,
        quantityField: "chance",
      }),
    );

    onSave({
      prizes: normalizedPrizes,
    });
  };

  const recommendationTone = stats.recommendation?.tone || "slate";

  return (
    <Modal isOpen={true} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-100">
            <Ticket size={22} className="text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-slate-800">스크래치 보상 설정</h3>
            <p className="text-xs font-medium tracking-tight text-slate-500">
              각 칸마다 현금, 아이템, 또는 둘 다 함께 줄 수 있습니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        <div
          className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
            isValid ? "border-blue-100 bg-blue-50" : "border-amber-100 bg-amber-50"
          }`}
        >
          <div className="flex items-center gap-3">
            {isValid ? (
              <CheckCircle2 className="text-blue-600" size={20} />
            ) : (
              <AlertCircle className="text-amber-500" size={20} />
            )}
            <div>
              <p className={`text-sm font-black ${isValid ? "text-blue-700" : "text-amber-700"}`}>
                입력 비중 합계 {Number(totalChance || 0).toLocaleString()}
              </p>
              <p className="text-[11px] font-bold text-slate-500">
                꼭 100으로 맞출 필요는 없습니다. 저장할 때 자동 환산되고, 자동분배 버튼으로도 남은 칸을 채울 수 있습니다.
              </p>
            </div>
          </div>
          <div className="h-2.5 w-40 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full ${isValid ? "bg-blue-600" : "bg-amber-500"}`}
              style={{ width: `${isValid ? 100 : Math.min(totalChance, 100)}%` }}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                운영 설정
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                참가 수수료는 전체 설정에서 관리하고, 여기서는 반영된 금액 기준으로 보상 균형만 조정합니다.
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-blue-100 bg-white px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-500">
                적용 수수료
              </p>
              <p className="mt-3 text-2xl font-black text-slate-800">
                {formatMoney(feeAmount, currencyName)}
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                전체 설정에서 변경되며 총 차감은 {formatMoney(totalCharge, currencyName)} 입니다.
              </p>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-500">
                    빠른 조정
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    자동분배로 빈 확률을 채우고, 템플릿으로 전체 감각을 한 번에 맞춥니다.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleAutoDistribute}
                  className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-black text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                >
                  자동분배
                </Button>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-3">
                {CHANCE_PRESET_OPTIONS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset.id)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                  >
                    <div className="text-sm font-black text-slate-800">{preset.label}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {preset.description}
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-2xl border p-5 ${toneStyles[recommendationTone]}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]">한 번 굴렸을 때 평균</p>
              <h4 className="mt-1 text-lg font-black">
                {stats.totalCost > 0
                  ? `총 ${formatMoney(stats.totalCost, currencyName)} 차감 시 평균 ${formatMoney(
                      Math.round(stats.totalExpectedReturn || 0),
                      currencyName,
                    )} 보상이 돌아옵니다.`
                  : `평균 ${formatMoney(Math.round(stats.totalExpectedReturn || 0), currencyName)} 보상`}
              </h4>
              <p className="mt-1 text-sm font-semibold opacity-90">{stats.recommendation.description}</p>
            </div>
            <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-black">
              현재 성향: {stats.recommendation.label}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3">
              <p className="text-[11px] font-black text-slate-500">총 차감</p>
              <p className="mt-1 text-xl font-black text-slate-800">
                {formatMoney(Math.round(stats.totalCost || 0), currencyName)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3">
              <p className="text-[11px] font-black text-slate-500">평균 보상 가치</p>
              <p className="mt-1 text-xl font-black text-slate-800">
                {formatMoney(Math.round(stats.totalExpectedReturn || 0), currencyName)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3">
              <p className="text-[11px] font-black text-slate-500">1회 평균 손익</p>
              <p
                className={`mt-1 text-xl font-black ${
                  Number(stats.expectedNet) > -1 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {stats.expectedNet > 0 ? "+" : ""}
                {formatMoney(Math.round(stats.expectedNet || 0), currencyName)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3">
              <p className="text-[11px] font-black text-slate-500">보상 나올 확률</p>
              <p className="mt-1 text-xl font-black text-slate-800">
                {formatPercent(stats.totalWinRate)}
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs font-semibold text-slate-600">
            실제 차감은 입장료 {formatMoney(entryPrice, currencyName)}
            {feeAmount > 0
              ? ` + 수수료 ${formatMoney(feeAmount, currencyName)}`
              : ""}
            입니다. 아이템은 상점 가격 기준으로 돈처럼 합산해서 계산하고, 현재 최대 보상 가치는{" "}
            {formatMoney(Math.round(stats.maxPrizeValue || 0), currencyName)} 입니다.
          </p>

        </div>

        <div className="grid grid-cols-[160px_1fr_110px_170px_48px] gap-3 px-4 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">
          <div>보상 구성</div>
          <div>세부 설정</div>
          <div className="text-center">입력 비중</div>
          <div>표시 이름</div>
          <div />
        </div>

        <div className="space-y-3">
          {prizes.map((prize) => (
            <div
              key={prize.id}
              className="grid grid-cols-[160px_1fr_110px_170px_48px] items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3"
            >
              <div className="space-y-2">
                <ToggleChip
                  active={prize.moneyEnabled}
                  icon={Coins}
                  tone="bg-blue-600"
                  onClick={() =>
                    handlePrizePatch(prize.id, (current) => ({
                      moneyEnabled: !current.moneyEnabled,
                    }))
                  }
                >
                  현금
                </ToggleChip>
                <ToggleChip
                  active={prize.itemEnabled}
                  icon={Gift}
                  tone="bg-pink-500"
                  onClick={() =>
                    handlePrizePatch(prize.id, (current) => ({
                      itemEnabled: !current.itemEnabled,
                    }))
                  }
                >
                  아이템
                </ToggleChip>
              </div>

              <div className="space-y-2">
                {prize.moneyEnabled && (
                  <div className="grid grid-cols-[110px_1fr] gap-2">
                    <select
                      value={prize.rewardMode}
                      onChange={(event) =>
                        handlePrizePatch(prize.id, () => ({
                          moneyEnabled: true,
                          rewardMode: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-300"
                    >
                      <option value="multiplier">배수</option>
                      <option value="amount">고정액</option>
                    </select>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={prize.rewardMode === "amount" ? prize.amount : prize.multiplier}
                        onChange={(event) =>
                          handlePrizePatch(prize.id, () => ({
                            moneyEnabled: true,
                            [prize.rewardMode === "amount" ? "amount" : "multiplier"]: event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-blue-300"
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">
                        {prize.rewardMode === "amount" ? currencyName : "배"}
                      </span>
                    </div>
                  </div>
                )}

                {prize.itemEnabled && (
                  <select
                    value={prize.itemId || ""}
                    onChange={(event) => handleItemChange(prize.id, event.target.value)}
                    className="w-full rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-pink-300"
                  >
                    <option value="">아이템 선택</option>
                    {storeItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                )}

                {!prize.moneyEnabled && !prize.itemEnabled && (
                  <p className="text-[11px] font-bold text-rose-500">
                    현금 또는 아이템 중 하나는 켜야 합니다.
                  </p>
                )}
              </div>

              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={prize.chance}
                  onChange={(event) =>
                    handlePrizePatch(prize.id, () => ({
                      chance: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-blue-200 bg-slate-50 py-2 pl-3 pr-8 text-right font-mono text-xs font-black text-blue-600 outline-none focus:border-blue-300"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Percent size={12} strokeWidth={3} />
                </span>
              </div>

              <input
                type="text"
                value={prize.label}
                onChange={(event) =>
                  handlePrizePatch(prize.id, () => ({
                    label: event.target.value,
                  }))
                }
                placeholder="예: 잭팟"
                className="w-full rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-300 focus:border-blue-300"
              />

              <div className="flex justify-center">
                <Button
                  size="sm"
                  tone="red"
                  kind="ghost"
                  rounded="lg"
                  onClick={() =>
                    setPrizes((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== prize.id)))
                  }
                  icon={Trash2}
                  className="h-10 w-10 p-0 hover:bg-red-50"
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          onClick={() => setPrizes((prev) => [...prev, createPrize()])}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
        >
          <Plus size={14} strokeWidth={3} />
          보상 추가
        </Button>
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose} className="font-bold">
          닫기
        </Button>
        <Button
          tone="blue"
          kind="solid"
          size="md"
          onClick={handleSave}
          disabled={!isValid}
          icon={Save}
          className="px-10 shadow-lg shadow-blue-600/20"
        >
          설정 저장
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ScratchSettingsModal;
