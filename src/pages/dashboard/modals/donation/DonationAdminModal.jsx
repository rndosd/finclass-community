import { appConfirm } from "../../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    collection,
    doc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    startAfter,
    Timestamp,
    where,
} from "firebase/firestore";
import {
    ArrowRightLeft,
    CalendarRange,
    Eye,
    EyeOff,
    HandHeart,
    History,
    RotateCcw,
    Search,
    Sparkles,
    Target,
    Trash2,
    Trophy,
    Wallet,
    X,
} from "lucide-react";

import { Button, IconButton, InputField, Modal, Spinner, ToggleSwitch , Tabs} from "../../../../components/ui";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useUser } from "../../../../contexts/UserContext";
import { db } from "../../../../firebase";
import {
    formatDateInKST,
    formatDateKeyInKST,
    parseDateKeyAsKST,
    shiftDateKeyInKST,
} from "../../../../utils/kstDate";
import { beginFirestoreSubscriptionDebug } from "../../../../utils/firestoreSubscriptionDebug";
import {
    getDonationLeaderboardQuery,
    mapDonationLeaderboardSnapshot,
} from "../../services/donationLeaderboard";
import {
    adjustDonationBalanceToZero,
    deleteDonation,
    setDonationGoal,
    setDonationLeaderboardVisibility,
    transferDonationToTax,
    transferTaxToDonation,
} from "../../services/donationService";

const PAGE_SIZE = 50;

function formatDate(ts) {
    if (!ts) return "-";
    const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    return formatDateInKST(date, "ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const atStartOfDay = (yyyyMmDd) => parseDateKeyAsKST(yyyyMmDd);
const atEndOfDay = (yyyyMmDd) => parseDateKeyAsKST(yyyyMmDd, { endOfDay: true });
const formatYMD = (date) => formatDateKeyInKST(date);

const DonationAdminModal = ({ isOpen, onClose, classId }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const { classData, userData } = useUser();
    const { showFeedback } = useFeedback();
    const currencyUnit = classData?.currencyUnit || "원";

    const [activeTab, setActiveTab] = useState("overview");
    const [rows, setRows] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [lastDocSnap, setLastDocSnap] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [keyword, setKeyword] = useState("");

    const today = new Date();
    const [startDate, setStartDate] = useState(shiftDateKeyInKST(today, -2));
    const [endDate, setEndDate] = useState(formatYMD(today));

    const [summary, setSummary] = useState({
        totalAmount: 0,
        goalAmount: 10000,
        movedToTaxTotal: 0,
        movedFromTaxTotal: 0,
        showLeaderboardToStudents: false,
    });
    const [taxSummary, setTaxSummary] = useState({
        totalIncome: 0,
        totalExpense: 0,
    });
    const [leaderboard, setLeaderboard] = useState([]);
    const [loadingBoard, setLoadingBoard] = useState(false);
    const [savingVisibility, setSavingVisibility] = useState(false);
    const [goalDraft, setGoalDraft] = useState("");
    const [goalSubmitting, setGoalSubmitting] = useState(false);
    const [transferAmount, setTransferAmount] = useState("");
    const [transferDirection, setTransferDirection] = useState("donation_to_tax");
    const [transferSubmitting, setTransferSubmitting] = useState(false);
    const [balanceAdjustmentSubmitting, setBalanceAdjustmentSubmitting] = useState(false);

    const initialLoadRef = useRef(false);
    const liveUnsubRef = useRef(null);

    const filteredRows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        const activeRows = rows.filter((row) => !row.deleted);
        if (!normalizedKeyword) return activeRows;

        return activeRows.filter((row) => {
            const name = String(row.donatorName || "").toLowerCase();
            const uid = String(row.donatorUid || "").toLowerCase();
            return name.includes(normalizedKeyword) || uid.includes(normalizedKeyword);
        });
    }, [keyword, rows]);

    const currentDonationAmount = Number(summary.totalAmount || 0);
    const taxBalance = Number(taxSummary.totalIncome || 0) - Number(taxSummary.totalExpense || 0);
    const availableTaxBalance = Math.max(taxBalance, 0);
    const goalDraftNumber = Number(goalDraft);
    const previewGoalAmount =
        goalDraft !== "" && Number.isFinite(goalDraftNumber) && goalDraftNumber >= 0
            ? goalDraftNumber
            : Number(summary.goalAmount || 0);
    const hasGoalPreview =
        goalDraft !== "" &&
        Number.isFinite(goalDraftNumber) &&
        goalDraftNumber >= 0 &&
        goalDraftNumber !== Number(summary.goalAmount || 0);
    const rawProgressPercent = useMemo(() => {
        const goalAmount = Number(previewGoalAmount || 0);
        return goalAmount > 0 ? Math.min((Math.max(currentDonationAmount, 0) / goalAmount) * 100, 100) : 0;
    }, [currentDonationAmount, previewGoalAmount]);
    const progressPercentLabel = useMemo(() => {
        if (rawProgressPercent >= 100) return "100%";
        if (rawProgressPercent === 0) return "0%";
        if (rawProgressPercent < 10) return `${rawProgressPercent.toFixed(1)}%`;
        return `${Math.round(rawProgressPercent)}%`;
    }, [rawProgressPercent]);
    const progressBarWidth = rawProgressPercent > 0 ? Math.max(rawProgressPercent, 1) : 0;
    const isDonationBalanceNegative = Number(summary.totalAmount || 0) < 0;

    const transferAmountNumber = Number(transferAmount);
    const isDonationToTaxTransfer = transferDirection === "donation_to_tax";
    const transferSourceBalance = isDonationToTaxTransfer ? currentDonationAmount : taxBalance;
    const transferAvailableBalance = isDonationToTaxTransfer
        ? Math.max(currentDonationAmount, 0)
        : availableTaxBalance;
    const transferSourceLabel = isDonationToTaxTransfer ? "기부금 잔액" : "세금 잔액";
    const transferDescription = isDonationToTaxTransfer
        ? "입력한 금액만큼 기부금 잔액이 줄고, 같은 금액이 세금으로 이동합니다."
        : "입력한 금액만큼 세금 지출로 기록되고, 같은 금액이 기부금 잔액에 더해집니다.";
    const canSubmitTransfer =
        Number.isFinite(transferAmountNumber) &&
        transferAmountNumber > 0 &&
        transferAmountNumber <= transferAvailableBalance;

    const resetRangeState = () => {
        setRows([]);
        setLastDocSnap(null);
        setHasMore(true);
    };

    const buildHistoryQuery = useCallback((rangeStart, rangeEnd, cursor) => {
        const constraints = [];
        const startTs = rangeStart ? Timestamp.fromDate(atStartOfDay(rangeStart)) : null;
        const endTs = rangeEnd ? Timestamp.fromDate(atEndOfDay(rangeEnd)) : null;

        if (startTs) constraints.push(where("donatedAt", ">=", startTs));
        if (endTs) constraints.push(where("donatedAt", "<=", endTs));
        constraints.push(orderBy("donatedAt", "desc"));
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(PAGE_SIZE));

        return query(collection(db, `classes/${classId}/donations`), ...constraints);
    }, [classId]);

    const subscribeFirstPage = useCallback((rangeStart, rangeEnd) => {
        if (!classId) return;
        if (liveUnsubRef.current) {
            liveUnsubRef.current();
            liveUnsubRef.current = null;
        }

        setLoadingHistory(true);
        const historyQuery = buildHistoryQuery(rangeStart, rangeEnd, null);
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: "DonationAdminModal.history",
            pathKey: "classes/{classId}/donations?range&limit=50",
            classId,
            role: userData?.role,
        });
        const unsubscribe = onSnapshot(
            historyQuery,
            (snapshot) => {
                subscriptionDebug.recordSnapshot(snapshot);
                const liveRows = snapshot.docs.map((docSnapshot) => ({
                    id: docSnapshot.id,
                    ...docSnapshot.data(),
                }));
                setRows((prev) => {
                    const liveIds = new Set(liveRows.map((row) => row.id));
                    const olderRows = prev.filter((row) => !liveIds.has(row.id));
                    return [...liveRows, ...olderRows];
                });
                setLastDocSnap(snapshot.docs[snapshot.docs.length - 1] || null);
                setHasMore(snapshot.size === PAGE_SIZE);
                setLoadingHistory(false);
            },
            (error) => {
                subscriptionDebug.recordError(error);
                console.error("[DonationAdminModal] history live error:", error);
                setLoadingHistory(false);
            },
        );
        liveUnsubRef.current = () => {
            unsubscribe();
            subscriptionDebug.stop();
        };
    }, [buildHistoryQuery, classId, userData?.role]);

    const fetchPage = async () => {
        if (!classId || loadingHistory) return;

        setLoadingHistory(true);
        try {
            const historyQuery = buildHistoryQuery(startDate, endDate, lastDocSnap);
            const snapshot = await getDocs(historyQuery);
            const nextRows = snapshot.docs.map((docSnapshot) => ({
                id: docSnapshot.id,
                ...docSnapshot.data(),
            }));
            setRows((prev) => {
                const mergedRows = [...prev, ...nextRows];
                const rowMap = new Map();
                mergedRows.forEach((row) => rowMap.set(row.id, row));
                return Array.from(rowMap.values());
            });
            setLastDocSnap(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.size === PAGE_SIZE);
        } catch (error) {
            console.error("[DonationAdminModal] history fetch error:", error);
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        if (!isOpen) {
            initialLoadRef.current = false;
            if (liveUnsubRef.current) {
                liveUnsubRef.current();
                liveUnsubRef.current = null;
            }
            return undefined;
        }

        if (initialLoadRef.current) return undefined;
        initialLoadRef.current = true;

        const current = new Date();
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(current.getDate() - 2);
        const nextStartDate = formatYMD(twoDaysAgo);
        const nextEndDate = formatYMD(current);

        setActiveTab("overview");
        setKeyword("");
        setStartDate(nextStartDate);
        setEndDate(nextEndDate);
        resetRangeState();
        subscribeFirstPage(nextStartDate, nextEndDate);
        return () => {
            initialLoadRef.current = false;
            if (liveUnsubRef.current) {
                liveUnsubRef.current();
                liveUnsubRef.current = null;
            }
        };
    }, [isOpen, subscribeFirstPage]);

    useEffect(() => {
        if (!isOpen || !classId) return undefined;
        const summaryRef = doc(db, `classes/${classId}/dashboardSummary/donationSummary`);
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: "DonationAdminModal.donationSummary",
            pathKey: "classes/{classId}/dashboardSummary/donationSummary",
            classId,
            role: userData?.role,
        });
        const unsubscribe = onSnapshot(
            summaryRef,
            (snapshot) => {
                subscriptionDebug.recordSnapshot(snapshot);
                const data = snapshot.exists() ? snapshot.data() : {};
                setSummary({
                    totalAmount: Number(data?.totalAmount || 0),
                    goalAmount: Number(data?.goalAmount || 10000),
                    movedToTaxTotal: Number(data?.movedToTaxTotal || 0),
                    movedFromTaxTotal: Number(data?.movedFromTaxTotal || 0),
                    showLeaderboardToStudents: Boolean(data?.showLeaderboardToStudents),
                });
            },
            (error) => {
                subscriptionDebug.recordError(error);
                console.error("[DonationAdminModal] summary listen error:", error);
            },
        );
        return () => {
            unsubscribe();
            subscriptionDebug.stop();
        };
    }, [classId, isOpen, userData?.role]);

    useEffect(() => {
        if (!isOpen || !classId) return undefined;
        const summaryRef = doc(db, `classes/${classId}/dashboardSummary/taxSummary`);
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: "DonationAdminModal.taxSummary",
            pathKey: "classes/{classId}/dashboardSummary/taxSummary",
            classId,
            role: userData?.role,
        });
        const unsubscribe = onSnapshot(
            summaryRef,
            (snapshot) => {
                subscriptionDebug.recordSnapshot(snapshot);
                const data = snapshot.exists() ? snapshot.data() : {};
                setTaxSummary({
                    totalIncome: Number(data?.totalIncome || 0),
                    totalExpense: Number(data?.totalExpense || 0),
                });
            },
            (error) => {
                subscriptionDebug.recordError(error);
                console.error("[DonationAdminModal] tax summary listen error:", error);
            },
        );
        return () => {
            unsubscribe();
            subscriptionDebug.stop();
        };
    }, [classId, isOpen, userData?.role]);

    useEffect(() => {
        if (!isOpen || !classId || activeTab !== "leaderboard") return undefined;
        setLoadingBoard(true);
        const leaderboardQuery = getDonationLeaderboardQuery(classId);
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: "DonationAdminModal.leaderboard",
            pathKey: "classes/{classId}/donationLeaderboard",
            classId,
            role: userData?.role,
        });
        const unsubscribe = onSnapshot(
            leaderboardQuery,
            (snapshot) => {
                subscriptionDebug.recordSnapshot(snapshot);
                setLeaderboard(mapDonationLeaderboardSnapshot(snapshot));
                setLoadingBoard(false);
            },
            (error) => {
                subscriptionDebug.recordError(error);
                console.error("[DonationAdminModal] leaderboard listen error:", error);
                setLeaderboard([]);
                setLoadingBoard(false);
            },
        );
        return () => {
            unsubscribe();
            subscriptionDebug.stop();
        };
    }, [activeTab, classId, isOpen, userData?.role]);

    useEffect(() => {
        if (!isOpen) {
            setGoalDraft("");
            setTransferAmount("");
            setTransferDirection("donation_to_tax");
            return;
        }
        setGoalDraft(String(summary.goalAmount || 0));
    }, [isOpen, summary.goalAmount]);

    const applyDateFilter = () => {
        resetRangeState();
        subscribeFirstPage(startDate, endDate);
    };

    const resetDateFilter = () => {
        const current = new Date();
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(current.getDate() - 2);
        const nextStartDate = formatYMD(twoDaysAgo);
        const nextEndDate = formatYMD(current);
        setStartDate(nextStartDate);
        setEndDate(nextEndDate);
        resetRangeState();
        subscribeFirstPage(nextStartDate, nextEndDate);
    };

    const handleVisibilityToggle = async (nextVisible) => {
        if (savingVisibility) return;
        setSavingVisibility(true);
        try {
            const result = await setDonationLeaderboardVisibility({ classId, visible: nextVisible });
            if (result?.success) {
                setSummary((prev) => ({ ...prev, showLeaderboardToStudents: nextVisible }));
                showFeedback(result.message || "기부 순위 공개 설정을 저장했습니다.", "success");
            } else {
                showFeedback(result?.message || "기부 순위 공개 설정을 저장하지 못했습니다.", "error");
            }
        } catch (error) {
            console.error("[DonationAdminModal] visibility toggle error:", error);
            showFeedback("기부 순위 공개 설정을 저장하지 못했습니다.", "error");
        } finally {
            setSavingVisibility(false);
        }
    };

    const handleGoalSubmit = async (event) => {
        event.preventDefault();
        const nextGoal = Number(goalDraft);
        if (!Number.isFinite(nextGoal) || nextGoal < 0) {
            showFeedback("목표 금액을 올바르게 입력해 주세요.", "warning");
            return;
        }

        setGoalSubmitting(true);
        try {
            const result = await setDonationGoal({ classId, newGoal: nextGoal });
            if (result?.success) {
                setSummary((prev) => ({ ...prev, goalAmount: nextGoal }));
                showFeedback(result.message || "기부 목표를 저장했습니다.", "success");
            } else {
                showFeedback(result?.message || "기부 목표를 저장하지 못했습니다.", "error");
            }
        } catch (error) {
            console.error("[DonationAdminModal] goal save error:", error);
            showFeedback("기부 목표를 저장하지 못했습니다.", "error");
        } finally {
            setGoalSubmitting(false);
        }
    };

    const handleTransferSubmit = async (event) => {
        event.preventDefault();
        if (!canSubmitTransfer) return;

        setTransferSubmitting(true);
        try {
            const result = isDonationToTaxTransfer
                ? await transferDonationToTax({ classId, amount: transferAmountNumber })
                : await transferTaxToDonation({ classId, amount: transferAmountNumber });
            if (result?.success) {
                if (isDonationToTaxTransfer) {
                    setSummary((prev) => ({
                        ...prev,
                        totalAmount: Math.max(Number(prev.totalAmount || 0) - transferAmountNumber, 0),
                        movedToTaxTotal: Number(prev.movedToTaxTotal || 0) + transferAmountNumber,
                    }));
                } else {
                    setSummary((prev) => ({
                        ...prev,
                        totalAmount: Number(prev.totalAmount || 0) + transferAmountNumber,
                        movedFromTaxTotal: Number(prev.movedFromTaxTotal || 0) + transferAmountNumber,
                    }));
                    setTaxSummary((prev) => ({
                        ...prev,
                        totalExpense: Number(prev.totalExpense || 0) + transferAmountNumber,
                    }));
                }
                showFeedback(
                    result.message || (isDonationToTaxTransfer ? "세금으로 이동했습니다." : "세금에서 기부금으로 이동했습니다."),
                    "success",
                );
                setTransferAmount("");
            } else {
                showFeedback(result?.message || "자금 이동에 실패했습니다.", "error");
            }
        } catch (error) {
            console.error("[DonationAdminModal] transfer error:", error);
            showFeedback("자금 이동에 실패했습니다.", "error");
        } finally {
            setTransferSubmitting(false);
        }
    };

    const handleBalanceAdjustmentToZero = async () => {
        if (!isDonationBalanceNegative || balanceAdjustmentSubmitting) return;

        const currentAmount = Number(summary.totalAmount || 0);
        const confirmed = (await appConfirm(
            `현재 기부금 잔액 ${formatDisplayMoney(currentAmount)} ${currencyUnit}을 0으로 보정할까요?\n\n이 작업은 보정 기록을 남깁니다.`,
        ));
        if (!confirmed) return;

        setBalanceAdjustmentSubmitting(true);
        try {
            const result = await adjustDonationBalanceToZero({
                classId,
                reason: "교사 화면에서 기부금 음수 잔액을 0으로 보정",
            });
            if (result?.success) {
                setSummary((prev) => ({ ...prev, totalAmount: 0 }));
                showFeedback(result.message || "기부금 잔액을 0으로 보정했습니다.", "success");
            } else {
                showFeedback(result?.message || "기부금 잔액을 보정하지 못했습니다.", "error");
            }
        } catch (error) {
            console.error("[DonationAdminModal] balance adjustment error:", error);
            showFeedback("기부금 잔액을 보정하지 못했습니다.", "error");
        } finally {
            setBalanceAdjustmentSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl" showDefaultCloseButton={false}>
            <Modal.Header className="border-b-0 bg-gradient-to-br from-rose-50 via-white to-sky-50 px-4 py-5 sm:px-8 sm:py-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white/90 px-3 py-1 text-xs font-semibold text-rose-600">
                            <Sparkles className="h-3.5 w-3.5" />
                            교사용 기부 관리
                        </div>
                        <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">기부 관리</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            목표 설정, 세금 이동, 순위 공개, 내역 관리를 한곳에서 처리할 수 있습니다.
                        </p>
                    </div>
                    <IconButton
                        icon={X}
                        label="닫기"
                        onClick={onClose}
                        tone="slate"
                        size="lg"
                        className="shrink-0 rounded-full border border-white/90 bg-white/90 p-2 text-slate-400 transition hover:text-slate-700"
                    />
                </div>
            </Modal.Header>

            <Modal.Body className="space-y-5 px-3 py-4 sm:px-8 sm:py-6">
                <div className="border-b border-slate-200">
                    <Tabs ariaLabel="기부 관리 업무" idPrefix="donation-management" tabs={[{id:"overview",label:"통계 및 현황",icon:Target},{id:"history",label:"기부 내역",icon:History},{id:"leaderboard",label:"순위",icon:Trophy}]} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="md" fullWidth wrapLabels />
                </div>

                {activeTab === "overview" ? (
                    <div className="space-y-5">
                        <div className="grid gap-3 lg:grid-cols-5">
                            <OverviewCard icon={Wallet} label="현재 기부금" value={formatDisplayMoney(summary.totalAmount)} unit={currencyUnit} tone="rose" />
                            <OverviewCard icon={HandHeart} label="목표 기준 기부금" value={formatDisplayMoney(Math.max(currentDonationAmount, 0))} unit={currencyUnit} tone="amber" />
                            <OverviewCard icon={ArrowRightLeft} label="세금 이동 누적" value={formatDisplayMoney(summary.movedToTaxTotal)} unit={currencyUnit} tone="sky" />
                            <OverviewCard icon={ArrowRightLeft} label="세금에서 이동 누적" value={formatDisplayMoney(Number(summary.movedFromTaxTotal || 0))} unit={currencyUnit} tone="sky" />
                            <OverviewCard icon={summary.showLeaderboardToStudents ? Eye : EyeOff} label="학생 순위 공개" value={summary.showLeaderboardToStudents ? "공개" : "숨김"} tone="mint" />
                        </div>

                        {isDonationBalanceNegative ? (
                            <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-bold text-amber-900">기부금 잔액 정산이 필요합니다.</p>
                                    <p className="mt-1 text-xs leading-5 text-amber-700">
                                        기부 내역 삭제로 현재 기부금이 음수가 되었어요. 규칙상 음수 상태는 유지하되, 필요하면 보정 기록을 남기고 0으로 맞출 수 있습니다.
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    tone="amber"
                                    variant="secondary"
                                    icon={RotateCcw}
                                    isLoading={balanceAdjustmentSubmitting}
                                    onClick={handleBalanceAdjustmentToZero}
                                    className="w-full shrink-0 sm:w-auto"
                                >
                                    0으로 보정
                                </Button>
                            </div>
                        ) : null}

                        <SectionPanel className="bg-gradient-to-br from-rose-50 via-white to-sky-50">
                            <div className="grid gap-4 xl:grid-cols-2">
                                <InnerCard>
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                        <Target className="h-4 w-4 text-rose-500" />
                                        운영 한눈에 보기
                                    </div>
                                        <div className="mt-4">
                                            <div className="flex items-end justify-between gap-3">
                                                <div>
                                                    <p className="text-xs font-medium text-slate-500">목표 진행률</p>
                                                    <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{progressPercentLabel}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-slate-500">현재 {formatDisplayMoney(Math.max(currentDonationAmount, 0))} {currencyUnit}</p>
                                                    <p className="mt-1 text-xs text-slate-400">목표 {formatDisplayMoney(previewGoalAmount)} {currencyUnit}</p>
                                                </div>
                                            </div>
                                            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white shadow-inner ring-1 ring-rose-100">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400 transition-all duration-500"
                                                    style={{ width: `${progressBarWidth}%` }}
                                                />
                                            </div>
                                            <p className="mt-3 text-xs text-slate-500">
                                                현재 기부금 잔액 기준으로 목표 진행률을 계산합니다.
                                            </p>
                                            {hasGoalPreview ? (
                                                <p className="mt-2 text-xs font-semibold text-rose-500">
                                                    입력 중인 목표 금액 기준으로 진행률을 미리 보여주고 있습니다.
                                                </p>
                                            ) : null}
                                        </div>
                                    </InnerCard>

                                <InnerCard as="form" onSubmit={handleTransferSubmit}>
                                    <p className="text-sm font-semibold text-slate-800">기부금 · 세금 이동</p>
                                    <p className="mt-1 text-xs text-slate-500">이동 방향을 고른 뒤 출발 잔액 안에서 금액을 이동합니다.</p>

                                    <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                                        <Button
                                            type="button"
                                            onClick={() => {
                                                setTransferDirection("donation_to_tax");
                                                setTransferAmount("");
                                            }}
                                            kind="ghost"
                                            tone="red"
                                            size="sm"
                                            aria-pressed={isDonationToTaxTransfer}
                                            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                                                isDonationToTaxTransfer
                                                    ? "bg-white text-rose-600 shadow-sm"
                                                    : "text-slate-500 hover:text-slate-700"
                                            }`}
                                        >
                                            기부금 → 세금
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={() => {
                                                setTransferDirection("tax_to_donation");
                                                setTransferAmount("");
                                            }}
                                            kind="ghost"
                                            tone="blue"
                                            size="sm"
                                            aria-pressed={!isDonationToTaxTransfer}
                                            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                                                !isDonationToTaxTransfer
                                                    ? "bg-white text-sky-600 shadow-sm"
                                                    : "text-slate-500 hover:text-slate-700"
                                            }`}
                                        >
                                            세금 → 기부금
                                        </Button>
                                    </div>

                                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                                        <InputField
                                            type="number"
                                            min="1"
                                            step="1"
                                            value={transferAmount}
                                            onChange={(event) => setTransferAmount(event.target.value)}
                                            placeholder={`이동 금액 (${currencyUnit})`}
                                        />
                                        <Button
                                            type="button"
                                            tone="blue"
                                            variant="secondary"
                                            onClick={() => setTransferAmount(String(transferAvailableBalance || 0))}
                                            className="w-full sm:w-auto"
                                        >
                                            전액 입력
                                        </Button>
                                    </div>
                                    <p className="mt-3 text-xs text-slate-500">{transferDescription}</p>
                                    <div className="mt-4 flex items-center justify-between gap-3">
                                        <div className="text-xs text-slate-500">
                                            <p>{transferSourceLabel} {formatDisplayMoney(transferSourceBalance)} {currencyUnit}</p>
                                            {transferSourceBalance < 0 ? (
                                                <p className="mt-1 font-semibold text-rose-500">
                                                    이동 가능 {formatDisplayMoney(transferAvailableBalance)} {currencyUnit}
                                                </p>
                                            ) : null}
                                        </div>
                                        <Button type="submit" tone="blue" isLoading={transferSubmitting} disabled={!canSubmitTransfer}>
                                            이동 실행
                                        </Button>
                                    </div>
                                </InnerCard>

                                <InnerCard as="form" onSubmit={handleGoalSubmit}>
                                    <p className="text-sm font-semibold text-slate-800">목표 설정</p>
                                    <p className="mt-1 text-xs text-slate-500">기부 카드에 보이는 목표 금액을 여기서 바로 바꿀 수 있습니다.</p>
                                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                        <InputField
                                            type="number"
                                            min="0"
                                            value={goalDraft}
                                            onChange={(event) => setGoalDraft(event.target.value)}
                                            placeholder="예: 30000"
                                            className="w-full"
                                        />
                                        <Button type="submit" tone="blue" isLoading={goalSubmitting} className="w-full sm:w-auto">
                                            목표 저장
                                        </Button>
                                    </div>
                                </InnerCard>

                                <InnerCard>
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-800">학생용 기부 순위</p>
                                            <p className="mt-1 text-xs text-slate-500">선생님이 켰을 때만 학생 카드에 트로피 아이콘이 보입니다.</p>
                                        </div>
                                        <ToggleSwitch
                                            id="donation-leaderboard-visibility"
                                            checked={summary.showLeaderboardToStudents}
                                            onChange={handleVisibilityToggle}
                                            disabled={savingVisibility}
                                            srLabel="학생용 기부 순위 공개"
                                        />
                                    </div>
                                    <div className="mt-3 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                        현재 상태: {summary.showLeaderboardToStudents ? "공개" : "숨김"}
                                    </div>
                                </InnerCard>
                            </div>
                        </SectionPanel>
                    </div>
                ) : null}

                {activeTab === "history" ? (
                    <div className="space-y-4">
                        <SectionPanel>
                            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_auto]">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <InputField value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="이름 또는 아이디로 검색" className="pl-10 text-sm" />
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                    <InputField type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="text-sm" />
                                    <span className="text-center text-sm text-slate-400">~</span>
                                    <InputField type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="text-sm" />
                                </div>
                                <div className="grid grid-cols-2 gap-2 lg:flex">
                                    <Button variant="secondary" tone="blue" onClick={applyDateFilter} className="w-full lg:w-auto">조회</Button>
                                    <Button variant="ghost" tone="slate" onClick={resetDateFilter} className="w-full lg:w-auto">초기화</Button>
                                </div>
                            </div>
                        </SectionPanel>

                        <HistoryTable
                            classId={classId}
                            rows={filteredRows}
                            currencyUnit={currencyUnit}
                            loadingHistory={loadingHistory}
                            onLocalRemove={(id) => setRows((prev) => prev.filter((item) => item.id !== id))}
                        />

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-xs text-slate-500">최근 기록은 자동으로 갱신되며, 더 오래된 내역은 추가 조회할 수 있습니다.</span>
                            <div className="flex items-center gap-2 sm:justify-end">
                                {loadingHistory ? <Spinner size="xs" /> : null}
                                <Button onClick={fetchPage} disabled={!hasMore || loadingHistory} variant="secondary" tone="blue" className="w-full sm:w-auto">
                                    더 불러오기
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {activeTab === "leaderboard" ? (
                    <div className="space-y-4">
                        <SectionPanel className="bg-gradient-to-r from-amber-50 via-white to-rose-50">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-800">실시간 기부 순위</p>
                                    <p className="mt-1 text-xs text-slate-500">누적 기부 금액 기준으로 집계되며, 학생 공개 여부는 통계 및 현황 탭에서 바꿀 수 있습니다.</p>
                                </div>
                                <div className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-100">
                                    학생 공개 상태: {summary.showLeaderboardToStudents ? "공개" : "숨김"}
                                </div>
                            </div>
                        </SectionPanel>

                        <SectionPanel className="overflow-hidden p-0">
                            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                                <div>
                                    <p className="text-sm font-semibold text-slate-800">순위 목록</p>
                                    <p className="mt-1 text-xs text-slate-500">누적 기부 금액 기준으로 집계됩니다.</p>
                                </div>
                                {loadingBoard ? <Spinner size="xs" /> : null}
                            </div>
                            <div className="max-h-[54vh] overflow-auto">
                                {loadingBoard ? (
                                    <div className="flex h-56 items-center justify-center"><Spinner size="lg" /></div>
                                ) : leaderboard.length === 0 ? (
                                    <EmptyState title="아직 집계된 기부 순위가 없습니다." body="학생들이 기부를 시작하면 순위가 여기에 나타납니다." />
                                ) : (
                                    <div className="divide-y divide-slate-100">
                                        {leaderboard.map((row) => (
                                            <div key={row.uid} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
                                                <div className="inline-flex min-w-[3rem] items-center justify-center rounded-full bg-amber-50 px-3 py-1 text-sm font-black text-amber-700">{row.rank}위</div>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-bold text-slate-900">{row.name}</p>
                                                    <p className="mt-0.5 text-xs text-slate-500">총 {row.count}회 기부</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-black text-slate-900">{formatDisplayMoney(row.total)}</p>
                                                    <p className="text-[11px] text-slate-400">{currencyUnit}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </SectionPanel>
                    </div>
                ) : null}
            </Modal.Body>

            <Modal.Footer className="bg-white px-3 py-4 sm:px-8">
                <Button onClick={onClose} variant="secondary" tone="slate" className="w-full sm:w-auto">닫기</Button>
            </Modal.Footer>
        </Modal>
    );
};

const OverviewCard = ({ icon: Icon, label, value, unit, tone = "slate" }) => {
    const toneClass = {
        rose: "bg-rose-50 border-rose-100",
        amber: "bg-amber-50 border-amber-100",
        sky: "bg-sky-50 border-sky-100",
        mint: "bg-emerald-50 border-emerald-100",
        slate: "bg-slate-50 border-slate-200",
    };

    return (
        <div className={`rounded-[1.75rem] border p-4 ${toneClass[tone] || toneClass.slate}`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <Icon className="h-4 w-4" />
                {label}
            </div>
            <p className="mt-4 text-2xl font-black tracking-tight text-slate-900">
                {value}
                {unit ? <span className="ml-1 text-sm font-semibold text-slate-500">{unit}</span> : null}
            </p>
        </div>
    );
};

const SectionPanel = ({ children, className = "" }) => (
    <div className={`rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
);

const InnerCard = ({ as: Tag = "div", children, className = "", ...props }) => (
    <Tag className={`rounded-[1.75rem] border border-white/90 bg-white/85 p-4 shadow-sm ${className}`} {...props}>
        {children}
    </Tag>
);



const EmptyState = ({ title, body }) => (
    <div className="px-6 py-12 text-center">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="mt-2 text-xs text-slate-500">{body}</p>
    </div>
);

const HistoryTable = ({ classId, rows, currencyUnit, loadingHistory, onLocalRemove }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();
return (<SectionPanel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <CalendarRange className="h-4 w-4 text-slate-400" />
                최근 기부 기록
            </div>
            <span className="text-xs text-slate-500">{rows.length}건 표시</span>
        </div>
        <div className="max-h-[52vh] overflow-auto">
            <div className="divide-y divide-slate-100 sm:hidden">
                {rows.map((row) => (
                    <div key={row.id} className="space-y-3 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{row.donatorName || row.donatorUid}</p>
                                <p className="mt-1 text-xs text-slate-500">{formatDate(row.donatedAt)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm font-black text-slate-900">{formatDisplayMoney(Number(row.amount || 0))}</p>
                                <p className="text-[11px] text-slate-400">{currencyUnit}</p>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <RowDeleteButton classId={classId} row={row} onLocalRemove={onLocalRemove} />
                        </div>
                    </div>
                ))}
                {!loadingHistory && rows.length === 0 ? <EmptyState title="표시할 기부 내역이 없습니다." body="검색어나 날짜 범위를 바꿔서 다시 확인해 보세요." /> : null}
            </div>

            <table className="hidden w-full text-sm sm:table">
                <thead className="bg-slate-50 text-slate-500">
                    <tr>
                        <th className="px-4 py-3 text-left font-semibold">일시</th>
                        <th className="px-4 py-3 text-left font-semibold">기부자</th>
                        <th className="px-4 py-3 text-right font-semibold">금액</th>
                        <th className="px-4 py-3 text-right font-semibold">관리</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                            <td className="px-4 py-3 text-slate-600">{formatDate(row.donatedAt)}</td>
                            <td className="px-4 py-3 font-medium text-slate-900">{row.donatorName || row.donatorUid}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900">{formatDisplayMoney(Number(row.amount || 0))} {currencyUnit}</td>
                            <td className="px-4 py-3 text-right"><RowDeleteButton classId={classId} row={row} onLocalRemove={onLocalRemove} /></td>
                        </tr>
                    ))}
                    {!loadingHistory && rows.length === 0 ? (
                        <tr>
                            <td colSpan={4} className="px-4 py-10">
                                <EmptyState title="표시할 기부 내역이 없습니다." body="검색어나 날짜 범위를 바꿔서 다시 확인해 보세요." />
                            </td>
                        </tr>
                    ) : null}
                </tbody>
            </table>
        </div>
    </SectionPanel>);
};

const RowDeleteButton = ({ classId, row, onLocalRemove }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const { isTeacher } = useUser();
    const { showFeedback } = useFeedback();
    const [busy, setBusy] = useState(false);

    if (!isTeacher) return null;

    const handleDelete = async () => {
        if (busy) return;
        const ok = (await appConfirm(`이 기부 내역을 삭제할까요?\n\n- 기부자: ${row.donatorName || row.donatorUid}\n- 금액: ${formatDisplayMoney(Number(
                row.amount || 0,
            ))}\n\n삭제하면 기부 합계와 순위에도 바로 반영됩니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
        if (!ok) return;

        setBusy(true);
        try {
            const result = await deleteDonation({ classId, donationId: row.id });
            if (result?.success) {
                onLocalRemove?.(row.id);
                showFeedback(result.message || "기부 내역을 삭제했습니다.", "success");
            } else {
                showFeedback(result?.message || "기부 내역을 삭제하지 못했습니다.", "error");
            }
        } catch (error) {
            console.error("[DonationAdminModal] delete error:", error);
            showFeedback("기부 내역을 삭제하지 못했습니다.", "error");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            icon={Trash2}
            kind="soft"
            tone="rose"
            size="xs"
            isLoading={busy}
            title="기부 내역 삭제"
        >
            삭제
        </Button>
    );
};

export default DonationAdminModal;
