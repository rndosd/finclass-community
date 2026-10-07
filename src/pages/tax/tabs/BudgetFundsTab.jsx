import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarCheck,
  ArrowRightLeft,
  BriefcaseBusiness,
  ChevronDown,
  HandCoins,
  History,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  Trash2,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import Button from "../../../components/ui/Button";
import Modal from "../../../components/ui/Modal";
import Spinner from "../../../components/ui/Spinner";
import StudentSelector from "../../../components/ui/StudentSelector";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useFundMode } from "../../../contexts/FundModeContext";
import { useClassStudents } from "../../../hooks/user/useClassStudents";
import {
  FUND_CHANNEL_OPTIONS,
  getDefaultFundChannels,
  getFundChannelLabel,
} from "../../../domain/classFunds/fundPolicy";
import {
  useClassFundsQuery,
  useClassFundUsagesQuery,
} from "../hooks/useTaxQuery";
import {
  allocateTaxToClassFunds,
  archiveClassFund,
  cancelClassFundUsage,
  createClassFund,
  recordClassFundUsage,
  settleClassFundDailyExpenses,
  transferClassFunds,
  updateClassFund,
  updateClassFundOperators,
  updateClassFundPensionSettings,
} from "../services/classFundService";

const MODAL_BODY_CLASS = "space-y-5 p-5 sm:p-6";
const MODAL_FIELD_CLASS =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
const MODAL_ACTIONS_CLASS =
  "flex justify-end gap-2 border-t border-slate-100 pt-4";

const isInvestmentFund = (fund) => fund?.fundType === "investment";
const isAssetOperationFund = (fund) =>
  ["investment", "pension"].includes(fund?.fundType);

export const getFundPublicValue = (fund = {}) => {
  const normalizedFund = fund || {};
  return isAssetOperationFund(normalizedFund)
    ? toNumber(normalizedFund.cashBalance) +
      toNumber(normalizedFund.investmentValue) +
      toNumber(normalizedFund.realEstateValue)
    : toNumber(normalizedFund.cashBalance) +
      toNumber(normalizedFund.pendingSettlementExpenseTotal) +
      toNumber(normalizedFund.investmentValue) +
      toNumber(normalizedFund.realEstateValue);
};

export const getUsageStatusLabel = (usage) => {
  if (usage?.cancellationStatus === "cancelled") return "취소됨";
  if (usage?.cancellationStatus === "reversal" || usage?.reversalOfUsageId) {
    return "취소 복구";
  }
  if (usage?.settlementStatus === "settled") return "반영 완료";
  if (usage?.settlementStatus === "not_applicable") return "자산반영";
  return "장부 대기";
};

const getUsageStatusClassName = (usage) => {
  if (usage?.cancellationStatus === "cancelled") {
    return "bg-slate-100 text-slate-500";
  }
  if (usage?.cancellationStatus === "reversal" || usage?.reversalOfUsageId) {
    return "bg-violet-50 text-violet-700";
  }
  if (usage?.settlementStatus === "settled") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (usage?.settlementStatus === "not_applicable") {
    return "bg-blue-50 text-blue-700";
  }
  return "bg-amber-50 text-amber-700";
};

export const canCancelClassFundUsage = (usage = {}) => {
  if (usage.cancellationStatus || usage.reversalOfUsageId) return false;
  if (usage.settlementId) return false;
  const isLinkedPosPurchase =
    usage.source === "store_pos" && usage.storeRedemptionIds?.length > 0;
  if (isLinkedPosPurchase) return toNumber(usage.amount) > 0;
  if (usage.relatedRealEstateLedgerId && usage.relatedDeskId) {
    return toNumber(usage.cashAmount || usage.amount) > 0;
  }
  if (usage.relatedTradeId && usage.channel === "stockInvestment") {
    return toNumber(usage.cashAmount || usage.amount) > 0;
  }
  if ((usage.direction || "out") === "in") return false;
  if (
    usage.settlementStatus === "not_applicable" ||
    usage.usageKind === "asset_purchase" ||
    usage.usageKind === "asset_sale"
  ) {
    return false;
  }
  if (
    usage.source &&
    !["class_fund_usage", "class_fund_payout"].includes(usage.source)
  ) {
    return false;
  }
  if (
    usage.relatedRealEstateLedgerId ||
    usage.relatedTradeId ||
    usage.storeRedemptionIds?.length
  ) {
    return false;
  }
  return toNumber(usage.amount) > 0;
};

const toNumber = (value) => {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getChannelLabels = (allowedChannels) => {
  if (!allowedChannels) return "수동 집행";
  return (
    FUND_CHANNEL_OPTIONS.filter(
      (option) => allowedChannels[option.key] === true,
    )
      .map((option) => option.label)
      .join(", ") || "사용처 없음"
  );
};

const getChannelCount = (allowedChannels) => {
  if (!allowedChannels) return 1;
  return FUND_CHANNEL_OPTIONS.filter(
    (option) => allowedChannels[option.key] === true,
  ).length;
};

const EXPENSE_CHANNEL_OPTIONS = FUND_CHANNEL_OPTIONS.filter(
  (option) => !option.investmentOnly && option.key !== "realEstatePurchase",
);

export const getAllowedExpenseChannelOptions = (fund) => {
  if (!fund || isInvestmentFund(fund)) return [];
  if (!fund.allowedChannels) {
    return EXPENSE_CHANNEL_OPTIONS.filter(
      (option) => option.key === "manualExpense",
    );
  }
  return EXPENSE_CHANNEL_OPTIONS.filter(
    (option) => fund.allowedChannels?.[option.key] === true,
  );
};

export const getCommittedFundBudget = (fund = {}) => {
  if (!Object.prototype.hasOwnProperty.call(fund, "allocatedFromTaxTotal")) {
    return getFundPublicValue(fund);
  }
  return (
    toNumber(fund.allocatedFromTaxTotal) -
    toNumber(fund.settledExpenseTotal)
  );
};

export default function BudgetFundsTab({
  classId,
  taxSummary,
  isLoading = false,
  currencyUnit = "",
}) {
  const { formatNumber } = useNumberFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();
  const { activeFundId, canOperateFund, isFundMode, startFundMode, exitFundMode } = useFundMode();
  const { data: classFunds = [], isLoading: isFundsLoading } =
    useClassFundsQuery(classId, { enabled: !!classId });
  const { data: classFundUsages = [], isLoading: isUsagesLoading } =
    useClassFundUsagesQuery(classId, { enabled: !!classId });
  const { data: pensionStudents = [] } = useClassStudents(classId, {
    enabled: Boolean(classId && classFunds.length > 0),
    realtime: true,
  });
  const [isCreateBusy, setIsCreateBusy] = useState(false);
  const [isAllocateBusy, setIsAllocateBusy] = useState(false);
  const [isUsageBusy, setIsUsageBusy] = useState(false);
  const [isSettleBusy, setIsSettleBusy] = useState(false);
  const [isEditBusy, setIsEditBusy] = useState(false);
  const [isTransferBusy, setIsTransferBusy] = useState(false);
  const [isPensionBusy, setIsPensionBusy] = useState(false);
  const [isOperatorsBusy, setIsOperatorsBusy] = useState(false);
  const [isCancelBusy, setIsCancelBusy] = useState(false);
  const [isDeleteBusy, setIsDeleteBusy] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAllocationOpen, setIsAllocationOpen] = useState(false);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isPensionOpen, setIsPensionOpen] = useState(false);
  const [isOperatorsOpen, setIsOperatorsOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [historyFundId, setHistoryFundId] = useState(null);
  const [historyChannelFilter, setHistoryChannelFilter] = useState("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [selectedFundId, setSelectedFundId] = useState(null);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [allocationDraft, setAllocationDraft] = useState({});
  const [usageForm, setUsageForm] = useState({
    fundId: "",
    amount: "",
    channel: "manualExpense",
    description: "",
  });
  const [fundForm, setFundForm] = useState({
    name: "",
    description: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    allowedChannels: getDefaultFundChannels("general"),
  });
  const [transferForm, setTransferForm] = useState({
    toFundId: "",
    amount: "",
    description: "",
  });
  const [pensionForm, setPensionForm] = useState({
    enabled: false,
    defaultContributionRate: "5",
    studentRates: {},
    participating: {},
  });
  const [operatorUids, setOperatorUids] = useState([]);
  const [deleteDestinationFundId, setDeleteDestinationFundId] = useState("__tax__");

  const openOperatorsModal = () => {
    if (!selectedFund) return;
    setOperatorUids(Array.isArray(selectedFund.operatorUids) ? selectedFund.operatorUids : []);
    setIsOperatorsOpen(true);
  };

  const handleSaveOperators = async (event) => {
    event.preventDefault();
    if (!selectedFund || isOperatorsBusy) return;
    setIsOperatorsBusy(true);
    const result = await updateClassFundOperators({
      classId,
      fundId: selectedFund.id,
      operatorUids,
    });
    setIsOperatorsBusy(false);
    if (!result?.success) {
      showFeedback(result?.message || "담당자 저장에 실패했습니다.", "error");
      return;
    }
    setIsOperatorsOpen(false);
    showFeedback("기금 운용 담당자를 저장했습니다.", "success");
  };

  const activeFunds = useMemo(
    () => classFunds.filter((fund) => !fund.status || fund.status === "active"),
    [classFunds],
  );
  const expenseFunds = useMemo(
    () => activeFunds.filter((fund) => !isAssetOperationFund(fund)),
    [activeFunds],
  );
  const usableExpenseFunds = useMemo(
    () => expenseFunds.filter(
      (fund) => getAllowedExpenseChannelOptions(fund).length > 0,
    ),
    [expenseFunds],
  );
  const fundsById = useMemo(
    () => new Map(classFunds.map((fund) => [fund.id, fund])),
    [classFunds],
  );
  const pendingUsages = useMemo(
    () =>
      classFundUsages.filter(
        (usage) => usage.settlementStatus === "pending",
      ),
    [classFundUsages],
  );
  const historyUsages = useMemo(
    () =>
      historyFundId
        ? classFundUsages.filter((usage) => usage.fundId === historyFundId)
        : classFundUsages,
    [classFundUsages, historyFundId],
  );
  const historyChannelOptions = useMemo(
    () =>
      Array.from(
        new Set(historyUsages.map((usage) => usage.channel).filter(Boolean)),
      ),
    [historyUsages],
  );
  const filteredHistoryUsages = useMemo(
    () =>
      historyUsages.filter((usage) => {
        if (
          historyChannelFilter !== "all" &&
          usage.channel !== historyChannelFilter
        ) {
          return false;
        }
        if (historyStatusFilter === "all") return true;
        if (historyStatusFilter === "pending") {
          return usage.settlementStatus === "pending";
        }
        if (historyStatusFilter === "cancelled") {
          return usage.cancellationStatus === "cancelled";
        }
        if (historyStatusFilter === "reversal") {
          return (
            usage.cancellationStatus === "reversal" ||
            Boolean(usage.reversalOfUsageId)
          );
        }
        return (
          !usage.cancellationStatus &&
          !usage.reversalOfUsageId &&
          usage.settlementStatus !== "pending"
        );
      }),
    [historyChannelFilter, historyStatusFilter, historyUsages],
  );
  const selectedFund =
    classFunds.find((fund) => fund.id === selectedFundId) ||
    classFunds[0] ||
    null;
  const selectedFundAssetValues = {
    total: getFundPublicValue(selectedFund),
    cash: toNumber(selectedFund?.cashBalance),
    stock: toNumber(selectedFund?.investmentValue),
    realEstate: toNumber(selectedFund?.realEstateValue),
  };

  const openFundAssetPage = (path) => {
    if (!selectedFund || selectedFund.status === "inactive") return;
    if (!isFundMode || activeFundId !== selectedFund.id) {
      startFundMode(selectedFund.id);
    }
    navigate(path);
  };

  const openPensionSettings = () => {
    if (!selectedFund || isInvestmentFund(selectedFund)) return;
    const settings = selectedFund.pensionSettings || {};
    const defaultRate = Number(settings.defaultContributionRate || 5);
    const excluded = new Set(settings.excludedStudentUids || []);
    setPensionForm({
      enabled: selectedFund.fundType === "pension"
        ? settings.enabled === true
        : true,
      defaultContributionRate: String(defaultRate),
      studentRates: Object.fromEntries(
        pensionStudents.map((student) => [
          student.uid,
          String(settings.rateOverrides?.[student.uid] ?? defaultRate),
        ]),
      ),
      participating: Object.fromEntries(
        pensionStudents.map((student) => [student.uid, !excluded.has(student.uid)]),
      ),
    });
    setIsPensionOpen(true);
  };

  const handleSavePensionSettings = async (event) => {
    event.preventDefault();
    if (!selectedFund || isInvestmentFund(selectedFund)) return;

    const defaultRate = Math.max(
      0,
      Math.min(50, Number(pensionForm.defaultContributionRate || 0)),
    );
    if (pensionForm.enabled && defaultRate <= 0) {
      showFeedback("연금 기본 납입률을 입력해 주세요.", "warning");
      return;
    }

    const excludedStudentUids = pensionStudents
      .filter((student) => pensionForm.participating[student.uid] === false)
      .map((student) => student.uid);
    const rateOverrides = Object.fromEntries(
      pensionStudents
        .filter((student) => pensionForm.participating[student.uid] !== false)
        .map((student) => [
          student.uid,
          Math.max(0, Math.min(50, Number(
            pensionForm.studentRates[student.uid] ?? defaultRate,
          ))),
        ])
        .filter(([, rate]) => rate !== defaultRate),
    );
    const participantCount = pensionStudents.length - excludedStudentUids.length;

    setIsPensionBusy(true);
    const result = await updateClassFundPensionSettings({
      classId,
      fundId: selectedFund.id,
      participantCount,
      settings: {
        enabled: pensionForm.enabled,
        defaultContributionRate: defaultRate,
        rateOverrides,
        excludedStudentUids,
      },
    });
    setIsPensionBusy(false);

    if (!result?.success) {
      showFeedback(result?.message || "연금 설정 저장에 실패했습니다.", "error");
      return;
    }
    showFeedback("급여 연동 연금 설정을 저장했습니다.", "success");
    await queryClient.invalidateQueries({
      queryKey: ["tax", "classFunds", classId],
    });
    setIsPensionOpen(false);
  };
  const selectedFundUsages = useMemo(
    () =>
      selectedFund
        ? classFundUsages
            .filter((usage) => usage.fundId === selectedFund.id)
            .slice(0, 8)
        : [],
    [classFundUsages, selectedFund],
  );
  const selectedPendingUsages = useMemo(
    () =>
      selectedFund
        ? pendingUsages.filter((usage) => usage.fundId === selectedFund.id)
        : [],
    [pendingUsages, selectedFund],
  );
  const historyPendingUsages = useMemo(
    () =>
      pendingUsages.filter(
        (usage) => !historyFundId || usage.fundId === historyFundId,
      ),
    [historyFundId, pendingUsages],
  );
  const totalIncome = toNumber(taxSummary?.totalIncome);
  const totalExpense = toNumber(taxSummary?.totalExpense);
  const taxBalance = totalIncome - totalExpense;
  const allocatedFundBalance = classFunds.reduce(
    (sum, fund) => sum + getFundPublicValue(fund),
    0,
  );
  const committedFundBudget = classFunds.reduce(
    (sum, fund) => sum + getCommittedFundBudget(fund),
    0,
  );
  const availableToAllocate = taxBalance - committedFundBudget;
  const allocationTotal = Object.values(allocationDraft).reduce(
    (sum, value) => sum + Math.max(0, Math.round(toNumber(value))),
    0,
  );

  const updateFundForm = (patch) => {
    setFundForm((current) => ({ ...current, ...patch }));
  };

  const handleCreateFund = async (event) => {
    event.preventDefault();
    if (!classId) return;

    const name = fundForm.name.trim();
    if (name.length < 2) {
      showFeedback("기금 이름은 2자 이상 입력해 주세요.", "warning");
      return;
    }

    setIsCreateBusy(true);
    const result = await createClassFund({
      classId,
      name,
      fundType: "general",
      description: fundForm.description,
      allowedChannels: getDefaultFundChannels("general"),
    });
    setIsCreateBusy(false);

    if (!result?.success) {
      showFeedback(result?.message || "기금 생성에 실패했습니다.", "error");
      return;
    }

    showFeedback("기금을 만들었습니다.", "success");
    setIsCreateOpen(false);
    setFundForm({
      name: "",
      description: "",
    });
  };

  const openAllocation = () => {
    setAllocationDraft({});
    setIsAllocationOpen(true);
  };

  const openUsageModal = (fund = null) => {
    const targetFund =
      fund && getAllowedExpenseChannelOptions(fund).length > 0
        ? fund
        : usableExpenseFunds[0];
    const defaultChannel = getAllowedExpenseChannelOptions(targetFund)[0]?.key || "";
    setUsageForm({
      fundId: targetFund?.id || "",
      amount: "",
      channel: defaultChannel,
      description: "",
    });
    setIsUsageOpen(true);
  };

  const openHistoryModal = (fundId = null) => {
    setHistoryFundId(fundId);
    setHistoryChannelFilter("all");
    setHistoryStatusFilter("all");
    setIsHistoryOpen(true);
  };

  const handleAllocate = async () => {
    if (!classId) return;
    const allocations = activeFunds
      .map((fund) => ({
        fundId: fund.id,
        amount: Math.max(0, Math.round(toNumber(allocationDraft[fund.id]))),
      }))
      .filter((entry) => entry.amount > 0);

    if (!allocations.length) {
      showFeedback("배정할 금액을 입력해 주세요.", "warning");
      return;
    }
    if (allocationTotal > availableToAllocate) {
      showFeedback("배정 가능 금액을 초과했습니다.", "warning");
      return;
    }

    setIsAllocateBusy(true);
    const result = await allocateTaxToClassFunds({
      classId,
      allocations,
      description: "예산·기금 탭에서 세금 재정 배정",
    });
    setIsAllocateBusy(false);

    if (!result?.success) {
      showFeedback(result?.message || "예산 배정에 실패했습니다.", "error");
      return;
    }

    showFeedback("예산을 배정했습니다.", "success");
    setIsAllocationOpen(false);
    setAllocationDraft({});
  };

  const handleRecordUsage = async (event) => {
    event.preventDefault();
    if (!classId) return;

    const amount = Math.max(0, Math.round(toNumber(usageForm.amount)));
    if (!usageForm.fundId) {
      showFeedback("사용할 기금을 선택해 주세요.", "warning");
      return;
    }
    if (amount <= 0) {
      showFeedback("사용 금액을 입력해 주세요.", "warning");
      return;
    }

    const fund = fundsById.get(usageForm.fundId);
    if (!fund || isInvestmentFund(fund)) {
      showFeedback("지출형 기금만 사용 기록을 남길 수 있습니다.", "warning");
      return;
    }

    setIsUsageBusy(true);
    const result = await recordClassFundUsage({
      classId,
      fundId: usageForm.fundId,
      amount,
      channel: usageForm.channel,
      description: usageForm.description,
    });
    setIsUsageBusy(false);

    if (!result?.success) {
      showFeedback(result?.message || "기금 사용 기록에 실패했습니다.", "error");
      return;
    }

    showFeedback("기금 사용을 기록했습니다.", "success");
    setIsUsageOpen(false);
    setUsageForm({
      fundId: "",
      amount: "",
      channel: "manualExpense",
      description: "",
    });
  };

  const handleSettlePending = async (targetFundId = null) => {
    if (!classId) return;

    setIsSettleBusy(true);
    const result = await settleClassFundDailyExpenses({
      classId,
      fundId: targetFundId,
    });
    setIsSettleBusy(false);

    if (!result?.success) {
      showFeedback(result?.message || "기존 사용내역 반영에 실패했습니다.", "error");
      return;
    }
    if (!result.settlementCount) {
      showFeedback("장부에 반영할 기존 사용내역이 없습니다.", "info");
      return;
    }

    const suffix = result.hasMore ? " 남은 내역은 한 번 더 반영해 주세요." : "";
    showFeedback(
      `${formatNumber(result.settledTotal)}${currencyUnit}을 장부에 반영했습니다.${suffix}`,
      "success",
    );
  };

  const openCancelModal = (usage) => {
    if (!canCancelClassFundUsage(usage)) return;
    setCancelTarget(usage);
    setCancelReason("");
  };

  const closeCancelModal = () => {
    if (isCancelBusy) return;
    setCancelTarget(null);
    setCancelReason("");
  };

  const handleCancelUsage = async () => {
    if (!classId || !cancelTarget || isCancelBusy) return;
    setIsCancelBusy(true);
    const result = await cancelClassFundUsage({
      classId,
      usageId: cancelTarget.id,
      reason: cancelReason.trim() || "잘못 기록된 거래",
    });
    setIsCancelBusy(false);
    if (!result?.success) {
      showFeedback(result?.message || "기금 거래 취소에 실패했습니다.", "error");
      return;
    }
    if (toNumber(result.debitedAmount) > 0) {
      showFeedback(
        `${formatNumber(result.debitedAmount)}${currencyUnit}을 기금에서 회수하고 거래를 복구했습니다.`,
        "success",
      );
    } else {
      showFeedback(
        `${formatNumber(result.refundedAmount || cancelTarget.cashAmount || cancelTarget.amount)}${currencyUnit}을 기금으로 복구했습니다.`,
        "success",
      );
    }
    closeCancelModal();
  };

  const openEditModal = (fund) => {
    setEditForm({
      name: fund.name || "",
      description: fund.description || "",
      allowedChannels: {
        ...getDefaultFundChannels(fund.fundType),
        ...(fund.allowedChannels || {}),
      },
    });
    setIsEditOpen(true);
  };

  const toggleEditChannel = (key) => {
    if (
      (isInvestmentFund(selectedFund) && key === "stockInvestment") ||
      (selectedFund?.fundType === "pension" &&
        ["stockInvestment", "realEstatePurchase"].includes(key))
    ) return;
    setEditForm((current) => ({
      ...current,
      allowedChannels: {
        ...current.allowedChannels,
        [key]: !current.allowedChannels[key],
      },
    }));
  };

  const handleUpdateFund = async (event) => {
    event.preventDefault();
    if (!selectedFund || editForm.name.trim().length < 2) {
      showFeedback("기금 이름은 2자 이상 입력해 주세요.", "warning");
      return;
    }
    setIsEditBusy(true);
    const result = await updateClassFund({
      classId,
      fundId: selectedFund.id,
      name: editForm.name.trim(),
      description: editForm.description,
      allowedChannels: editForm.allowedChannels,
      status: selectedFund.status || "active",
    });
    setIsEditBusy(false);
    if (!result?.success) {
      showFeedback(result?.message || "기금 수정에 실패했습니다.", "error");
      return;
    }
    showFeedback("기금 정보를 수정했습니다.", "success");
    queryClient.setQueryData(
      ["tax", "classFunds", classId],
      (current = []) => current.map((fund) =>
        fund.id === selectedFund.id
          ? {
              ...fund,
              name: editForm.name.trim(),
              description: editForm.description,
              allowedChannels: editForm.allowedChannels,
              status: selectedFund.status || "active",
            }
          : fund,
      ),
    );
    setIsEditOpen(false);
  };

  const handleToggleFundStatus = async () => {
    if (!selectedFund || isEditBusy) return;
    const nextStatus = selectedFund.status === "inactive" ? "active" : "inactive";
    setIsEditBusy(true);
    const result = await updateClassFund({
      classId,
      fundId: selectedFund.id,
      name: selectedFund.name,
      description: selectedFund.description || "",
      allowedChannels: selectedFund.allowedChannels || getDefaultFundChannels(selectedFund.fundType),
      status: nextStatus,
    });
    setIsEditBusy(false);
    if (!result?.success) {
      showFeedback(result?.message || "기금 상태 변경에 실패했습니다.", "error");
      return;
    }
    queryClient.setQueryData(
      ["tax", "classFunds", classId],
      (current = []) => current.map((fund) =>
        fund.id === selectedFund.id ? { ...fund, status: nextStatus } : fund,
      ),
    );
    if (nextStatus === "inactive" && activeFundId === selectedFund.id) {
      exitFundMode();
    }
    showFeedback(nextStatus === "active" ? "기금을 활성화했습니다." : "기금을 중지했습니다.", "success");
  };

  const openTransferModal = () => {
    const target = activeFunds.find((fund) => fund.id !== selectedFund?.id);
    setTransferForm({ toFundId: target?.id || "", amount: "", description: "" });
    setIsTransferOpen(true);
  };

  const openDeleteModal = () => {
    if (!selectedFund) return;
    const firstDestination = activeFunds.find(
      (fund) => fund.id !== selectedFund.id,
    );
    setDeleteDestinationFundId(firstDestination?.id || "__tax__");
    setIsDeleteOpen(true);
  };

  const handleArchiveFund = async () => {
    if (!selectedFund || isDeleteBusy) return;
    if (selectedFundAssetValues.stock > 0 || selectedFundAssetValues.realEstate > 0) {
      showFeedback("보유 중인 주식과 부동산을 모두 정리한 후 삭제해 주세요.", "warning");
      return;
    }
    if (toNumber(selectedFund.pendingSettlementExpenseTotal) > 0) {
      showFeedback("기존 장부 대기 내역을 먼저 반영한 후 삭제해 주세요.", "warning");
      return;
    }

    setIsDeleteBusy(true);
    const result = await archiveClassFund({
      classId,
      fundId: selectedFund.id,
      destinationFundId:
        selectedFundAssetValues.cash > 0 && deleteDestinationFundId !== "__tax__"
          ? deleteDestinationFundId
          : "",
    });
    setIsDeleteBusy(false);
    if (!result?.success) {
      showFeedback(result?.message || "기금 삭제에 실패했습니다.", "error");
      return;
    }

    const nextFund = classFunds.find((fund) => fund.id !== selectedFund.id);
    if (activeFundId === selectedFund.id) exitFundMode();
    setSelectedFundId(nextFund?.id || null);
    setIsDeleteOpen(false);
    await queryClient.invalidateQueries({
      queryKey: ["tax", "classFunds", classId],
    });
    showFeedback(
      result.movedAmount > 0
        ? `남은 ${formatNumber(result.movedAmount)}${currencyUnit}을 ${result.destinationFundName || "국고"}로 옮기고 기금을 삭제했습니다.`
        : "기금을 삭제했습니다.",
      "success",
    );
  };

  const handleTransferFunds = async (event) => {
    event.preventDefault();
    const amount = Math.max(0, Math.round(toNumber(transferForm.amount)));
    if (!selectedFund || !transferForm.toFundId || amount <= 0) {
      showFeedback("도착 기금과 이체 금액을 확인해 주세요.", "warning");
      return;
    }
    if (amount > toNumber(selectedFund.cashBalance)) {
      showFeedback("출발 기금의 현금 잔액이 부족합니다.", "warning");
      return;
    }
    setIsTransferBusy(true);
    const result = await transferClassFunds({
      classId,
      fromFundId: selectedFund.id,
      toFundId: transferForm.toFundId,
      amount,
      description: transferForm.description.trim() || "기금 간 이체",
    });
    setIsTransferBusy(false);
    if (!result?.success) {
      showFeedback(result?.message || "기금 이체에 실패했습니다.", "error");
      return;
    }
    showFeedback(`${formatNumber(amount)}${currencyUnit}을 이체했습니다.`, "success");
    setIsTransferOpen(false);
  };
  return (
    <div className="space-y-4 xl:space-y-5">
      <h2 className="sr-only">예산·기금</h2>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white lg:flex lg:items-stretch">
        <div className="grid flex-1 sm:grid-cols-3">
          <SummaryTile label="국고 잔액" value={formatNumber(taxBalance)} unit={currencyUnit} />
          <SummaryTile label="기금 총가치" value={formatNumber(allocatedFundBalance)} unit={currencyUnit} />
          <SummaryTile label="배정 가능" value={formatNumber(availableToAllocate)} unit={currencyUnit} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 lg:border-l lg:border-t-0">
          <Button
            type="button"
            tone="blue"
            kind="solid"
            size="sm"
            icon={HandCoins}
            onClick={openAllocation}
            disabled={!activeFunds.length}
          >
            예산 배정
          </Button>
          <Button
            type="button"
            tone="slate"
            kind="outline"
            size="sm"
            icon={Plus}
            onClick={() => setIsCreateOpen(true)}
          >
            기금 만들기
          </Button>
        </div>
      </div>

      <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50/50 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-black text-slate-900">기금 목록</h3>
            <p className="mt-1 text-xs text-slate-500">
              기금을 선택해 잔액과 사용내역을 확인하세요.
            </p>
          </div>
          {isFundsLoading || isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner size="lg" tone="blue" />
            </div>
          ) : classFunds.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm font-bold text-slate-600">등록된 기금이 없습니다.</p>
              <Button
                type="button"
                tone="blue"
                kind="soft"
                size="sm"
                icon={Plus}
                className="mt-3"
                onClick={() => setIsCreateOpen(true)}
              >
                첫 기금 만들기
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {classFunds.map((fund) => {
                const selected = selectedFund?.id === fund.id;
                return (
                  <button
                    key={fund.id}
                    type="button"
                    onClick={() => {
                      setSelectedFundId(fund.id);
                      setIsManagementOpen(false);
                    }}
                    className={
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition " +
                      (selected
                        ? "bg-indigo-50 text-indigo-900"
                        : "text-slate-700 hover:bg-white")
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-black">{fund.name}</span>
                        {isFundMode && activeFundId === fund.id ? (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                            사용 중
                          </span>
                        ) : null}
                        {fund.status === "inactive" ? (
                          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500">중지</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        {getChannelLabels(fund.allowedChannels)}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-sm font-black">
                      {formatNumber(getFundPublicValue(fund))}
                      <span className="ml-0.5 text-xs font-bold text-slate-400">
                        {currencyUnit}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="min-w-0">
          {selectedFund ? (
            <>
              <div className="border-b border-slate-200 px-5 py-5 sm:px-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black text-slate-900">{selectedFund.name}</h3>
                      {selectedFund.pensionSettings?.enabled ? (
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700">
                          급여 연동
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-pressed={selectedFund.status !== "inactive"}
                        aria-label={`기금 상태 ${selectedFund.status === "inactive" ? "중지" : "활성"}. 클릭하여 ${selectedFund.status === "inactive" ? "활성화" : "중지"}`}
                        disabled={isEditBusy}
                        onClick={handleToggleFundStatus}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black transition disabled:cursor-wait disabled:opacity-60 ${
                          selectedFund.status === "inactive"
                            ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            selectedFund.status === "inactive"
                              ? "bg-slate-400"
                              : "bg-emerald-500"
                          }`}
                        />
                        {selectedFund.status === "inactive" ? "중지" : "활성"}
                      </button>
                      {isFundMode && activeFundId === selectedFund.id ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                          현재 사용 중
                        </span>
                      ) : null}
                      {Number(selectedFund.operatorCount || selectedFund.operatorUids?.length || 0) > 0 ? (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">
                          운용 담당 {Number(selectedFund.operatorCount || selectedFund.operatorUids?.length || 0)}명
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      <span title={getChannelLabels(selectedFund.allowedChannels)}>
                        사용처 {getChannelCount(selectedFund.allowedChannels)}개
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:flex-nowrap">
                    {selectedFund.status !== "inactive" && canOperateFund(selectedFund) ? (
                      <Button
                        type="button"
                        tone="emerald"
                        kind={isFundMode && activeFundId === selectedFund.id ? "solid" : "soft"}
                        size="xs"
                        icon={BriefcaseBusiness}
                        onClick={() => startFundMode(selectedFund.id)}
                        disabled={isFundMode && activeFundId === selectedFund.id}
                      >
                        {isFundMode && activeFundId === selectedFund.id
                          ? "기금 사용 중"
                          : "기금 시작"}
                      </Button>
                    ) : null}
                    {selectedFund.status !== "inactive" && getAllowedExpenseChannelOptions(selectedFund).length > 0 ? (
                      <Button
                        type="button"
                        tone="blue"
                        kind="soft"
                        size="xs"
                        icon={ReceiptText}
                        onClick={() => openUsageModal(selectedFund)}
                      >
                        지출 기록
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      tone="slate"
                      kind="outline"
                      size="xs"
                      icon={History}
                      onClick={() => openHistoryModal(selectedFund.id)}
                    >
                      장부
                    </Button>
                    <div
                      className="relative"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          setIsManagementOpen(false);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setIsManagementOpen(false);
                          event.currentTarget.querySelector("button")?.focus();
                        }
                      }}
                    >
                      <Button
                        type="button"
                        tone="slate"
                        kind="soft"
                        size="xs"
                        icon={Settings2}
                        onClick={() => setIsManagementOpen((current) => !current)}
                        aria-expanded={isManagementOpen}
                        aria-haspopup="menu"
                      >
                        관리
                        <ChevronDown className={`ml-1 h-3.5 w-3.5 transition ${isManagementOpen ? "rotate-180" : ""}`} />
                      </Button>
                      {isManagementOpen ? (
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-30 mt-2 w-52 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/70"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                            onClick={() => {
                              setIsManagementOpen(false);
                              openEditModal(selectedFund);
                            }}
                          >
                            <Pencil className="h-4 w-4 text-slate-400" />
                            설정 수정
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-blue-700 transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                            onClick={() => {
                              setIsManagementOpen(false);
                              openOperatorsModal();
                            }}
                          >
                            <Users className="h-4 w-4" />
                            운용 담당자 지정
                          </button>
                          {!isInvestmentFund(selectedFund) ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-violet-700 transition hover:bg-violet-50 focus:bg-violet-50 focus:outline-none"
                              onClick={() => {
                                setIsManagementOpen(false);
                                openPensionSettings();
                              }}
                            >
                              <HandCoins className="h-4 w-4" />
                              급여 연동 연금
                            </button>
                          ) : null}
                          {selectedFund.status !== "inactive" && activeFunds.some((fund) => fund.id !== selectedFund.id) ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-indigo-700 transition hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                              onClick={() => {
                                setIsManagementOpen(false);
                                openTransferModal();
                              }}
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                              기금 이체
                            </button>
                          ) : null}
                          {selectedFund.status !== "inactive" && !isInvestmentFund(selectedFund) && selectedPendingUsages.length > 0 ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-amber-700 transition hover:bg-amber-50 focus:bg-amber-50 focus:outline-none"
                              onClick={() => {
                                setIsManagementOpen(false);
                                handleSettlePending(selectedFund.id);
                              }}
                            >
                              <CalendarCheck className="h-4 w-4" />
                              기존 내역 반영
                            </button>
                          ) : null}
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-rose-700 transition hover:bg-rose-50 focus:bg-rose-50 focus:outline-none"
                            onClick={() => {
                              setIsManagementOpen(false);
                              openDeleteModal();
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            기금 삭제
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {[
                    ["총가치", selectedFundAssetValues.total, "text-indigo-700"],
                    ["현금", selectedFundAssetValues.cash, "text-slate-800"],
                    ["주식", selectedFundAssetValues.stock, "text-emerald-700"],
                    ["부동산", selectedFundAssetValues.realEstate, "text-blue-700"],
                  ].map(([label, value, valueClassName]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
                    >
                      <p className="text-[11px] font-bold text-slate-400">{label}</p>
                      <p className={`mt-0.5 text-sm font-black ${valueClassName}`}>
                        {formatNumber(value)}{currencyUnit}
                      </p>
                    </div>
                  ))}
                </div>
                {(selectedFundAssetValues.stock > 0 || selectedFundAssetValues.realEstate > 0) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedFundAssetValues.stock > 0 ? (
                      <Button
                        type="button"
                        tone="emerald"
                        kind="soft"
                        size="xs"
                        icon={TrendingUp}
                        disabled={selectedFund.status === "inactive"}
                        onClick={() => openFundAssetPage("/stock")}
                      >
                        보유 주식 보기
                      </Button>
                    ) : null}
                    {selectedFundAssetValues.realEstate > 0 ? (
                      <Button
                        type="button"
                        tone="blue"
                        kind="soft"
                        size="xs"
                        icon={Building2}
                        disabled={selectedFund.status === "inactive"}
                        onClick={() => openFundAssetPage("/realestate")}
                      >
                        보유 부동산 보기
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {selectedFund.fundType === "pension" ? (
                  <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-violet-900">급여 연동 연금</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${selectedFund.pensionSettings?.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                            {selectedFund.pensionSettings?.enabled ? "운영 중" : "중지"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-bold text-violet-600">
                          기본급의 {formatNumber(selectedFund.pensionSettings?.defaultContributionRate || 0)}% · 참여 {formatNumber(selectedFund.pensionParticipantCount || 0)}명 · 누적 {formatNumber(selectedFund.pensionContributionTotal || 0)}{currencyUnit}
                        </p>
                      </div>
                      <Button
                        type="button"
                        tone="blue"
                        kind="soft"
                        size="xs"
                        icon={Settings2}
                        onClick={openPensionSettings}
                      >
                        연금 설정
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="p-5 sm:p-7">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-black text-slate-900">최근 사용내역</h4>
                  </div>
                  {selectedPendingUsages.length > 0 ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                      기존 내역 반영 필요
                    </span>
                  ) : null}
                </div>

                {isUsagesLoading ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Spinner size="md" tone="blue" />
                  </div>
                ) : selectedFundUsages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-500">
                    아직 사용내역이 없습니다.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <div className="min-w-[600px]">
                      <div className="grid grid-cols-[90px_minmax(160px,1fr)_100px_110px_90px] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
                        <span>일자</span>
                        <span>내역</span>
                        <span>사용처</span>
                        <span className="text-right">금액</span>
                        <span className="text-right">상태</span>
                      </div>
                      {selectedFundUsages.map((usage) => (
                        <div
                          key={usage.id}
                          className="grid grid-cols-[90px_minmax(160px,1fr)_100px_110px_90px] items-center border-t border-slate-100 px-4 py-3 text-sm"
                        >
                          <span className="text-slate-500">{usage.dateKey || "-"}</span>
                          <span className="truncate font-bold text-slate-800">
                            {usage.description || "기금 사용"}
                          </span>
                          <span className="text-slate-500">
                            {getFundChannelLabel(usage.channel)}
                          </span>
                          <span className="text-right font-black text-slate-900">
                            {usage.direction === "in" ? "+" : "-"}
                            {formatNumber(usage.amount || 0)}
                            <span className="ml-1 text-xs text-slate-400">
                              {currencyUnit}
                            </span>
                          </span>
                          <span className="text-right">
                            <span
                              className={
                                "inline-flex rounded-full px-2 py-1 text-[11px] font-black " +
                                getUsageStatusClassName(usage)
                              }
                            >
                              {getUsageStatusLabel(usage)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-[500px] items-center justify-center p-8 text-center">
              <div>
                <WalletCards className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-500">
                  기금을 만들면 상세 내역이 여기에 표시됩니다.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={isPensionOpen}
        onClose={() => setIsPensionOpen(false)}
        title="급여 연동 연금 설정"
        size="lg"
      >
        <form className={MODAL_BODY_CLASS} onSubmit={handleSavePensionSettings}>
          <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-800">
            급여가 지급될 때 기본급에 납입률을 적용하여 학생 실수령액에서 자동 차감하고 이 연금 기금에 적립합니다.
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span>
                <span className="block text-sm font-black text-slate-800">급여 연동 사용</span>
                <span className="mt-0.5 block text-xs font-medium text-slate-400">월말정산과 별도로 즉시 확정됩니다.</span>
              </span>
              <input
                type="checkbox"
                checked={pensionForm.enabled}
                onChange={(event) => setPensionForm((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))}
                className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black text-slate-500">기본 납입률</span>
              <div className="relative mt-1.5">
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.1"
                  value={pensionForm.defaultContributionRate}
                  onChange={(event) => setPensionForm((current) => ({
                    ...current,
                    defaultContributionRate: event.target.value,
                  }))}
                  className={`${MODAL_FIELD_CLASS} mt-0 pr-8`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">%</span>
              </div>
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-black text-slate-800">학생별 납입률</p>
              <p className="text-xs font-bold text-slate-400">참여 해제 시 급여에서 차감하지 않습니다.</p>
            </div>
            <div className="max-h-[360px] overflow-y-auto rounded-xl border border-slate-200">
              {pensionStudents.map((student) => {
                const participating = pensionForm.participating[student.uid] !== false;
                return (
                  <div
                    key={student.uid}
                    className="grid grid-cols-[minmax(0,1fr)_80px_90px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <span className="truncate text-sm font-bold text-slate-700">{student.name || "학생"}</span>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                      <input
                        type="checkbox"
                        checked={participating}
                        onChange={(event) => setPensionForm((current) => ({
                          ...current,
                          participating: {
                            ...current.participating,
                            [student.uid]: event.target.checked,
                          },
                        }))}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      참여
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="50"
                        step="0.1"
                        disabled={!participating}
                        value={pensionForm.studentRates[student.uid] ?? pensionForm.defaultContributionRate}
                        onChange={(event) => setPensionForm((current) => ({
                          ...current,
                          studentRates: {
                            ...current.studentRates,
                            [student.uid]: event.target.value,
                          },
                        }))}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-1.5 pr-6 text-right text-sm font-bold outline-none focus:border-violet-400 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={MODAL_ACTIONS_CLASS}>
            <Button type="button" tone="slate" kind="soft" onClick={() => setIsPensionOpen(false)}>
              취소
            </Button>
            <Button type="submit" tone="blue" kind="solid" isLoading={isPensionBusy}>
              연금 설정 저장
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isOperatorsOpen}
        onClose={() => setIsOperatorsOpen(false)}
        title="기금 운용 담당자"
        size="md"
      >
        <form className={MODAL_BODY_CLASS} onSubmit={handleSaveOperators}>
          <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <span className="font-black">{selectedFund?.name}</span>의 허용된 사용처에서만
            기금을 운용할 수 있습니다.
          </div>
          <StudentSelector
            label="담당 학생"
            selectedUids={operatorUids}
            onChange={setOperatorUids}
            multiple
            allStudents={pensionStudents}
            disabled={isOperatorsBusy}
          />
          <div className={MODAL_ACTIONS_CLASS}>
            <Button type="button" tone="slate" kind="soft" onClick={() => setIsOperatorsOpen(false)}>
              취소
            </Button>
            <Button type="submit" tone="blue" kind="solid" icon={Users} isLoading={isOperatorsBusy}>
              담당자 저장
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isDeleteOpen}
        onClose={() => {
          if (!isDeleteBusy) setIsDeleteOpen(false);
        }}
        title="기금 삭제"
        size="sm"
      >
        <div className={MODAL_BODY_CLASS}>
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
            <p className="text-sm font-black text-rose-900">
              {selectedFund?.name || "선택한 기금"}
            </p>
            <p className="mt-1 text-xs leading-5 text-rose-700">
              삭제하면 선생님과 학생 화면에서 즉시 사라집니다. 기존 장부는 내부 기록으로 보존됩니다.
            </p>
          </div>

          {selectedFundAssetValues.stock > 0 || selectedFundAssetValues.realEstate > 0 ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
              보유 중인 주식 또는 부동산이 있습니다. 해당 자산을 모두 매도한 후 삭제해 주세요.
            </div>
          ) : toNumber(selectedFund?.pendingSettlementExpenseTotal) > 0 ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
              장부 대기 내역이 있습니다. 기존 내역을 먼저 반영한 후 삭제해 주세요.
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-600">남은 현금</span>
                  <span className="text-base font-black text-slate-900">
                    {formatNumber(selectedFundAssetValues.cash)}{currencyUnit}
                  </span>
                </div>
              </div>
              {selectedFundAssetValues.cash > 0 ? (
                <label className="block">
                  <span className="text-xs font-black text-slate-500">남은 현금을 옮길 곳</span>
                  <select
                    value={deleteDestinationFundId}
                    onChange={(event) => setDeleteDestinationFundId(event.target.value)}
                    className={`${MODAL_FIELD_CLASS} font-bold`}
                  >
                    {activeFunds
                      .filter((fund) => fund.id !== selectedFund?.id)
                      .map((fund) => (
                        <option key={fund.id} value={fund.id}>{fund.name}</option>
                      ))}
                    <option value="__tax__">국고로 반환</option>
                  </select>
                  <span className="mt-2 block text-xs leading-5 text-slate-400">
                    삭제와 잔액 이전은 한 번에 처리됩니다.
                  </span>
                </label>
              ) : null}
            </>
          )}

          <div className={MODAL_ACTIONS_CLASS}>
            <Button
              type="button"
              tone="slate"
              kind="soft"
              onClick={() => setIsDeleteOpen(false)}
              disabled={isDeleteBusy}
            >
              취소
            </Button>
            <Button
              type="button"
              tone="red"
              kind="solid"
              icon={Trash2}
              onClick={handleArchiveFund}
              isLoading={isDeleteBusy}
              disabled={
                selectedFundAssetValues.stock > 0 ||
                selectedFundAssetValues.realEstate > 0 ||
                toNumber(selectedFund?.pendingSettlementExpenseTotal) > 0
              }
            >
              기금 삭제
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="기금 만들기"
        size="md"
      >
        <form className={MODAL_BODY_CLASS} onSubmit={handleCreateFund}>
          <label className="block">
            <span className="text-xs font-black text-slate-500">기금 이름</span>
            <input
              value={fundForm.name}
              onChange={(event) => updateFundForm({ name: event.target.value })}
              className={MODAL_FIELD_CLASS}
              placeholder="예: 2학기 행사기금"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500">설명</span>
            <textarea
              value={fundForm.description}
              onChange={(event) => updateFundForm({ description: event.target.value })}
              className={`${MODAL_FIELD_CLASS} min-h-20`}
              placeholder="이 기금을 어디에 쓸지 간단히 적어 주세요."
            />
          </label>
          <div className={MODAL_ACTIONS_CLASS}>
            <Button
              type="button"
              tone="slate"
              kind="soft"
              onClick={() => setIsCreateOpen(false)}
            >
              취소
            </Button>
            <Button
              type="submit"
              tone="blue"
              kind="solid"
              icon={Plus}
              isLoading={isCreateBusy}
            >
              기금 만들기
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="기금 설정 수정"
        size="md"
      >
        <form className={MODAL_BODY_CLASS} onSubmit={handleUpdateFund}>
          <label className="block">
            <span className="text-xs font-black text-slate-500">기금 이름</span>
            <input
              value={editForm.name}
              onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
              className={MODAL_FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500">설명</span>
            <textarea
              value={editForm.description}
              onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))}
              className={`${MODAL_FIELD_CLASS} min-h-20`}
            />
          </label>
          <div>
            <div className="mb-2 text-xs font-black text-slate-500">사용처</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {FUND_CHANNEL_OPTIONS.filter((option) => {
                if (selectedFund?.fundType === "pension") {
                  return ["stockInvestment", "realEstatePurchase"].includes(option.key);
                }
                if (isInvestmentFund(selectedFund)) {
                  return option.key === "stockInvestment";
                }
                return true;
              }).map((option) => (
                <label key={option.key} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${editForm.allowedChannels[option.key] === true ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700"}`}>
                  <input
                    type="checkbox"
                    checked={editForm.allowedChannels[option.key] === true}
                    onChange={() => toggleEditChannel(option.key)}
                    disabled={
                      (isInvestmentFund(selectedFund) && option.key === "stockInvestment") ||
                      (selectedFund?.fundType === "pension" &&
                        ["stockInvestment", "realEstatePurchase"].includes(option.key))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <div className={MODAL_ACTIONS_CLASS}>
            <Button type="button" tone="slate" kind="soft" onClick={() => setIsEditOpen(false)}>취소</Button>
            <Button type="submit" tone="blue" kind="solid" icon={Pencil} isLoading={isEditBusy}>저장</Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        title="기금 이체"
        size="md"
      >
        <form className={MODAL_BODY_CLASS} onSubmit={handleTransferFunds}>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black text-slate-500">보내는 기금</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="font-black text-slate-900">{selectedFund?.name}</span>
              <span className="text-sm font-black text-indigo-700">
                현금 {formatNumber(selectedFund?.cashBalance || 0)}{currencyUnit}
              </span>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-black text-slate-500">받는 기금</span>
            <select
              value={transferForm.toFundId}
              onChange={(event) => setTransferForm((current) => ({ ...current, toFundId: event.target.value }))}
              className={`${MODAL_FIELD_CLASS} font-bold`}
            >
              {activeFunds.filter((fund) => fund.id !== selectedFund?.id).map((fund) => (
                <option key={fund.id} value={fund.id}>{fund.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500">이체 금액</span>
            <input
              type="number"
              min="1"
              value={transferForm.amount}
              onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))}
              className={`${MODAL_FIELD_CLASS} text-right font-bold`}
              placeholder="0"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500">메모</span>
            <input
              value={transferForm.description}
              onChange={(event) => setTransferForm((current) => ({ ...current, description: event.target.value }))}
              className={MODAL_FIELD_CLASS}
              placeholder="예: 장학기금으로 예산 이동"
            />
          </label>
          <div className={MODAL_ACTIONS_CLASS}>
            <Button type="button" tone="slate" kind="soft" onClick={() => setIsTransferOpen(false)}>취소</Button>
            <Button type="submit" tone="blue" kind="solid" icon={ArrowRightLeft} isLoading={isTransferBusy}>이체</Button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={isAllocationOpen}
        onClose={() => setIsAllocationOpen(false)}
        title="예산 배정"
        size="lg"
      >
        <div className={`${MODAL_BODY_CLASS} overflow-y-auto`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile
              label="국고 잔액"
              value={formatNumber(taxBalance)}
              unit={currencyUnit}
            />
            <SummaryTile
              label="기금 총가치"
              value={formatNumber(allocatedFundBalance)}
              unit={currencyUnit}
            />
            <SummaryTile
              label="배정 가능"
              value={formatNumber(availableToAllocate)}
              unit={currencyUnit}
            />
          </div>

          <div className="rounded-2xl border border-slate-200">
            <div className="grid grid-cols-[1fr_0.8fr_1fr] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
              <div>예산/기금</div>
              <div className="text-right">현재 총가치</div>
              <div className="text-right">배정 금액</div>
            </div>
            {activeFunds.map((fund) => (
              <div
                key={fund.id}
                className="grid grid-cols-[1fr_0.8fr_1fr] items-center border-t border-slate-100 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-black text-slate-900">{fund.name}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fund.pensionSettings?.enabled
                      ? "급여 연동 연금"
                      : getChannelLabels(fund.allowedChannels)}
                  </div>
                </div>
                <div className="text-right text-sm font-bold text-slate-700">
                  {formatNumber(getFundPublicValue(fund))}
                  <span className="ml-1 text-xs text-slate-400">{currencyUnit}</span>
                </div>
                <div className="flex justify-end">
                  <input
                    value={allocationDraft[fund.id] || ""}
                    onChange={(event) =>
                      setAllocationDraft((current) => ({
                        ...current,
                        [fund.id]: event.target.value,
                      }))
                    }
                    inputMode="numeric"
                    className="w-36 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-right text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    placeholder="0"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-black text-slate-500">이번 배정 합계</div>
              <div className="text-xl font-black text-slate-900">
                {formatNumber(allocationTotal)}
                <span className="ml-1 text-sm text-slate-400">{currencyUnit}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                tone="slate"
                kind="soft"
                onClick={() => setIsAllocationOpen(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                tone="blue"
                kind="solid"
                icon={HandCoins}
                onClick={handleAllocate}
                isLoading={isAllocateBusy}
                disabled={allocationTotal <= 0 || allocationTotal > availableToAllocate}
              >
                배정하기
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isUsageOpen}
        onClose={() => setIsUsageOpen(false)}
        title="기금 지출 기록"
        size="md"
      >
        <form className={MODAL_BODY_CLASS} onSubmit={handleRecordUsage}>
          <label className="block">
            <span className="text-xs font-black text-slate-500">기금</span>
            <select
              value={usageForm.fundId}
              onChange={(event) =>
                setUsageForm((current) => {
                  const nextFund = fundsById.get(event.target.value);
                  return {
                    ...current,
                    fundId: event.target.value,
                    channel: getAllowedExpenseChannelOptions(nextFund)[0]?.key || "",
                  };
                })
              }
              className={MODAL_FIELD_CLASS}
            >
              {usableExpenseFunds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name} · 잔액 {formatNumber(fund.cashBalance || 0)}
                  {currencyUnit}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black text-slate-500">지출 금액</span>
              <input
                value={usageForm.amount}
                onChange={(event) =>
                  setUsageForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                inputMode="numeric"
                className={`${MODAL_FIELD_CLASS} text-right font-bold`}
                placeholder="0"
              />
            </label>

            <label className="block">
              <span className="text-xs font-black text-slate-500">사용처</span>
              <select
                value={usageForm.channel}
                onChange={(event) =>
                  setUsageForm((current) => ({
                    ...current,
                    channel: event.target.value,
                  }))
                }
                className={MODAL_FIELD_CLASS}
              >
                {getAllowedExpenseChannelOptions(
                  fundsById.get(usageForm.fundId),
                ).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-black text-slate-500">내용</span>
            <textarea
              value={usageForm.description}
              onChange={(event) =>
                setUsageForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className={`${MODAL_FIELD_CLASS} min-h-20`}
              placeholder="예: 학급 행사 물품 구입"
            />
          </label>

          <div className="rounded-2xl bg-blue-50 p-4 text-sm font-bold leading-6 text-blue-800">
            기록하면 기금 현금과 국고 장부에 바로 반영됩니다.
          </div>

          <div className={MODAL_ACTIONS_CLASS}>
            <Button
              type="button"
              tone="slate"
              kind="soft"
              onClick={() => setIsUsageOpen(false)}
            >
              취소
            </Button>
            <Button
              type="submit"
              tone="blue"
              kind="solid"
              icon={ReceiptText}
              isLoading={isUsageBusy}
              disabled={!usableExpenseFunds.length || !usageForm.channel}
            >
              기록하기
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        title={historyFundId ? "기금 장부" : "전체 기금 장부"}
        size="lg"
      >
        <div className={MODAL_BODY_CLASS}>
          {historyPendingUsages.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black text-amber-700">기존 장부 대기</div>
                <div className="text-xl font-black text-slate-900">
                  {formatNumber(historyPendingUsages.reduce((sum, usage) => sum + toNumber(usage.amount), 0))}
                  <span className="ml-1 text-sm text-slate-400">{currencyUnit}</span>
                </div>
              </div>
              <Button
                type="button"
                tone="emerald"
                kind="solid"
                icon={CalendarCheck}
                onClick={() => handleSettlePending(historyFundId)}
                isLoading={isSettleBusy}
              >
                기존 내역 반영
              </Button>
            </div>
          ) : null}

          <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
            <label className="block">
              <span className="sr-only">장부 사용처 필터</span>
              <select
                value={historyChannelFilter}
                onChange={(event) => setHistoryChannelFilter(event.target.value)}
                className={`${MODAL_FIELD_CLASS} font-bold text-slate-700`}
              >
                <option value="all">모든 사용처</option>
                {historyChannelOptions.map((channel) => (
                  <option key={channel} value={channel}>
                    {getFundChannelLabel(channel)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">장부 상태 필터</span>
              <select
                value={historyStatusFilter}
                onChange={(event) => setHistoryStatusFilter(event.target.value)}
                className={`${MODAL_FIELD_CLASS} font-bold text-slate-700`}
              >
                <option value="all">모든 상태</option>
                <option value="reflected">정상 반영</option>
                <option value="pending">장부 대기</option>
                <option value="cancelled">취소됨</option>
                <option value="reversal">취소 복구</option>
              </select>
            </label>
          </div>

          {isUsagesLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Spinner size="md" tone="blue" />
            </div>
          ) : historyUsages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">
              사용내역이 없습니다.
            </div>
          ) : filteredHistoryUsages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">
              조건에 맞는 내역이 없습니다.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-2xl border border-slate-200">
              <div className="grid min-w-[760px] grid-cols-[0.8fr_1fr_0.9fr_0.8fr_0.8fr_0.7fr] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
                <div>날짜</div>
                <div>기금</div>
                <div>사용처</div>
                <div className="text-right">금액</div>
                <div className="text-right">상태</div>
                <div className="text-right">관리</div>
              </div>
              {filteredHistoryUsages.map((usage) => (
                <div
                  key={usage.id}
                  className="grid min-w-[760px] grid-cols-[0.8fr_1fr_0.9fr_0.8fr_0.8fr_0.7fr] items-center border-t border-slate-100 px-4 py-3 text-sm"
                >
                  <div className="text-slate-500">{usage.dateKey || "-"}</div>
                  <div>
                    <div className="font-black text-slate-900">
                      {usage.fundName || fundsById.get(usage.fundId)?.name || "-"}
                    </div>
                    {usage.description ? (
                      <div className="mt-1 truncate text-xs text-slate-400">
                        {usage.description}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-slate-600">
                    {getFundChannelLabel(usage.channel)}
                  </div>
                  <div className="text-right font-black text-slate-900">
                    {usage.direction === "in" ? "+" : "-"}
                    {formatNumber(usage.amount || 0)}
                    <span className="ml-1 text-xs text-slate-400">
                      {currencyUnit}
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-[11px] font-black",
                        getUsageStatusClassName(usage),
                      ].join(" ")}
                    >
                      {getUsageStatusLabel(usage)}
                    </span>
                  </div>
                  <div className="text-right">
                    {canCancelClassFundUsage(usage) ? (
                      <Button
                        type="button"
                        tone="red"
                        kind="ghost"
                        size="sm"
                        icon={RotateCcw}
                        onClick={() => openCancelModal(usage)}
                      >
                        취소
                      </Button>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-400">
                        {usage.settlementStatus === "not_applicable"
                          ? "거래 화면 정정"
                          : "-"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={!!cancelTarget}
        onClose={closeCancelModal}
        title="기금 거래 취소"
        size="sm"
      >
        <div className={MODAL_BODY_CLASS}>
          <div className="rounded-2xl bg-rose-50 p-4">
            <p className="text-sm font-black text-rose-900">
              {cancelTarget?.description || "기금 사용"}
            </p>
            <p className="mt-2 text-xl font-black text-rose-700">
              {formatNumber(cancelTarget?.cashAmount || cancelTarget?.amount || 0)}
              <span className="ml-1 text-sm">{currencyUnit}</span>
            </p>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            원래 기록은 삭제하지 않고 취소됨으로 남깁니다. 반대 방향의 복구
            기록을 추가하고 기금 잔액과 국고 장부를 함께 되돌립니다.
          </p>
          {cancelTarget?.relatedPayoutId ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              학생에게 지급된 금액도 함께 회수합니다. 학생 잔액이 부족하면
              취소되지 않습니다.
            </p>
          ) : null}
          {cancelTarget?.source === "store_pos" ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              학생 보유 상품, 상점 재고, 구매 횟수도 함께 복구합니다. 이미
              사용한 상품이 포함되어 있으면 취소되지 않습니다.
            </p>
          ) : null}
          {cancelTarget?.relatedRealEstateLedgerId ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              현재 소유권과 국고·취득세·양도세 기록을 함께 확인해 복구합니다.
              이후 거래나 진행 중인 계약이 있으면 취소되지 않습니다.
            </p>
          ) : null}
          {cancelTarget?.relatedTradeId &&
          cancelTarget?.channel === "stockInvestment" ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              같은 종목의 이후 거래가 없을 때만 현금·보유수량·취득원가·수수료를
              원거래 기준으로 되돌립니다.
            </p>
          ) : null}
          <label className="block">
            <span className="text-xs font-black text-slate-500">취소 사유</span>
            <input
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              maxLength={300}
              className={`${MODAL_FIELD_CLASS} focus:border-rose-400 focus:ring-rose-100`}
              placeholder="예: 금액을 잘못 입력함"
            />
          </label>
          <div className={MODAL_ACTIONS_CLASS}>
            <Button type="button" tone="slate" kind="soft" onClick={closeCancelModal} disabled={isCancelBusy}>
              취소
            </Button>
            <Button type="button" tone="red" kind="solid" icon={RotateCcw} onClick={handleCancelUsage} isLoading={isCancelBusy}>
              거래 취소
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const SummaryTile = ({ label, value, unit }) => (
  <div className="border-b border-slate-100 p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
    <div className="text-xs font-black text-slate-500">{label}</div>
    <div className="mt-2 text-xl font-black text-slate-900">
      {value}
      {unit ? <span className="ml-1 text-sm text-slate-400">{unit}</span> : null}
    </div>
  </div>
);
