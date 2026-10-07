import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React from "react";
import dayjs from "dayjs";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Badge, Button, IconButton } from "../../../components/ui";
import { isRandomBoxItem } from "../utils/randomBox";

const isCompletedStatus = (status) =>
  status === "redeemed" || status === "completed";

const toDateSafe = (...candidates) => {
  for (const timestamp of candidates) {
    if (!timestamp) continue;
    if (typeof timestamp.toDate === "function") return timestamp.toDate();
    if (typeof timestamp?.seconds === "number") {
      return new Date(timestamp.seconds * 1000);
    }
    if (timestamp instanceof Date) return timestamp;
  }
  return null;
};

const toSafeCount = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(numericValue));
};

const getDefaultUsageMeta = (item, usageInfo) => {
  if (!isCompletedStatus(item?.status)) {
    return { label: "-", tone: "slate", variant: "soft" };
  }

  if (!usageInfo) {
    return { label: "확인 중", tone: "slate", variant: "soft" };
  }

  if (usageInfo.type === "unused") {
    return { label: "미사용", tone: "emerald", variant: "soft" };
  }

  if (usageInfo.type === "partial") {
    return {
      label: `부분 사용 (${usageInfo.usedQty}/${usageInfo.purchasedQty})`,
      tone: "yellow",
      variant: "soft",
    };
  }

  return { label: "사용 완료", tone: "rose", variant: "soft" };
};

const getRandomBoxProgress = (item, usageInfo) => {
  const purchasedQty = Math.max(1, toSafeCount(item?.quantity, 1));
  const openedCountRaw = Number(item?.randomBoxOpenedCount);
  const hasTracking = Number.isFinite(openedCountRaw);
  const openedCount = Math.min(purchasedQty, toSafeCount(openedCountRaw));
  const unopenedCount = Math.max(purchasedQty - openedCount, 0);
  const unusedCount = toSafeCount(item?.randomBoxRewardUnusedCount);
  const partialCount = toSafeCount(item?.randomBoxRewardPartialCount);
  const usedCount = toSafeCount(item?.randomBoxRewardUsedCount);

  if (!hasTracking) {
    if (!usageInfo) {
      return {
        usageMeta: { label: "확인 중", tone: "slate", variant: "soft" },
        summaryText: "개봉 추적 정보 확인 중",
      };
    }

    if (usageInfo.type === "unused") {
      return {
        usageMeta: { label: "미개봉", tone: "emerald", variant: "soft" },
        summaryText: `미개봉 ${purchasedQty}개`,
      };
    }

    if (usageInfo.type === "partial") {
      return {
        usageMeta: {
          label: `일부 개봉 (${usageInfo.usedQty}/${usageInfo.purchasedQty})`,
          tone: "yellow",
          variant: "soft",
        },
        summaryText: "이전 구매의 상세 개봉 기록은 없어요.",
      };
    }

    return {
      usageMeta: { label: "개봉됨", tone: "amber", variant: "soft" },
      summaryText: "받은 보상은 새 기록부터 볼 수 있어요.",
    };
  }

  const summaryParts = [`개봉 ${openedCount}/${purchasedQty}`];
  if (openedCount > 0) {
    if (unusedCount > 0) summaryParts.push(`미사용 ${unusedCount}`);
    if (partialCount > 0) summaryParts.push(`부분 사용 ${partialCount}`);
    if (usedCount > 0) summaryParts.push(`사용 완료 ${usedCount}`);
  } else if (unopenedCount > 0) {
    summaryParts.push(`남음 ${unopenedCount}`);
  }

  if (openedCount <= 0) {
    return {
      usageMeta: { label: "미개봉", tone: "emerald", variant: "soft" },
      summaryText: summaryParts.join(" · "),
    };
  }

  if (unopenedCount > 0) {
    return {
      usageMeta: {
        label: `일부 개봉 (${openedCount}/${purchasedQty})`,
        tone: "yellow",
        variant: "soft",
      },
      summaryText: summaryParts.join(" · "),
    };
  }

  if (partialCount > 0) {
    return {
      usageMeta: { label: "보상 일부 사용", tone: "yellow", variant: "soft" },
      summaryText: summaryParts.join(" · "),
    };
  }

  if (unusedCount > 0) {
    return {
      usageMeta: { label: "보상 미사용", tone: "amber", variant: "soft" },
      summaryText: summaryParts.join(" · "),
    };
  }

  return {
    usageMeta: { label: "보상 사용 완료", tone: "rose", variant: "soft" },
    summaryText: summaryParts.join(" · "),
  };
};

const getRewardUsageMeta = (status) => {
  if (status === "unused") {
    return { label: "미사용", tone: "emerald", variant: "soft" };
  }

  if (status === "partial") {
    return { label: "부분 사용", tone: "yellow", variant: "soft" };
  }

  return { label: "사용 완료", tone: "rose", variant: "soft" };
};

const isRowSelectionExcludedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button,a,input,textarea,select,[data-no-row-select='true']"),
  );
};

const PurchaseItemRow = ({
  item,
  onCancel,
  onRedeem,
  isProcessing,
  isBulkProcessing,
  isSelected = false,
  isSelectable = false,
  onToggleSelected,
  onSelectionMouseDown,
  onSelectionMouseEnter,
  usageInfo,
  isExpandedRandomBox = false,
  randomBoxEvents = [],
  isLoadingRandomBoxEvents = false,
  onToggleRandomBoxDetails,
  isRestricted = false,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const isDisabled = isProcessing || isBulkProcessing;
  const isCompletedPurchase = isCompletedStatus(item.status);
  const isRandomBoxPurchase = isRandomBoxItem(item);
  const randomBoxProgress = isRandomBoxPurchase && isCompletedPurchase
    ? getRandomBoxProgress(item, usageInfo)
    : null;
  const usageMeta = randomBoxProgress?.usageMeta || getDefaultUsageMeta(item, usageInfo);
  const usageSummaryText =
    isRandomBoxPurchase && isCompletedPurchase ? randomBoxProgress?.summaryText : "";
  const canRefund =
    !isRestricted &&
    isCompletedPurchase &&
    Boolean(usageInfo) &&
    usageInfo.type === "unused";
  const displayDate = toDateSafe(
    item.requestDate,
    item.completedAt,
    item.redeemedAt,
    item.cancelledAt,
    item.createdAt,
  );
  const totalAmount = Number(item.totalAmount || 0);
  const isRandomBoxExpandable = isRandomBoxPurchase && isCompletedPurchase;
  const privacyPill = (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">
      교사만 확인
    </span>
  );
  const blurredTextClass =
    "inline-block max-w-full rounded bg-slate-200 px-2 text-transparent blur-[3px] select-none";

  return (
    <>
      <tr
        onMouseDown={(event) => {
          if (!isSelectable || isRowSelectionExcludedTarget(event.target)) return;
          event.preventDefault();
          onSelectionMouseDown?.(item, isSelected);
        }}
        onMouseEnter={() => {
          if (!isSelectable) return;
          onSelectionMouseEnter?.(item);
        }}
        className={`transition-colors ${
          isExpandedRandomBox
            ? "bg-amber-50/40"
            : isSelected
              ? "bg-indigo-50/70"
              : isSelectable
                ? "cursor-pointer hover:bg-slate-50/60"
                : "hover:bg-slate-50/30"
        }`}
      >
        <td className="p-3 text-center">
          {isSelectable ? (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelected?.(item)}
              disabled={isDisabled}
              className="h-4 w-4 cursor-pointer accent-indigo-600"
              data-no-row-select="true"
            />
          ) : (
            <span className="text-slate-200">-</span>
          )}
        </td>

        <td className="whitespace-nowrap p-3">
          {displayDate ? dayjs(displayDate).format("YYYY.MM.DD HH:mm") : "-"}
        </td>

        <td className="p-3 font-medium text-slate-800">
          {isRestricted ? (
            <span className={blurredTextClass}>VIP 학생</span>
          ) : (
            item.studentName
          )}
        </td>

        <td className="p-3">
          <div className="flex items-start gap-2">
            {isRandomBoxExpandable && !isRestricted ? (
              <IconButton
                icon={isExpandedRandomBox ? ChevronUp : ChevronDown}
                label={isExpandedRandomBox ? "랜덤박스 상세 닫기" : "랜덤박스 상세 보기"}
                onClick={() => onToggleRandomBoxDetails?.(item)}
                tone="amber"
                size="sm"
                className="mt-0.5 rounded-lg border-amber-200 bg-white"
                data-no-row-select="true"
                aria-label={isExpandedRandomBox ? "랜덤박스 상세 닫기" : "랜덤박스 상세 보기"}
              />
            ) : null}

            <div className="min-w-0">
              <div className="font-medium text-slate-800">
                {isRestricted ? (
                  <span className={blurredTextClass}>VIP 전용 상품</span>
                ) : (
                  `${item.itemName} (${item.quantity}개)`
                )}
              </div>
              {!isRestricted && isRandomBoxPurchase && usageSummaryText ? (
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {usageSummaryText}
                </p>
              ) : null}
            </div>
          </div>
        </td>

        <td className="whitespace-nowrap p-3 text-right font-semibold">
          {isRestricted ? (
            <span className={blurredTextClass}>000,000</span>
          ) : (
            `${formatDisplayMoney(totalAmount)} ${item.currencyUnit}`
          )}
        </td>

        <td className="p-3 text-center">
          {isCompletedStatus(item.status) ? (
            <Badge tone="green" variant="soft" size="sm">
              지급 완료
            </Badge>
          ) : item.status === "cancelled" ? (
            <Badge tone="rose" variant="soft" size="sm">
              취소됨
            </Badge>
          ) : (
            <Badge tone="yellow" variant="soft" size="sm">
              대기 중
            </Badge>
          )}
        </td>

        <td className="whitespace-nowrap p-3 text-center">
          <Badge tone={usageMeta.tone} variant={usageMeta.variant} size="sm">
            {usageMeta.label}
          </Badge>
        </td>

        <td className="p-3 text-center">
          {isRestricted ? (
            privacyPill
          ) : item.status === "pending" ? (
            <div className="flex items-center justify-center gap-2">
              <Button
                size="xs"
                kind="outline"
                tone="rose"
                onClick={() => onCancel(item)}
                disabled={isDisabled}
                data-no-row-select="true"
              >
                취소
              </Button>
              <Button
                size="xs"
                kind="solid"
                tone="blue"
                onClick={() => onRedeem(item)}
                disabled={isDisabled}
                isLoading={isProcessing}
                data-no-row-select="true"
              >
                지급
              </Button>
            </div>
          ) : isCompletedStatus(item.status) ? (
            <span
              className={`text-xs font-semibold ${
                canRefund ? "text-indigo-600" : "text-slate-400"
              }`}
            >
              {canRefund ? "환불 가능" : "환불 불가"}
            </span>
          ) : (
            <span className="text-xs font-medium text-rose-600">취소 완료</span>
          )}
        </td>
      </tr>

      {isRandomBoxExpandable && isExpandedRandomBox && !isRestricted ? (
        <tr className="bg-amber-50/30">
          <td colSpan={8} className="px-6 pb-4 pt-0">
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700">
                    랜덤박스 상세
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-600">
                    개봉 결과와 보상 사용 상태를 확인할 수 있습니다.
                  </p>
                </div>

                {item.randomBoxLastRewardItemName ? (
                  <Badge tone="amber" variant="soft" size="sm">
                    최근 보상 {item.randomBoxLastRewardItemName}
                  </Badge>
                ) : null}
              </div>

              {isLoadingRandomBoxEvents ? (
                <div className="mt-3 rounded-xl bg-white/80 px-4 py-5 text-sm font-medium text-slate-400">
                  랜덤박스 상세를 불러오는 중입니다...
                </div>
              ) : randomBoxEvents.length > 0 ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {randomBoxEvents.map((event) => {
                    const rewardUsageMeta = getRewardUsageMeta(
                      String(event?.rewardUsageStatus || "").trim(),
                    );
                    const openedAt = toDateSafe(event?.openedAt);
                    const lastUsedAt = toDateSafe(event?.rewardLastUsedAt);
                    const rewardQuantity = Math.max(
                      1,
                      toSafeCount(event?.rewardQuantity, 1),
                    );
                    const usedQty = Math.min(
                      rewardQuantity,
                      toSafeCount(event?.rewardUsedQty),
                    );
                    const remainingQty = Math.max(
                      0,
                      toSafeCount(event?.rewardRemainingQty, rewardQuantity - usedQty),
                    );

                    return (
                      <div
                        key={event.id}
                        className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-amber-100"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-amber-700">
                              개봉 {openedAt ? dayjs(openedAt).format("YYYY.MM.DD HH:mm") : "-"}
                            </p>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-800">
                              {event.rewardItemName || "보상 아이템"} x{rewardQuantity}
                            </p>
                          </div>

                          <Badge
                            tone={rewardUsageMeta.tone}
                            variant={rewardUsageMeta.variant}
                            size="sm"
                          >
                            {rewardUsageMeta.label}
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                            사용 {usedQty}/{rewardQuantity}
                          </span>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                            남음 {remainingQty}
                          </span>
                          {lastUsedAt ? (
                            <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-600">
                              마지막 사용 {dayjs(lastUsedAt).format("MM.DD HH:mm")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-white/80 px-4 py-5 text-sm font-medium text-slate-500">
                  랜덤박스 개봉 상세가 아직 없습니다. 오래된 기록은 보상 추적 정보가 없을 수 있습니다.
                </div>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

export default PurchaseItemRow;
