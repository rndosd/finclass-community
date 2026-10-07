import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from '../../../../components/ui';

const TradeHistoryWarningModal = ({
  isOpen,
  title = '거래 이력 자리 변경 경고',
  message = '',
  confirmLabel = '계속 진행',
  onClose,
  onConfirm,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    size="sm"
    closeOnOverlayClick={false}
  >
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-amber-900">거래 이력 보호 확인</p>
            <p className="mt-1 text-sm font-semibold leading-relaxed text-amber-800">
              {message}
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs font-semibold text-slate-500">
        거래 이력이 있는 자리의 정보 손실을 막기 위해 한 번 더 확인합니다.
      </p>

      <div className="flex justify-end gap-2">
        <Button tone="slate" kind="ghost" onClick={onClose}>
          취소
        </Button>
        <Button tone="red" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Modal>
);

export default TradeHistoryWarningModal;
