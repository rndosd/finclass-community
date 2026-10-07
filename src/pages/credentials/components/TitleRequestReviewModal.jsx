import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Badge, Button, Modal, Textarea } from "../../../components/ui";

export default function TitleRequestReviewModal({
  open,
  mode,
  items,
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const [reviewMessage, setReviewMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setReviewMessage(items.length === 1 ? items[0]?.reviewMessage || "" : "");
  }, [items, open]);

  if (!open || !items.length) return null;

  const isApprove = mode === "approve";
  const title = isApprove
    ? items.length > 1
      ? "칭호 요청 일괄 승인 및 지급"
      : "칭호 요청 승인 및 지급"
    : items.length > 1
      ? "칭호 요청 일괄 반려"
      : "칭호 요청 반려";

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title={title}
      size="lg"
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isApprove ? "emerald" : "red"}>
              {items.length}건 선택
            </Badge>
            <Badge tone="slate">
              {isApprove ? "승인 시 즉시 지급" : "반려 사유 전달"}
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {isApprove
              ? "선택한 요청을 승인하면 학생에게 칭호가 즉시 지급됩니다."
              : "반려 사유를 남기면 학생이 다음 요청 전에 참고할 수 있습니다."}
          </p>
        </div>

        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <div
              key={item.requestId}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-slate-900">
                  {item.studentName || "학생"} ·{" "}
                  {item.titleName || "이름 없는 칭호"}
                </p>
                {item.gradeLabel ? (
                  <Badge tone={item.gradeTone || "slate"}>
                    {item.gradeLabel}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {item.acquisitionCondition ||
                  "학생이 별도 조건 설명 없이 직접 요청했습니다."}
              </p>
              {item.requestMessage ? (
                <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                  학생 메모: {item.requestMessage}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            {isApprove ? "승인 메모" : "반려 사유"}
          </label>
          <Textarea
            rows={4}
            value={reviewMessage}
            onChange={(event) => setReviewMessage(event.target.value)}
            placeholder={
              isApprove
                ? "예: 수행 기록을 확인했고 승인 후 즉시 지급합니다."
                : "예: 제출 기록이 아직 확인되지 않아 이번 요청은 반려합니다."
            }
            disabled={isSubmitting}
          />
          <p className="text-xs leading-5 text-slate-500">
            {isApprove
              ? "승인 메모는 선택 입력입니다. 비워 두면 기본 승인 처리로 저장됩니다."
              : "반려 사유는 필수입니다. 학생이 다시 요청할 때 참고할 수 있도록 남겨 주세요."}
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            tone={isApprove ? "emerald" : "red"}
            onClick={() =>
              onSubmit({
                mode,
                items,
                reviewMessage: String(reviewMessage || "").trim(),
              })
            }
            isLoading={isSubmitting}
            disabled={!isApprove && !String(reviewMessage || "").trim()}
            icon={isApprove ? CheckCircle2 : XCircle}
          >
            {isApprove ? "승인 및 지급" : "반려 처리"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
