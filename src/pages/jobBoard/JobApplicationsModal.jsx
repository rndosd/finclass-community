import {
  Badge,
  Button,
  Modal,
  Spinner,
} from "../../components/ui";
import {
  ApplicationCard,
  REVIEW_FILTER_OPTIONS,
  WorkerRatingActionCard,
  isApplicationPayable,
  normalizeSelectionTypeValue,
  selectClassName,
} from "./JobBoardPage.parts";

export default function JobApplicationsModal({
  isOpen,
  onClose,
  selectedPost,
  isTeacher,
  canManageSelectedWorkerRatings,
  isApplicationsLoading,
  filteredApplications,
  payableApplications,
  detailApplications,
  bulkPaymentTargets,
  bulkPaymentIds,
  expandedApplicationIds,
  allDetailsExpanded,
  busyKey,
  reviewFilter,
  setReviewFilter,
  setBulkPaymentIds,
  onBulkPayRewards,
  onToggleAllDetails,
  onBulkDragStart,
  onBulkDragEnter,
  onToggleDetail,
  onSelectApplication,
  onRejectApplication,
  selectedPostRateTargets,
  onRateWorker,
}) {
  if (!selectedPost) return null;

  const isFirstCome = normalizeSelectionTypeValue(selectedPost.selectionType) === "first_come";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isFirstCome ? "참여자 관리" : "지원자 관리"}
      size="5xl"
    >
      <div className="space-y-4">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-900">
                {isFirstCome ? "참여자 관리" : "지원자 관리"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {isFirstCome
                  ? isTeacher
                    ? "선착순 참여자는 자동 선발됩니다. 완료 확인과 보상 지급을 여기서 처리할 수 있습니다."
                    : "선착순 참여자는 자동 선발됩니다. 완료 확인 전까지 반려 처리를 할 수 있습니다."
                  : isTeacher
                    ? "선발, 반려, 보상 지급을 여기서 처리할 수 있습니다."
                    : "선발과 반려를 직접 처리할 수 있습니다. 보상 지급은 교사가 합니다."}
              </p>
            </div>
            <div className="min-w-[180px]">
              <select
                className={selectClassName}
                value={reviewFilter}
                onChange={(event) => setReviewFilter(event.target.value)}
              >
                {REVIEW_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isTeacher && payableApplications.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-500">
                지급 가능한 행을 누른 채로 훑으면 여러 명을 선택할 수 있습니다.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-black text-slate-700">
                  {bulkPaymentTargets.length}명 선택
                </span>
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  onClick={() => setBulkPaymentIds(payableApplications.map((application) => application.id))}
                  disabled={bulkPaymentTargets.length === payableApplications.length}
                >
                  모두 선택
                </Button>
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  onClick={() => setBulkPaymentIds([])}
                  disabled={bulkPaymentTargets.length === 0}
                >
                  해제
                </Button>
                <Button
                  size="sm"
                  tone="blue"
                  onClick={onBulkPayRewards}
                  isLoading={busyKey === "pay:bulk"}
                  disabled={bulkPaymentTargets.length === 0}
                >
                  선택 지급
                </Button>
              </div>
            </div>
          ) : null}

          {detailApplications.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-500">
                지원서 {expandedApplicationIds.length}/{detailApplications.length}개 펼침
              </p>
              <Button
                size="sm"
                kind="outline"
                tone="slate"
                onClick={onToggleAllDetails}
              >
                {allDetailsExpanded ? "모두 접기" : "모두 펼치기"}
              </Button>
            </div>
          ) : null}

          {isApplicationsLoading ? (
            <div className="mt-6 flex items-center justify-center py-12">
              <Spinner size="md" tone="indigo" />
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm font-semibold text-slate-500">
              표시할 지원서가 없습니다.
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-400 md:grid md:grid-cols-[40px_minmax(0,1fr)_120px_minmax(260px,auto)]">
                <span>선택</span>
                <span>이름</span>
                <span>상태</span>
                <span className="text-right">처리</span>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    busyKey={busyKey}
                    isBulkSelectable={Boolean(isTeacher && isApplicationPayable(application))}
                    isBulkSelected={bulkPaymentIds.includes(application.id)}
                    isDetailOpen={expandedApplicationIds.includes(application.id)}
                    onBulkDragStart={onBulkDragStart}
                    onBulkDragEnter={onBulkDragEnter}
                    onToggleDetail={onToggleDetail}
                    onSelect={onSelectApplication}
                    onReject={onRejectApplication}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {canManageSelectedWorkerRatings ? (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">작업자 후기</p>
                <p className="mt-1 text-sm text-slate-500">
                  보상을 받은 작업자에게 후기를 남길 수 있어요. 선생님은 전체 후기를 관리해요.
                </p>
              </div>
              <Badge tone="amber">{selectedPostRateTargets.length}명</Badge>
            </div>

            {isApplicationsLoading ? (
              <div className="mt-4 flex items-center justify-center py-12">
                <Spinner size="md" tone="amber" />
              </div>
            ) : selectedPostRateTargets.length === 0 ? (
              <div className="mt-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm font-semibold text-slate-500">
                보상 지급 후 후기를 남길 수 있어요.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {selectedPostRateTargets.map((target) => (
                  <WorkerRatingActionCard
                    key={`${target.applicationId}:${target.targetUid}`}
                    target={target}
                    busyKey={busyKey}
                    onRate={onRateWorker}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
