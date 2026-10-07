import React, { useMemo, useState } from "react";
import { Info, Package, PackageOpen, Ticket } from "lucide-react";

import { Button, Modal, Alert } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { useItemActions } from "../hooks/useItemActions";
import {
  formatExpiryDateTime,
  formatRemainingTime,
} from "../utils/itemExpiration";
import {
  getRandomBoxBoxType,
  getRandomBoxRewardEntries,
  isRandomBoxItem,
} from "../utils/randomBox";

const UseItemModal = ({
  isOpen,
  onClose,
  item,
  targetStudentUid = null,
  isAdminView = false,
  onUseSuccess = null,
}) => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();
  const { executeUseItem, loading } = useItemActions();

  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const isTicket =
    item?.itemType === "ticket" || item?.functionTag === "arcade_ticket";
  const isRandomBox = isRandomBoxItem(item);
  const randomBoxType = isRandomBox ? getRandomBoxBoxType(item) : "normal";
  const isPremiumRandomBox = isRandomBox && randomBoxType === "premium";
  const randomBoxRewardEntries = isRandomBox
    ? getRandomBoxRewardEntries(item)
    : [];

  const stockSummary = useMemo(
    () => ({ total: item?.usableQuantity ?? item?.quantity ?? 0 }),
    [item],
  );
  const numericQuantity = Math.floor(Number(quantity || 0));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isTicket || loading) return;

    const qty = isRandomBox ? 1 : numericQuantity;
    if (qty < 1 || qty > stockSummary.total) {
      showFeedback("사용 가능한 수량을 확인해 주세요.", "warning");
      return;
    }

    const result = await executeUseItem({
      classId,
      itemId: item.id,
      quantity: qty,
      note: isRandomBox ? "" : note.trim(),
      targetStudentUid,
    });

    if (!result.success) {
      return;
    }

    if (result?.data?.openedRandomBox) {
      const rewardName = result?.data?.rewardItemName || "보상 아이템";
      const rewardQuantity = Number(result?.data?.rewardQuantity || 1);

      showFeedback(
        isAdminView
          ? `${item.itemName}를 열어 ${rewardName} ${rewardQuantity}개를 지급했습니다.`
          : `${item.itemName}를 열어 ${rewardName} ${rewardQuantity}개를 획득했습니다.`,
        "success",
      );
    } else {
      showFeedback(
        isAdminView
          ? `${item.itemName} ${qty}개를 학생 대신 사용 처리했습니다.`
          : `${item.itemName} ${qty}개를 사용했습니다.`,
        "success",
      );
    }

    onUseSuccess?.(
      result?.data?.openedRandomBox
        ? {
            ...result.data,
            boxType: randomBoxType,
            previewRewards: randomBoxRewardEntries,
          }
        : result.data,
    );
    onClose();
  };

  const isInvalidQty = isRandomBox
    ? stockSummary.total < 1
    : !Number.isFinite(numericQuantity) ||
      numericQuantity < 1 ||
      numericQuantity > stockSummary.total;

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div
            className={`rounded-xl p-2 ${
              isTicket
                ? "bg-blue-100 text-blue-600"
                : isRandomBox
                  ? isPremiumRandomBox
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-700"
                  : "bg-indigo-100 text-indigo-600"
            }`}
          >
            {isTicket ? (
              <Ticket size={20} strokeWidth={2.5} />
            ) : isRandomBox ? (
              <PackageOpen size={20} />
            ) : (
              <Package size={20} />
            )}
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 leading-tight">
              {isTicket
                ? "티켓 안내"
                : isRandomBox
                  ? isAdminView
                    ? "랜덤박스 개봉"
                    : "랜덤박스 열기"
                  : isAdminView
                    ? "아이템 대신 사용"
                    : "아이템 사용하기"}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-500">{item?.itemName}</p>
              {isRandomBox ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                    isPremiumRandomBox
                      ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {isPremiumRandomBox ? "프리미엄 박스" : "일반 박스"}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-5">
          <div
            className={`flex items-center justify-between rounded-2xl border p-4 ${
              isTicket
                ? "border-blue-100 bg-blue-50/50"
                : isRandomBox
                  ? isPremiumRandomBox
                    ? "border-rose-100 bg-gradient-to-br from-rose-50 via-amber-50 to-white"
                    : "border-amber-100 bg-amber-50/50"
                  : "border-indigo-100 bg-indigo-50/50"
            }`}
          >
            <div>
              <p
                className={`text-[10px] font-black uppercase tracking-widest ${
                  isTicket
                    ? "text-blue-500"
                    : isRandomBox
                      ? isPremiumRandomBox
                        ? "text-rose-500"
                        : "text-amber-500"
                      : "text-indigo-500"
                }`}
              >
                보유 수량
              </p>
              <p
                className={`text-2xl font-black ${
                  isTicket
                    ? "text-blue-900"
                    : isRandomBox
                      ? isPremiumRandomBox
                        ? "text-rose-900"
                        : "text-amber-900"
                      : "text-indigo-900"
                }`}
              >
                {stockSummary.total}
                <span className="ml-1 text-sm font-normal">개</span>
              </p>
            </div>
          </div>

          {isTicket ? (
            <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-blue-200 bg-white p-5 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <Info size={32} />
              </div>
              <p className="text-sm font-bold leading-relaxed text-slate-500">
                오락실 티켓은 <span className="text-blue-600">오락실 게임</span>에서만
                자동으로 사용됩니다.
                <br />
                가방에서는 직접 사용할 수 없습니다.
              </p>
            </div>
          ) : (
            <form id="use-item-form" onSubmit={handleSubmit} className="space-y-5">
              {isRandomBox ? (
                <Alert
                  type="info"
                  message={
                    isPremiumRandomBox
                      ? "프리미엄 랜덤박스를 열면 연출 후 보상 아이템 1종이 바로 가방에 지급됩니다."
                      : "랜덤박스를 열면 보상 아이템 1종이 바로 가방에 지급됩니다."
                  }
                />
              ) : item?.expiredQuantity > 0 && isAdminView ? (
                <Alert
                  type={item?.isFullyExpired ? "warning" : "info"}
                  message={
                    item?.isFullyExpired
                      ? `만료된 수량 ${item.expiredQuantity}개는 사용할 수 없습니다. 학생 가방에서는 보이지 않고 관리자만 확인할 수 있습니다.`
                      : `만료된 수량 ${item.expiredQuantity}개는 제외되고, 현재 사용 가능한 수량은 ${stockSummary.total}개입니다.${
                          item?.nextExpiryMs
                            ? ` 다음 만료: ${formatExpiryDateTime(item.nextExpiryMs)} (${formatRemainingTime(item.nextExpiryMs)})`
                            : ""
                        }`
                  }
                />
              ) : item?.nextExpiryMs ? (
                <Alert
                  type="info"
                  message={`현재 사용 가능한 수량은 ${stockSummary.total}개입니다. 다음 만료: ${formatExpiryDateTime(item.nextExpiryMs)} (${formatRemainingTime(item.nextExpiryMs)})`}
                />
              ) : null}

              <div
                className={`grid grid-cols-1 gap-4 ${
                  isRandomBox ? "" : "sm:grid-cols-2"
                }`}
              >
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <label className="mb-3 block text-xs font-black uppercase tracking-widest text-slate-500">
                    {isRandomBox ? "열기 수량" : "사용할 수량"}
                  </label>
                  {isRandomBox ? (
                    <div
                      className={`flex h-[54px] items-center justify-center rounded-xl border text-xl font-black ${
                        isPremiumRandomBox
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      1개
                    </div>
                  ) : (
                    <input
                      type="number"
                      value={quantity}
                      onChange={(event) =>
                        setQuantity(
                          event.target.value === ""
                            ? ""
                            : Math.floor(Number(event.target.value)),
                        )
                      }
                      className="w-full rounded-xl border border-blue-200 px-4 py-3 text-center text-xl font-bold focus:ring-2 focus:ring-blue-500/20"
                      required
                    />
                  )}
                </div>

                {!isRandomBox ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <label className="mb-3 block text-xs font-black uppercase tracking-widest text-slate-500">
                      사용 메모
                    </label>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={
                        isAdminView
                          ? "대리 사용 사유를 적어 주세요"
                          : "메모를 적어 주세요"
                      }
                      className="h-[64px] w-full resize-none rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full gap-2">
          {isTicket ? (
            <Button size="md"
              kind="solid"
              tone="blue"
              onClick={onClose}
              fullWidth
              
            >
              확인했습니다
            </Button>
          ) : (
            <>
              <Button size="md"
                kind="ghost"
                tone="slate"
                onClick={onClose}
                disabled={loading}
                className="flex-1"
              >
                취소
              </Button>
              <Button
                type="submit"
                form="use-item-form"
                kind="solid"
                tone={isRandomBox ? (isPremiumRandomBox ? "rose" : "amber") : "indigo"}
                isLoading={loading}
                disabled={loading || isInvalidQty}
                fullWidth
                className={`h-12 flex-[2] rounded-2xl font-black ${
                  isRandomBox
                    ? isPremiumRandomBox
                      ? "shadow-lg shadow-rose-100"
                      : "shadow-lg shadow-amber-100"
                    : "shadow-lg shadow-indigo-100"
                }`}
              >
                {isRandomBox
                  ? isAdminView
                    ? "대신 열기"
                    : "지금 열기"
                  : isAdminView
                    ? "대신 사용하기"
                    : "지금 사용하기"}
              </Button>
            </>
          )}
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default UseItemModal;
