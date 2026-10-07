import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";

// UI
import { Spinner, Button, Card, PageHeader, Badge } from "../../components/ui";
import AppLayout from "../../components/layout/AppLayout";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileText,
  Gavel,
  PenLine,
  Users,
  Vote,
  XCircle,
} from "lucide-react";
import { useLawboard } from "./hooks/useLawboard";
import LawDetailModal from "./modals/LawDetailModal";
import ProposeBillModal from "./modals/ProposeBillModal";
import { getBillProposerDisplayName } from "./utils/billDisplay";

export default function AssemblyHome() {
  const navigate = useNavigate();
  const { classData, isTeacher } = useUser();
  const {
    classId,
    isLoading,
    isProcessing,
    votingBills,
    finishedBills,
    votedBills,
    handleApplyPolicy,
    handleVote,
    handleVoteVisibilityChange,
    isProposeModalOpen,
    setIsProposeModalOpen,
    handleProposalSuccess,
    canManageAssembly,
    canProposeBill,
  } = useLawboard();
  const [selectedBillId, setSelectedBillId] = useState(null);

  const currentLaws = useMemo(
    () =>
      [...votingBills]
        .sort(
          (a, b) =>
            (b.votes?.agree || 0) + (b.votes?.disagree || 0) -
            ((a.votes?.agree || 0) + (a.votes?.disagree || 0)),
        )
        .slice(0, 4),
    [votingBills],
  );

  const recentDecisions = useMemo(
    () => finishedBills.slice(0, 4),
    [finishedBills],
  );

  const selectedBill = useMemo(
    () =>
      [...votingBills, ...finishedBills].find(
        (bill) => bill.id === selectedBillId,
      ) || null,
    [finishedBills, selectedBillId, votingBills],
  );

  const votedCount = useMemo(
    () =>
      votingBills.reduce(
        (count, bill) => count + (votedBills[bill.id] ? 1 : 0),
        0,
      ),
    [votedBills, votingBills],
  );

  const passedCount = finishedBills.filter(
    (bill) => bill.status === "passed",
  ).length;
  const votePercentage =
    votingBills.length > 0
      ? Math.round((votedCount / votingBills.length) * 100)
      : 100;
  const passRate =
    finishedBills.length > 0
      ? Math.round((passedCount / finishedBills.length) * 100)
      : null;
  const pendingVoteCount = Math.max(0, votingBills.length - votedCount);
  const highlightedLaw =
    currentLaws.find((law) => !votedBills[law.id]) || currentLaws[0] || null;

  const openBill = (billId) => {
    setSelectedBillId(billId);
  };

  if (isLoading) {
    return (
      <AppLayout showDefaultHeader={false} showSidebar={true}>
        <div className="flex min-h-screen items-center justify-center bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <Spinner size="lg" message="의회 데이터 불러오는 중..." />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showDefaultHeader={false} showSidebar={true}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader
          title={`${classData?.className || "우리 반"} 학생의회`}
          subtitle="오늘의 안건을 살펴보고 우리 반의 결정에 참여해 보세요."
          icon={Vote}
          actions={
            <div className="flex flex-wrap gap-2">
              {canManageAssembly && (
                <Button
                  kind="outline"
                  tone="slate"
                  icon={Gavel}
                  onClick={() => navigate("/assembly/laws")}
                >
                  안건·투표 관리
                </Button>
              )}
              {canProposeBill && (
                <Button
                  kind="outline"
                  tone="blue"
                  icon={PenLine}
                  onClick={() => setIsProposeModalOpen(true)}
                >
                  법안 제안
                </Button>
              )}
            </div>
          }
        />

        <section aria-labelledby="assembly-agenda-title">
          <div className="mb-3 flex items-center gap-2 text-indigo-700">
            <CalendarDays aria-hidden="true" className="h-5 w-5" />
            <h2
              id="assembly-agenda-title"
              className="text-xl font-black tracking-tight"
            >
              오늘의 의회 일정
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Card
              noPadding
            >
              <Card.Content noPadding className="flex h-full flex-col justify-between gap-6 p-4 sm:p-6">
                {highlightedLaw ? (
                  <>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="indigo" variant="soft" size="sm">
                          투표 진행 중
                        </Badge>
                        {votedBills[highlightedLaw.id] && (
                          <Badge
                            tone={
                              votedBills[highlightedLaw.id] === "agree"
                                ? "emerald"
                                : "rose"
                            }
                            variant="soft"
                            size="sm"
                          >
                            내 투표 완료
                          </Badge>
                        )}
                      </div>
                      <h3 className="mt-4 text-2xl font-black leading-snug tracking-tight text-slate-900 sm:text-3xl">
                        {highlightedLaw.title}
                      </h3>
                      <p className="mt-3 line-clamp-2 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
                        {highlightedLaw.content ||
                          "우리 반을 더 좋은 공간으로 만들기 위한 안건입니다. 내용을 확인하고 의견을 남겨 주세요."}
                      </p>
                    </div>

                    <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText aria-hidden="true" className="h-4 w-4" />
                          제안자{" "}
                          {getBillProposerDisplayName(
                            highlightedLaw,
                            isTeacher,
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Users aria-hidden="true" className="h-4 w-4" />
                          참여{" "}
                          {(highlightedLaw.votes?.agree || 0) +
                            (highlightedLaw.votes?.disagree || 0)}
                          명
                        </span>
                      </div>
                      <Button
                        tone="blue"
                        icon={ArrowRight}
                        onClick={() => openBill(highlightedLaw.id)}
                      >
                        {votedBills[highlightedLaw.id]
                          ? "내용과 결과 보기"
                          : "내용 확인하고 투표하기"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-56 flex-col items-start justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                      <Vote aria-hidden="true" className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 text-xl font-black text-slate-900">
                      오늘 진행 중인 법안이 없습니다.
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {canProposeBill
                        ? "새로운 의견이 있다면 법안으로 제안해 보세요."
                        : "새로운 의견은 선생님이나 법안 제안 권한이 있는 학생에게 전달해 보세요."}
                    </p>
                    {canProposeBill && (
                      <Button
                        className="mt-5"
                        tone="blue"
                        icon={PenLine}
                        onClick={() => setIsProposeModalOpen(true)}
                      >
                        법안 제안하기
                      </Button>
                    )}
                  </div>
                )}
              </Card.Content>
            </Card>

            <Card
              noPadding
            >
              <Card.Content noPadding className="flex h-full flex-col justify-center p-4 sm:p-6">
                <p className="text-sm font-bold text-slate-800">내 투표 참여</p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <p className="text-4xl font-black tracking-tight text-indigo-600">
                    {votedCount}
                    <span className="ml-1 text-lg font-bold text-slate-400">
                      / {votingBills.length}
                    </span>
                  </p>
                  <span className="text-sm font-bold text-indigo-600">
                    {votePercentage}%
                  </span>
                </div>
                <div
                  className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="진행 중 법안 투표 참여율"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={votePercentage}
                >
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                    style={{ width: `${votePercentage}%` }}
                  />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  {pendingVoteCount > 0
                    ? `아직 참여할 투표가 ${pendingVoteCount}건 남아 있어요.`
                    : "현재 안건에 모두 참여했어요."}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
                  <div>
                    <p className="text-xs text-slate-400">전체 법안</p>
                    <p className="mt-1 text-lg font-black text-slate-800">
                      {votingBills.length + finishedBills.length}건
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">가결률</p>
                    <p className="mt-1 text-lg font-black text-slate-800">
                      {passRate == null ? "-" : `${passRate}%`}
                    </p>
                  </div>
                </div>
              </Card.Content>
            </Card>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section aria-labelledby="current-bills-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Vote
                  aria-hidden="true"
                  className="h-5 w-5 text-indigo-600"
                />
                <h2
                  id="current-bills-title"
                  className="text-lg font-black text-slate-900"
                >
                  진행 중인 법안
                </h2>
              </div>
              <span className="text-sm font-semibold text-slate-500">
                {votingBills.length}건
              </span>
            </div>

            <Card
              noPadding
              className="overflow-hidden"
            >
              <Card.Content noPadding>
                {currentLaws.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {currentLaws.map((law) => {
                      const participants =
                        (law.votes?.agree || 0) +
                        (law.votes?.disagree || 0);
                      const myVote = votedBills[law.id];

                      return (
                        <button
                          key={law.id}
                          type="button"
                          onClick={() => openBill(law.id)}
                          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-800">
                              {law.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              제안자{" "}
                              {getBillProposerDisplayName(law, isTeacher)} · 참여{" "}
                              {participants}명
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge
                              tone={
                                myVote
                                  ? myVote === "agree"
                                    ? "emerald"
                                    : "rose"
                                  : "indigo"
                              }
                              variant="soft"
                              size="sm"
                            >
                              {myVote
                                ? myVote === "agree"
                                  ? "찬성 완료"
                                  : "반대 완료"
                                : "투표하기"}
                            </Badge>
                            <ArrowRight
                              aria-hidden="true"
                              className="h-4 w-4 text-slate-400"
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-12 text-center text-sm text-slate-500">
                    진행 중인 법안이 없습니다.
                  </div>
                )}
              </Card.Content>
            </Card>
          </section>

          <section aria-labelledby="recent-decisions-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="h-5 w-5 text-emerald-600"
                />
                <h2
                  id="recent-decisions-title"
                  className="text-lg font-black text-slate-900"
                >
                  최근 결정
                </h2>
              </div>
              <span className="text-sm font-semibold text-slate-500">
                {finishedBills.length}건
              </span>
            </div>

            <Card
              noPadding
              className="overflow-hidden"
            >
              <Card.Content noPadding>
                {recentDecisions.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {recentDecisions.map((law) => {
                      const isPassed = law.status === "passed";
                      const DecisionIcon = isPassed
                        ? CheckCircle2
                        : XCircle;

                      return (
                        <button
                          key={law.id}
                          type="button"
                          onClick={() => openBill(law.id)}
                          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <DecisionIcon
                              aria-hidden="true"
                              className={`h-5 w-5 shrink-0 ${
                                isPassed
                                  ? "text-emerald-500"
                                  : "text-rose-500"
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-slate-800">
                                {law.title}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                제안자{" "}
                                {getBillProposerDisplayName(law, isTeacher)}
                              </p>
                            </div>
                          </div>
                          <Badge
                            tone={isPassed ? "emerald" : "rose"}
                            variant="soft"
                            size="sm"
                          >
                            {isPassed ? "가결" : "부결"}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-12 text-center text-sm text-slate-500">
                    아직 종료된 법안이 없습니다.
                  </div>
                )}
              </Card.Content>
            </Card>
          </section>
        </div>
      </div>

      {selectedBill && (
        <LawDetailModal
          bill={selectedBill}
          classId={classId}
          isOpen={!!selectedBill}
          onClose={() => setSelectedBillId(null)}
          onVote={handleVote}
          onApplyPolicy={() => handleApplyPolicy(selectedBill.id)}
          onToggleVoterVisibility={handleVoteVisibilityChange}
          onEditBill={() => {
            setSelectedBillId(null);
            navigate("/assembly/laws");
          }}
          myVote={votedBills[selectedBill.id]}
          isProcessing={isProcessing}
          canManageAssembly={canManageAssembly}
        />
      )}

      {isProposeModalOpen && (
        <ProposeBillModal
          isOpen={isProposeModalOpen}
          onClose={() => setIsProposeModalOpen(false)}
          classId={classId}
          onSuccess={handleProposalSuccess}
        />
      )}
    </AppLayout>
  );
}
