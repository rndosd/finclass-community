import React, { useState, useMemo } from "react";
import dayjs from "dayjs";
import {
  Button,
  CardSkeleton,
  Modal,
  SurfaceLoader,
} from "../../../components/ui";
import LoanHistoryFilterBar from "../components/LoanHistoryFilterBar";
import RepayModal from "./RepayModal";
import {
  calculateRepaymentDate,
  getLoanOverdueDays,
  toDate,
} from "../utils/dateUtils";
import { calculateLoanInterestDue } from "../utils/loanMetrics";
import {
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ReceiptRefundIcon,
  CreditCardIcon,
  CalendarIcon,
  BanknotesIcon,
  NoSymbolIcon,
  RocketLaunchIcon,
  InformationCircleIcon,
  FireIcon,
} from "@heroicons/react/24/solid";
import { useUser } from "../../../contexts/UserContext";
import { useStudentBankHistory } from "../../../hooks/bank/useBankHistory";
import {
  formatDateKeyInKST,
  parseDateKeyAsKST,
} from "../../../utils/kstDate";
import { formatBankMoney } from "../../../utils/bankMoney";

const INITIAL_START_DATE = formatDateKeyInKST(
  dayjs().subtract(3, "month").toDate(),
);
const INITIAL_END_DATE = formatDateKeyInKST(new Date());
const DEFAULT_HIDDEN_STATUSES = new Set(["repaid"]);

export default function LoanHistoryModal({
  open,
  onClose,
  studentName,
  loans: initialLoans = [],
  isMyBankPage,
  currencyUnit,
  studentCashBalance = 0,
  isRepayingLoan = false,
  onRepay,
  uid,
  classId,
}) {
  const { isTeacher, isBankManager } = useUser();
  const { data: loans = [], isLoading: isLoansLoading } =
    useStudentBankHistory(classId, uid, "loans", {
      enabled: open,
      initialData: initialLoans,
    });

  // --- 상환 모달 제어 상태 ---
  const [selectedLoanForRepay, setSelectedLoanForRepay] = useState(null);
  const [isRepayModalOpen, setIsRepayModalOpen] = useState(false);

  // 1. 필터 상태
  const [startDate, setStartDate] = useState(INITIAL_START_DATE);
  const [endDate, setEndDate] = useState(INITIAL_END_DATE);
  const [selectedStatuses, setSelectedStatuses] = useState([]);

  // 2. 테마 결정 로직
  const getStatusTheme = (status, hasPenalty) => {
    if (hasPenalty && status === "ongoing") {
      return {
        label: "연체 중",
        color: "rose",
        Icon: ExclamationTriangleIcon,
        isUrgent: true,
      };
    }
    switch (status) {
      case "pending":
        return { label: "승인 대기", color: "amber", Icon: ClockIcon };
      case "ongoing":
        return { label: "상환 중", color: "blue", Icon: RocketLaunchIcon };
      case "repaid":
        return { label: "상환 완료", color: "emerald", Icon: CheckCircleIcon };
      case "cancelled_request":
        return { label: "요청 취소", color: "slate", Icon: ReceiptRefundIcon };
      case "rejected":
        return { label: "승인 거절", color: "slate", Icon: NoSymbolIcon };
      default:
        return { label: "기타", color: "slate", Icon: InformationCircleIcon };
    }
  };

  // 3. 필터링된 대출 목록
  const filteredLoans = useMemo(() => {
    return (loans || []).filter((l) => {
      const loanStatus = String(l?.status || "");

      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(loanStatus)) return false;
      } else if (DEFAULT_HIDDEN_STATUSES.has(loanStatus)) {
        return false;
      }

      const pick = toDate(l.createdAt || l.startedAt);
      if (!pick) return true;
      const fromDate = parseDateKeyAsKST(startDate);
      const toDateBound = parseDateKeyAsKST(endDate, { endOfDay: true });
      if (fromDate && pick < fromDate)
        return false;
      if (toDateBound && pick > toDateBound) return false;
      return true;
    });
  }, [loans, selectedStatuses, startDate, endDate]);

  const handleOpenRepayClick = (loan) => {
    setSelectedLoanForRepay(loan);
    setIsRepayModalOpen(true);
  };

  const handleCloseRepayModal = () => {
    setIsRepayModalOpen(false);
    setSelectedLoanForRepay(null);
  };

  const handleClearFilters = () => {
    setSelectedStatuses([]);
    setStartDate(INITIAL_START_DATE);
    setEndDate(INITIAL_END_DATE);
  };
  const hasFilteredLoans = filteredLoans.length > 0;

  if (!open) return null;

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="" size="4xl">
        <div className="flex flex-col bg-slate-50 min-h-[600px] max-h-[85vh]">
          {/* 헤더 */}
          <div className="bg-white px-8 pt-8 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-rose-500 rounded-2xl shadow-lg shadow-rose-200">
                <CreditCardIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  {studentName}님의 대출 장부
                </h2>
                <p className="text-xs text-slate-400 font-bold mt-0.5">
                  대출 원금, 이자, 연체료를 투명하게 관리합니다.
                </p>
              </div>
            </div>
            <LoanHistoryFilterBar
              selectedStatuses={selectedStatuses}
              onStatusChange={setSelectedStatuses}
              onClearFilters={handleClearFilters}
              startDate={startDate}
              endDate={endDate}
              onChangeStartDate={setStartDate}
              onChangeEndDate={setEndDate}
              filteredCount={filteredLoans.length}
              totalCount={loans.length}
            />
          </div>

          {/* 리스트 */}
          <div className="flex-grow overflow-y-auto p-6 scrollbar-hide">
            <SurfaceLoader
              loading={isLoansLoading}
              variant={hasFilteredLoans ? "refreshing" : "surface-loading"}
              preserveContent={hasFilteredLoans}
              skeleton={
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 p-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <CardSkeleton
                      key={`loan-history-skeleton-${index}`}
                      bare
                      className="min-h-[240px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                      rows={5}
                      showFooter
                    />
                  ))}
                </div>
              }
              minHeightClassName="min-h-[360px]"
            >
              {hasFilteredLoans ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredLoans.map((l) => {
                  const startedAt = toDate(l.startedAt);
                  const repaymentDate = calculateRepaymentDate(l);
                  const now = new Date();

                  // A. 원금
                  const principalTotal = Number(l.principal || l.amount || 0);
                  const principalLeft = Number(l.amountLeft ?? principalTotal);

                  // B. 이자 (일할)
                  const interestDue =
                    l.status === "ongoing"
                      ? calculateLoanInterestDue(l, now).interestDue
                      : 0;

                  // 🚀 C. 연체료 (기준일 기반 독립 계산)
                  const overdueDays = getLoanOverdueDays(l, now);
                  let penaltyDue = 0;
                  if (l.status === "ongoing" && overdueDays > 0) {
                    const overdueRate = Number(l.overdueRate || 0);
                    penaltyDue = Math.round(
                      principalLeft * (overdueRate / 100) * overdueDays,
                    );
                  }

                  const totalDue = principalLeft + interestDue + penaltyDue;
                  const theme = getStatusTheme(l.status, penaltyDue > 0);
                  const progress =
                    principalTotal > 0
                      ? ((principalTotal - principalLeft) / principalTotal) *
                        100
                      : 0;
                  const canRepay =
                    l.status === "ongoing" &&
                    (isMyBankPage || isTeacher || isBankManager);

                  return (
                    <div
                      key={l.id}
                      className={`relative bg-white rounded-2xl border-2 shadow-sm overflow-hidden flex flex-col min-h-[240px] transition-all ${theme.isUrgent ? "border-rose-200 shadow-rose-100" : "border-slate-100"}`}
                    >
                      <div className="p-4 flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-xl bg-${theme.color}-50 text-${theme.color}-500 relative`}
                          >
                            <theme.Icon className="w-5 h-5" />
                            {penaltyDue > 0 && (
                              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                <span className="relative rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                              </span>
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-slate-800 truncate w-32">
                              {l.productLabel || "대출 상품"}
                            </h4>
                            <span
                              className={`text-[10px] font-bold text-${theme.color}-600`}
                            >
                              {theme.label}
                            </span>
                          </div>
                        </div>
                        {l.status === "ongoing" && repaymentDate && (
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-md ${penaltyDue > 0 ? "bg-rose-100 text-rose-600 animate-pulse" : "bg-blue-50 text-blue-600"}`}
                          >
                            {penaltyDue > 0
                              ? `연체 ${overdueDays}일차`
                              : `${dayjs(repaymentDate).format("MM.DD")} 만기`}
                          </span>
                        )}
                      </div>

                      <div className="px-4 py-3 bg-slate-50/50 space-y-2 border-y border-slate-100">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-slate-400 font-bold">
                            남은 원금
                          </span>
                          <span className="text-xs font-bold text-slate-700">
                            {formatBankMoney(principalLeft)} {currencyUnit}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-slate-400 font-bold">
                            밀린 이자 (일할)
                          </span>
                          <span
                            className={`text-xs font-bold ${interestDue > 0 ? "text-blue-600" : "text-slate-400"}`}
                          >
                            +{formatBankMoney(interestDue)} {currencyUnit}
                          </span>
                        </div>
                        {penaltyDue > 0 && (
                          <div className="flex justify-between items-center bg-rose-50 px-2 py-1 -mx-2 rounded-lg">
                            <span className="text-[10px] text-rose-500 font-black flex items-center gap-1">
                              <FireIcon className="w-3 h-3" /> 연체료 (미납)
                            </span>
                            <span className="text-xs font-black text-rose-600">
                              +{formatBankMoney(penaltyDue)} {currencyUnit}
                            </span>
                          </div>
                        )}
                        <div className="border-t border-slate-200 my-1 pt-1 flex justify-between items-center">
                          <span className="text-[11px] text-slate-900 font-extrabold">
                            총 상환 필요액
                          </span>
                          <span className="text-sm font-black text-slate-900">
                            {formatBankMoney(totalDue)} {currencyUnit}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 mt-auto">
                        <div className="flex items-center justify-between mb-3 text-[10px] text-slate-400 font-bold">
                          <div className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" />{" "}
                            {startedAt
                              ? dayjs(startedAt).format("YYYY.MM.DD")
                              : "-"}{" "}
                            시작
                          </div>
                          <span>상환율 {Math.floor(progress)}%</span>
                        </div>
                        <div className="flex gap-1.5">
                          {canRepay ? (
                            <Button
                              size="sm"
                              tone={penaltyDue > 0 ? "rose" : "blue"}
                              kind="solid"
                              className="w-full"
                              onClick={() => handleOpenRepayClick(l)}
                            >
                              <ReceiptRefundIcon className="w-3.5 h-3.5 mr-1" />{" "}
                              {penaltyDue > 0
                                ? "연체료 포함 상환하기"
                                : "상환하기"}
                            </Button>
                          ) : l.status === "repaid" ? (
                            <div className="w-full py-2 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold text-center border border-emerald-100 flex items-center justify-center gap-1">
                              <CheckCircleIcon className="w-3.5 h-3.5" /> 상환
                              완료
                            </div>
                          ) : (
                            <div className="w-full py-2 bg-slate-50 text-slate-400 rounded-lg text-xs font-bold text-center border border-slate-100">
                              -
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="absolute bottom-0 left-0 w-full h-[3px] bg-slate-100">
                        <div
                          style={{ width: `${progress}%` }}
                          className={`h-full transition-all duration-700 ${l.status === "repaid" ? "bg-emerald-500" : penaltyDue > 0 ? "bg-rose-500" : "bg-blue-500"}`}
                        />
                      </div>
                    </div>
                  );
                  })}
                </div>
              ) : (
                <div className="py-24 text-center opacity-30">
                  <BanknotesIcon className="w-16 h-16 mx-auto mb-4" />
                  <p className="font-bold">내역이 없습니다.</p>
                </div>
              )}
            </SurfaceLoader>
          </div>
        </div>
      </Modal>

      {/* 상환 모달 오버레이 */}
      {selectedLoanForRepay && (
        <div className="relative z-[1050]">
          <RepayModal
            isOpen={isRepayModalOpen}
            onClose={handleCloseRepayModal}
            loan={selectedLoanForRepay}
            studentCashBalance={studentCashBalance}
            onRepay={onRepay}
            isSubmitting={isRepayingLoan}
            currencyUnit={currencyUnit}
          />
        </div>
      )}
    </>
  );
}
