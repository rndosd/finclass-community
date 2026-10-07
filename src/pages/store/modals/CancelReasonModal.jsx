// src/pages/store/modals/CancelReasonModal.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Textarea } from '../../../components/ui';

export default function CancelReasonModal({
    isOpen,
    onClose,
    onSubmit,
    defaultReason = '',
    isSubmitting = false,
}) {
    const [reason, setReason] = useState(defaultReason);
    const textareaRef = useRef(null);

    // 모달 열릴 때 초기화 + 포커스
    useEffect(() => {
        if (isOpen) {
            setReason(defaultReason || '');
            // 약간의 지연 후 포커스(렌더 완료 시점 보장)
            setTimeout(() => textareaRef.current?.focus(), 0);
        }
    }, [isOpen, defaultReason]);

    const handleSubmit = () => {
        if (typeof onSubmit === 'function' && !isSubmitting) {
            onSubmit(reason.trim());
        }
    };

    // Enter 제출(Shift+Enter는 줄바꿈)
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={isSubmitting ? undefined : onClose}
            size="md"
            closeOnOverlayClick={!isSubmitting}
        >
            <Modal.Header>
                <h3 className="text-lg font-semibold text-slate-800">🛑 구매 취소 사유 입력</h3>
            </Modal.Header>

            <Modal.Body>
                <p className="text-sm text-slate-600 mb-3">
                    이 구매 건을 취소하는 사유를 입력해 주세요. (선택 사항이며, 입력하지 않아도 취소 가능합니다.)
                </p>
                <Textarea
                    ref={textareaRef}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="예: 학생 요청, 재고 부족, 잘못된 주문 등"
                    rows={4}
                    className="w-full"
                />
            </Modal.Body>

            <Modal.Footer>
                <Button
                    variant="outline"
                    color="slate"
                    onClick={onClose}
                    disabled={isSubmitting}
                >
                    닫기
                </Button>
                <Button
                    color="red"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    isLoading={isSubmitting}
                >
                    {isSubmitting ? '처리 중...' : '취소 확정'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
