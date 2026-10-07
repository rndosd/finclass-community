import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Gift,
  Grid3X3,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Modal, Button } from "../../../components/ui";
import { analyzeBoardPrizes } from "../utils/prizeAnalytics";
import {
  BOARD_PRESET_OPTIONS,
  applyBoardPreset,
  createEditablePrize,
  isPrizeDraftValid,
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
    count: 1,
    label: "새 종이뽑기 보상",
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

const PickSettingsModal = ({
  settings,
  storeItems = [],
  currencyName = "빌",
  onReset,
  isResetting = false,
  onSave,
  onClose,
}) => {
  const { formatClassCurrency } = useNumberFormat();
  const formatMoney = (value, unit) => `${formatClassCurrency(value)} ${unit}`;
  const feeAmount = Math.max(0, Number(settings?.feeAmount || 0));
  const [boardSize, setBoardSize] = useState(settings?.boardSize || 100);
  const [prizes, setPrizes] = useState(
    Array.isArray(settings?.prizes) && settings.prizes.length > 0
      ? settings.prizes.map((prize) => toEditablePrize(prize))
      : [createPrize(), createPrize()],
  );

  const safeBoardSize = Number(boardSize) || 0;
  const entryPrice = Number(settings?.price || 0);
  const totalCharge = Math.max(0, entryPrice + feeAmount);
  const totalPrizeCount = prizes.reduce((sum, prize) => sum + (Number(prize.count) || 0), 0);
  const remainingSlots = safeBoardSize - totalPrizeCount;
  const hasNoPrize = prizes.length === 0;
  const hasInvalidPrize = prizes.some((prize) =>
    !isPrizeDraftValid(prize, { quantityField: "count" }),
  );
  const isValid =
    safeBoardSize > 0 &&
    !hasNoPrize &&
    !hasInvalidPrize &&
    totalPrizeCount <= safeBoardSize;
  const canApplyBoardPreset = safeBoardSize > 0 && safeBoardSize >= prizes.length && prizes.length > 0;

  const stats = useMemo(
    () => analyzeBoardPrizes(prizes, safeBoardSize, entryPrice, storeItems, feeAmount),
    [prizes, safeBoardSize, entryPrice, storeItems, feeAmount],
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

  const handleApplyBoardPreset = (presetId) => {
    if (!canApplyBoardPreset) return;

    setPrizes((prev) =>
      applyBoardPreset(prev, {
        presetId,
        boardSize: safeBoardSize,
        entryPrice,
        storeItems,
      }),
    );
  };

  const handleSave = () => {
    if (!isValid) return;

    const normalizedPrizes = prizes.map((prize, index) =>
      normalizePrizeDraft(prize, {
        index,
        quantityField: "count",
      }),
    );

    onSave({
      boardSize: safeBoardSize,
      prizes: normalizedPrizes,
      updatedAt: new Date(),
    });
  };

  const recommendationTone = stats.recommendation?.tone || "slate";

  return (
    <Modal isOpen={true} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600 shadow-lg shadow-cyan-100">
            <Grid3X3 size={22} className="text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-slate-800">종이뽑기 보상 설정</h3>
            <p className="text-xs font-medium text-slate-500">
              전체 칸 수 안에서 현금, 아이템, 또는 둘 다 있는 보상을 배치합니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <label className="mb-1 block text-sm font-black text-slate-700">전체 칸 수</label>
              <p className="text-[11px] font-bold text-slate-400">
                남는 칸은 자동으로 빈칸이 됩니다.
              </p>
            </div>
            <div className="relative w-32">
              <input
                type="text"
                inputMode="numeric"
                value={boardSize}
                onChange={(event) => {
                  const numeric = event.target.value.replace(/[^0-9]/g, "");
                  setBoardSize(numeric === "" ? "" : Number(numeric));
                }}
                className="no-spinner w-full rounded-xl border-2 border-blue-200 bg-blue-50/50 py-3 pl-4 pr-10 text-center text-lg font-black text-cyan-600 outline-none transition-all focus:border-cyan-500"
                placeholder="0"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                칸
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[20, 30, 40, 50, 100].map((size) => (
              <Button
                key={size}
                type="button"
                onClick={() => setBoardSize(size)}
                className={`rounded-lg px-4 py-1.5 text-[11px] font-black transition ${
                  boardSize === size
                    ? "bg-cyan-600 text-white shadow-md"
                    : "border border-slate-200 bg-white text-slate-500 hover:border-cyan-200"
                }`}
              >
                {size}칸
              </Button>
            ))}
          </div>
        </div>

        <div
          className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
            isValid ? "border-cyan-100 bg-cyan-50" : "border-rose-100 bg-rose-50"
          }`}
        >
          <div className="flex items-center gap-3">
            {isValid ? (
              <CheckCircle2 className="text-cyan-600" size={20} />
            ) : (
              <AlertCircle className="text-rose-500" size={20} />
            )}
            <div>
              <p className={`text-sm font-black ${isValid ? "text-cyan-700" : "text-rose-700"}`}>
                보상 칸 {totalPrizeCount} / {safeBoardSize || 0}
              </p>
              <p className="text-[11px] font-bold text-slate-500">
                {isValid
                  ? `남은 ${Math.max(remainingSlots, 0)}칸은 빈칸으로 처리됩니다.`
                  : "보상 칸 수가 전체 칸 수를 넘지 않도록 조정해 주세요."}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                운영 설정
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                참가 수수료는 전체 설정에서 관리하고, 여기서는 반영된 금액 기준으로 칸 배치만 조정합니다.
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-cyan-100 bg-white px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-500">
                적용 수수료
              </p>
              <p className="mt-3 text-2xl font-black text-slate-800">
                {formatMoney(feeAmount, currencyName)}
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                전체 설정에서 변경되며 총 차감은 {formatMoney(totalCharge, currencyName)} 입니다.
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-500">
                    칸 배치 도구
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    전체 칸 수를 기준으로 보상 칸을 빠르게 배치할 수 있습니다.
                  </p>
                </div>
                <div className="text-xs font-bold text-slate-500">
                  큰 보상은 적게, 작은 보상은 더 자주 나오게 정리합니다.
                </div>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-3">
                {BOARD_PRESET_OPTIONS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyBoardPreset(preset.id)}
                    disabled={!canApplyBoardPreset}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      canApplyBoardPreset
                        ? "border-slate-200 bg-white hover:border-cyan-300 hover:bg-cyan-50"
                        : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    <div className="text-sm font-black">{preset.label}</div>
                    <div className="mt-1 text-xs font-semibold">
                      {preset.description}
                    </div>
                  </Button>
                ))}
              </div>

              {!canApplyBoardPreset && (
                <p className="mt-3 text-xs font-semibold text-rose-500">
                  자동배치를 쓰려면 전체 칸 수가 현재 보상 종류 수보다 많거나 같아야 합니다.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className={`rounded-2xl border p-5 ${toneStyles[recommendationTone]}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]">한 번 뽑았을 때 평균</p>
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
            입니다. 빈칸 비율은 {formatPercent(stats.blankRate)} 이고, 아이템은 상점 가격 기준으로 합산합니다. 현재 최대 보상 가치는{" "}
            {formatMoney(Math.round(stats.maxPrizeValue || 0), currencyName)} 입니다.
          </p>

        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-[160px_1fr_90px_170px_48px] gap-3 px-4 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">
            <div>보상 구성</div>
            <div>세부 설정</div>
            <div className="text-center">칸 수</div>
            <div>표시 이름</div>
            <div />
          </div>

          <div className="max-h-[320px] space-y-3 overflow-y-auto pr-2 custom-scrollbar">
            {prizes.map((prize) => (
              <div
                key={prize.id}
                className="grid grid-cols-[160px_1fr_90px_170px_48px] items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3"
              >
                <div className="space-y-2">
                  <ToggleChip
                    active={prize.moneyEnabled}
                    icon={Coins}
                    tone="bg-cyan-600"
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
                        className="rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-cyan-300"
                      >
                        <option value="multiplier">배수</option>
                        <option value="amount">고정액</option>
                      </select>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={prize.rewardMode === "amount" ? prize.amount : prize.multiplier}
                          onChange={(event) => {
                            const numeric = event.target.value.replace(/[^0-9.]/g, "");
                            handlePrizePatch(prize.id, () => ({
                              moneyEnabled: true,
                              [prize.rewardMode === "amount" ? "amount" : "multiplier"]: numeric,
                            }));
                          }}
                          className="w-full rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-cyan-300"
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

                <input
                  type="text"
                  inputMode="numeric"
                  value={prize.count}
                  onChange={(event) => {
                    const numeric = event.target.value.replace(/[^0-9]/g, "");
                    handlePrizePatch(prize.id, () => ({
                      count: numeric === "" ? 0 : Number(numeric),
                    }));
                  }}
                  className="no-spinner w-full rounded-xl border border-blue-200 bg-slate-50 py-2 text-center text-xs font-black text-cyan-600 outline-none focus:border-cyan-300"
                />

                <input
                  type="text"
                  value={prize.label}
                  onChange={(event) =>
                    handlePrizePatch(prize.id, () => ({
                      label: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-blue-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-cyan-300"
                  placeholder="예: 참가상"
                />

                <Button
                  size="sm"
                  tone="red"
                  kind="ghost"
                  onClick={() =>
                    setPrizes((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== prize.id)))
                  }
                  icon={Trash2}
                  className="w-10"
                />
              </div>
            ))}
          </div>

          <Button
            type="button"
            onClick={() => setPrizes((prev) => [...prev, createPrize()])}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-600"
          >
            <Plus size={14} />
            보상 추가
          </Button>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose}>
          닫기
        </Button>
        <Button
          tone="slate"
          kind="outline"
          onClick={onReset}
          disabled={isResetting}
          icon={RotateCcw}
        >
          {isResetting ? "초기화 중..." : "현재 설정으로 초기화"}
        </Button>
        <Button size="md"
          tone="cyan"
          onClick={handleSave}
          disabled={!isValid || isResetting}
          icon={Save}
          
        >
          설정 저장
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PickSettingsModal;
