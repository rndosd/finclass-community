import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import AppLayout from "../../components/layout/AppLayout";
import { Badge, Button, Card, PageHeader, PageLoader } from "../../components/ui";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Filter,
  Gavel,
  Pencil,
  PlusCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  Vote,
  X,
} from "lucide-react";
import { useLawboard } from "./hooks/useLawboard";
import ProposeBillModal from "./modals/ProposeBillModal";
import LawDetailModal from "./modals/LawDetailModal";
import SetThresholdModal from "./modals/SetThresholdModal";
import PolicyApplyConfirmationModal from "./modals/PolicyApplyConfirmationModal";
import { getBillProposerDisplayName } from "./utils/billDisplay";

const toDateValue = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp?.toDate === "function") return timestamp.toDate();
  if (typeof timestamp?.toMillis === "function") return new Date(timestamp.toMillis());
  if (typeof timestamp?.seconds === "number") return new Date(timestamp.seconds * 1000);
  if (typeof timestamp === "number") return new Date(timestamp);
  if (typeof timestamp === "string") {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const getBillTime = (bill) => {
  const date =
    toDateValue(bill?.closedAt) ||
    toDateValue(bill?.endedAt) ||
    toDateValue(bill?.endAt) ||
    toDateValue(bill?.updatedAt) ||
    toDateValue(bill?.createdAt);
  return date ? date.getTime() : 0;
};

const formatBillDate = (timestamp) => {
  const date = toDateValue(timestamp);
  return date ? dayjs(date).format("YYYY.MM.DD") : "-";
};

const getStatusMeta = (status) => {
  switch (status) {
    case "passed":
      return { label: "가결", tone: "emerald", summary: "기준을 넘겨 통과된 안건입니다." };
    case "rejected":
      return { label: "부결", tone: "rose", summary: "찬성 수가 기준에 미치지 못했습니다." };
    default:
      return { label: "진행 중", tone: "indigo", summary: "현재 표결이 진행 중입니다." };
  }
};

const getVoteMeta = (vote) => {
  if (vote === "agree") {
    return { label: "찬성", tone: "blue", summary: "이 안건에 찬성표를 행사했습니다." };
  }
  if (vote === "disagree") {
    return { label: "반대", tone: "red", summary: "이 안건에 반대표를 행사했습니다." };
  }
  return { label: "미투표", tone: "slate", summary: "아직 표결하지 않았습니다." };
};

const getVoteSummary = (bill) => {
  const agree = Number(bill?.votes?.agree || 0);
  const disagree = Number(bill?.votes?.disagree || 0);
  return {
    agree,
    disagree,
    total: agree + disagree,
  };
};

const STATUS_FILTERS = [
  { id: "all", label: "전체", tone: "slate" },
  { id: "passed", label: "가결만", tone: "emerald" },
  { id: "rejected", label: "부결만", tone: "rose" },
];

const Lawboard = () => {
  const {
    classId,
    isLoading,
    isProcessing,
    activeTab,
    setActiveTab,
    votingBills,
    finishedBills,
    votedBills,
    handleApplyPolicy,
    handleVote,
    handleVoteVisibilityChange,
    handleCloseVoting,
    handleReopenVoting,
    isProposeModalOpen,
    setIsProposeModalOpen,
    handleProposalSuccess,
    loadMoreFinishedBills,
    canLoadMoreFinishedBills,
    canManageAssembly,
    canProposeBill,
    handleDeleteBill,
  } = useLawboard();

  const [selectedBillId, setSelectedBillId] = useState(null);
  const [editingBill, setEditingBill] = useState(null);
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [policyApplyBill, setPolicyApplyBill] = useState(null);

  useEffect(() => {
    if (activeTab !== "finished") {
      setStatusFilter("all");
    }
  }, [activeTab]);

  const pendingBills = useMemo(
    () => votingBills.filter((bill) => !votedBills[bill.id]),
    [votingBills, votedBills],
  );
  const pendingPreviewBills = pendingBills.slice(0, 4);
  const unvotedCount = pendingBills.length;
  const votingBoardRows = useMemo(() => {
    return [...votingBills].sort((a, b) => {
      const aPriority = votedBills[a.id] ? 1 : 0;
      const bPriority = votedBills[b.id] ? 1 : 0;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return getBillTime(b) - getBillTime(a);
    });
  }, [votingBills, votedBills]);

  const finishedBoardRows = useMemo(() => {
    return [...finishedBills]
      .filter((bill) => (statusFilter === "all" ? true : bill.status === statusFilter))
      .sort((a, b) => getBillTime(b) - getBillTime(a));
  }, [finishedBills, statusFilter]);

  const visibleBills = activeTab === "voting" ? votingBoardRows : finishedBoardRows;
  const selectedBill = useMemo(
    () => [...votingBills, ...finishedBills].find((bill) => bill.id === selectedBillId) || null,
    [finishedBills, selectedBillId, votingBills],
  );
  const assemblyQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "학생의회 안건·투표 도우미",
      launcherTitle: "학생의회 안건·투표 도우미",
      launcherDescription: "안건 제안, 투표, 가결 기준, 정책 반영 흐름을 체크합니다.",
      subtitle: "학생 의견을 규칙과 정책으로 연결하는 의사결정 구조를 확인합니다.",
      storageKey: classId
        ? `finclass_assembly_quest_${classId}`
        : "finclass_assembly_quest",
      tourKey: "TEACHER_ASSEMBLY_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "proposal-entry",
          title: "안건 제안 위치 확인하기",
          description: "학생 또는 교사가 안건을 제안하는 시작 지점을 확인합니다.",
          completed: isProposeModalOpen || votingBills.length + finishedBills.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "proposal-open",
              label: "안건 제안 버튼 확인",
              completed: isProposeModalOpen,
            },
            {
              id: "any-bill",
              label: "등록된 안건 확인",
              completed: votingBills.length + finishedBills.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="assembly-top-grid"]',
              title: "안건 제안",
              content: "왼쪽 카드에서 새 안건을 제안할 수 있습니다.",
            },
          ],
        },
        {
          id: "voting-board",
          title: "진행 중 안건 확인하기",
          description: "투표가 진행 중인 안건과 미투표 상태를 확인합니다.",
          doneText: `${votingBills.length}개의 진행 중 안건이 있습니다.`,
          completed: activeTab === "voting" || votingBills.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "voting-tab",
              label: "진행 중 안건 화면 열기",
              completed: activeTab === "voting",
            },
            {
              id: "voting-count",
              label: "진행 중 안건 확인",
              completed: votingBills.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="assembly-board-header"]',
              title: "안건 보드",
              content: "진행 중 안건과 종료된 안건을 이 영역에서 전환합니다.",
            },
            {
              target: '[data-tour="assembly-board-preview"]',
              title: "투표 목록",
              content: "안건별 찬성/반대와 내 투표 상태를 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "threshold",
          title: "가결 기준 확인하기",
          description: "안건이 통과되는 기준을 확인합니다.",
          completed: isThresholdModalOpen,
          manualComplete: true,
          objectives: [
            {
              id: "threshold-open",
              label: "가결 기준 설정 열기",
              completed: isThresholdModalOpen,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="assembly-board-header"]',
              title: "가결 기준",
              content: "관리자는 상단 설정에서 가결 기준을 조정할 수 있습니다.",
            },
          ],
        },
        {
          id: "finished-board",
          title: "종료된 안건 보기",
          description: "가결/부결된 안건 기록을 확인합니다.",
          doneText: `${finishedBills.length}개의 종료 안건이 있습니다.`,
          completed: activeTab === "finished" || finishedBills.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "finished-open",
              label: "종료된 안건 화면 열기",
              completed: activeTab === "finished",
            },
            {
              id: "finished-count",
              label: "종료된 안건 확인",
              completed: finishedBills.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="assembly-board-header"]',
              title: "종료된 안건",
              content: "종료된 안건에서 가결/부결 기록을 필터링합니다.",
            },
          ],
        },
        {
          id: "policy-apply",
          title: "정책 반영 살펴보기",
          description: "가결된 안건을 경찰 규칙 같은 운영 정책으로 연결할 수 있습니다.",
          completed:
            Boolean(policyApplyBill) ||
            finishedBills.some((bill) => bill?.isPolicyApplied),
          manualComplete: true,
          objectives: [
            {
              id: "policy-modal",
              label: "정책 반영 흐름 열기",
              completed: Boolean(policyApplyBill),
            },
            {
              id: "policy-applied",
              label: "정책 반영 완료 안건 확인",
              completed: finishedBills.some((bill) => bill?.isPolicyApplied),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="assembly-board-preview"]',
              title: "정책 반영",
              content: "가결된 안건 카드에서 정책 반영 여부를 확인합니다.",
            },
          ],
        },
      ],
    }),
    [
      activeTab,
      classId,
      finishedBills,
      isProposeModalOpen,
      isThresholdModalOpen,
      policyApplyBill,
      votingBills.length,
    ],
  );

  const openPolicyApply = (bill) => {
    setPolicyApplyBill(bill);
  };

  const renderQuickActions = (bill) => {
    const myVote = votedBills[bill.id];
    const isVoting = bill.status === "voting";
    const canApplyPolicyManually =
      canManageAssembly &&
      bill.status === "passed" &&
      bill.policeRuleData &&
      !bill.isPolicyApplied &&
      !bill.registerPoliceRuleOnPass;

    return (
      <div className="inline-flex flex-wrap items-center justify-end gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm shadow-slate-100">
        {isVoting && (!myVote || bill.allowVoteChanges === true) ? (
          <>
            <Button
              size="icon-sm"
              rounded="full"
              tone="blue"
              icon={Check}
              iconOnly
              aria-label="찬성"
              title="찬성"
              isLoading={isProcessing === `vote-${bill.id}-agree`}
              disabled={!!isProcessing}
              onClick={(event) => {
                event.stopPropagation();
                handleVote(bill.id, "agree");
              }}
            >
              찬성
            </Button>
            <Button
              size="icon-sm"
              rounded="full"
              kind="outline"
              tone="red"
              icon={X}
              iconOnly
              aria-label="반대"
              title="반대"
              isLoading={isProcessing === `vote-${bill.id}-disagree`}
              disabled={!!isProcessing}
              onClick={(event) => {
                event.stopPropagation();
                handleVote(bill.id, "disagree");
              }}
            >
              반대
            </Button>
          </>
        ) : (
          <Button
            size="icon-sm"
            rounded="full"
            kind="outline"
            tone="slate"
            icon={Eye}
            iconOnly
            aria-label="상세 보기"
            title="상세 보기"
            disabled={!!isProcessing}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedBillId(bill.id);
            }}
          >
            보기
          </Button>
        )}

        {canManageAssembly && bill.status === "voting" && (
          <Button
            size="icon-sm"
            rounded="full"
            kind="ghost"
            tone="slate"
            icon={Gavel}
            iconOnly
            aria-label="마감"
            title="마감"
            isLoading={isProcessing === `close-${bill.id}`}
            disabled={!!isProcessing}
            onClick={(event) => {
              event.stopPropagation();
              handleCloseVoting(bill.id);
            }}
          >
            마감
          </Button>
        )}

        {canApplyPolicyManually && (
          <Button
            size="icon-sm"
            rounded="full"
            kind="ghost"
            tone="blue"
            icon={ShieldCheck}
            iconOnly
            aria-label="정책 적용"
            title="정책 적용"
            isLoading={isProcessing === `apply-${bill.id}`}
            disabled={!!isProcessing}
            onClick={(event) => {
              event.stopPropagation();
              openPolicyApply(bill);
            }}
          >
            정책 반영
          </Button>
        )}

        {canManageAssembly && bill.status === "voting" && (
          <Button
            size="icon-sm"
            rounded="full"
            kind="ghost"
            tone="slate"
            icon={Pencil}
            iconOnly
            aria-label="수정"
            title="수정"
            disabled={!!isProcessing}
            onClick={(event) => {
              event.stopPropagation();
              setEditingBill(bill);
            }}
          >
            수정
          </Button>
        )}

        {canManageAssembly && bill.status !== "voting" && !bill.isPolicyApplied && (
          <Button
            size="icon-sm"
            rounded="full"
            kind="ghost"
            tone="slate"
            icon={RefreshCw}
            iconOnly
            aria-label="재개"
            title="재개"
            isLoading={isProcessing === `reopen-${bill.id}`}
            disabled={!!isProcessing}
            onClick={(event) => {
              event.stopPropagation();
              handleReopenVoting(bill.id, bill.title);
            }}
          >
            재개
          </Button>
        )}

        {canManageAssembly && (
          <Button
            size="icon-sm"
            rounded="full"
            kind="ghost"
            tone="red"
            icon={Trash2}
            iconOnly
            aria-label="삭제"
            title="삭제"
            isLoading={isProcessing === `delete-${bill.id}`}
            disabled={!!isProcessing}
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteBill(bill.id, bill.title);
            }}
          >
            삭제
          </Button>
        )}
      </div>
    );
  };

  const renderBoardRow = (bill) => {
    const myVote = votedBills[bill.id];
    const myVoteMeta = getVoteMeta(myVote);
    const statusMeta = getStatusMeta(bill.status);
    const voteSummary = getVoteSummary(bill);
    const hideVoteResults =
      bill.status === "voting" &&
      bill.hideResultsDuringVoting === true &&
      !canManageAssembly;
    const createdDate = formatBillDate(bill.createdAt);
    const closedDate = bill.status === "voting" ? null : formatBillDate(bill.closedAt);
    const proposerDisplayName = getBillProposerDisplayName(bill, canManageAssembly);

    return (
      <Button
        type="button"
        key={bill.id}
        onClick={() => setSelectedBillId(bill.id)}
        className={[
          "group w-full items-stretch justify-start border-b border-slate-100 px-5 py-4 text-left transition-colors last:border-b-0 sm:px-6",
          bill.status === "voting" && !myVote ? "bg-indigo-50/50 hover:bg-indigo-50/80" : "hover:bg-slate-50/80",
        ].join(" ")}
      >
        <div className="grid w-full gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(250px,0.8fr)_minmax(150px,0.45fr)_minmax(190px,0.65fr)] xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={statusMeta.tone} size="sm">
                {statusMeta.label}
              </Badge>
              {bill.registerPoliceRuleOnPass && bill.status === "voting" && !bill.isPolicyApplied && (
                <span className="text-xs text-slate-500">가결 시 경찰 규칙 자동 등록</span>
              )}
              {bill.status === "voting" && !myVote && (
                <span className="text-xs font-medium text-indigo-600">내 투표 필요</span>
              )}
              {bill.isPolicyApplied && (
                <span className="text-xs text-slate-500">정책 반영 완료</span>
              )}
            </div>

            <p className="mt-2 truncate text-base font-bold text-slate-900">
              {bill.title}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>제안자 {proposerDisplayName}</span>
              <span>발의 {createdDate}</span>
              {closedDate ? <span>종료 {closedDate}</span> : <span>현재 표결 중</span>}
            </div>
          </div>

          <div className="text-sm text-slate-600">
            {hideVoteResults ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
                <EyeOff className="h-4 w-4" /> 마감 전 결과 비공개
              </span>
            ) : (
              <>
                <span className="font-medium text-blue-600">찬성 {voteSummary.agree}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="font-medium text-red-600">반대 {voteSummary.disagree}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span>총 {voteSummary.total}</span>
              </>
            )}
          </div>

          <div className="text-sm">
            <span
              className={[
                "font-semibold",
                myVoteMeta.tone === "blue"
                  ? "text-blue-600"
                  : myVoteMeta.tone === "red"
                  ? "text-red-600"
                  : "text-slate-500",
              ].join(" ")}
            >
              {myVoteMeta.label}
            </span>
          </div>

          <div className="flex items-center justify-start gap-3 xl:justify-end">
            <div className="hidden">
              <span>상세 보기</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </div>
            {renderQuickActions(bill)}
          </div>
        </div>
      </Button>
    );
  };

  if (isLoading) {
    return <PageLoader message="의회 데이터를 불러오는 중입니다..." />;
  }

  return (
    <AppLayout
      showDefaultHeader={false}
      showSidebar={true}
      pageGuide={assemblyQuestGuide}
    >
      <div className="min-h-screen bg-[#f0f5ff]">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <PageHeader
            title="학생의회 · 안건·투표 관리"
            subtitle="학생의회의 전체 안건, 투표 현황과 가결 기준을 확인하고 관리합니다."
            icon={Gavel}
            actions={
              canManageAssembly ? (
                <div className="flex gap-2">
                  <Button
                    kind="outline"
                    tone="slate"
                    icon={Settings}
                    onClick={() => setIsThresholdModalOpen(true)}
                  >
                    가결 기준
                  </Button>
                </div>
              ) : null
            }
          />

          <div data-tour="assembly-top-grid" className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card variant="surface" tone="white" >
              <Card.Content noPadding className="gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    바로 하기
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                    안건 제안
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    학급 운영에 필요한 의견이 있으면 새 안건으로 바로 올릴 수 있습니다.
                  </p>
                </div>

                {canProposeBill ? (
                  <Button
                    size="lg"
                    tone="blue"
                    icon={PlusCircle}
                    fullWidth
                    onClick={() => setIsProposeModalOpen(true)}
                  >
                    안건 제안하기
                  </Button>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    현재 계정에는 안건 제안 권한이 없습니다.
                  </div>
                )}
              </Card.Content>
            </Card>

            <Card variant="surface" tone="white" >
              <Card.Content noPadding className="gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      지금 투표할 안건
                    </p>
                    <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                      {unvotedCount > 0 ? `${unvotedCount}건` : "없음"}
                    </h2>
                  </div>
                  <p className="text-xs font-medium text-slate-500">
                    {unvotedCount > 0 ? "우선 확인" : "대기 중"}
                  </p>
                </div>

                {pendingPreviewBills.length > 0 ? (
                  <div className="divide-y divide-slate-100 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/70">
                    {pendingPreviewBills.map((bill, index) => (
                      <Button
                        key={bill.id}
                        type="button"
                        onClick={() => setSelectedBillId(bill.id)}
                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/80"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{bill.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {index === 0 ? "가장 먼저 확인" : "미투표 안건"}
                          </p>
                        </div>
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-sm text-slate-500">
                    지금 바로 투표할 안건은 없습니다.
                  </div>
                )}

                {activeTab !== "voting" && unvotedCount > 0 && (
                  <div className="flex justify-end">
                    <Button tone="blue" icon={ArrowRight} onClick={() => setActiveTab("voting")}>
                      진행 중 안건으로 이동
                    </Button>
                  </div>
                )}
              </Card.Content>
            </Card>
          </div>

          <Card variant="glass" tone="white" className="relative overflow-hidden rounded-[1.75rem]">
            <div
              data-tour="assembly-board-preview"
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-[88px] z-10 h-[240px]"
            />
            <div className="border-b border-slate-100 bg-white/80 px-5 py-4 sm:px-6">
              <div
                data-tour="assembly-board-header"
                data-active-tab={activeTab}
                className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <p className="text-lg font-black tracking-tight text-slate-900">
                    {activeTab === "voting" ? "진행 중 안건" : "종료된 안건"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {activeTab === "voting"
                      ? "지금 투표 가능한 안건을 먼저 보여줍니다."
                      : "최근에 종료된 안건 기록을 확인합니다."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {activeTab === "voting" ? (
                    <>
                      {unvotedCount > 0 && <p className="text-sm text-slate-500">미투표 {unvotedCount}건</p>}
                      <Button size="sm" kind="outline" tone="slate" onClick={() => setActiveTab("finished")}>
                        종료된 안건 보기
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" kind="outline" tone="slate" onClick={() => setActiveTab("voting")}>
                        진행 중 안건으로 돌아가기
                      </Button>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="mr-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          <Filter className="h-4 w-4" />
                          상태 필터
                        </div>
                        {STATUS_FILTERS.map((filterOption) => (
                          <Button
                            key={filterOption.id}
                            size="sm"
                            kind={statusFilter === filterOption.id ? "solid" : "outline"}
                            tone={filterOption.tone}
                            onClick={() => setStatusFilter(filterOption.id)}
                          >
                            {filterOption.label}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {visibleBills.length === 0 ? (
              <div className="flex flex-col items-start justify-start px-6 py-16 text-left">
                <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-slate-100 text-slate-500">
                  <Vote className="h-8 w-8" />
                </div>
                <h3 className="mt-5 text-xl font-black tracking-tight text-slate-800">
                  {activeTab === "voting"
                    ? "진행 중인 안건이 없습니다."
                    : statusFilter === "all"
                    ? "종료된 안건이 없습니다."
                    : `${statusFilter === "passed" ? "가결된" : "부결된"} 안건이 없습니다.`}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {activeTab === "voting"
                    ? "새 안건이 올라오면 여기에서 바로 확인하고 투표할 수 있습니다."
                    : "필터를 바꾸거나 조금 뒤 다시 확인해 보세요."}
                </p>
              </div>
            ) : (
              <div>{visibleBills.map(renderBoardRow)}</div>
            )}
          </Card>

          {activeTab === "finished" && canLoadMoreFinishedBills && (
            <div className="flex justify-center">
              <Button kind="outline" tone="slate" disabled={!!isProcessing} onClick={() => loadMoreFinishedBills()}>
                종료된 안건 더 보기
              </Button>
            </div>
          )}
        </div>
      </div>

      {isProposeModalOpen && (
        <ProposeBillModal
          isOpen={isProposeModalOpen}
          onClose={() => setIsProposeModalOpen(false)}
          classId={classId}
          onSuccess={handleProposalSuccess}
        />
      )}

      {editingBill && (
        <ProposeBillModal
          isOpen={!!editingBill}
          onClose={() => setEditingBill(null)}
          classId={classId}
          onSuccess={() => setEditingBill(null)}
          mode="edit"
          initialBill={editingBill}
        />
      )}

      {selectedBill && (
        <LawDetailModal
          bill={selectedBill}
          classId={classId}
          isOpen={!!selectedBill}
          onClose={() => setSelectedBillId(null)}
          onVote={handleVote}
          onApplyPolicy={() => setPolicyApplyBill(selectedBill)}
          onToggleVoterVisibility={handleVoteVisibilityChange}
          onEditBill={() => {
            setSelectedBillId(null);
            setEditingBill(selectedBill);
          }}
          myVote={votedBills[selectedBill.id]}
          isProcessing={isProcessing}
          canManageAssembly={canManageAssembly}
        />
      )}

      {isThresholdModalOpen && (
        <SetThresholdModal
          isOpen={isThresholdModalOpen}
          onClose={() => setIsThresholdModalOpen(false)}
          classId={classId}
        />
      )}

      {policyApplyBill && (
        <PolicyApplyConfirmationModal
          isOpen={!!policyApplyBill}
          onClose={() => setPolicyApplyBill(null)}
          bill={policyApplyBill}
          onConfirm={(billId, dangerLevel) => {
            handleApplyPolicy(billId, dangerLevel);
            setPolicyApplyBill(null);
          }}
          isLoading={isProcessing}
        />
      )}
    </AppLayout>
  );
};

export default Lawboard;
