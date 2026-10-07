import { useEffect, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";

import { Badge, Button, Modal, Textarea } from "../../../components/ui";

export default function TitleRevocationModal({
  open,
  item,
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason(item?.revokeReason || "");
  }, [item, open]);

  if (!item) return null;

  const isRestore = Boolean(item.isRevoked);

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title={isRestore ? "칭호 복구" : "칭호 회수"}
      size="md"
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {item.gradeLabel ? (
              <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge>
            ) : null}
            <Badge tone={item.isRevoked ? "red" : "blue"}>
              {item.isRevoked ? "회수 이력" : "현재 보유"}
            </Badge>
          </div>
          <p className="mt-3 text-lg font-black text-slate-900">
            {item.name || "이름 없는 칭호"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {isRestore
              ? "회수된 칭호를 다시 보유 상태로 복구합니다."
              : "회수하면 학생 보유 목록과 대표 칭호 영역에서 즉시 제외되고, 회수 이력은 그대로 남습니다."}
          </p>
          {item.revokeReason ? (
            <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm leading-6 text-slate-600">
              기존 회수 사유: {item.revokeReason}
            </p>
          ) : null}
        </div>

        {!isRestore ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              회수 사유
            </label>
            <Textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="예: 기간 한정 칭호 종료, 역할 변경, 기준 미충족 확인"
              disabled={isSubmitting}
            />
            <p className="text-xs leading-5 text-slate-500">
              회수 사유는 이력으로 남아 이후 복구 여부를 판단할 때 참고할 수 있습니다.
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            tone={isRestore ? "emerald" : "red"}
            onClick={() =>
              onSubmit({ item, revokeReason: String(reason || "").trim() })
            }
            isLoading={isSubmitting}
            disabled={!isRestore && !String(reason || "").trim()}
            icon={isRestore ? CheckCircle2 : Trash2}
          >
            {isRestore ? "복구" : "회수"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
