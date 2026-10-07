import React from 'react';
import { History } from 'lucide-react';
import Button from '../../../../components/ui/Button';
import Modal from '../../../../components/ui/Modal';
import RentPaymentHistory from './RentPaymentHistory';

const RentHistoryModal = ({ isOpen, onClose, desk, classId }) => (
  <Modal isOpen={isOpen} onClose={onClose} size="xl">
    <Modal.Header>
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-600 shadow-sm">
          <History size={24} />
        </div>
        <div>
          <h3 className="text-xl font-black leading-tight text-slate-800">임대 납부 기록</h3>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {desk?.label} Payment History
          </p>
        </div>
      </div>
    </Modal.Header>

    <Modal.Body className="min-h-[70vh]">
      <RentPaymentHistory
        desk={desk}
        classId={classId}
        embedded
        showHeader={false}
      />
    </Modal.Body>

    <Modal.Footer>
      <Button
        tone="slate"
        kind="soft"
        fullWidth
        onClick={onClose}
        className="sm:w-auto"
      >
        닫기
      </Button>
    </Modal.Footer>
  </Modal>
);

export default RentHistoryModal;
