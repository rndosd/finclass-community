// src/pages/marketplace/modals/RejectReasonModal.jsx
import React, { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';
import { Button } from "../../../components/ui";

const RejectReasonModal = ({ isOpen, onClose, onSubmit, itemTitle }) => {
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (isOpen) setReason('');
    }, [isOpen]);

    const handleSubmit = () => {
        onSubmit(reason.trim());
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="sm" title="거절 사유 입력">
            <div className="space-y-3">
                <div className="text-sm text-gray-600">
                    <div className="mb-1">대상 물건</div>
                    <div className="font-medium text-gray-800">{itemTitle}</div>
                </div>

                <textarea
                    className="w-full border rounded-xl px-3 py-2 min-h-[100px]"
                    placeholder="거절 사유를 입력하세요 (선택)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />

                <div className="flex justify-end gap-2">
                    <Button tone="slate" kind="outline" size="sm" onClick={onClose} >취소</Button>
                    <Button tone="rose" kind="solid" size="sm"
                        onClick={handleSubmit}
                        
                    >
                        거절하기
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default RejectReasonModal;
