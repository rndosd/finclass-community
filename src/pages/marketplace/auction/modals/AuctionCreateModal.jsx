import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React, { useId, useMemo, useState } from "react";
import { X, PlusCircle } from "lucide-react";
import { Modal, Button } from "../../../../components/ui";
import {
  getProductTypeAsset,
  MARKETPLACE_TYPE_ASSET_OPTIONS,
} from "../../../../assets/illustrations/productTypes";

const MAX_DURATION_MINUTES = 60 * 24 * 30;

function toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDurationLabel({ days, hours, minutes }) {
  const parts = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0) parts.push(`${minutes}분`);
  return parts.length ? parts.join(" ") : "0분";
}

export default function AuctionCreateModal({
  isOpen,
  onClose,
  currencyName,
  onSubmit,
  isSubmitting,
  antiSnipingSeconds = 30,
  autoApproveEnabled = false,
}) {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const titleId = useId();
  const [form, setForm] = useState({
    title: "",
    itemIcon: "auto",
    description: "",
    auctionType: "open",
    startPrice: 100,
    bidStep: 10,
    days: 0,
    hours: 1,
    minutes: 0,
  });

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const normalized = useMemo(
    () => ({
      title: String(form.title || "").trim(),
      itemIcon: String(form.itemIcon || "auto"),
      description: String(form.description || "").trim(),
      auctionType: form.auctionType === "sealed" ? "sealed" : "open",
      startPrice: Math.max(1, Math.floor(toSafeNumber(form.startPrice, 0))),
      bidStep: Math.max(1, Math.floor(toSafeNumber(form.bidStep, 0))),
      days: Math.max(0, Math.floor(toSafeNumber(form.days, 0))),
      hours: Math.min(23, Math.max(0, Math.floor(toSafeNumber(form.hours, 0)))),
      minutes: Math.min(59, Math.max(0, Math.floor(toSafeNumber(form.minutes, 0)))),
    }),
    [form]
  );

  const selectedItemAsset = useMemo(
    () => getProductTypeAsset({
      itemIcon: form.itemIcon,
      title: form.title,
      description: form.description,
      assetContext: "marketplace",
    }),
    [form.description, form.itemIcon, form.title],
  );
  const totalMinutes = useMemo(
    () =>
      normalized.days * 24 * 60 +
      normalized.hours * 60 +
      normalized.minutes,
    [normalized.days, normalized.hours, normalized.minutes]
  );

  const durationLabel = useMemo(
    () => formatDurationLabel(normalized),
    [normalized]
  );

  const isValid =
    normalized.title.length >= 1 &&
    normalized.startPrice >= 1 &&
    (normalized.auctionType === "sealed" || normalized.bidStep >= 1) &&
    totalMinutes >= 1 &&
    totalMinutes <= MAX_DURATION_MINUTES;

  const submit = () => {
    if (!isValid || isSubmitting) return;
    onSubmit?.({
      ...normalized,
      minutes: totalMinutes,
      durationDays: normalized.days,
      durationHours: normalized.hours,
      durationMinutesPart: normalized.minutes,
    });
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? undefined : onClose}
      size="max-w-2xl"
      showDefaultCloseButton={false}
      closeOnOverlayClick={false}
      aria-labelledby={titleId}
    >
      <div className="flex max-h-[90dvh] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 id={titleId} className="text-xl font-bold text-slate-900">경매 출품</h2>
              <p className="text-sm text-slate-500">
                공개 또는 블라인드 방식으로 출품하고 마감 후 정산합니다.
              </p>
            </div>
            <Button tone="slate" kind="ghost" size="icon-md"
              onClick={onClose}
              disabled={isSubmitting}
              
              aria-label="경매 출품 닫기"
            >
              <X size={18} />
            </Button>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">경매 방식</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => update("auctionType", "open")}
                  aria-pressed={form.auctionType === "open"}
                  className={`rounded-xl border px-4 py-3 text-left transition ${form.auctionType === "open" ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600"}`}
                >
                  <span className="block text-sm font-bold">공개 경매</span>
                  <span className="mt-1 block text-xs">현재 최고가를 보며 여러 번 입찰</span>
                </button>
                <button
                  type="button"
                  onClick={() => update("auctionType", "sealed")}
                  aria-pressed={form.auctionType === "sealed"}
                  className={`rounded-xl border px-4 py-3 text-left transition ${form.auctionType === "sealed" ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600"}`}
                >
                  <span className="block text-sm font-bold">블라인드 경매</span>
                  <span className="mt-1 block text-xs">금액 비공개 · 한 사람당 한 번</span>
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor={`${titleId}-title`} className="mb-1 block text-sm font-semibold text-slate-700">제목</label>
              <input
                type="text"
                maxLength={50}
                id={`${titleId}-title`}
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="예: 게임 쿠폰 1장"
                className="w-full rounded-xl border border-blue-200 px-3 py-2"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">대표 이미지</label>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white p-2 ring-1 ring-slate-100">
                  <img src={selectedItemAsset} alt="" aria-hidden="true" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <select
                    aria-label="대표 이미지"
                    value={form.itemIcon}
                    onChange={(event) => update("itemIcon", event.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500"
                  >
                    {MARKETPLACE_TYPE_ASSET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">경매 카드에 표시될 대표 이미지를 고릅니다.</p>
                </div>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${titleId}-description`} className="mb-1 block text-sm font-semibold text-slate-700">설명</label>
              <textarea
                rows={3}
                maxLength={200}
                id={`${titleId}-description`}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="물건 상태나 전달 조건을 적어주세요"
                className="w-full resize-none rounded-xl border border-blue-200 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                시작가 ({currencyName})
              </label>
              <input
                type="number"
                min={1}
                aria-label="시작가"
                value={form.startPrice}
                onChange={(e) => update("startPrice", e.target.value)}
                className="w-full rounded-xl border border-blue-200 px-3 py-2"
              />
            </div>

            {normalized.auctionType === "open" ? <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                입찰 단위 ({currencyName})
              </label>
              <input
                type="number"
                min={1}
                aria-label="입찰 단위"
                value={form.bidStep}
                onChange={(e) => update("bidStep", e.target.value)}
                className="w-full rounded-xl border border-blue-200 px-3 py-2"
              />
            </div> : (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                <p className="font-bold">최소 입찰 금액</p>
                <p className="mt-1 text-xs">시작가 이상으로 한 번만 제출할 수 있습니다.</p>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                진행 시간
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    aria-label="진행 시간 일"
                    value={form.days}
                    onChange={(e) => update("days", e.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2"
                  />
                  <p className="mt-1 text-xs text-slate-500">일</p>
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    aria-label="진행 시간 시간"
                    value={form.hours}
                    onChange={(e) => update("hours", e.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2"
                  />
                  <p className="mt-1 text-xs text-slate-500">시간</p>
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    aria-label="진행 시간 분"
                    value={form.minutes}
                    onChange={(e) => update("minutes", e.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2"
                  />
                  <p className="mt-1 text-xs text-slate-500">분</p>
                </div>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                총 진행 시간:
                {" "}
                <span className="font-semibold text-slate-700">{durationLabel}</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                최대 30일까지 설정할 수 있습니다.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-200">
            {normalized.auctionType === "sealed"
              ? "모든 입찰금은 마감까지 보류됩니다. 최고 금액이 같으면 먼저 입찰한 사람이 낙찰됩니다."
              : "입찰자는 최고 입찰자일 때만 보류금이 유지되고, 마감되면 자동 정산됩니다."}
            {normalized.auctionType === "open" && Number(antiSnipingSeconds || 0) > 0 ? (
              <p className="mt-1 font-semibold text-indigo-700">
                마감 시간 자동 연장: 종료 {antiSnipingSeconds}초 이내 입찰 시 남은 시간을 {antiSnipingSeconds}초로 재설정합니다.
              </p>
            ) : null}
          </div>

          </div>
          <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">경매 조건: 시작가 {formatDisplayMoney(normalized.startPrice)} {currencyName}{normalized.auctionType === "open" ? ` · ${formatDisplayMoney(normalized.bidStep)} ${currencyName}씩 입찰` : " · 한 사람당 한 번"} · {durationLabel}</p>
            <p className="mb-3 text-xs text-slate-500">{autoApproveEnabled ? "등록하면 바로 경매가 시작됩니다." : "등록 후 승인 대기 상태가 되며, 승인되면 경매가 시작됩니다."}</p>
          <div className="flex justify-end gap-2">
            <Button kind="outline" tone="slate" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button
              kind="solid"
              tone="blue"
              icon={PlusCircle}
              onClick={submit}
              isLoading={isSubmitting}
              disabled={!isValid || isSubmitting}
            >
              {autoApproveEnabled ? "출품하기" : "승인 요청"}
            </Button>
          </div>
          </div>
      </div>
    </Modal>
  );
}
