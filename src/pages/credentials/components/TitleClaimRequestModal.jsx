import { useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Alert, Badge, Button, Modal, Textarea } from "../../../components/ui";
import { getTitleRevealMeta } from "../CredentialsPage.parts";

export default function TitleClaimRequestModal({
  open,
  entry,
  existingRequest,
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const [requestMessage, setRequestMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setRequestMessage(existingRequest?.requestMessage || "");
  }, [existingRequest, open]);

  if (!entry) return null;

  const revealMeta = getTitleRevealMeta(entry);
  const displayName = revealMeta.displayName || "이름 없는 칭호";
  const displayHint =
    revealMeta.displayHint ||
    "조건을 달성했다고 판단하면 교사에게 지급 요청을 보낼 수 있습니다.";
  const isRetryRequest = existingRequest?.status === "rejected";

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title="칭호 지급 요청"
      size="md"
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {entry.gradeLabel ? (
              <Badge tone={entry.gradeTone || "slate"}>{entry.gradeLabel}</Badge>
            ) : null}
            {entry.category ? <Badge tone="blue">{entry.category}</Badge> : null}
            <Badge tone="indigo">{isRetryRequest ? "재요청" : "학생 요청"}</Badge>
          </div>
          <p
            className="mt-3 text-lg font-black text-slate-900"
            style={
              revealMeta.blurName
                ? { filter: "blur(4px)", userSelect: "none" }
                : undefined
            }
          >
            {displayName}
          </p>
          <p
            className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600"
            style={
              revealMeta.blurHint
                ? { filter: "blur(3.4px)", userSelect: "none" }
                : undefined
            }
          >
            {displayHint}
          </p>
        </div>

        {isRetryRequest && existingRequest?.reviewMessage ? (
          <Alert
            type="warning"
            message={`지난 요청의 검토 의견: ${existingRequest.reviewMessage}`}
          />
        ) : null}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            요청 메모
          </label>
          <Textarea
            rows={4}
            value={requestMessage}
            onChange={(event) => setRequestMessage(event.target.value)}
            placeholder="예: 이번 주 모둠 투자 수익 기록을 1등으로 마쳤고 발표 참여도 완료했습니다."
            disabled={isSubmitting}
          />
          <p className="text-xs leading-5 text-slate-500">
            조건 달성 근거를 교사가 바로 확인할 수 있도록 짧게 적어 두면 검토가 빨라집니다.
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                entry,
                requestMessage: String(requestMessage || "").trim(),
              })
            }
            isLoading={isSubmitting}
            icon={Send}
          >
            요청 보내기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
