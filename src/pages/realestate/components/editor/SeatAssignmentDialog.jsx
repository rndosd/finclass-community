import React from 'react';
import { ArrowRightLeft, User, UserMinus } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';
import Button from '../../../../components/ui/Button';

const SeatAssignmentDialog = ({ desk, students, onClose, onAssign, onClear, onToggleActive }) => (
  <Modal isOpen onClose={onClose} size="sm" title="학생 자리 변경">
    <p className="text-xs font-semibold text-slate-500">{desk.label || `${desk.number}번 자리`}</p>
    <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-4">
      <span className="flex items-center gap-2 text-sm text-slate-600"><User size={16} />앉은 학생</span>
      <strong className="break-words text-right text-lg text-slate-900">{desk.studentName || '미배정'}</strong>
    </div>
    <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
      <ArrowRightLeft size={15} className="mt-0.5 shrink-0 text-indigo-600" />
      학생끼리 자리를 바꾸려면 이 창을 닫고 이름을 다른 책상으로 드래그하세요.
    </p>
    <div className="mt-5 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-bold text-slate-800">이 자리에 배정할 학생</h3>
      <p className="mt-1 text-xs text-slate-500">아직 자리가 없는 학생만 표시합니다.</p>
      {students.length > 0 ? <div className="mt-3 grid max-h-48 grid-cols-2 gap-2 overflow-y-auto">
        {students.map((student) => <button key={student.uid} type="button" onClick={() => onAssign(student)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50">
          <User size={14} className="shrink-0 text-slate-400" /><span className="break-words">{student.name}</span>
        </button>)}
      </div> : <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">모든 학생에게 자리가 배정되어 있어요.</p>}
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
      <Button type="button" kind="outline" tone="slate" size="sm" disabled={!desk.studentName} onClick={onClear}>
        <UserMinus size={14} />배정 해제
      </Button>
      <Button type="button" kind="ghost" tone="slate" size="sm" onClick={onToggleActive}>
        {desk.isActive ? '자리 숨기기' : '자리 복구'}
      </Button>
    </div>
    <p className="mt-4 text-xs text-slate-400">부동산 소유자: {desk.ownerName || '국가'} · 변경 후 최종 저장을 눌러 주세요.</p>
  </Modal>
);

export default SeatAssignmentDialog;
