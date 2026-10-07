import React, { useEffect, useState, useSyncExternalStore } from "react";
import Modal from "./Modal";
import Button from "./Button";
import InputField from "./InputField";
import {
  cancelAppDialogs, getAppDialog, resolveAppDialog, subscribeAppDialogs,
} from "../../utils/appDialogs";

function DialogContent({ request }) {
  const [value, setValue] = useState(request.defaultValue || "");
  const isPrompt = request.type === "prompt";
  const isAlert = request.type === "alert";
  const cancel = () => resolveAppDialog(request.id, isPrompt ? null : isAlert ? undefined : false);
  const submit = () => resolveAppDialog(request.id, isPrompt ? value : isAlert ? undefined : true);
  return (
    <Modal
      isOpen
      title={request.title || (isAlert ? "알림" : isPrompt ? "내용 입력" : "작업 확인")}
      size="sm"
      density="compact"
      onClose={cancel}
      closeOnOverlayClick={false}
      zIndexBase={120000}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {!isAlert && <Button size="sm" variant="outline" data-autofocus={!isPrompt || undefined} onClick={cancel}>{request.cancelLabel || "취소"}</Button>}
          <Button size="sm" tone={request.tone || "blue"} data-autofocus={isAlert || undefined} onClick={submit}>
            {request.confirmLabel || (isAlert ? "닫기" : isPrompt ? "입력 완료" : "계속하기")}
          </Button>
        </div>
      }
    >
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{request.message}</p>
      {isPrompt && <form aria-label={`${request.inputLabel || "입력 내용"} 입력`} className="mt-5" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <InputField label={request.inputLabel || "입력 내용"} value={value} onChange={(event) => setValue(event.target.value)} data-autofocus />
      </form>}
    </Modal>
  );
}

export default function AppDialogHost({ scopeKey = "app" }) {
  const request = useSyncExternalStore(subscribeAppDialogs, getAppDialog, () => null);
  // Navigation/account/class changes cancel pending decisions, rather than executing stale actions.
  useEffect(() => () => cancelAppDialogs(), [scopeKey]);
  useEffect(() => {
    const handleEscape = (event) => {
      const active = getAppDialog();
      if (!active || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      resolveAppDialog(active.id, active.type === "prompt" ? null : active.type === "confirm" ? false : undefined);
    };
    // Native dialogs consumed Escape; preserve that boundary for legacy parent key handlers.
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, []);
  return request ? <DialogContent key={request.id} request={request} /> : null;
}
