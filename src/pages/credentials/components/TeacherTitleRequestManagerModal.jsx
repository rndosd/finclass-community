import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Badge, Button, Card, Modal, Spinner } from "../../../components/ui";
import {
  EmptyState,
  SectionLead,
  formatDate,
  getTitleRequestStatusMeta,
} from "../CredentialsPage.parts";

export default function TeacherTitleRequestManagerModal({
  open,
  onClose,
  pendingRequests,
  reviewedRequests,
  isLoading,
  onApproveRequest,
  onRejectRequest,
  onApproveSelected,
  onRejectSelected,
}) {
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);

  useEffect(() => {
    if (!open) {
      setSelectedRequestIds([]);
      return;
    }

    setSelectedRequestIds((prev) =>
      prev.filter((requestId) =>
        pendingRequests.some((item) => item.requestId === requestId),
      ),
    );
  }, [open, pendingRequests]);

  const selectedItems = useMemo(
    () =>
      pendingRequests.filter((item) =>
        selectedRequestIds.includes(item.requestId),
      ),
    [pendingRequests, selectedRequestIds],
  );

  const requestStudentCount = useMemo(
    () =>
      new Set(
        pendingRequests.map((item) => item.studentUid).filter(Boolean),
      ).size,
    [pendingRequests],
  );

  const allSelected =
    pendingRequests.length > 0 &&
    selectedItems.length === pendingRequests.length;

  const toggleRequestSelection = (requestId) => {
    setSelectedRequestIds((prev) =>
      prev.includes(requestId)
        ? prev.filter((item) => item !== requestId)
        : [...prev, requestId],
    );
  };

  const toggleAllSelections = () => {
    if (allSelected) {
      setSelectedRequestIds([]);
      return;
    }

    setSelectedRequestIds(pendingRequests.map((item) => item.requestId));
  };

  const recentReviewedRequests = useMemo(
    () => reviewedRequests.slice(0, 8),
    [reviewedRequests],
  );

  if (!open) return null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="칭호 요청 관리"
      size="xl"
    >
      <div className="space-y-4">
        <Card
          className="overflow-hidden border-violet-100 bg-[linear-gradient(135deg,_rgba(245,243,255,0.92),_rgba(255,255,255,0.96))]"
          variant="elevated"
          tone="white"
          noShadow
        >
          <SectionLead
            eyebrow="승인 관리"
            title={`승인 대기 ${pendingRequests.length}건`}
            description="학생별 상세보기에 들어가지 않고도 이곳에서 승인 및 지급하거나 반려할 수 있습니다."
            action={
              <div className="flex flex-wrap gap-2">
                <Badge tone={pendingRequests.length ? "violet" : "slate"}>
                  요청 {pendingRequests.length}건
                </Badge>
                <Badge tone="blue">요청 학생 {requestStudentCount}명</Badge>
              </div>
            }
          />

          {selectedItems.length ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="indigo">선택 {selectedItems.length}건</Badge>
                <p className="text-sm font-medium text-slate-700">
                  선택한 요청을 한 번에 승인 및 지급하거나 반려할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  tone="emerald"
                  icon={CheckCircle2}
                  onClick={() => onApproveSelected(selectedItems)}
                >
                  승인 및 지급
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  tone="red"
                  icon={XCircle}
                  onClick={() => onRejectSelected(selectedItems)}
                >
                  선택 반려
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="py-12">
              <Spinner />
            </div>
          ) : pendingRequests.length ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">
                  대기 요청 목록
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={toggleAllSelections}
                >
                  {allSelected ? "전체 선택 해제" : "전체 선택"}
                </Button>
              </div>

              <div className="grid gap-3">
                {pendingRequests.map((requestItem) => {
                  const isSelected = selectedRequestIds.includes(
                    requestItem.requestId,
                  );

                  return (
                    <div
                      key={requestItem.requestId}
                      className={`rounded-2xl border p-4 transition ${
                        isSelected
                          ? "border-indigo-200 bg-indigo-50/60 shadow-[0_18px_36px_-28px_rgba(79,70,229,0.45)]"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  toggleRequestSelection(requestItem.requestId)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              선택
                            </label>
                            <p className="text-base font-bold text-slate-900">
                              {requestItem.studentName || "학생"} ·{" "}
                              {requestItem.titleName || "이름 없는 칭호"}
                            </p>
                            {requestItem.gradeLabel ? (
                              <Badge tone={requestItem.gradeTone || "slate"}>
                                {requestItem.gradeLabel}
                              </Badge>
                            ) : null}
                            {requestItem.category ? (
                              <Badge tone="blue">{requestItem.category}</Badge>
                            ) : null}
                            {requestItem.requestedAt ? (
                              <Badge tone="slate">
                                요청 {formatDate(requestItem.requestedAt)}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-500">
                            {requestItem.acquisitionCondition ||
                              "학생이 별도 조건 설명 없이 직접 요청했습니다."}
                          </p>
                          {requestItem.requestMessage ? (
                            <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                              학생 메모: {requestItem.requestMessage}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            tone="emerald"
                            icon={CheckCircle2}
                            onClick={() => onApproveRequest(requestItem)}
                          >
                            승인 및 지급
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            tone="red"
                            icon={XCircle}
                            onClick={() => onRejectRequest(requestItem)}
                          >
                            반려
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="대기 중인 요청이 없습니다"
              description="학생이 칭호 지급 요청을 보내면 이곳에서 승인 및 지급 여부를 처리할 수 있습니다."
              className="px-4 text-pretty sm:px-8"
            />
          )}
        </Card>

        {recentReviewedRequests.length ? (
          <Card
            className="overflow-hidden border-slate-200 bg-white"
            variant="elevated"
            tone="white"
            noShadow
          >
            <SectionLead
              eyebrow="최근 처리"
              title="최근 처리한 요청"
              description="최근 승인하거나 반려한 요청을 빠르게 확인할 수 있습니다."
            />
            <div className="grid gap-3">
              {recentReviewedRequests.map((requestItem) => {
                const statusMeta = getTitleRequestStatusMeta(requestItem.status);

                return (
                  <div
                    key={`${requestItem.requestId}-reviewed`}
                    className="rounded-2xl border border-slate-200 bg-white/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">
                            {requestItem.studentName || "학생"} ·{" "}
                            {requestItem.titleName || "이름 없는 칭호"}
                          </p>
                          {requestItem.gradeLabel ? (
                            <Badge tone={requestItem.gradeTone || "slate"}>
                              {requestItem.gradeLabel}
                            </Badge>
                          ) : null}
                          <Badge tone={statusMeta.tone}>
                            {statusMeta.label}
                          </Badge>
                        </div>
                        {requestItem.requestMessage ? (
                          <p className="mt-2 text-sm leading-6 text-slate-500">
                            학생 메모: {requestItem.requestMessage}
                          </p>
                        ) : null}
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {requestItem.reviewMessage
                            ? `처리 메모: ${requestItem.reviewMessage}`
                            : statusMeta.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {requestItem.requestedAt ? (
                          <Badge tone="slate">
                            요청 {formatDate(requestItem.requestedAt)}
                          </Badge>
                        ) : null}
                        {requestItem.reviewedAt ? (
                          <Badge tone="slate">
                            처리 {formatDate(requestItem.reviewedAt)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}
      </div>
    </Modal>
  );
}
