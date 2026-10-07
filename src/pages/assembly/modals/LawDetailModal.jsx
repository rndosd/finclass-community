import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Badge, Button, Modal, ToggleSwitch } from "../../../components/ui";
import { db } from "../../../firebase";
import {
  CalendarDays,
  Check,
  Coins,
  Eye,
  EyeOff,
  FileText,
  Pencil,
  ShieldCheck,
  UserRound,
  Users,
  Vote,
  X,
} from "lucide-react";
import { getBillProposerDisplayName } from "../utils/billDisplay";

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

const formatBillDate = (timestamp) => {
  const date = toDateValue(timestamp);
  return date ? dayjs(date).format("YYYY.MM.DD HH:mm") : "-";
};

const formatVoterTime = (timestamp) => {
  const date = toDateValue(timestamp);
  return date ? dayjs(date).format("MM.DD HH:mm") : "-";
};

const getStatusMeta = (status) => {
  switch (status) {
    case "passed":
      return { label: "가결", tone: "emerald", summary: "투표가 가결로 마감된 안건입니다." };
    case "rejected":
      return { label: "부결", tone: "rose", summary: "투표가 부결로 마감된 안건입니다." };
    default:
      return { label: "투표 진행 중", tone: "indigo", summary: "현재 학생들이 투표 중인 안건입니다." };
  }
};

const getVoteMeta = (vote) => {
  if (vote === "agree") {
    return { label: "찬성", tone: "blue", summary: "찬성표를 제출했습니다." };
  }

  if (vote === "disagree") {
    return { label: "반대", tone: "red", summary: "반대표를 제출했습니다." };
  }

  return { label: "미투표", tone: "slate", summary: "아직 투표하지 않았습니다." };
};

const getVoteSummary = (bill) => {
  const agree = Number(bill?.votes?.agree || 0);
  const disagree = Number(bill?.votes?.disagree || 0);
  const total = agree + disagree;

  return {
    agree,
    disagree,
    total,
    agreeRatio: total > 0 ? Math.round((agree / total) * 100) : 0,
    disagreeRatio: total > 0 ? Math.round((disagree / total) * 100) : 0,
  };
};

const isVoterListPublic = (bill) => {
  if (!bill) return false;

  if (bill.status === "voting" && bill.hideResultsDuringVoting === true) {
    return false;
  }

  return bill.status === "voting"
    ? bill.showVotersDuringVoting === true
    : bill.showVotersAfterClose === true;
};

const getVoterLabel = (voter) =>
  String(voter?.voterName || voter?.voterUid || "이름 없음").trim() || "이름 없음";

const getToneTextClass = (tone) => {
  if (tone === "blue") return "text-blue-700";
  if (tone === "red") return "text-rose-700";
  if (tone === "emerald") return "text-emerald-700";
  return "text-slate-600";
};

const getVoteBadgeTone = (tone) => {
  if (tone === "blue") return "blue";
  if (tone === "red") return "red";
  if (tone === "emerald") return "emerald";
  return "slate";
};

const VoteDistributionBar = ({ voteSummary, myVoteMeta, isHidden = false }) => {
  if (isHidden) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
        <EyeOff className="mx-auto h-5 w-5 text-slate-400" />
        <p className="mt-2 text-sm font-semibold text-slate-700">투표 결과는 마감 후 공개됩니다.</p>
        <p className={`mt-1 text-xs font-semibold ${getToneTextClass(myVoteMeta.tone)}`}>
          내 상태 {myVoteMeta.label}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
            찬성 {voteSummary.agree}
          </span>
          <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
            반대 {voteSummary.disagree}
          </span>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            총 {voteSummary.total}
          </span>
        </div>

        <span className={`text-xs font-semibold ${getToneTextClass(myVoteMeta.tone)}`}>
          내 상태 {myVoteMeta.label}
        </span>
      </div>

      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
        {voteSummary.total > 0 ? (
          <div className="flex h-full w-full">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${voteSummary.agreeRatio}%` }}
            />
            <div
              className="h-full bg-rose-500 transition-all duration-300"
              style={{ width: `${voteSummary.disagreeRatio}%` }}
            />
          </div>
        ) : (
          <div className="h-full w-full bg-slate-200" />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-500">
        {voteSummary.total > 0 ? (
          <>
            <span>찬성 {voteSummary.agreeRatio}%</span>
            <span>반대 {voteSummary.disagreeRatio}%</span>
          </>
        ) : (
          <span>아직 집계된 표가 없습니다.</span>
        )}
      </div>
    </div>
  );
};

const VisibilityCard = ({
  title,
  description,
  checked,
  toggleId,
  disabled,
  onChange,
}) => (
  <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>

    <div className="flex items-center gap-2">
      {checked ? (
        <Eye className="h-4 w-4 text-indigo-500" />
      ) : (
        <EyeOff className="h-4 w-4 text-slate-400" />
      )}
      <ToggleSwitch
        id={toggleId}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  </div>
);

const VoterColumn = ({ title, toneClass, voters }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-3">
    <div className="flex items-center justify-between gap-3">
      <p className={`text-sm font-semibold ${toneClass}`}>{title}</p>
      <span className="text-xs font-medium text-slate-500">{voters.length}명</span>
    </div>

    {voters.length === 0 ? (
      <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
        공개할 투표자가 없습니다.
      </div>
    ) : (
      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
        {voters.map((voter) => (
          <div
            key={voter.id}
            className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
          >
            <p className="truncate text-sm font-semibold text-slate-900">{getVoterLabel(voter)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{formatVoterTime(voter.votedAt)}</p>
          </div>
        ))}
      </div>
    )}
  </div>
);

const LawDetailModal = ({
  bill,
  classId,
  isOpen,
  onClose,
  onVote,
  onApplyPolicy,
  onToggleVoterVisibility,
  onEditBill,
  myVote,
  isProcessing,
  canManageAssembly = false,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const [voters, setVoters] = useState([]);
  const [isLoadingVoters, setIsLoadingVoters] = useState(false);
  const [votersError, setVotersError] = useState(null);

  useEffect(() => {
    if (!bill || !classId || !isOpen) {
      setVoters([]);
      setIsLoadingVoters(false);
      setVotersError(null);
      return undefined;
    }

    const canViewVoters = canManageAssembly || isVoterListPublic(bill);
    if (!canViewVoters) {
      setVoters([]);
      setIsLoadingVoters(false);
      setVotersError(null);
      return undefined;
    }

    setIsLoadingVoters(true);
    setVotersError(null);

    const votersQuery = query(
      collection(db, `classes/${classId}/assemblyBills/${bill.id}/voters`),
      orderBy("votedAt", "asc"),
    );

    const unsubscribe = onSnapshot(
      votersQuery,
      (snapshot) => {
        setVoters(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setIsLoadingVoters(false);
      },
      (error) => {
        console.error("Failed to load assembly voters:", error);
        setVoters([]);
        setVotersError(error);
        setIsLoadingVoters(false);
      },
    );

    return unsubscribe;
  }, [bill, canManageAssembly, classId, isOpen]);

  const agreeVoters = useMemo(
    () => voters.filter((voter) => voter.vote === "agree"),
    [voters],
  );
  const disagreeVoters = useMemo(
    () => voters.filter((voter) => voter.vote === "disagree"),
    [voters],
  );

  if (!bill) return null;

  const isVoted = Boolean(myVote);
  const statusMeta = getStatusMeta(bill.status);
  const myVoteMeta = getVoteMeta(myVote);
  const createdDate = formatBillDate(bill.createdAt);
  const closedDate = bill.status === "voting" ? null : formatBillDate(bill.closedAt);
  const hasPoliceData = Boolean(bill.policeRuleData);
  const willAutoRegister = bill.registerPoliceRuleOnPass === true;
  const canApplyPolicyManually =
    bill.status === "passed" &&
    canManageAssembly &&
    hasPoliceData &&
      !bill.isPolicyApplied &&
      !willAutoRegister;
  const studentsCanViewVoters = isVoterListPublic(bill);
  const canViewVoters = canManageAssembly || studentsCanViewVoters;
  const canEditBill = canManageAssembly && bill.status === "voting";
  const hideVoteResults =
    bill.status === "voting" &&
    bill.hideResultsDuringVoting === true &&
    !canManageAssembly;
  const canChangeVote =
    bill.status === "voting" &&
    isVoted &&
    (bill.allowVoteChanges === true || canManageAssembly);
  const proposerDisplayName = getBillProposerDisplayName(bill, canManageAssembly);
  const voteSummary =
    !canViewVoters || isLoadingVoters || votersError
      ? getVoteSummary(bill)
      : {
          agree: agreeVoters.length,
          disagree: disagreeVoters.length,
          total: agreeVoters.length + disagreeVoters.length,
          agreeRatio:
            agreeVoters.length + disagreeVoters.length > 0
              ? Math.round((agreeVoters.length / (agreeVoters.length + disagreeVoters.length)) * 100)
              : 0,
          disagreeRatio:
            agreeVoters.length + disagreeVoters.length > 0
              ? Math.round((disagreeVoters.length / (agreeVoters.length + disagreeVoters.length)) * 100)
              : 0,
        };
  const isUpdatingDuringVotingVisibility =
    isProcessing === `visibility-${bill.id}-showVotersDuringVoting`;
  const isUpdatingAfterCloseVisibility =
    isProcessing === `visibility-${bill.id}-showVotersAfterClose`;

  const policyStatusText = willAutoRegister
    ? bill.isPolicyApplied
      ? "가결 후 자동으로 정책 반영까지 완료되었습니다."
      : "가결되면 자동으로 정책에 반영되는 안건입니다."
    : "자동 반영 없이, 가결 후 교사/관리자가 수동으로 정책 반영을 진행할 수 있습니다.";

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="flex h-full min-h-0 flex-col bg-white">
        <header className="border-b border-slate-200 px-6 pb-5 pt-7 sm:px-8 sm:pb-6 sm:pt-8">
          <div className="flex flex-wrap items-center gap-3 pr-12">
            <Badge tone={statusMeta.tone} size="sm">
              {statusMeta.label}
            </Badge>
            <h2 className="text-2xl font-black leading-tight tracking-tight text-slate-900 sm:text-3xl">
              {bill.title}
            </h2>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-4 w-4" />
              제안자 {proposerDisplayName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              발의 {createdDate}
            </span>
            {closedDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                마감 {closedDate}
              </span>
            )}
            {bill.isPolicyApplied && (
              <Badge tone="emerald" size="sm" icon={ShieldCheck}>
                정책 반영 완료
              </Badge>
            )}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
          <section className="px-6 py-6 sm:px-8 sm:py-7">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <FileText className="h-5 w-5 text-indigo-500" />
                안건 내용
              </div>
              {canEditBill && (
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  icon={Pencil}
                  disabled={!!isProcessing}
                  onClick={() => onEditBill?.(bill)}
                >
                  수정
                </Button>
              )}
            </div>

            <div className="mt-5 max-w-3xl whitespace-pre-wrap text-[15px] leading-8 text-slate-700 sm:text-base">
              {bill.content || "법안 내용이 없습니다."}
            </div>
          </section>

          <aside className="border-t border-slate-200 bg-slate-50/50 px-6 py-6 sm:px-8 sm:py-7 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Vote className="h-5 w-5 text-indigo-500" />
              {bill.status === "voting" ? "투표하기" : "투표 결과"}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm text-slate-600">
              <Users className="mr-1.5 inline h-4 w-4 text-slate-500" />
              현재{" "}
              <span className="font-bold text-indigo-600">
                {voteSummary.total}명
              </span>
              이 참여했어요
            </div>

            <div className="mt-5">
              <VoteDistributionBar
                voteSummary={voteSummary}
                myVoteMeta={myVoteMeta}
                isHidden={hideVoteResults}
              />
            </div>

            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="text-center text-sm font-medium leading-6 text-slate-700">
                {bill.status === "voting"
                  ? isVoted
                    ? `${myVoteMeta.label} 투표를 제출했습니다.`
                    : "신중하게 읽고 의견을 선택해 주세요."
                  : `${statusMeta.label}로 마감된 안건입니다.`}
              </p>

              {bill.status === "voting" && (!isVoted || canChangeVote) ? (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Button
                    tone="emerald"
                    size="xl"
                    icon={Check}
                    fullWidth
                    isLoading={isProcessing === `vote-${bill.id}-agree`}
                    disabled={!!isProcessing || myVote === "agree"}
                    onClick={() => onVote(bill.id, "agree")}
                  >
                    찬성
                  </Button>
                  <Button
                    tone="red"
                    size="xl"
                    icon={X}
                    fullWidth
                    isLoading={isProcessing === `vote-${bill.id}-disagree`}
                    disabled={!!isProcessing || myVote === "disagree"}
                    onClick={() => onVote(bill.id, "disagree")}
                  >
                    반대
                  </Button>
                </div>
              ) : (
                <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-slate-600">
                    내 상태
                  </span>
                  <Badge
                    tone={getVoteBadgeTone(myVoteMeta.tone)}
                    size="sm"
                  >
                    {bill.status === "voting"
                      ? `${myVoteMeta.label} 투표 완료`
                      : statusMeta.label}
                  </Badge>
                </div>
              )}
              {canChangeVote && (
                <p className="mt-3 text-center text-xs text-slate-500">
                  투표가 마감되기 전까지 다른 선택으로 변경할 수 있어요.
                </p>
              )}
            </div>
          </aside>
        </div>

        <details className="group border-t border-slate-200 bg-slate-50/70">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 sm:px-8 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <Users className="h-4 w-4 text-slate-500" />
              참여 정보 · 정책 정보
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-500">
                {voteSummary.total}명 참여
              </span>
              <span className="text-xs font-semibold text-indigo-600">
                펼쳐보기
              </span>
            </div>
          </summary>

          <div
            className={`border-t border-slate-200 bg-white ${
              hasPoliceData ? "grid lg:grid-cols-2" : ""
            }`}
          >
            <section className="px-6 py-5 sm:px-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    투표 참여 정보
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    참여자 공개 범위와 선택 현황입니다.
                  </p>
                </div>
                <Badge
                  tone={studentsCanViewVoters ? "indigo" : "slate"}
                  size="sm"
                  icon={studentsCanViewVoters ? Eye : EyeOff}
                >
                  {studentsCanViewVoters ? "학생 공개" : "관리자만 공개"}
                </Badge>
              </div>

              {canManageAssembly && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <VisibilityCard
                    title="진행 중 공개"
                    description="투표 중 학생에게 목록을 보여줍니다."
                    checked={bill.showVotersDuringVoting === true}
                    toggleId={`show-voters-during-${bill.id}`}
                    disabled={!canManageAssembly || !!isProcessing}
                    onChange={(nextValue) =>
                      onToggleVoterVisibility?.(
                        bill.id,
                        "showVotersDuringVoting",
                        nextValue,
                      )
                    }
                  />
                  <VisibilityCard
                    title="마감 후 공개"
                    description="투표 종료 뒤 학생에게 목록을 보여줍니다."
                    checked={bill.showVotersAfterClose === true}
                    toggleId={`show-voters-after-${bill.id}`}
                    disabled={!canManageAssembly || !!isProcessing}
                    onChange={(nextValue) =>
                      onToggleVoterVisibility?.(
                        bill.id,
                        "showVotersAfterClose",
                        nextValue,
                      )
                    }
                  />
                </div>
              )}

              {(isUpdatingDuringVotingVisibility ||
                isUpdatingAfterCloseVisibility) && (
                <p className="mt-2 text-xs font-medium text-indigo-600">
                  공개 설정 저장 중...
                </p>
              )}

              <div className="mt-4">
                {!canViewVoters ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                    현재는 투표자 목록이 비공개입니다.
                  </div>
                ) : votersError ? (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-4 text-sm text-rose-700">
                    투표자 목록을 불러오지 못했습니다.
                  </div>
                ) : isLoadingVoters ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                    투표자 목록을 불러오는 중입니다.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <VoterColumn
                      title="찬성"
                      toneClass="text-blue-700"
                      voters={agreeVoters}
                    />
                    <VoterColumn
                      title="반대"
                      toneClass="text-rose-700"
                      voters={disagreeVoters}
                    />
                  </div>
                )}
              </div>
            </section>

            {hasPoliceData && (
              <section className="border-t border-slate-200 px-6 py-5 sm:px-8 lg:border-l lg:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      정책 반영 정보
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      통과 후 적용되는 규칙을 확인합니다.
                    </p>
                  </div>
                  <Badge
                    tone={
                      bill.isPolicyApplied
                        ? "emerald"
                        : willAutoRegister
                        ? "indigo"
                        : "slate"
                    }
                    size="sm"
                  >
                    {bill.isPolicyApplied
                      ? "반영 완료"
                      : willAutoRegister
                      ? "자동 반영"
                      : "수동 반영"}
                  </Badge>
                </div>

                <p className="mt-4 text-xs leading-6 text-slate-600">
                  {policyStatusText}
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <Coins className="h-3.5 w-3.5" />
                      벌금
                    </div>
                    <p className="mt-1.5 text-sm font-bold text-slate-900">
                      {formatDisplayMoney(Number(
                        bill.policeRuleData?.fineAmount || 0,
                      ))}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      신용 변화
                    </div>
                    <p className="mt-1.5 text-sm font-bold text-slate-900">
                      {Number(bill.policeRuleData?.creditChange || 0) > 0
                        ? "+"
                        : ""}
                      {Number(bill.policeRuleData?.creditChange || 0)}
                    </p>
                  </div>
                </div>

                {bill.policeRuleData?.notes && (
                  <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-3 text-xs leading-6 text-blue-800">
                    {bill.policeRuleData.notes}
                  </div>
                )}

                {bill.status === "passed" && canManageAssembly && (
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-slate-600">
                      {bill.isPolicyApplied
                        ? "이미 정책에 반영된 안건입니다."
                        : willAutoRegister
                        ? "가결 시 자동 반영 대상으로 설정되어 있습니다."
                        : "필요하면 지금 정책에 반영할 수 있습니다."}
                    </p>

                    {canApplyPolicyManually ? (
                      <Button
                        tone="blue"
                        size="sm"
                        isLoading={isProcessing === `apply-${bill.id}`}
                        disabled={!!isProcessing}
                        onClick={() => onApplyPolicy()}
                      >
                        정책 반영하기
                      </Button>
                    ) : (
                      <Badge
                        tone={bill.isPolicyApplied ? "emerald" : "slate"}
                        size="sm"
                      >
                        {bill.isPolicyApplied
                          ? "반영 완료"
                          : willAutoRegister
                          ? "자동 반영 대기"
                          : "추가 작업 없음"}
                      </Badge>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
};

export default LawDetailModal;
