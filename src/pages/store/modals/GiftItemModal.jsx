import React, { useState, useMemo } from "react";
import { Modal, Button, Alert } from "../../../components/ui";
import { Gift } from "lucide-react";
import { useUser } from "../../../contexts/UserContext";
import { useItemActions } from "../hooks/useItemActions";
import { useFeedback } from "../../../contexts/FeedbackContext"; // 🚀 피드백 추가
import StudentSelector from "../../../components/ui/StudentSelector";
import { getActivePurchaseQuantity } from "../utils/itemExpiration";

const GiftItemModal = ({ isOpen, onClose, item }) => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback(); // 🚀 피드백 사용
  const { executeGiftItem, loading } = useItemActions();

  const [selectedRecipient, setSelectedRecipient] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const isGiftAllowed = item?.isGiftAllowed !== false;

  // 선물 가능 수량 계산 (직접 구매했고 아직 만료되지 않은 수량만 선물 가능)
  const maxGiftableQty = useMemo(() => {
    const explicitQuantity = Number(item?.activePurchaseQty);
    if (Number.isFinite(explicitQuantity)) {
      return Math.max(0, explicitQuantity);
    }

    return getActivePurchaseQuantity(item);
  }, [item]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (selectedRecipient.length === 0 || loading) return;

    if (!isGiftAllowed) {
      showFeedback("이 상품은 선물할 수 없도록 설정되어 있습니다.", "warning");
      return;
    }

    const qty = Math.floor(Number(quantity || 0));
    if (qty < 1 || qty > maxGiftableQty) {
      showFeedback("선물 가능한 수량을 확인해주세요.", "warning");
      return;
    }

    const result = await executeGiftItem({
      classId,
      recipientUid: selectedRecipient[0],
      itemId: item.id,
      quantity: qty,
      message: message.trim(),
    });

    if (result.success) {
      // ✅ 1. 토스트 알림 띄우기
      showFeedback(
        `${item.itemName} ${qty}개를 선물로 보냈습니다! 🎁`,
        "success",
      );

      // ✅ 2. 지체 없이 즉시 모달 닫기
      onClose();
    }
    // 실패 시 피드백은 훅에서 처리됨
  };

  const isInvalidQty =
    !Number.isFinite(quantity) || quantity < 1 || quantity > maxGiftableQty;

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-pink-100 rounded-xl text-pink-600">
            <Gift size={20} />
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">
            아이템 선물하기
          </h2>
        </div>
      </Modal.Header>

      <Modal.Body className="py-6">
        <form id="gift-form" onSubmit={handleSubmit} className="space-y-6">
          {/* 선물 수량 요약 정보 */}
          <div className="p-5 bg-pink-50/50 rounded-[2rem] border border-pink-100 flex justify-between items-center shadow-sm">
            <div>
              <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest">
                선물 가능
              </p>
              <p className="text-2xl font-black text-pink-600">
                {maxGiftableQty}개
              </p>
            </div>
            <p className="text-xs text-slate-400 font-bold">
              보유: {item?.quantity}개
            </p>
          </div>

          <StudentSelector
            label="누구에게 선물할까요?"
            selectedUids={selectedRecipient}
            onChange={setSelectedRecipient}
            singleSelect={true}
            includeTeacher={true}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-slate-200">
              <label className="text-xs font-black text-slate-500 uppercase mb-2 block tracking-widest">
                수량
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.floor(Number(e.target.value)))
                }
                className="w-full text-center text-xl font-black focus:outline-none"
                required
              />
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200">
              <label className="text-xs font-black text-slate-500 uppercase mb-2 block tracking-widest">
                메시지
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="한마디 적어보세요"
                className="w-full text-sm resize-none h-10 focus:outline-none font-medium"
              />
            </div>
          </div>

          <Alert
            type={isGiftAllowed ? "info" : "warning"}
            message={
              isGiftAllowed
                ? "직접 구매했고 아직 만료되지 않은 수량만 선물할 수 있으며, 자산 가치도 함께 이동합니다."
                : "이 상품은 선생님이 선물 제한로 설정해 두었습니다."
            }
          />
        </form>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex gap-2 w-full">
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
            form="gift-form"
            kind="solid"
            tone="pink"
            isLoading={loading}
            disabled={
              loading ||
              !isGiftAllowed ||
              selectedRecipient.length === 0 ||
              isInvalidQty
            }
            fullWidth
            className="flex-[2]"
          >
            선물 보내기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default GiftItemModal;
