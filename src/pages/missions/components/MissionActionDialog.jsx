import React, { useEffect, useSyncExternalStore } from "react";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";

// Mission-only requests: keep native browser dialogs out of the mission flow.
const listeners = new Set();
let activeRequest = null;
let mounted = false;
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => activeRequest;

const defaultsFor = (message) => {
  if (/삭제/.test(message)) return { title: "과제를 삭제할까요?", confirmLabel: "삭제하기", danger: true, consequence: "삭제한 과제는 되돌릴 수 없습니다." };
  if (/취소|회수/.test(message)) return { title: "승인을 취소할까요?", confirmLabel: "승인 취소", danger: true, consequence: "지급된 보상이 회수됩니다." };
  if (/반려/.test(message)) return { title: "제출을 반려할까요?", confirmLabel: "반려하기", danger: true, consequence: "학생에게 반려 상태가 표시됩니다." };
  if (/발송/.test(message)) return { title: "알림을 보낼까요?", confirmLabel: "알림 보내기" };
  if (/생성/.test(message)) return { title: "반복 과제를 만들까요?", confirmLabel: "과제 만들기" };
  return { title: "제출을 승인할까요?", confirmLabel: "승인하기" };
};

export const confirmMissionAction = (message, options = {}) => {
  // Ignore duplicate clicks while a decision is pending. Never run without a host.
  if (!mounted || activeRequest) return Promise.resolve(false);
  return new Promise((resolve) => {
    activeRequest = { message, ...defaultsFor(message), ...options, resolve };
    emit();
  });
};

export const showMissionNotice = (message) =>
  confirmMissionAction(message, { title: "과제 안내", confirmLabel: "확인", notice: true, danger: false, consequence: "" });

const settle = (accepted) => {
  const request = activeRequest;
  activeRequest = null;
  emit();
  request?.resolve(accepted);
};

export default function MissionActionDialog() {
  const request = useSyncExternalStore(subscribe, getSnapshot, () => null);
  useEffect(() => {
    mounted = true;
    return () => {
      mounted = false;
      settle(false);
    };
  }, []);

  if (!request) return null;

  return (
    <Modal isOpen={!!request} onClose={() => settle(false)} size="sm" title={request?.title}>
      <div>
        <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{request?.message}</p>
        {request?.consequence ? <p className="mt-3 text-sm font-semibold text-slate-900">{request.consequence}</p> : null}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {!request?.notice ? <Button variant="outline" onClick={() => settle(false)}>취소</Button> : null}
        <Button variant={request?.danger ? "danger" : "primary"} onClick={() => settle(true)}>{request?.confirmLabel}</Button>
      </div>
    </Modal>
  );
}
