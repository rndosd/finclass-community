import React from "react";
import { Gavel, Percent, Settings2, Store, TimerReset } from "lucide-react";
import { Badge, Button, Modal } from "../../../components/ui";

const toNumber = (v, fallback = 0) => {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
};

function FeeSection({
  icon: Icon,
  title,
  description,
  feeRate,
  setFeeRate,
  feeEnabled,
  setFeeEnabled,
  onSave,
  isSaving,
  accentClass,
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center ${accentClass}`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">{title}</p>
            <p className="text-sm text-slate-500">{description}</p>
          </div>
        </div>

        <Badge tone={feeEnabled ? "blue" : "slate"} variant="soft" size="sm">
          {feeEnabled ? `${toNumber(feeRate, 0)}%` : "OFF"}
        </Badge>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-700">수수료 사용</p>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={feeEnabled}
            onChange={(e) => setFeeEnabled(e.target.checked)}
          />
          활성화
        </label>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-semibold text-slate-600 mb-1">
            수수료율 (%)
          </label>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={toNumber(feeRate, 0)}
            onChange={(e) => setFeeRate(toNumber(e.target.value, 0))}
            className="w-full"
          />
          <p className="text-xs text-slate-500 mt-1">권장: 0~10% (기본 5%)</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-600 mb-1">
            직접 입력
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={feeRate}
              onChange={(e) => setFeeRate(toNumber(e.target.value, 0))}
              className="w-full px-3 py-2 rounded-xl border border-blue-200 bg-blue-50/50"
            />
            <span className="text-slate-500">%</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          kind="solid"
          tone="blue"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? "저장 중..." : "설정 저장"}
        </Button>
      </div>
    </div>
  );
}

const ANTI_SNIPING_OPTIONS = [
  { value: 0, label: "사용 안 함" },
  { value: 15, label: "15초" },
  { value: 30, label: "30초" },
  { value: 60, label: "60초" },
  { value: 120, label: "2분" },
  { value: 300, label: "5분" },
];

const MAX_ANTI_SNIPING_SECONDS = 60 * 60;

function AntiSnipingSection({ value, onChange, onSave, isSaving }) {
  const seconds = Number(value || 0);

  return (
    <div className="space-y-4 rounded-3xl border border-indigo-200 bg-indigo-50/50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
            <TimerReset className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">마감 시간 자동 연장</p>
            <p className="text-sm text-slate-500">
              마감 직전 입찰이 들어오면 모든 학생에게 다시 입찰할 시간을 줍니다.
            </p>
          </div>
        </div>
        <Badge tone={seconds > 0 ? "indigo" : "slate"} variant="soft" size="sm">
          {seconds > 0 ? `${seconds}초` : "OFF"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ANTI_SNIPING_OPTIONS.map((option) => {
          const selected = seconds === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={isSaving}
              onClick={() => onChange(option.value)}
              className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                selected
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">
          직접 입력
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={MAX_ANTI_SNIPING_SECONDS}
            step={1}
            value={seconds}
            disabled={isSaving}
            onChange={(event) =>
              onChange(
                Math.max(
                  0,
                  Math.min(
                    MAX_ANTI_SNIPING_SECONDS,
                    Math.floor(toNumber(event.target.value, 0)),
                  ),
                ),
              )
            }
            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            aria-describedby="anti-sniping-input-help"
          />
          <span className="shrink-0 text-sm font-semibold text-slate-500">초</span>
        </div>
        <p id="anti-sniping-input-help" className="mt-1 text-xs text-slate-500">
          0~3,600초 사이에서 원하는 시간을 입력할 수 있습니다. 0초는 사용 안 함입니다.
        </p>
      </div>

      <p className="text-xs leading-5 text-slate-600">
        예: 30초 설정 시 남은 시간이 30초 이하일 때 입찰되면 마감까지 다시 30초가 남도록 조정됩니다.
        새로 시작하는 경매에 설정이 고정됩니다.
      </p>

      <div className="flex justify-end">
        <Button
          size="sm"
          kind="solid"
          tone="blue"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? "저장 중..." : "설정 저장"}
        </Button>
      </div>
    </div>
  );
}

export default function SellerFeeSettingsModal({
  isOpen,
  onClose,
  canManageSellerFee,
  marketFee,
  auctionFee,
}) {
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-indigo-600" />
          <span>판매·경매 설정</span>
        </div>
      }
    >
      {!canManageSellerFee ? (
        <div className="py-6 text-center text-slate-600">
          판매·경매 설정 권한이 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          <FeeSection
            icon={Store}
            title="중고거래 판매 수수료"
            description="바로구매 완료 시 판매자 정산 금액에서 수수료를 차감합니다."
            feeRate={marketFee.marketFeeRate}
            setFeeRate={marketFee.setMarketFeeRate}
            feeEnabled={marketFee.marketFeeEnabled}
            setFeeEnabled={marketFee.setMarketFeeEnabled}
            onSave={marketFee.handleSaveMarketFeeSettings}
            isSaving={marketFee.isSavingMarketFeeSettings}
            accentClass="bg-blue-50 text-blue-600"
          />

          <FeeSection
            icon={Gavel}
            title="경매 판매 수수료"
            description="경매 정산 완료 시 판매자 정산 금액에서 수수료를 차감합니다."
            feeRate={auctionFee.auctionFeeRate}
            setFeeRate={auctionFee.setAuctionFeeRate}
            feeEnabled={auctionFee.auctionFeeEnabled}
            setFeeEnabled={auctionFee.setAuctionFeeEnabled}
            onSave={auctionFee.handleSaveAuctionSettings}
            isSaving={auctionFee.isSavingAuctionSettings}
            accentClass="bg-indigo-50 text-indigo-600"
          />

          <AntiSnipingSection
            value={auctionFee.auctionAntiSnipingSeconds}
            onChange={auctionFee.setAuctionAntiSnipingSeconds}
            onSave={auctionFee.handleSaveAuctionSettings}
            isSaving={auctionFee.isSavingAuctionSettings}
          />

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
            <Percent className="w-4 h-4 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-700">
              수수료는 판매자에게만 적용되며, 구매자는 기존 가격 그대로 결제합니다.
            </p>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" kind="outline" tone="slate" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
