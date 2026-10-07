import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

import { Alert, Button, Modal } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { useItemActions } from "../hooks/useItemActions";

const DeleteInventoryItemModal = ({
  isOpen,
  onClose,
  item,
  targetStudentUid,
}) => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();
  const { executeDeleteItem, loading } = useItemActions();

  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setQuantity(1);
    setReason("");
  }, [isOpen, item?.id]);

  const stockSummary = useMemo(
    () => ({
      total: Math.max(0, Number(item?.quantity || 0)),
      deletable: Math.max(0, Number(item?.quantity || 0)),
    }),
    [item],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    const qty = Math.floor(Number(quantity || 0));
    if (qty < 1 || qty > stockSummary.deletable) {
      showFeedback("삭제할 수량을 확인해주세요.", "warning");
      return;
    }

    const result = await executeDeleteItem({
      classId,
      targetStudentUid,
      itemId: item.id,
      quantity: qty,
      reason: reason.trim(),
    });

    if (result.success) {
      showFeedback(`${item.itemName} ${qty}개를 삭제했습니다.`, "success");
      onClose();
    }
  };

  const isInvalidQty =
    !Number.isFinite(Number(quantity)) ||
    Number(quantity) < 1 ||
    Number(quantity) > stockSummary.deletable;

  if (!isOpen || !targetStudentUid) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-red-100 p-2 text-red-600">
            <Trash2 size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black leading-tight text-slate-900">
              학생 아이템 삭제
            </h2>
            <p className="text-sm font-bold text-slate-500">{item?.itemName}</p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <form
          id="delete-item-form"
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-500">
              현재 보유 수량
            </p>
            <p className="mt-1 text-2xl font-black text-red-900">
              {stockSummary.deletable}
              <span className="ml-1 text-sm font-normal">개</span>
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              현재 학생 가방에 표시되는 수량 기준으로 삭제됩니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <label className="mb-3 block text-xs font-black uppercase tracking-widest text-slate-500">
                삭제 수량
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) =>
                  setQuantity(
                    e.target.value === ""
                      ? ""
                      : Math.floor(Number(e.target.value)),
                  )
                }
                className="w-full rounded-xl border border-blue-200 px-4 py-3 text-center text-xl font-bold focus:ring-2 focus:ring-red-500"
                min={1}
                max={stockSummary.deletable}
                required
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <label className="mb-3 block text-xs font-black uppercase tracking-widest text-slate-500">
                삭제 사유
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 잘못 지급, 회수, 분실 처리"
                className="h-[64px] w-full resize-none rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <Alert
            type="warning"
            message="삭제 후 학생 자산과 보유 수량이 함께 차감되며, 사용 기록에는 삭제 내역이 남습니다."
          />

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                이 작업은 학생 가방에 바로 반영됩니다.
              </span>
            </div>
          </div>
        </form>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full gap-2">
          <Button size="md"
            kind="ghost"
            tone="slate"
            onClick={onClose}
            disabled={loading}
            className="flex-1"
          >
            취소
          </Button>
          <Button size="md"
            type="submit"
            form="delete-item-form"
            kind="solid"
            tone="red"
            isLoading={loading}
            disabled={loading || isInvalidQty}
            fullWidth
            className="flex-[2]"
          >
            삭제하기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default DeleteInventoryItemModal;
