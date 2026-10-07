import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowRight,
  Clock,
  Copy,
  EyeOff,
  MessageSquare,
  Pencil,
  ShieldCheck,
  UserSearch,
  X,
} from "lucide-react";

import { Badge, Button, Modal, Textarea } from "../../../../components/ui";
import { useFeedback } from "../../../../contexts/FeedbackContext";

const MAX_REASON_LENGTH = 1000;

const PoliceReasonModal = ({
  isOpen,
  onClose,
  data,
  canEditReason = false,
  onSaveReason,
  isSavingReason = false,
}) => {
  const { showFeedback } = useFeedback();
  const [isEditing, setIsEditing] = useState(false);
  const [draftReason, setDraftReason] = useState("");

  const baseReason = useMemo(() => {
    if (!data) return "";
    return (data.reporterName ? data.reportReason || data.reason : data.reason) || "";
  }, [data]);

  const rejectReason = useMemo(() => {
    if (!data) return "";
    return String(
      data.rejectReason || data.rejectionReason || data.resolutionReason || "",
    ).trim();
  }, [data]);

  useEffect(() => {
    if (!isOpen) return;
    setIsEditing(false);
    setDraftReason(baseReason);
  }, [baseReason, data?.id, isOpen]);

  if (!data) return null;

  const accusedName =
    data.studentName || data.accusedStudentName || "이름 없음";
  const applierName =
    data.actorName || data.appliedByName || data.resolverName || "처리자 없음";

  const amount = data.amountSigned || data.amount || 0;
  const appliedCount = Math.max(
    1,
    Math.floor(Number(data.quantityApplied || data.repeatCount || 1)),
  );
  const isFine = amount < 0 || data.type === "fine";
  const isReward = amount > 0 || data.type === "reward";
  const isReportBased = Boolean(data.reporterName);

  const rawDate = data.appliedAt || data.createdAt;
  const dateText = rawDate
    ? dayjs(rawDate.toDate?.() || rawDate).format("YYYY.MM.DD HH:mm")
    : "-";

  const displayReason = isEditing
    ? draftReason
    : baseReason || "(사유 없음)";
  const reasonLabel = rejectReason && isReportBased ? "신고 사유" : "사유 내용";

  const handleCopy = async () => {
    try {
      const copyText = rejectReason
        ? `반려 사유: ${rejectReason}\n${reasonLabel}: ${displayReason}`
        : displayReason;
      await navigator.clipboard.writeText(copyText);
      showFeedback("사유가 복사되었습니다.", "success");
    } catch (_error) {
      showFeedback("복사에 실패했습니다.", "error");
    }
  };

  const handleStartEdit = () => {
    setDraftReason(baseReason);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftReason(baseReason);
    setIsEditing(false);
  };

  const handleSave = async () => {
    const nextReason = String(draftReason || "").trim();

    if (!nextReason) {
      showFeedback("사유를 입력해 주세요.", "error");
      return;
    }

    if (nextReason.length > MAX_REASON_LENGTH) {
      showFeedback(`사유는 ${MAX_REASON_LENGTH}자 이하로 입력해 주세요.`, "error");
      return;
    }

    if (!onSaveReason) return;

    await onSaveReason(nextReason);
    setDraftReason(nextReason);
    setIsEditing(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <Modal.Header onClose={onClose}>
        <div className="flex items-center justify-between w-full pr-8">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-lg ${
                isFine
                  ? "bg-rose-50"
                  : isReward
                    ? "bg-emerald-50"
                    : "bg-indigo-50"
              }`}
            >
              <MessageSquare
                className={`w-5 h-5 ${
                  isFine
                    ? "text-rose-600"
                    : isReward
                      ? "text-emerald-600"
                      : "text-indigo-600"
                }`}
              />
            </div>
            <h3 className="font-bold text-lg text-slate-900">사유 상세</h3>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-4">
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center flex-wrap gap-2 text-sm">
                {isReportBased && (
                  <>
                    <div className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold">
                      <UserSearch size={12} /> {data.reporterName}
                    </div>
                    <ArrowRight size={14} className="text-slate-300" />
                  </>
                )}
                <span className="font-bold text-slate-600">{applierName}</span>
                <ArrowRight size={14} className="text-slate-300" />
                <span className="font-black text-indigo-600">{accusedName}</span>
                {appliedCount > 1 && (
                  <div className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                    <span className="text-[10px] font-bold">x {appliedCount}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isReportBased && (
                  <Badge tone="indigo" variant="outline" className="text-[10px] py-0">
                    신고 기반
                  </Badge>
                )}
                {data.isSensitive && (
                  <div className="flex items-center gap-1 text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">
                    <EyeOff size={10} />
                    <span className="text-[10px] font-bold">민감 신고</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 text-slate-400 font-mono text-[11px] pt-3 border-t border-slate-50">
              <Clock className="w-3 h-3" />
              <span>기록 시각: {dateText}</span>
            </div>
          </div>

          {rejectReason ? (
            <div className="relative pt-2">
              <div className="absolute top-0 left-4 px-2 bg-white text-[10px] font-black text-rose-600 flex items-center gap-1 z-10">
                <X className="w-3 h-3" /> 반려 사유
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5 pt-7">
                <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed text-rose-900">
                  "{rejectReason}"
                </p>
              </div>
            </div>
          ) : null}

          <div className="relative pt-2">
            <div className="absolute top-0 left-4 px-2 bg-white text-[10px] font-black text-slate-500 flex items-center gap-1 z-10">
              <ShieldCheck className="w-3 h-3" /> {reasonLabel}
            </div>
            <div className="bg-slate-50 rounded-2xl border border-slate-200/50 p-5 pt-7">
              {isEditing ? (
                <div className="space-y-3">
                  <Textarea
                    rows={6}
                    value={draftReason}
                    onChange={(event) => setDraftReason(event.target.value)}
                    maxLength={MAX_REASON_LENGTH}
                    className="rounded-2xl border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed"
                    placeholder="사유를 입력하세요"
                  />
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>선생님만 사유를 수정할 수 있습니다.</span>
                    <span>{draftReason.trim().length}/{MAX_REASON_LENGTH}</span>
                  </div>
                </div>
              ) : (
                <p className="text-slate-800 text-sm leading-relaxed font-medium whitespace-pre-wrap italic">
                  "{displayReason}"
                </p>
              )}
            </div>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex gap-2 w-full flex-wrap">
          <Button size="md"
                    tone="blue"
            kind="soft"
            className="flex-1 gap-2"
            onClick={handleCopy}
          >
            <Copy className="w-4 h-4" /> 사유 복사
          </Button>

          {canEditReason && !isEditing && (
            <Button size="md"
              tone="emerald"
              kind="soft"
              className="flex-1 gap-2"
              onClick={handleStartEdit}
            >
              <Pencil className="w-4 h-4" /> 사유 수정
            </Button>
          )}

          {canEditReason && isEditing && (
            <Button size="md"
              tone="slate"
              kind="soft"
              className="flex-1 gap-2"
              onClick={handleCancelEdit}
              disabled={isSavingReason}
            >
              <X className="w-4 h-4" /> 수정 취소
            </Button>
          )}

          {canEditReason && isEditing && (
            <Button size="md"
              tone="blue"
              className="flex-1"
              onClick={handleSave}
              isLoading={isSavingReason}
            >
              사유 저장
            </Button>
          )}

          <Button size="md"
            tone="slate"
            className="flex-1"
            onClick={onClose}
          >
            닫기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default React.memo(PoliceReasonModal);
