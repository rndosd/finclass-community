const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const { readRealEstateLayout, stageRealEstateLayout, runRealEstateTransaction } = require("../utils/realEstateStorage");
const { runExpiredRentBulkReset } = require("../utils/expiredRentBulkSettlement");
const { FieldValue } = admin.firestore;

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const { stageTaxIncome } = require("../utils/taxIncome");
const { stageTaxExpense } = require("../utils/taxExpense");
const { stageActivityLog } = require("../utils/logUtils");
const {
    assertCanOperateClassFund,
    mustBeTeacherOrTaxAdmin,
} = require("../utils/permissions");
const { getGlobalConfig } = require("../utils/planManager");
const { getTaxBillLateFeePolicy } = require("../utils/taxPolicy");
const {
    buildRealEstateRentIncomeTaxSnapshot,
} = require("../utils/realEstateIncomeTax");
const {
    calculateCumulativeRentCharge,
    calculateInitialPrepaidDays,
    calculateUnusedPrepaidRent,
} = require("../utils/rentContractPolicy");
const { getClassFundChannelAccess } = require("../utils/classFundPolicy");
const {
    stageImmediateClassFundExpense,
} = require("../utils/classFundExpenseRecording");
const {
    CLASS_FUND_TAX_EXPENSE_RECORDING_OPTIONS,
    CLASS_FUND_TAX_INCOME_RECORDING_OPTIONS,
    buildClassFundPurchaseAccounting,
    buildClassFundPurchaseQuote,
    buildClassFundSaleAccounting,
    buildClassFundSaleQuote,
    getClassFundOwnerId,
    isClassFundOwnedDesk,
} = require("../utils/classFundRealEstatePolicy");
const {
    buildClassFundRealEstateCancellationAccounting,
} = require("../utils/classFundRealEstateCancellation");
const {
    addCalendarDaysInKST,
    endOfDayInKST,
    formatDateKeyInKST,
    parseDateKeyAsKST,
    startOfDayInKST,
    toDate,
} = require("../utils/dateUtils");

const REAL_ESTATE_ADMIN_TOKEN_KEY = "a_rst";
const TAX_LINE_COLLECTION = "lines";
const SALE_CONTRACT_CONFIRMATION_TEXT = "위 계약 내용을 확인했습니다.";
const SALE_CONTRACT_REVIEW_CHECKLIST_IDS = {
    seller: ["seller-desk", "seller-settlement", "seller-transfer"],
    buyer: ["buyer-desk", "buyer-payment", "buyer-transfer"],
};

const toSafeId = (value, fallback = "na") => {
    const normalized = String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || fallback;
};

const createRentContractId = () => `rent_contract_${db.collection("_").doc().id}`;

const resolveAggregateBatchKey = (data, fallbackSeed) =>
    toSafeId(
        data?.aggregateBatchKey ||
            data?.clientRequestId ||
            data?.requestId ||
            fallbackSeed ||
            db.collection("_").doc().id,
    );

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

const normalizeDeskLabelToken = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value).trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    if (lower === "undefined" || lower === "null" || lower === "nan") return "";
    return text;
};

const getResolvedDeskLabel = (desk) => {
    const label = normalizeDeskLabelToken(desk?.label);
    if (label) return label;

    const number = normalizeDeskLabelToken(desk?.number);
    if (number) return `${number}번 자리`;

    return "이름 없는 자리";
};

const getClassDisplayName = (classData = {}) =>
    String(
        classData?.className ||
            classData?.name ||
            classData?.title ||
            "학급",
    ).trim() || "학급";

const normalizeContractConfirmationText = (value) =>
    String(value || "").replace(/\s+/g, " ").trim();

const normalizePurchaseRequests = (requests) => {
    if (!Array.isArray(requests)) return [];

    const seenBuyerIds = new Set();
    return requests.reduce((normalized, request) => {
        const buyerId = String(request?.buyerId || request?.uid || "").trim();
        if (!buyerId || seenBuyerIds.has(buyerId)) return normalized;

        seenBuyerIds.add(buyerId);
        normalized.push({
            buyerId,
            buyerName: String(request?.buyerName || request?.name || "익명").trim() || "익명",
            requestedAt: request?.requestedAt || null,
        });
        return normalized;
    }, []);
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HOLDING_TAX_PERIOD_DAYS = 28;
const DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS = 3;
const RENT_DAYS_PER_WEEK = 7;
const RENT_DEPOSIT_STATUS = {
    NOT_REQUIRED: "not_required",
    PENDING: "pending",
    PAID: "paid",
    RETURN_PENDING: "return_pending",
    SETTLED: "settled",
};
const RENT_CONTRACT_STATUS = {
    PENDING_PAYMENT: "pending_payment",
    ACTIVE: "active",
};
const HOLDING_TAX_BILL_KIND = "realestate_holding";
const HOLDING_TAX_STATUS_COLLECTION_PATH = (classId) =>
    `classes/${classId}/real_estate/holding_tax_status/byStudent`;
const HOLDING_TAX_STATUS_DOC_PATH = (classId, studentUid) =>
    `${HOLDING_TAX_STATUS_COLLECTION_PATH(classId)}/${studentUid}`;

const buildHoldingTaxPeriodKey = (periodStart, periodEnd) =>
    `${formatDateKeyInKST(periodStart)}__${formatDateKeyInKST(periodEnd)}`;

const isHoldingTaxBillPaid = (bill = {}) =>
    bill?.isPaid === true ||
    String(bill?.status || "").toLowerCase() === "paid";

const buildHoldingTaxStatusBillSummary = (billId, billData = {}) => ({
    id: billId,
    periodKey:
        typeof billData?.periodKey === "string" && billData.periodKey.trim()
            ? billData.periodKey.trim()
            : null,
    amount: Math.max(0, Number(billData?.amount || 0)),
    issuedAt: billData?.issuedAt || billData?.createdAt || null,
    dueDate: billData?.dueDate || null,
    status:
        typeof billData?.status === "string" && billData.status.trim()
            ? billData.status.trim()
            : isHoldingTaxBillPaid(billData)
                ? "paid"
                : "pending",
    isPaid: isHoldingTaxBillPaid(billData),
});

const getHoldingTaxStatusBillSortMs = (billSummary = {}) =>
    toDate(billSummary?.issuedAt)?.getTime() ||
    toDate(billSummary?.dueDate)?.getTime() ||
    0;

const recomputeHoldingTaxStatusSummary = async (classId, studentUid) => {
    if (!classId || !studentUid) return;

    const summaryRef = db.doc(HOLDING_TAX_STATUS_DOC_PATH(classId, studentUid));
    const billsSnap = await db
        .collection(`classes/${classId}/students/${studentUid}/taxBills`)
        .where("billKind", "==", HOLDING_TAX_BILL_KIND)
        .get();

    const billsByPeriod = {};
    let overdueBill = null;
    const nowMs = Date.now();

    billsSnap.forEach((docSnap) => {
        const billSummary = buildHoldingTaxStatusBillSummary(
            docSnap.id,
            docSnap.data() || {},
        );
        const sortMs = getHoldingTaxStatusBillSortMs(billSummary);

        if (billSummary.periodKey) {
            const currentPeriodBill = billsByPeriod[billSummary.periodKey];
            if (
                !currentPeriodBill ||
                sortMs > getHoldingTaxStatusBillSortMs(currentPeriodBill)
            ) {
                billsByPeriod[billSummary.periodKey] = billSummary;
            }
        }

        if (billSummary.isPaid) return;

        const dueMs = toDate(billSummary.dueDate)?.getTime() || 0;
        if (dueMs <= 0 || dueMs >= nowMs) return;

        if (!overdueBill || sortMs > getHoldingTaxStatusBillSortMs(overdueBill)) {
            overdueBill = billSummary;
        }
    });

    if (Object.keys(billsByPeriod).length === 0 && !overdueBill) {
        await summaryRef.delete();
        return;
    }

    await summaryRef.set(
        {
            studentUid,
            billsByPeriod,
            overdueBill: overdueBill || null,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
};

const countInclusiveDaysInKST = (startValue, endValue) => {
    const start = startOfDayInKST(startValue);
    const end = startOfDayInKST(endValue);
    if (!start || !end || start.getTime() > end.getTime()) return 0;
    return Math.floor((end.getTime() - start.getTime()) / ONE_DAY_MS) + 1;
};

const countExclusiveDaysInKST = (startValue, endValue) => {
    const start = startOfDayInKST(startValue);
    const end = startOfDayInKST(endValue);
    if (!start || !end || end.getTime() <= start.getTime()) return 0;
    return Math.floor((end.getTime() - start.getTime()) / ONE_DAY_MS);
};

const toWholeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.floor(numeric) : 0;
};

const calculateRentAmountFromDays = (weeklyRent, days) => {
    const safeWeeklyRent = Math.max(0, toWholeNumber(weeklyRent));
    const safeDays = Math.max(0, toWholeNumber(days));
    if (safeWeeklyRent <= 0 || safeDays <= 0) return 0;
    return Math.floor((safeWeeklyRent * safeDays) / RENT_DAYS_PER_WEEK);
};

const getPaymentDaysFromRecord = (record) => {
    const explicitDays = Math.max(0, toWholeNumber(record?.days));
    if (explicitDays > 0) return explicitDays;

    const weeks = Math.max(0, toWholeNumber(record?.weeks));
    if (weeks > 0) return weeks * RENT_DAYS_PER_WEEK;

    const coverageStartAt = startOfDayInKST(toDate(record?.coverageStartAt));
    const coverageEndAt = startOfDayInKST(toDate(record?.coverageEndAt));
    if (coverageStartAt && coverageEndAt) {
        return countExclusiveDaysInKST(coverageStartAt, coverageEndAt);
    }
    return 0;
};

const buildPaymentCoverageWindow = (record) => {
    const totalDays = getPaymentDaysFromRecord(record);
    let coverageStartDate = startOfDayInKST(toDate(record?.coverageStartAt));
    let coverageEndDate = startOfDayInKST(toDate(record?.coverageEndAt || record?.validUntil));

    if (!coverageStartDate && coverageEndDate && totalDays > 0) {
        coverageStartDate = addCalendarDaysInKST(coverageEndDate, -totalDays);
    }

    if (coverageStartDate && !coverageEndDate && totalDays > 0) {
        coverageEndDate = addCalendarDaysInKST(coverageStartDate, totalDays);
    }

    return {
        coverageStartDate,
        coverageEndDate,
        totalDays,
    };
};

const calculatePaymentAmountForDays = ({ record, days, fallbackWeeklyRent = 0 }) => {
    const safeDays = Math.max(0, toWholeNumber(days));
    if (safeDays <= 0) return 0;

    const weeklyRent = Math.max(
        0,
        toWholeNumber(record?.rateSnapshot?.weeklyRent || fallbackWeeklyRent),
    );
    if (weeklyRent > 0) {
        return calculateRentAmountFromDays(weeklyRent, safeDays);
    }

    const totalDays = Math.max(0, getPaymentDaysFromRecord(record));
    const totalAmount = Math.max(0, Number(record?.amount || 0));
    if (totalDays <= 0 || totalAmount <= 0) return 0;
    return Math.floor(totalAmount * (safeDays / totalDays));
};

const calculateContractOverlapPaymentSummary = ({
    paymentRecords,
    tenantId,
    contractStartDate,
    contractLastDate,
    fallbackWeeklyRent = 0,
}) => {
    const normalizedTenantId = String(tenantId || "").trim();
    if (!normalizedTenantId || !contractStartDate || !contractLastDate) {
        return {
            paidDays: 0,
            paidAmount: 0,
        };
    }

    const contractEndExclusive = addCalendarDaysInKST(contractLastDate, 1);

    return (paymentRecords || []).reduce((summary, record) => {
        if (String(record?.tenantId || "") !== normalizedTenantId) return summary;

        const {
            coverageStartDate,
            coverageEndDate,
            totalDays,
        } = buildPaymentCoverageWindow(record);

        if (!coverageStartDate || !coverageEndDate || totalDays <= 0) {
            return summary;
        }

        const overlapStart = startOfDayInKST(
            coverageStartDate.getTime() < contractStartDate.getTime()
                ? contractStartDate
                : coverageStartDate,
        );
        const overlapEnd = startOfDayInKST(
            coverageEndDate.getTime() > contractEndExclusive.getTime()
                ? contractEndExclusive
                : coverageEndDate,
        );
        const overlapDays = countExclusiveDaysInKST(overlapStart, overlapEnd);
        if (overlapDays <= 0) return summary;

        return {
            paidDays: summary.paidDays + overlapDays,
            paidAmount: summary.paidAmount + calculatePaymentAmountForDays({
                record,
                days: overlapDays,
                fallbackWeeklyRent,
            }),
        };
    }, {
        paidDays: 0,
        paidAmount: 0,
    });
};

const buildDeskRentPaymentSnapshot = (desk, paymentRecords) => {
    const currentTenantId = String(desk?.studentId || "").trim();
    const currentContractId = String(desk?.rentContractId || "").trim();
    const contractStartDate = startOfDayInKST(toDate(desk?.rentStartAt));
    const contractLastDate = startOfDayInKST(toDate(desk?.rentLastDateAt));
    const fallbackWeeklyRent = getDeskWeeklyRentAmount(desk);

    if (!currentTenantId) {
        return {
            paidDays: 0,
            paidAmount: 0,
            paidUntil: null,
        };
    }

    if (contractStartDate && contractLastDate) {
        const exactContractSummary = currentContractId
            ? (paymentRecords || []).reduce((summary, record) => {
                if (String(record?.contractId || "").trim() !== currentContractId) {
                    return summary;
                }

                return {
                    paidDays: summary.paidDays + getPaymentDaysFromRecord(record),
                    paidAmount: summary.paidAmount + Math.max(0, Number(record?.amount || 0)),
                };
            }, {
                paidDays: 0,
                paidAmount: 0,
            })
            : {
                paidDays: 0,
                paidAmount: 0,
            };
        const overlapSummary = calculateContractOverlapPaymentSummary({
            paymentRecords: (paymentRecords || []).filter(
                (record) => !String(record?.contractId || "").trim(),
            ),
            tenantId: currentTenantId,
            contractStartDate,
            contractLastDate,
            fallbackWeeklyRent,
        });
        const paidDays = exactContractSummary.paidDays + overlapSummary.paidDays;
        const paidAmount = exactContractSummary.paidAmount + overlapSummary.paidAmount;

        return {
            paidDays,
            paidAmount,
            paidUntil: paidDays > 0
                ? addCalendarDaysInKST(contractStartDate, paidDays)
                : null,
        };
    }

    const relevantPayments = (paymentRecords || [])
        .filter((record) => String(record?.tenantId || "") === currentTenantId);
    const paidDays = relevantPayments.reduce(
        (sum, record) => sum + getPaymentDaysFromRecord(record),
        0,
    );
    const paidAmount = relevantPayments.reduce(
        (sum, record) => sum + Math.max(0, Number(record?.amount || 0)),
        0,
    );
    const paidUntil = relevantPayments.reduce((latest, record) => {
        const coverageEndDate = startOfDayInKST(toDate(record?.coverageEndAt || record?.validUntil));
        if (!coverageEndDate) return latest;
        if (!latest || coverageEndDate.getTime() > latest.getTime()) return coverageEndDate;
        return latest;
    }, null);

    return {
        paidDays,
        paidAmount,
        paidUntil,
    };
};

const resolveTrackedPaidDays = (desk, contractStartDate) => {
    const explicitPaidDays = Math.max(0, toWholeNumber(desk?.rentPaidDays));
    if (explicitPaidDays > 0) return explicitPaidDays;

    const paidUntilDate = startOfDayInKST(toDate(desk?.rentPaidUntil));
    if (!contractStartDate || !paidUntilDate) return 0;
    return countExclusiveDaysInKST(contractStartDate, paidUntilDate);
};

const buildRentContractContext = (desk) => {
    const contractStartDate = startOfDayInKST(toDate(desk?.rentStartAt));
    const contractLastDate = startOfDayInKST(toDate(desk?.rentLastDateAt));
    const studentId = String(desk?.studentId || "").trim();
    const rentTenantId = String(desk?.rentTenantId || "").trim();
    const hasConfiguredContract = Boolean(
        contractStartDate &&
        contractLastDate &&
        studentId &&
        rentTenantId &&
        studentId === rentTenantId,
    );

    const paidDays = hasConfiguredContract
        ? resolveTrackedPaidDays(desk, contractStartDate)
        : 0;
    const paidAmount = Math.max(
        0,
        Number(desk?.rentPaidAmount || calculateRentAmountFromDays(desk?.weeklyRent || desk?.rentPrice || 0, paidDays)),
    );

    return {
        hasConfiguredContract,
        contractStartDate,
        contractLastDate,
        totalContractDays: hasConfiguredContract
            ? countInclusiveDaysInKST(contractStartDate, contractLastDate)
            : 0,
        paidDays,
        paidAmount,
    };
};

const getRentDepositSnapshot = (desk = {}) => {
    const amount = Math.max(0, toWholeNumber(desk?.rentDepositAmount));
    const paidAmount = Math.max(0, toWholeNumber(desk?.rentDepositPaidAmount));
    const returnedAmount = Math.max(0, toWholeNumber(desk?.rentDepositReturnedAmount));
    const deductedAmount = Math.max(0, toWholeNumber(desk?.rentDepositDeductedAmount));
    const outstandingAmount = Math.max(0, paidAmount - returnedAmount - deductedAmount);
    const status = String(desk?.rentDepositStatus || "").trim() || (
        amount <= 0
            ? RENT_DEPOSIT_STATUS.NOT_REQUIRED
            : paidAmount > 0
                ? RENT_DEPOSIT_STATUS.PAID
                : RENT_DEPOSIT_STATUS.PENDING
    );

    return {
        amount,
        paidAmount,
        returnedAmount,
        deductedAmount,
        outstandingAmount,
        status,
    };
};

const getRentContractLifecycleStatus = (desk = {}) => {
    const explicitStatus = String(desk?.rentContractStatus || "").trim();
    if (explicitStatus === RENT_CONTRACT_STATUS.ACTIVE) return explicitStatus;
    if (explicitStatus === RENT_CONTRACT_STATUS.PENDING_PAYMENT) return explicitStatus;

    const deposit = getRentDepositSnapshot(desk);
    return deposit.amount > 0 && deposit.status !== RENT_DEPOSIT_STATUS.PAID
        ? RENT_CONTRACT_STATUS.PENDING_PAYMENT
        : RENT_CONTRACT_STATUS.ACTIVE;
};

const calculateRentDepositUnpaidAmount = (desk, asOfDate = new Date()) => {
    const contract = buildRentContractContext(desk);
    if (!contract.hasConfiguredContract) return 0;

    const normalizedAsOf = startOfDayInKST(asOfDate);
    const accruedEndDate = normalizedAsOf && normalizedAsOf.getTime() < contract.contractLastDate.getTime()
        ? normalizedAsOf
        : contract.contractLastDate;
    const accruedDays = Math.max(
        0,
        Math.min(
            contract.totalContractDays,
            countInclusiveDaysInKST(contract.contractStartDate, accruedEndDate),
        ),
    );
    const accruedAmount = calculateRentAmountFromDays(
        desk?.weeklyRent || desk?.rentPrice || 0,
        accruedDays,
    );
    return Math.max(0, accruedAmount - contract.paidAmount);
};

const clearDeskRentContract = (desk, nextWeeklyRent = 0) => ({
    ...desk,
    weeklyRent: Math.max(0, toWholeNumber(nextWeeklyRent)),
    rentContractId: null,
    rentStartAt: null,
    rentLastDateAt: null,
    rentTenantId: null,
    rentTenantName: null,
    rentPaidUntil: null,
    rentPaidDays: 0,
    rentPaidAmount: 0,
    rentPaidWithheldTaxAmount: 0,
    rentDepositAmount: 0,
    rentDepositStatus: RENT_DEPOSIT_STATUS.NOT_REQUIRED,
    rentDepositPaidAmount: 0,
    rentDepositReturnedAmount: 0,
    rentDepositDeductedAmount: 0,
    rentDepositPaidAt: null,
    rentDepositReturnedAt: null,
    rentDepositSettlementReason: null,
    rentContractStatus: null,
    rentActivatedAt: null,
    rentInitialPaymentDays: 0,
    rentInitialPaymentAmount: 0,
});

const buildUpdatedRentContractDesk = async ({
    transaction,
    classId,
    config,
    targetDesk,
    actorUid,
    canManageClass,
    payload = {},
}) => {
    const isOwner = targetDesk.ownerId === actorUid;
    const canManageRent = isOwner || canManageClass;
    if (!canManageRent) {
        throw new HttpsError(
            "permission-denied",
            "임대료는 소유자 또는 담당 교사만 설정할 수 있습니다.",
        );
    }

    const weeklyRent = Math.max(0, parseInt(payload.weeklyRent, 10) || 0);
    const hasDepositAmountPayload = Object.prototype.hasOwnProperty.call(payload, "depositAmount");
    const depositAmount = hasDepositAmountPayload
        ? Math.max(0, parseInt(payload.depositAmount, 10) || 0)
        : Math.max(0, toWholeNumber(targetDesk?.rentDepositAmount));
    const existingDeposit = getRentDepositSnapshot(targetDesk);
    const currentWeeklyRent = Math.max(
        0,
        parseInt(targetDesk.weeklyRent || targetDesk.rentPrice || 0, 10) || 0,
    );
    const today = startOfDayInKST(new Date());
    const existingRentStartDate = startOfDayInKST(toDate(targetDesk.rentStartAt));
    const existingLifecycleStatus = getRentContractLifecycleStatus(targetDesk);
    const existingRentLastDate = startOfDayInKST(toDate(targetDesk.rentLastDateAt));
    const isExpiredActiveContract = Boolean(
        targetDesk.rentContractId &&
        existingLifecycleStatus === RENT_CONTRACT_STATUS.ACTIVE &&
        existingRentLastDate && existingRentLastDate.getTime() < today.getTime(),
    );
    if (isExpiredActiveContract) {
        const previousContract = buildRentContractContext(targetDesk);
        const accruedAmount = calculateRentAmountFromDays(currentWeeklyRent, previousContract.totalContractDays);
        if (previousContract.paidAmount < accruedAmount) {
            throw new HttpsError("failed-precondition", "종료된 계약의 미납 임대료를 먼저 납부해 주세요.");
        }
        if (previousContract.paidAmount > accruedAmount) {
            throw new HttpsError("failed-precondition", "종료된 계약에 반환할 임대료가 남아 있습니다. 계약 종료 기능으로 먼저 정산해 주세요.");
        }
    }

    if (config.rentLimitEnabled === true) {
        const rentLimitRate = Number(config.rentLimitRate || 0);
        const officialPrice = Number(targetDesk.price || 0);
        const maxRent = Math.floor(Math.max(0, officialPrice) * (rentLimitRate / 100));
        if (weeklyRent > maxRent) {
            throw new HttpsError(
                "failed-precondition",
                `임대료 상한(${maxRent.toLocaleString()})을 초과했습니다.`,
            );
        }
    }

    if (weeklyRent <= 0) {
        if (
            targetDesk?.rentContractId &&
            existingLifecycleStatus === RENT_CONTRACT_STATUS.ACTIVE &&
            !isExpiredActiveContract
        ) {
            throw new HttpsError(
                "failed-precondition",
                "시작된 계약은 임대료를 0으로 덮어쓸 수 없습니다. 계약 종료 기능을 이용해 주세요.",
            );
        }
        if (existingDeposit.outstandingAmount > 0) {
            throw new HttpsError(
                "failed-precondition",
                "반환할 보증금이 남아 있어 계약을 해제할 수 없습니다. 보증금을 먼저 정산해 주세요.",
            );
        }
        return clearDeskRentContract(targetDesk, 0);
    }

    if (!targetDesk.studentId) {
        throw new HttpsError(
            "failed-precondition",
            "현재 입주자가 있는 자리에서만 임대 계약을 등록할 수 있습니다.",
        );
    }

    const rentStartDateKey =
        typeof payload.rentStartDateKey === "string"
            ? payload.rentStartDateKey.trim()
            : "";
    const rentLastDateKey =
        typeof payload.rentLastDateKey === "string"
            ? payload.rentLastDateKey.trim()
            : "";

    if (!rentStartDateKey || !rentLastDateKey) {
        throw new HttpsError(
            "invalid-argument",
            "계약 시작일과 실제거주 마지막일을 모두 입력해 주세요.",
        );
    }

    const parsedRentStartDate = startOfDayInKST(parseDateKeyAsKST(rentStartDateKey));
    const parsedRentLastDate = startOfDayInKST(parseDateKeyAsKST(rentLastDateKey));
    const existingRentTenantId = String(targetDesk.rentTenantId || "").trim();
    const existingRentContractId =
        typeof targetDesk.rentContractId === "string"
            ? targetDesk.rentContractId.trim()
            : "";

    if (!parsedRentStartDate || !parsedRentLastDate) {
        throw new HttpsError("invalid-argument", "계약 날짜 형식이 올바르지 않습니다.");
    }

    if (parsedRentLastDate.getTime() < parsedRentStartDate.getTime()) {
        throw new HttpsError(
            "invalid-argument",
            "실제거주 마지막일은 계약 시작일보다 빠를 수 없습니다.",
        );
    }

    if (parsedRentLastDate.getTime() < today.getTime()) {
        throw new HttpsError(
            "failed-precondition",
            "이미 종료된 날짜로 새 임대 계약을 등록할 수 없습니다.",
        );
    }

    const isSameContractConfig = Boolean(
        existingRentContractId &&
        existingRentTenantId === String(targetDesk.studentId || "") &&
        existingRentStartDate &&
        existingRentLastDate &&
        existingRentStartDate.getTime() === parsedRentStartDate.getTime() &&
        existingRentLastDate.getTime() === parsedRentLastDate.getTime() &&
        currentWeeklyRent === weeklyRent &&
        existingDeposit.amount === depositAmount,
    );

    if (
        !isSameContractConfig &&
        existingRentContractId &&
        existingLifecycleStatus === RENT_CONTRACT_STATUS.ACTIVE &&
        !isExpiredActiveContract
    ) {
        throw new HttpsError(
            "failed-precondition",
            "시작된 계약의 조건은 직접 변경할 수 없습니다. 교사가 계약 종료 또는 재계약으로 처리해 주세요.",
        );
    }

    if (isExpiredActiveContract && parsedRentStartDate.getTime() <= existingRentLastDate.getTime()) {
        throw new HttpsError("failed-precondition", "새 계약 시작일은 종료된 계약의 마지막 거주일 이후로 설정해 주세요.");
    }

    if (!isSameContractConfig && existingDeposit.outstandingAmount > 0) {
        throw new HttpsError(
            "failed-precondition",
            "반환할 보증금이 남아 있어 계약을 변경할 수 없습니다. 보증금을 먼저 정산해 주세요.",
        );
    }
    const nextRentContractId = isSameContractConfig
        ? existingRentContractId
        : createRentContractId();

    const paymentsQuery = db
        .collection(`classes/${classId}/real_estate/rent_payments/records`)
        .where("deskId", "==", targetDesk.id);
    const paymentsSnap = await transaction.get(paymentsQuery);
    const legacyPayments = paymentsSnap.docs
        .map((doc) => doc.data() || {})
        .filter((record) => String(record?.tenantId || "") === String(targetDesk.studentId || ""));

    const recalculatedSnapshot = buildDeskRentPaymentSnapshot(
        {
            ...targetDesk,
            weeklyRent,
            rentContractId: nextRentContractId,
            rentStartAt: admin.firestore.Timestamp.fromDate(parsedRentStartDate),
            rentLastDateAt: admin.firestore.Timestamp.fromDate(parsedRentLastDate),
            studentId: targetDesk.studentId,
        },
        legacyPayments,
    );

    return {
        ...targetDesk,
        weeklyRent,
        rentContractId: nextRentContractId,
        rentStartAt: admin.firestore.Timestamp.fromDate(parsedRentStartDate),
        rentLastDateAt: admin.firestore.Timestamp.fromDate(parsedRentLastDate),
        rentTenantId: targetDesk.studentId,
        rentTenantName: targetDesk.studentName || null,
        rentPaidDays: recalculatedSnapshot.paidDays,
        rentPaidAmount: recalculatedSnapshot.paidAmount,
        rentPaidWithheldTaxAmount: isSameContractConfig
            ? Math.max(0, toWholeNumber(targetDesk.rentPaidWithheldTaxAmount))
            : 0,
        rentPaidUntil: recalculatedSnapshot.paidUntil
            ? admin.firestore.Timestamp.fromDate(recalculatedSnapshot.paidUntil)
            : null,
        rentDepositAmount: depositAmount,
        rentDepositStatus: isSameContractConfig
            ? existingDeposit.status
            : depositAmount > 0
                ? RENT_DEPOSIT_STATUS.PENDING
                : RENT_DEPOSIT_STATUS.NOT_REQUIRED,
        rentDepositPaidAmount: isSameContractConfig ? existingDeposit.paidAmount : 0,
        rentDepositReturnedAmount: isSameContractConfig ? existingDeposit.returnedAmount : 0,
        rentDepositDeductedAmount: isSameContractConfig ? existingDeposit.deductedAmount : 0,
        rentDepositPaidAt: isSameContractConfig ? (targetDesk.rentDepositPaidAt || null) : null,
        rentDepositReturnedAt: isSameContractConfig ? (targetDesk.rentDepositReturnedAt || null) : null,
        rentDepositSettlementReason: isSameContractConfig
            ? (targetDesk.rentDepositSettlementReason || null)
            : null,
        rentContractStatus: isSameContractConfig
            ? existingLifecycleStatus
            : RENT_CONTRACT_STATUS.PENDING_PAYMENT,
        rentActivatedAt: isSameContractConfig ? (targetDesk.rentActivatedAt || null) : null,
        rentInitialPaymentDays: isSameContractConfig
            ? Math.max(0, toWholeNumber(targetDesk.rentInitialPaymentDays))
            : 0,
        rentInitialPaymentAmount: isSameContractConfig
            ? Math.max(0, toWholeNumber(targetDesk.rentInitialPaymentAmount))
            : 0,
    };
};

const getLatestDateInKST = (...values) =>
    values.reduce((latest, value) => {
        const current = startOfDayInKST(value);
        if (!current) return latest;
        if (!latest || current.getTime() > latest.getTime()) return current;
        return latest;
    }, null);

const calculateProratedHoldingTaxAmount = ({ officialPrice, taxRate, holdingDays }) => {
    const safePrice = Math.max(0, Number(officialPrice || 0));
    const safeRate = Math.max(0, Number(taxRate || 0));
    const safeHoldingDays = Math.max(0, Number(holdingDays || 0));
    if (safePrice <= 0 || safeRate <= 0 || safeHoldingDays <= 0) return 0;
    return Math.max(0, Math.floor(safePrice * (safeRate / 100) * (safeHoldingDays / 7)));
};

const buildHoldingTaxDeskBreakdown = ({ desks, periodStart, periodEnd, cutoverAt, holdingTaxRate }) => {
    const items = [];
    let totalOfficialPrice = 0;
    let totalHoldingDays = 0;

    (desks || []).forEach((desk) => {
        const deskId = typeof desk?.id === "string" ? desk.id.trim() : "";
        if (!deskId) return;

        const officialPrice = Math.max(0, Number(desk?.price || 0));
        if (officialPrice <= 0) return;

        const ownerSinceAt = toDate(desk?.ownerSinceAt) || cutoverAt;
        const taxableStart = getLatestDateInKST(ownerSinceAt, cutoverAt, periodStart);
        const holdingDays = countInclusiveDaysInKST(taxableStart, periodEnd);
        if (holdingDays <= 0) return;

        const taxAmount = calculateProratedHoldingTaxAmount({
            officialPrice,
            taxRate: holdingTaxRate,
            holdingDays,
        });
        if (taxAmount <= 0) return;

        totalOfficialPrice += officialPrice;
        totalHoldingDays += holdingDays;
        items.push({
            deskId,
            deskLabel: getResolvedDeskLabel(desk),
            officialPrice,
            ownerSinceAt: admin.firestore.Timestamp.fromDate(ownerSinceAt),
            taxableStartAt: admin.firestore.Timestamp.fromDate(taxableStart),
            taxableEndAt: admin.firestore.Timestamp.fromDate(periodEnd),
            holdingDays,
            taxAmount,
        });
    });

    return {
        deskBreakdown: items,
        deskCount: items.length,
        totalOfficialPrice,
        totalHoldingDays,
        amount: items.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0),
    };
};

const isTaxBillPaid = (bill) => bill?.isPaid === true || bill?.status === "paid";

const isHoldingTaxBillOverdue = (bill, now = new Date()) => {
    if (!bill || isTaxBillPaid(bill)) return false;

    const dueDate = toDate(bill?.dueAt || bill?.dueDate);
    if (!dueDate) return false;

    return dueDate.getTime() < now.getTime();
};

const getOverdueHoldingTaxBills = async (transaction, classId, studentUid) => {
    if (!classId || !studentUid) return [];

    const billsQuery = db
        .collection(`classes/${classId}/students/${studentUid}/taxBills`)
        .where("isPaid", "==", false);

    const snapshot = await transaction.get(billsQuery);
    const now = new Date();

    return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((bill) => bill.billKind === "realestate_holding")
        .filter((bill) => isHoldingTaxBillOverdue(bill, now));
};

const ensureNoOverdueHoldingTaxBills = async (transaction, classId, studentUid) => {
    const overdueBills = await getOverdueHoldingTaxBills(transaction, classId, studentUid);
    if (overdueBills.length === 0) return;

    throw new HttpsError(
        "failed-precondition",
        "연체된 보유세가 있어 새로운 부동산 매수나 경매 입찰에 참여할 수 없습니다. 먼저 보유세를 납부해주세요.",
    );
};

const getRealEstateAuthContext = (request, classId) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const role = request.auth.token?.role || null;
    const tokenClassId = request.auth.token?.classId || null;
    const tokenPermissions = request.auth.token?.permissions || {};

    const isAdmin = role === "admin";
    const isTeacher = role === "teacher";
    const hasRealEstateAdmin =
        tokenPermissions[REAL_ESTATE_ADMIN_TOKEN_KEY] === true ||
        tokenPermissions.realestate_admin === true;

    if (!isAdmin && (!tokenClassId || tokenClassId !== classId)) {
        throw new HttpsError(
            "permission-denied",
            "다른 학급 데이터에는 접근할 수 없습니다.",
        );
    }

    return {
        uid: request.auth.uid,
        role,
        isAdmin,
        isTeacher,
        hasRealEstateAdmin,
        canManageRealEstate: isAdmin || isTeacher || hasRealEstateAdmin,
    };
};

const getDeskWeeklyRentAmount = (desk) =>
    Math.max(0, Number(desk?.weeklyRent || desk?.rentPrice || 0));

const isDeskRentApplicable = (desk) =>
    !!desk?.studentId &&
    !isClassFundOwnedDesk(desk) &&
    desk?.ownerId !== desk?.studentId;

/**
 * 부동산 거래 실행 (매수자 결제)
 */
exports.executeRealEstateTransaction = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, deskId, buyerName } = request.data;
    const buyerUid = request.auth.uid;
    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `realestate_trade_${buyerUid}_${deskId}_${Date.now()}`,
    );

    if (!classId || !deskId) {
        throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const buyerRef = db.doc(`classes/${classId}/students/${buyerUid}`);
        const classRef = db.doc(`classes/${classId}`);

        const [layoutSnap, configSnap, buyerSnap, classSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(buyerRef),
            transaction.get(classRef),
        ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }

        if (!buyerSnap.exists) {
            throw new HttpsError("not-found", "구매자 정보를 찾을 수 없습니다.");
        }
        if (!classSnap.exists) {
            throw new HttpsError("not-found", "학급 정보를 찾을 수 없습니다.");
        }

        const groups = layoutSnap.data().groups || [];
        const configData = configSnap.data() || {};
        const buyerData = buyerSnap.data();
        const classData = classSnap.data() || {};
        const logContext = {
            config: globalConfig,
            planType: classData.planType || "FREE",
            serviceName: "realestate",
        };

        const isSystemEnabled = configData.enabled !== false;
        if (!isSystemEnabled) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const isAcqEnabled = isSystemEnabled && (configData.acquisitionTaxEnabled !== false);
        const acqRate = isAcqEnabled ? (Number(configData.acquisitionTaxRate) || 0) : 0;

        const isCapEnabled = isSystemEnabled && (configData.capitalGainsTaxEnabled !== false);
        const capRate = isCapEnabled ? (Number(configData.capitalGainsTaxRate) || 0) : 0;

        let targetGroupIndex = -1;
        let targetDeskIndex = -1;
        let desk = null;

        for (let g = 0; g < groups.length; g++) {
            const dIdx = groups[g].desks.findIndex((d) => d.id === deskId);
            if (dIdx !== -1) {
                targetGroupIndex = g;
                targetDeskIndex = dIdx;
                desk = groups[g].desks[dIdx];
                break;
            }
        }

        if (!desk) {
            throw new HttpsError("not-found", "해당 자리를 찾을 수 없습니다.");
        }

        if (isClassFundOwnedDesk(desk)) {
            throw new HttpsError(
                "failed-precondition",
                "기금 소유 부동산은 기금 모드에서만 매각할 수 있습니다.",
            );
        }

        const resolvedDeskLabel = getResolvedDeskLabel(desk);

        if (!desk.isForSale && desk.tradeStatus !== "contracting") {
            throw new HttpsError("failed-precondition", "거래 가능한 상태가 아닙니다.");
        }

        if (desk.buyerId !== buyerUid) {
            throw new HttpsError("permission-denied", "선택된 계약자만 결제할 수 있습니다.");
        }

        if (desk.ownerId === buyerUid) {
            throw new HttpsError("invalid-argument", "본인 소유 자리는 구매할 수 없습니다.");
        }

        await ensureNoOverdueHoldingTaxBills(transaction, classId, buyerUid);

        if (!desk.contractState?.sellerSigned || !desk.contractState?.buyerSigned) {
            throw new HttpsError("failed-precondition", "매도자와 매수자 서명이 모두 필요합니다.");
        }

        const sellerUid = desk.ownerId;
        const isStateOwned = !sellerUid;
        const resolvedSellerName = isStateOwned
            ? getClassDisplayName(classData)
            : String(desk?.ownerName || "이름 없음");
        const resolvedBuyerName = String(
            buyerName || buyerData?.name || buyerData?.displayName || "익명"
        ).trim();
        if (!resolvedBuyerName) {
            throw new HttpsError("failed-precondition", "매수인 이름 정보를 확인할 수 없습니다.");
        }

        const tradePrice = Number(desk.askingPrice);
        if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
            throw new HttpsError("failed-precondition", "매물 가격이 올바르지 않습니다. 판매 가격을 다시 설정해 주세요.");
        }

        const acquisitionTax = Math.floor(tradePrice * (acqRate / 100));

        let capitalGainsTax = 0;
        if (!isStateOwned && capRate > 0) {
            const recordedPurchasePrice = Number(desk.lastPurchasePrice || 0);
            const lastPurchasePrice = recordedPurchasePrice > 0 ? recordedPurchasePrice : tradePrice;
            const profit = tradePrice - lastPurchasePrice;
            if (profit > 0) {
                capitalGainsTax = Math.floor(profit * (capRate / 100));
            }
        }

        const totalBuyerCost = tradePrice + acquisitionTax;
        const totalSellerIncome = tradePrice - capitalGainsTax;
        const totalTaxRevenue = acquisitionTax + capitalGainsTax;
        if (
            !Number.isFinite(acquisitionTax) ||
            !Number.isFinite(capitalGainsTax) ||
            !Number.isFinite(totalBuyerCost) ||
            !Number.isFinite(totalSellerIncome) ||
            !Number.isFinite(totalTaxRevenue)
        ) {
            throw new HttpsError("internal", "거래 금액 계산 중 오류가 발생했습니다.");
        }

        const buyerBalance = buyerData.assets?.cash || 0;
        if (buyerBalance < totalBuyerCost) {
            throw new HttpsError("resource-exhausted", `잔액이 부족합니다. (필요 금액: ${totalBuyerCost.toLocaleString()})`);
        }

        const officialPriceRatio = Number.isFinite(Number(configData.officialPriceRatio))
            ? Number(configData.officialPriceRatio)
            : 70;
        const officialPrice = Math.floor(tradePrice * (officialPriceRatio / 100));
        if (!Number.isFinite(officialPrice)) {
            throw new HttpsError("internal", "공시지가 계산 중 오류가 발생했습니다.");
        }

        let sellerRef = null;
        if (!isStateOwned) {
            sellerRef = db.doc(`classes/${classId}/students/${sellerUid}`);
            const sellerSnap = await transaction.get(sellerRef);
            if (!sellerSnap.exists) {
                throw new HttpsError("not-found", "매도자 정보를 찾을 수 없습니다.");
            }
        }

        transaction.update(buyerRef, {
            "assets.cash": FieldValue.increment(-totalBuyerCost),
        });

        const ledgerRef = db.collection(`classes/${classId}/real_estate/ledger/transactions`).doc();
        const aggregateTaxId = `realestate_trade_${batchKey}`;
        const safeDeskLineKey = toSafeId(deskId, "desk");
        const taxLines = [];
        let totalTaxIncomeAmount = 0;

        if (!isStateOwned) {
            transaction.update(sellerRef, {
                "assets.cash": FieldValue.increment(totalSellerIncome),
            });

            stageActivityLog(transaction, classId, {
                studentUid: sellerUid,
                type: "income",
                category: "real_estate",
                subCategory: "sell",
                amount: totalSellerIncome,
                description: `${resolvedDeskLabel} 매도 완료 (매매가: ${tradePrice}, 양도소득세: ${capitalGainsTax})`,
                currency: "class_currency",
                taxEvent: capitalGainsTax > 0 ? {
                    sourceKey: "realEstateTrade",
                    taxCategory: "transaction_tax",
                    taxType: "capital_gains_tax",
                    amount: capitalGainsTax,
                } : null,
            }, logContext);
        } else if (tradePrice > 0) {
            totalTaxIncomeAmount += tradePrice;
            taxLines.push({
                id: `${safeDeskLineKey}_state_sale`,
                amount: tradePrice,
                source: "real_estate",
                taxType: "state_asset_sale",
                description: `${resolvedDeskLabel} 국유지 매각 수입`,
                studentUid: buyerUid,
                studentName: resolvedBuyerName,
                relatedDoc: { collection: "real_estate_ledger", id: ledgerRef.id },
                externalId: `${safeDeskLineKey}_state_sale`,
                meta: {
                    deskId,
                    taxKey: "state_asset_sale",
                },
            });
        }

        if (acquisitionTax > 0) {
            totalTaxIncomeAmount += acquisitionTax;
            taxLines.push({
                id: `${safeDeskLineKey}_acquisition_tax`,
                amount: acquisitionTax,
                source: "real_estate",
                taxType: "re_acquisition",
                description: `${resolvedDeskLabel} 취득세`,
                studentUid: buyerUid,
                studentName: resolvedBuyerName,
                relatedDoc: { collection: "real_estate_ledger", id: ledgerRef.id },
                externalId: `${safeDeskLineKey}_acquisition_tax`,
                meta: {
                    deskId,
                    taxKey: "re_acquisition",
                },
            });
        }

        if (capitalGainsTax > 0) {
            totalTaxIncomeAmount += capitalGainsTax;
            taxLines.push({
                id: `${safeDeskLineKey}_capital_gains_tax`,
                amount: capitalGainsTax,
                source: "real_estate",
                taxType: "re_capital_gains",
                description: `${resolvedDeskLabel} 양도소득세`,
                studentUid: sellerUid,
                studentName: resolvedSellerName,
                relatedDoc: { collection: "real_estate_ledger", id: ledgerRef.id },
                externalId: `${safeDeskLineKey}_capital_gains_tax`,
                meta: {
                    deskId,
                    taxKey: "re_capital_gains",
                },
            });
        }

        let isTaxRecorded = false;
        const taxRecordPointers = {};
        if (totalTaxIncomeAmount > 0 && taxLines.length > 0) {
            const taxIncomeResult = stageTaxIncome(
                transaction,
                classId,
                {
                    amount: totalTaxIncomeAmount,
                    taxType: "real_estate_trade",
                    description: `${resolvedDeskLabel} 거래 세입 합산 (${taxLines.length}건)`,
                    source: "real_estate",
                    studentUid: buyerUid,
                    studentName: resolvedBuyerName,
                },
                "system",
                {
                    ...logContext,
                    classData,
                    sourceKey: "realEstateTrade",
                    ensurePeriodSettlement: true,
                    customId: aggregateTaxId,
                    aggregateMeta: {
                        group: "realestate_trade",
                        batchKey,
                        pageKey: "realestate",
                        actorUid: buyerUid,
                        actorName: resolvedBuyerName,
                        mode: "execute_realestate_transaction",
                    },
                    detailLines: taxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                }
            );
            isTaxRecorded = !taxIncomeResult?.skipped && !!taxIncomeResult?.id;

            if (isTaxRecorded) {
                for (const line of taxLines) {
                    taxRecordPointers[line.id] = buildTaxRecordPointer(
                        "taxIncomes",
                        aggregateTaxId,
                        line.id,
                    );
                }
            }
        }

        stageActivityLog(transaction, classId, {
            studentUid: buyerUid,
            type: "expense",
            category: "real_estate",
            subCategory: "buy",
            amount: totalBuyerCost,
            description: `${resolvedDeskLabel} 구매 완료 (매매가: ${tradePrice}, 취득세: ${acquisitionTax})`,
            currency: "class_currency",
            taxEvent: acquisitionTax + (isStateOwned ? tradePrice : 0) > 0 ? {
                sourceKey: "realEstateTrade",
                taxCategory: "transaction_tax",
                taxType: isStateOwned
                    ? "state_asset_sale_and_acquisition_tax"
                    : "acquisition_tax",
                amount: acquisitionTax + (isStateOwned ? tradePrice : 0),
            } : null,
        }, logContext);

        const ownershipUpdatedAt = new Date().toISOString();
        const updatedGroups = [...groups];
        updatedGroups[targetGroupIndex].desks[targetDeskIndex] = {
            ...desk,
            ownerId: buyerUid,
            ownerName: resolvedBuyerName,
            ownerSinceAt: ownershipUpdatedAt,
            ownerSource: isStateOwned ? "state_sale" : "sale",
            ownerUpdatedAt: ownershipUpdatedAt,
            lastPurchasePrice: tradePrice,
            price: officialPrice,
            tradeStatus: "idle",
            isForSale: false,
            askingPrice: 0,
            buyerId: null,
            contractState: null,
            purchaseRequests: [],
            hasTradeHistory: true,
        };

        stageRealEstateLayout(transaction, layoutRef, {
            groups: updatedGroups,
        });
        transaction.set(
            configRef,
            {
                seedMarketPrice: Math.max(0, Math.round(tradePrice)),
            },
            { merge: true }
        );

        transaction.set(ledgerRef, {
            type: "sale",
            deskId,
            deskLabel: resolvedDeskLabel,
            buyerId: buyerUid,
            buyerName: resolvedBuyerName,
            sellerId: sellerUid || "STATE",
            sellerName: resolvedSellerName,
            amount: tradePrice,
            tradePrice,
            taxAmount: totalTaxRevenue,
            acquisitionTax,
            capitalGainsTax,
            buyerTotalCost: totalBuyerCost,
            sellerNetIncome: totalSellerIncome,
            stateAssetSaleIncome: isStateOwned ? tradePrice : 0,
            taxAggregateAmount: totalTaxIncomeAmount,
            taxDetails: {
                acquisition: acquisitionTax,
                capitalGains: capitalGainsTax,
            },
            ...(isTaxRecorded
                ? {
                    taxAggregateId: aggregateTaxId,
                    taxRecords: taxRecordPointers,
                    taxCancelled: false,
                }
                : {}),
            timestamp: FieldValue.serverTimestamp(),
        });

        return { success: true };
    });
});

/**
 * 기금과 국가 사이의 부동산 직접 거래
 * - purchase: 국가 소유 좌석을 선택한 기금이 정가로 매수
 * - sell: 선택한 기금 소유 좌석을 국가에 정가로 매각
 */
exports.executeClassFundRealEstateTrade = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, deskId, classFundId, action } = request.data || {};
    const fundId = String(classFundId || "").trim().slice(0, 120);
    const normalizedAction = String(action || "").trim();
    if (!classId || !deskId || !fundId) {
        throw new HttpsError(
            "invalid-argument",
            "classId, deskId, classFundId가 필요합니다.",
        );
    }
    if (!["purchase", "sell"].includes(normalizedAction)) {
        throw new HttpsError("invalid-argument", "지원하지 않는 기금 부동산 거래입니다.");
    }

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `class_fund_realestate_${normalizedAction}_${fundId}_${deskId}_${Date.now()}`,
    );

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const classRef = db.doc(`classes/${classId}`);
        const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
        const callerRef = db.doc(
            `classes/${classId}/students/${request.auth.uid}`,
        );
        const taxSummaryRef = db.doc(`classes/${classId}/dashboardSummary/taxSummary`);
        const [layoutSnap, configSnap, classSnap, fundSnap, callerSnap, taxSummarySnap] =
            await Promise.all([
                readRealEstateLayout(db, layoutRef, transaction),
                transaction.get(configRef),
                transaction.get(classRef),
                transaction.get(fundRef),
                transaction.get(callerRef),
                transaction.get(taxSummaryRef),
            ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }
        if (!classSnap.exists) {
            throw new HttpsError("not-found", "학급 정보를 찾을 수 없습니다.");
        }
        if (!fundSnap.exists) {
            throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
        }

        const configData = configSnap.exists ? configSnap.data() || {} : {};
        if (configData.enabled === false) {
            throw new HttpsError(
                "failed-precondition",
                "부동산 시스템이 비활성화 상태입니다.",
            );
        }

        const classData = classSnap.data() || {};
        const fundData = fundSnap.data() || {};
        assertCanOperateClassFund({
            userData: callerSnap.exists ? callerSnap.data() : null,
            fundData,
            uid: request.auth.uid,
        });
        const groups = Array.isArray(layoutSnap.data()?.groups) ?
            layoutSnap.data().groups :
            [];
        let targetGroupIndex = -1;
        let targetDeskIndex = -1;
        let desk = null;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
            const deskIndex = (groups[groupIndex]?.desks || []).findIndex(
                (entry) => entry?.id === deskId,
            );
            if (deskIndex >= 0) {
                targetGroupIndex = groupIndex;
                targetDeskIndex = deskIndex;
                desk = groups[groupIndex].desks[deskIndex];
                break;
            }
        }
        if (!desk) {
            throw new HttpsError("not-found", "해당 자리를 찾을 수 없습니다.");
        }
        if (desk.isActive === false) {
            throw new HttpsError("failed-precondition", "비활성 좌석은 거래할 수 없습니다.");
        }
        if (
            desk.auctionSummary?.auctionId ||
            desk.foreclosureInfo?.auctionId ||
            desk.tradeStatus === "contracting"
        ) {
            throw new HttpsError(
                "failed-precondition",
                "진행 중인 계약이나 경매가 있는 좌석은 거래할 수 없습니다.",
            );
        }

        const now = FieldValue.serverTimestamp();
        const nowIso = new Date().toISOString();
        const dateKey = formatDateKeyInKST(new Date());
        const deskLabel = getResolvedDeskLabel(desk);
        const fundName = String(fundData.name || "기금");
        const planType = classData.planType || "FREE";
        const logContext = {
            config: globalConfig,
            planType,
            serviceName: "realestate",
        };
        const realEstateLedgerRef = db
            .collection(`classes/${classId}/real_estate/ledger/transactions`)
            .doc();
        const fundLedgerRef = fundRef.collection("ledger").doc();
        const updatedGroups = [...groups];
        const targetGroup = { ...updatedGroups[targetGroupIndex] };
        const updatedDesks = [...(targetGroup.desks || [])];
        let result = null;

        if (normalizedAction === "purchase") {
            if (desk.ownerId || isClassFundOwnedDesk(desk)) {
                throw new HttpsError(
                    "failed-precondition",
                    "국가 소유 부동산만 기금으로 구매할 수 있습니다.",
                );
            }

            const quote = buildClassFundPurchaseQuote(desk, configData);
            const accounting = buildClassFundPurchaseAccounting(quote);
            if (quote.price <= 0) {
                throw new HttpsError(
                    "failed-precondition",
                    "구매 가격이 설정되지 않은 좌석입니다.",
                );
            }
            const access = getClassFundChannelAccess(
                fundData,
                "realEstatePurchase",
                { amount: quote.totalCost },
            );
            if (!access.allowed) {
                throw new HttpsError("failed-precondition", access.reason);
            }

            const balanceBefore = Math.floor(Number(fundData.cashBalance || 0));
            const balanceAfter = balanceBefore - quote.totalCost;
            const assetUsageRef = db
                .collection(`classes/${classId}/fundUsages`)
                .doc();
            const acquisitionTaxUsageRef = quote.acquisitionTax > 0 ?
                db.collection(`classes/${classId}/fundUsages`).doc() :
                null;

            transaction.update(fundRef, {
                cashBalance: FieldValue.increment(accounting.cashDelta),
                realEstateValue: FieldValue.increment(
                    accounting.realEstateValueDelta,
                ),
                realEstateCount: FieldValue.increment(
                    accounting.realEstateCountDelta,
                ),
                realEstatePurchaseTotal: FieldValue.increment(
                    accounting.realEstatePurchaseTotalDelta,
                ),
                spentTotal: FieldValue.increment(accounting.spentTotalDelta),
                settledExpenseTotal: FieldValue.increment(
                    accounting.settledExpenseTotalDelta,
                ),
                totalValue: FieldValue.increment(accounting.totalValueDelta),
                lastUsageAt: now,
                updatedAt: now,
            });
            transaction.set(assetUsageRef, {
                fundId,
                fundName,
                fundType: fundData.fundType || "general",
                channel: "realEstatePurchase",
                usageKind: "asset_purchase",
                direction: "out",
                amount: quote.price,
                cashAmount: quote.totalCost,
                taxAmount: quote.acquisitionTax,
                description: `${deskLabel} 국가 소유 부동산 구매`,
                settlementStatus: "not_applicable",
                dateKey,
                relatedRealEstateLedgerId: realEstateLedgerRef.id,
                relatedDeskId: deskId,
                createdBy: request.auth.uid,
                usedAt: now,
                createdAt: now,
                updatedAt: now,
            });
            if (acquisitionTaxUsageRef) {
                stageImmediateClassFundExpense(transaction, {
                    classId,
                    usageRef: acquisitionTaxUsageRef,
                    fundId,
                    fundName,
                    fundType: fundData.fundType || "general",
                    amount: quote.acquisitionTax,
                    channel: "realEstatePurchase",
                    description: `${deskLabel} 기금 부동산 취득세`,
                    dateKey,
                    balanceBefore,
                    balanceAfter,
                    createdBy: request.auth.uid,
                    now,
                    taxContext: logContext,
                    usageData: {
                        usageKind: "expense",
                        direction: "out",
                        source: "class_fund_real_estate",
                        relatedRealEstateLedgerId: realEstateLedgerRef.id,
                        relatedDeskId: deskId,
                    },
                    taxData: {
                        source: "class_fund_real_estate",
                        expenseType: "real_estate_acquisition_tax",
                        category: "real_estate",
                        studentName: fundName,
                    },
                });
            }
            transaction.set(fundLedgerRef, {
                type: "real_estate_purchase",
                direction: "out",
                amount: quote.totalCost,
                assetValue: quote.carryingValue,
                taxAmount: quote.acquisitionTax,
                description: `${deskLabel} 국가 소유 부동산 구매`,
                balanceBefore,
                balanceAfter,
                relatedDeskId: deskId,
                relatedRealEstateLedgerId: realEstateLedgerRef.id,
                createdBy: request.auth.uid,
                createdAt: now,
            });

            const taxLines = [
                {
                    id: `${toSafeId(deskId, "desk")}_state_sale`,
                    amount: quote.price,
                    source: "class_fund_real_estate",
                    taxType: "state_asset_sale",
                    description: `${deskLabel} 기금 대상 국유지 매각 수입`,
                    relatedDoc: {
                        collection: "real_estate_ledger",
                        id: realEstateLedgerRef.id,
                    },
                },
            ];
            if (quote.acquisitionTax > 0) {
                taxLines.push({
                    id: `${toSafeId(deskId, "desk")}_acquisition_tax`,
                    amount: quote.acquisitionTax,
                    source: "class_fund_real_estate",
                    taxType: "re_acquisition",
                    description: `${deskLabel} 기금 부동산 취득세`,
                    relatedDoc: {
                        collection: "real_estate_ledger",
                        id: realEstateLedgerRef.id,
                    },
                });
            }
            const taxIncomeResult = stageTaxIncome(
                transaction,
                classId,
                {
                    amount: quote.totalCost,
                    taxType: "class_fund_real_estate_purchase",
                    description: `${fundName} ${deskLabel} 부동산 구매 세입`,
                    source: "class_fund_real_estate",
                    studentUid: request.auth.uid,
                    studentName: fundName,
                },
                request.auth.uid,
                {
                    ...logContext,
                    classData,
                    sourceKey: "realEstateTrade",
                    // 기금 부동산 거래는 현금과 국고가 같은 트랜잭션에서
                    // 즉시 움직이므로 기간 정산이나 요금제 게이트로 미룰 수 없다.
                    ...CLASS_FUND_TAX_INCOME_RECORDING_OPTIONS,
                    customId: `classFundRealEstateIncome_${realEstateLedgerRef.id}`,
                    aggregateMeta: {
                        group: "class_fund_real_estate_purchase",
                        batchKey,
                        pageKey: "realestate",
                        actorUid: request.auth.uid,
                        mode: "class_fund_purchase",
                    },
                    detailLines: taxLines,
                    detailCollection: TAX_LINE_COLLECTION,
                },
            );
            if (taxIncomeResult?.skipped || !taxIncomeResult?.id) {
                throw new HttpsError(
                    "failed-precondition",
                    "부동산 구매 세입을 기록할 수 없습니다.",
                );
            }

            updatedDesks[targetDeskIndex] = {
                ...desk,
                ownerId: getClassFundOwnerId(fundId),
                ownerName: fundName,
                ownerType: "classFund",
                ownerFundId: fundId,
                ownerSinceAt: nowIso,
                ownerSource: "class_fund_purchase",
                ownerUpdatedAt: nowIso,
                fundAcquisitionPrice: quote.carryingValue,
                lastPurchasePrice: quote.price,
                tradeStatus: "idle",
                isForSale: false,
                askingPrice: 0,
                buyerId: null,
                contractState: null,
                purchaseRequests: [],
                hasTradeHistory: true,
            };
            transaction.set(realEstateLedgerRef, {
                type: "class_fund_purchase",
                deskId,
                deskLabel,
                buyerId: getClassFundOwnerId(fundId),
                buyerName: fundName,
                buyerType: "classFund",
                buyerFundId: fundId,
                sellerId: "STATE",
                sellerName: getClassDisplayName(classData),
                amount: quote.price,
                tradePrice: quote.price,
                acquisitionTax: quote.acquisitionTax,
                buyerTotalCost: quote.totalCost,
                stateAssetSaleIncome: quote.price,
                taxAggregateAmount: quote.totalCost,
                taxAggregateId: taxIncomeResult.id,
                timestamp: now,
                createdBy: request.auth.uid,
            });
            result = {
                action: "purchase",
                fundId,
                deskId,
                price: quote.price,
                taxAmount: quote.acquisitionTax,
                cashChange: -quote.totalCost,
                balanceAfter,
            };
        } else {
            if (!isClassFundOwnedDesk(desk, fundId)) {
                throw new HttpsError(
                    "failed-precondition",
                    "선택한 기금이 소유한 부동산만 매각할 수 있습니다.",
                );
            }
            if (fundData.status && fundData.status !== "active") {
                throw new HttpsError(
                    "failed-precondition",
                    "운영 중인 기금만 부동산을 매각할 수 있습니다.",
                );
            }

            const quote = buildClassFundSaleQuote(desk, configData);
            const accounting = buildClassFundSaleAccounting(quote);
            if (quote.salePrice <= 0 || quote.netProceeds < 0) {
                throw new HttpsError(
                    "failed-precondition",
                    "매각 가격을 확인할 수 없습니다.",
                );
            }
            const taxSummary = taxSummarySnap.exists ?
                taxSummarySnap.data() || {} :
                {};
            const taxBalance =
                Math.floor(Number(taxSummary.totalIncome || 0)) -
                Math.floor(Number(taxSummary.totalExpense || 0));
            if (taxBalance < quote.salePrice) {
                throw new HttpsError(
                    "failed-precondition",
                    "국고 잔액이 부족해 기금 부동산을 매입할 수 없습니다.",
                );
            }

            const balanceBefore = Math.floor(Number(fundData.cashBalance || 0));
            const balanceAfter = balanceBefore + quote.netProceeds;
            const saleUsageRef = db
                .collection(`classes/${classId}/fundUsages`)
                .doc();
            const fundUpdate = {
                cashBalance: FieldValue.increment(accounting.cashDelta),
                realEstateValue: FieldValue.increment(
                    accounting.realEstateValueDelta,
                ),
                realEstateCount: FieldValue.increment(
                    accounting.realEstateCountDelta,
                ),
                realEstateSaleTotal: FieldValue.increment(
                    accounting.realEstateSaleTotalDelta,
                ),
                totalValue: FieldValue.increment(accounting.totalValueDelta),
                lastUsageAt: now,
                updatedAt: now,
            };
            if (accounting.realizedGainDelta > 0) {
                fundUpdate.realEstateRealizedGain = FieldValue.increment(
                    accounting.realizedGainDelta,
                );
            } else if (accounting.realizedLossDelta > 0) {
                fundUpdate.realEstateRealizedLoss = FieldValue.increment(
                    accounting.realizedLossDelta,
                );
            }
            transaction.update(fundRef, fundUpdate);
            transaction.set(saleUsageRef, {
                fundId,
                fundName,
                fundType: fundData.fundType || "general",
                channel: "realEstatePurchase",
                usageKind: "asset_sale",
                direction: "in",
                amount: quote.netProceeds,
                grossAmount: quote.salePrice,
                taxAmount: quote.capitalGainsTax,
                description: `${deskLabel} 국가 매각`,
                settlementStatus: "not_applicable",
                dateKey,
                relatedRealEstateLedgerId: realEstateLedgerRef.id,
                relatedDeskId: deskId,
                createdBy: request.auth.uid,
                usedAt: now,
                createdAt: now,
                updatedAt: now,
            });
            transaction.set(fundLedgerRef, {
                type: "real_estate_sale",
                direction: "in",
                amount: quote.netProceeds,
                grossAmount: quote.salePrice,
                taxAmount: quote.capitalGainsTax,
                assetValueRemoved: quote.carryingValue,
                description: `${deskLabel} 국가 매각`,
                balanceBefore,
                balanceAfter,
                relatedDeskId: deskId,
                relatedRealEstateLedgerId: realEstateLedgerRef.id,
                createdBy: request.auth.uid,
                createdAt: now,
            });

            const taxExpenseResult = stageTaxExpense(
                transaction,
                classId,
                {
                    amount: quote.salePrice,
                    description: `${fundName} 소유 ${deskLabel} 국가 매입`,
                    source: "class_fund_real_estate",
                    expenseType: "state_asset_buyback",
                    category: "real_estate",
                    studentUid: request.auth.uid,
                    studentName: fundName,
                },
                request.auth.uid,
                {
                    ...logContext,
                    ...CLASS_FUND_TAX_EXPENSE_RECORDING_OPTIONS,
                    customId: `classFundRealEstateExpense_${realEstateLedgerRef.id}`,
                    aggregateMeta: {
                        group: "class_fund_real_estate_sale",
                        batchKey,
                        pageKey: "realestate",
                        actorUid: request.auth.uid,
                        mode: "class_fund_sale",
                    },
                    detailLines: [
                        {
                            id: `${toSafeId(deskId, "desk")}_state_buyback`,
                            amount: quote.salePrice,
                            source: "class_fund_real_estate",
                            expenseType: "state_asset_buyback",
                            category: "real_estate",
                            description: `${deskLabel} 국가 매입`,
                            relatedDoc: {
                                collection: "real_estate_ledger",
                                id: realEstateLedgerRef.id,
                            },
                        },
                    ],
                },
            );
            if (taxExpenseResult?.skipped || !taxExpenseResult?.id) {
                throw new HttpsError(
                    "failed-precondition",
                    "부동산 국가 매입 지출을 기록할 수 없습니다.",
                );
            }

            let capitalGainsTaxIncomeId = null;
            if (quote.capitalGainsTax > 0) {
                const taxIncomeResult = stageTaxIncome(
                    transaction,
                    classId,
                    {
                        amount: quote.capitalGainsTax,
                        taxType: "class_fund_real_estate_capital_gains",
                        description: `${fundName} ${deskLabel} 매각 양도소득세`,
                        source: "class_fund_real_estate",
                        studentUid: request.auth.uid,
                        studentName: fundName,
                    },
                    request.auth.uid,
                    {
                        ...logContext,
                        classData,
                        sourceKey: "realEstateTrade",
                        ...CLASS_FUND_TAX_INCOME_RECORDING_OPTIONS,
                        customId: `classFundRealEstateTax_${realEstateLedgerRef.id}`,
                        aggregateMeta: {
                            group: "class_fund_real_estate_sale_tax",
                            batchKey,
                            pageKey: "realestate",
                            actorUid: request.auth.uid,
                            mode: "class_fund_sale",
                        },
                    },
                );
                if (taxIncomeResult?.skipped || !taxIncomeResult?.id) {
                    throw new HttpsError(
                        "failed-precondition",
                        "부동산 매각 세금을 기록할 수 없습니다.",
                    );
                }
                capitalGainsTaxIncomeId = taxIncomeResult.id;
            }

            updatedDesks[targetDeskIndex] = {
                ...desk,
                ownerId: null,
                ownerName: "",
                ownerType: "state",
                ownerFundId: null,
                ownerSinceAt: null,
                ownerSource: "state_buyback",
                ownerUpdatedAt: nowIso,
                fundAcquisitionPrice: 0,
                lastPurchasePrice: quote.salePrice,
                tradeStatus: "idle",
                isForSale: false,
                askingPrice: 0,
                buyerId: null,
                contractState: null,
                purchaseRequests: [],
                hasTradeHistory: true,
            };
            transaction.set(realEstateLedgerRef, {
                type: "class_fund_sale",
                deskId,
                deskLabel,
                buyerId: "STATE",
                buyerName: getClassDisplayName(classData),
                sellerId: getClassFundOwnerId(fundId),
                sellerName: fundName,
                sellerType: "classFund",
                sellerFundId: fundId,
                amount: quote.salePrice,
                tradePrice: quote.salePrice,
                capitalGainsTax: quote.capitalGainsTax,
                sellerNetIncome: quote.netProceeds,
                taxExpenseId: taxExpenseResult.id,
                capitalGainsTaxIncomeId,
                timestamp: now,
                createdBy: request.auth.uid,
            });
            result = {
                action: "sell",
                fundId,
                deskId,
                price: quote.salePrice,
                taxAmount: quote.capitalGainsTax,
                cashChange: quote.netProceeds,
                balanceAfter,
            };
        }

        targetGroup.desks = updatedDesks;
        updatedGroups[targetGroupIndex] = targetGroup;
        stageRealEstateLayout(transaction, layoutRef, {
            groups: updatedGroups,
            updatedAt: now,
        });
        stageActivityLog(
            transaction,
            classId,
            {
                studentUid: request.auth.uid,
                type: "admin_action",
                category: "class_fund_real_estate",
                amount: Math.abs(result.cashChange),
                description:
                    normalizedAction === "purchase" ?
                        `${fundName}으로 ${deskLabel} 구매` :
                        `${fundName} 소유 ${deskLabel} 국가 매각`,
                relatedDoc: {
                    collection: "real_estate_ledger",
                    id: realEstateLedgerRef.id,
                },
            },
            logContext,
        );

        return { success: true, ...result };
    });
});

exports.__cancelClassFundRealEstateUsage = async ({
    classId,
    usageId,
    reason,
    actorUid,
    logContext = {},
}) => runRealEstateTransaction(db, async (transaction) => {
    const usageRef = db.doc(`classes/${classId}/fundUsages/${usageId}`);
    const usageSnap = await transaction.get(usageRef);
    if (!usageSnap.exists) {
        throw new HttpsError("not-found", "기금 부동산 내역을 찾을 수 없습니다.");
    }
    const usage = usageSnap.data() || {};
    if (usage.cancellationStatus === "cancelled") {
        throw new HttpsError("already-exists", "이미 취소된 부동산 거래입니다.");
    }

    const tradeId = String(usage.relatedRealEstateLedgerId || "").trim();
    const fundId = String(usage.fundId || "").trim();
    const deskId = String(usage.relatedDeskId || "").trim();
    if (!tradeId || !fundId || !deskId) {
        throw new HttpsError(
            "failed-precondition",
            "부동산 원거래 연결 정보를 확인할 수 없습니다.",
        );
    }

    const tradeRef = db.doc(
        `classes/${classId}/real_estate/ledger/transactions/${tradeId}`,
    );
    const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const fundLedgerQuery = fundRef.collection("ledger")
        .where("relatedRealEstateLedgerId", "==", tradeId);
    const linkedUsagesQuery = db.collection(`classes/${classId}/fundUsages`)
        .where("relatedRealEstateLedgerId", "==", tradeId);
    const latestTradeQuery = db.collection(
        `classes/${classId}/real_estate/ledger/transactions`,
    ).where("deskId", "==", deskId);
    const [tradeSnap, fundSnap, layoutSnap, fundLedgerSnap, linkedUsagesSnap,
        latestTradeSnap] = await Promise.all([
        transaction.get(tradeRef),
        transaction.get(fundRef),
        readRealEstateLayout(db, layoutRef, transaction),
        transaction.get(fundLedgerQuery),
        transaction.get(linkedUsagesQuery),
        transaction.get(latestTradeQuery),
    ]);
    if (!tradeSnap.exists || !fundSnap.exists || !layoutSnap.exists) {
        throw new HttpsError(
            "not-found",
            "기금·부동산 원거래 정보를 찾을 수 없습니다.",
        );
    }
    const trade = tradeSnap.data() || {};
    if (trade.status === "cancelled" || trade.isCancelled === true) {
        throw new HttpsError("already-exists", "이미 취소된 부동산 거래입니다.");
    }
    const latestActiveTrade = [...latestTradeSnap.docs]
        .filter((doc) => {
            const data = doc.data() || {};
            return data.status !== "cancelled" && data.isCancelled !== true;
        })
        .sort((left, right) => {
            const leftTime = left.data()?.timestamp?.toMillis?.() || 0;
            const rightTime = right.data()?.timestamp?.toMillis?.() || 0;
            return rightTime - leftTime;
        })[0];
    if (latestActiveTrade?.id !== tradeId) {
        throw new HttpsError(
            "failed-precondition",
            "이후 부동산 거래가 있어 이전 거래를 취소할 수 없습니다.",
        );
    }
    const expectedFundId = trade.type === "class_fund_purchase" ?
        trade.buyerFundId : trade.sellerFundId;
    if (String(expectedFundId || "") !== fundId) {
        throw new HttpsError(
            "failed-precondition",
            "부동산 거래와 기금 정보가 일치하지 않습니다.",
        );
    }

    const originalFundLedger = fundLedgerSnap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
        .find((entry) => ["real_estate_purchase", "real_estate_sale"]
            .includes(entry.type));
    let accounting;
    try {
        accounting = buildClassFundRealEstateCancellationAccounting({
            trade,
            fundLedger: originalFundLedger || {},
        });
    } catch (error) {
        throw new HttpsError("failed-precondition", error.message);
    }

    const layoutData = layoutSnap.data() || {};
    const groups = Array.isArray(layoutData.groups) ? [...layoutData.groups] : [];
    let groupIndex = -1;
    let deskIndex = -1;
    let desk = null;
    groups.some((group, currentGroupIndex) => {
        const currentDeskIndex = (group?.desks || [])
            .findIndex((entry) => entry?.id === deskId);
        if (currentDeskIndex < 0) return false;
        groupIndex = currentGroupIndex;
        deskIndex = currentDeskIndex;
        desk = group.desks[currentDeskIndex];
        return true;
    });
    if (!desk) {
        throw new HttpsError("not-found", "취소할 부동산을 찾을 수 없습니다.");
    }
    if (desk.auctionSummary?.auctionId || desk.foreclosureInfo?.auctionId ||
        desk.tradeStatus === "contracting") {
        throw new HttpsError(
            "failed-precondition",
            "진행 중인 계약이나 경매가 있어 취소할 수 없습니다.",
        );
    }
    if (accounting.action === "purchase_cancel" &&
        !isClassFundOwnedDesk(desk, fundId)) {
        throw new HttpsError(
            "failed-precondition",
            "현재 기금이 소유한 상태가 아니어서 구매를 취소할 수 없습니다.",
        );
    }
    if (accounting.action === "sale_cancel" &&
        (desk.ownerId || isClassFundOwnedDesk(desk))) {
        throw new HttpsError(
            "failed-precondition",
            "현재 국가 소유 상태가 아니어서 매각을 취소할 수 없습니다.",
        );
    }
    const fund = fundSnap.data() || {};
    const balanceBefore = Math.floor(Number(fund.cashBalance || 0));
    if (accounting.cashDelta < 0 && balanceBefore < Math.abs(accounting.cashDelta)) {
        throw new HttpsError(
            "failed-precondition",
            "기금 현금이 부족해 부동산 매각을 취소할 수 없습니다.",
        );
    }

    const now = FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();
    const fundUpdate = {
        cashBalance: FieldValue.increment(accounting.cashDelta),
        realEstateValue: FieldValue.increment(accounting.realEstateValueDelta),
        realEstateCount: FieldValue.increment(accounting.realEstateCountDelta),
        totalValue: FieldValue.increment(accounting.totalValueDelta),
        lastCancellationAt: now,
        updatedAt: now,
    };
    if (accounting.realEstatePurchaseTotalDelta) {
        fundUpdate.realEstatePurchaseTotal = FieldValue.increment(
            accounting.realEstatePurchaseTotalDelta,
        );
    }
    if (accounting.realEstateSaleTotalDelta) {
        fundUpdate.realEstateSaleTotal = FieldValue.increment(
            accounting.realEstateSaleTotalDelta,
        );
    }
    if (accounting.spentTotalDelta) {
        fundUpdate.spentTotal = FieldValue.increment(accounting.spentTotalDelta);
    }
    if (accounting.settledExpenseTotalDelta) {
        fundUpdate.settledExpenseTotal = FieldValue.increment(
            accounting.settledExpenseTotalDelta,
        );
    }
    if (accounting.realizedGainDelta) {
        fundUpdate.realEstateRealizedGain = FieldValue.increment(
            accounting.realizedGainDelta,
        );
    }
    if (accounting.realizedLossDelta) {
        fundUpdate.realEstateRealizedLoss = FieldValue.increment(
            accounting.realizedLossDelta,
        );
    }
    transaction.update(fundRef, fundUpdate);

    const nextDesk = accounting.action === "purchase_cancel" ? {
        ...desk,
        ownerId: null,
        ownerName: "",
        ownerType: "state",
        ownerFundId: null,
        ownerSinceAt: null,
        ownerSource: "class_fund_purchase_cancelled",
        ownerUpdatedAt: nowIso,
        fundAcquisitionPrice: 0,
        lastPurchasePrice: accounting.carryingValue,
        tradeStatus: "idle",
        isForSale: false,
        askingPrice: 0,
        buyerId: null,
        contractState: null,
        purchaseRequests: [],
    } : {
        ...desk,
        ownerId: getClassFundOwnerId(fundId),
        ownerName: fund.name || usage.fundName || "기금",
        ownerType: "classFund",
        ownerFundId: fundId,
        ownerSinceAt: nowIso,
        ownerSource: "class_fund_sale_cancelled",
        ownerUpdatedAt: nowIso,
        fundAcquisitionPrice: accounting.carryingValue,
        lastPurchasePrice: Math.max(
            0,
            Math.floor(Number(trade.tradePrice || trade.amount || 0)),
        ),
        tradeStatus: "idle",
        isForSale: false,
        askingPrice: 0,
        buyerId: null,
        contractState: null,
        purchaseRequests: [],
    };
    const nextGroup = { ...groups[groupIndex] };
    const nextDesks = [...(nextGroup.desks || [])];
    nextDesks[deskIndex] = nextDesk;
    nextGroup.desks = nextDesks;
    groups[groupIndex] = nextGroup;
    stageRealEstateLayout(transaction, layoutRef, { groups, updatedAt: now });

    const reversalRef = db.collection(`classes/${classId}/fundUsages`).doc();
    const reversalLedgerRef = fundRef.collection("ledger").doc();
    linkedUsagesSnap.docs.forEach((doc) => {
        const linkedUsage = doc.data() || {};
        transaction.update(doc.ref, {
            cancellationStatus: "cancelled",
            cancellationReason: reason,
            cancelledBy: actorUid,
            cancelledAt: now,
            reversalUsageId: reversalRef.id,
            reversalLedgerId: reversalLedgerRef.id,
            updatedAt: now,
        });
        if (linkedUsage.taxExpenseId) {
            transaction.set(
                db.doc(`classes/${classId}/taxExpenses/${linkedUsage.taxExpenseId}`),
                {
                    status: "cancelled",
                    isCancelled: true,
                    cancelledAt: now,
                    cancelledBy: actorUid,
                    cancelledReason: "class_fund_real_estate_cancelled",
                },
                { merge: true },
            );
        }
    });
    transaction.set(tradeRef, {
        status: "cancelled",
        isCancelled: true,
        cancellationReason: reason,
        cancelledBy: actorUid,
        cancelledAt: now,
        reversalUsageId: reversalRef.id,
    }, { merge: true });

    const cancelTaxRecord = (collectionName, id) => {
        if (!id) return;
        transaction.set(db.doc(`classes/${classId}/${collectionName}/${id}`), {
            status: "cancelled",
            isCancelled: true,
            cancelledAt: now,
            cancelledBy: actorUid,
            cancelledReason: "class_fund_real_estate_cancelled",
        }, { merge: true });
    };
    if (trade.type === "class_fund_purchase") {
        cancelTaxRecord("taxIncomes", trade.taxAggregateId);
    } else {
        cancelTaxRecord("taxExpenses", trade.taxExpenseId);
        cancelTaxRecord("taxIncomes", trade.capitalGainsTaxIncomeId);
    }

    const direction = accounting.cashDelta > 0 ? "in" : "out";
    const balanceAfter = balanceBefore + accounting.cashDelta;
    transaction.set(reversalRef, {
        fundId,
        fundName: fund.name || usage.fundName || "",
        fundType: fund.fundType || usage.fundType || "general",
        amount: accounting.cashAmount,
        channel: "realEstatePurchase",
        direction,
        usageKind: "cancellation_reversal",
        description: `[부동산 취소] ${trade.deskLabel || deskId}`,
        dateKey: formatDateKeyInKST(new Date()),
        balanceBefore,
        balanceAfter,
        settlementStatus: "not_applicable",
        cancellationStatus: "reversal",
        reversalOfUsageId: usageId,
        relatedRealEstateLedgerId: tradeId,
        relatedDeskId: deskId,
        reason,
        createdBy: actorUid,
        usedAt: now,
        createdAt: now,
        updatedAt: now,
    });
    transaction.set(reversalLedgerRef, {
        type: "real_estate_cancellation",
        direction,
        amount: accounting.cashAmount,
        description: `[부동산 취소] ${trade.deskLabel || deskId}`,
        originalUsageId: usageId,
        reversalUsageId: reversalRef.id,
        relatedRealEstateLedgerId: tradeId,
        relatedDeskId: deskId,
        reason,
        balanceBefore,
        balanceAfter,
        createdBy: actorUid,
        createdAt: now,
    });
    stageActivityLog(transaction, classId, {
        studentUid: actorUid,
        type: "admin_action",
        category: "class_fund_real_estate_cancel",
        amount: accounting.cashAmount,
        description: `기금 부동산 거래 취소: ${trade.deskLabel || deskId}`,
        relatedDoc: { collection: "real_estate_ledger", id: tradeId },
    }, logContext);

    return {
        usageId,
        reversalUsageId: reversalRef.id,
        refundedAmount: accounting.cashDelta > 0 ? accounting.cashAmount : 0,
        debitedAmount: accounting.cashDelta < 0 ? accounting.cashAmount : 0,
        balanceAfter,
        action: accounting.action,
    };
});

/**
 * 임대료 납부
 * - 현재 자리의 입주자만 납부 가능
 * - 날짜는 일 단위로 계산
 * - rentTaxEnabled / rentTaxRate 설정 연동
 */
exports.issueRealEstateHoldingTaxBills = onCall(async (request) => {
    try {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Authentication is required.");
        }

        const { classId, periodStart, periodEnd, dueDate } = request.data || {};
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        await mustBeTeacherOrTaxAdmin(classId, request.auth.uid);

        return runRealEstateTransaction(db, async (transaction) => {
            const classRef = db.doc(`classes/${classId}`);
            const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
            const configRef = db.doc(`classes/${classId}/real_estate/config`);
            const [classSnap, layoutSnap, configSnap] = await Promise.all([
                transaction.get(classRef),
                readRealEstateLayout(db, layoutRef, transaction),
                transaction.get(configRef),
            ]);

            if (!classSnap.exists) {
                throw new HttpsError("not-found", "Class not found.");
            }
            if (!layoutSnap.exists) {
                throw new HttpsError("not-found", "Real estate layout not found.");
            }

            const lateFeePolicy = getTaxBillLateFeePolicy(classSnap.data() || {});
            const config = configSnap.data() || {};
            if (config.enabled === false) {
                throw new HttpsError("failed-precondition", "Real estate system is disabled.");
            }
            if (config.holdingTaxEnabled !== true) {
                throw new HttpsError("failed-precondition", "Holding tax is disabled.");
            }

            const holdingTaxRate = Math.max(0, Number(config.holdingTaxRate || 0));
            let holdingTaxCutoverAt = startOfDayInKST(config?.holdingTaxCutoverAt || new Date());
            if (!holdingTaxCutoverAt) {
                throw new HttpsError("failed-precondition", "\uBCF4\uC720\uC138 \uAE30\uC900\uC77C\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }

            const shouldBackfillCutoverAt = !config?.holdingTaxCutoverAt;

            const resolvedPeriodStart = startOfDayInKST(periodStart || holdingTaxCutoverAt);
            const resolvedPeriodEnd = startOfDayInKST(periodEnd || resolvedPeriodStart);
            if (!resolvedPeriodStart || !resolvedPeriodEnd) {
                throw new HttpsError("invalid-argument", "\uACFC\uC138 \uAE30\uAC04\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }
            if (resolvedPeriodStart.getTime() < holdingTaxCutoverAt.getTime()) {
                throw new HttpsError("failed-precondition", "\uC0C8 \uBCF4\uC720\uC138 \uACC4\uC0B0 \uC2DC\uC791\uC77C \uC774\uC804 \uAE30\uAC04\uC740 \uBC1C\uAE09\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }
            if (resolvedPeriodEnd.getTime() < resolvedPeriodStart.getTime()) {
                throw new HttpsError("invalid-argument", "\uACFC\uC138 \uC885\uB8CC\uC77C\uC740 \uC2DC\uC791\uC77C\uBCF4\uB2E4 \uBE60\uB97C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }

            const today = startOfDayInKST(new Date());
            if (resolvedPeriodEnd.getTime() > today.getTime()) {
                throw new HttpsError("failed-precondition", "\uBBF8\uB798 \uAE30\uAC04\uC758 \uBCF4\uC720\uC138\uB294 \uBC1C\uAE09\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }

            const periodDays = countInclusiveDaysInKST(resolvedPeriodStart, resolvedPeriodEnd);
            if (periodDays <= 0) {
                throw new HttpsError("invalid-argument", "\uACFC\uC138 \uAE30\uAC04\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
            }
            if (periodDays > MAX_HOLDING_TAX_PERIOD_DAYS) {
                throw new HttpsError("failed-precondition", "\uBCF4\uC720\uC138 \uBC1C\uAE09 \uAE30\uAC04\uC740 \uCD5C\uB300 28\uC77C\uAE4C\uC9C0\uB9CC \uC124\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
            }

            const periodEndBoundary = endOfDayInKST(resolvedPeriodEnd);
            const resolvedDueDate = endOfDayInKST(
                dueDate || addCalendarDaysInKST(resolvedPeriodEnd, DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS),
            );
            if (!resolvedDueDate) {
                throw new HttpsError("invalid-argument", "\uB0A9\uBD80 \uAE30\uD55C\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }
            if (resolvedDueDate.getTime() < periodEndBoundary.getTime()) {
                throw new HttpsError("failed-precondition", "\uB0A9\uBD80 \uAE30\uD55C\uC740 \uACFC\uC138 \uC885\uB8CC\uC77C\uBCF4\uB2E4 \uBE60\uB97C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
            }

            const periodKey = buildHoldingTaxPeriodKey(resolvedPeriodStart, resolvedPeriodEnd);
            const periodLabel = `${formatDateKeyInKST(resolvedPeriodStart)} ~ ${formatDateKeyInKST(resolvedPeriodEnd)}`;
            const issuedAt = admin.firestore.Timestamp.fromDate(new Date());
            const periodStartTimestamp = admin.firestore.Timestamp.fromDate(resolvedPeriodStart);
            const periodEndTimestamp = admin.firestore.Timestamp.fromDate(resolvedPeriodEnd);
            const dueDateTimestamp = admin.firestore.Timestamp.fromDate(resolvedDueDate);
            const cutoverTimestamp = admin.firestore.Timestamp.fromDate(holdingTaxCutoverAt);
            const groups = Array.isArray(layoutSnap.data()?.groups) ? layoutSnap.data().groups : [];
            const ownedDeskMap = new Map();

            groups.forEach((group) => {
                (group?.desks || []).forEach((desk) => {
                    if (desk?.isActive === false) return;
                    if (!desk?.ownerId || isClassFundOwnedDesk(desk)) return;

                    if (!ownedDeskMap.has(desk.ownerId)) {
                        ownedDeskMap.set(desk.ownerId, []);
                    }
                    ownedDeskMap.get(desk.ownerId).push(desk);
                });
            });

            let issuedCount = 0;
            let existingCount = 0;
            let skippedCount = 0;
            let totalAmount = 0;
            const pendingBillWrites = [];

            for (const [studentUid, ownedDesks] of ownedDeskMap.entries()) {
                const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
                const studentSnap = await transaction.get(studentRef);
                if (!studentSnap.exists) {
                    skippedCount += 1;
                    continue;
                }

                const breakdown = buildHoldingTaxDeskBreakdown({
                    desks: ownedDesks,
                    periodStart: resolvedPeriodStart,
                    periodEnd: resolvedPeriodEnd,
                    cutoverAt: holdingTaxCutoverAt,
                    holdingTaxRate,
                });
                if (breakdown.amount <= 0 || breakdown.deskCount <= 0) {
                    skippedCount += 1;
                    continue;
                }

                const studentData = studentSnap.data() || {};
                const studentName = String(
                    studentData.name || studentData.displayName || studentUid,
                ).trim();
                const billId = toSafeId(`re_holding__${periodKey}`, "re_holding");
                const billRef = db.doc(`classes/${classId}/students/${studentUid}/taxBills/${billId}`);
                const existingBillSnap = await transaction.get(billRef);

                if (existingBillSnap.exists) {
                    existingCount += 1;
                    continue;
                }

                pendingBillWrites.push({
                    ref: billRef,
                    data: {
                        classId,
                        studentUid,
                        studentName,
                        issuedBy: request.auth.uid,
                        billKind: HOLDING_TAX_BILL_KIND,
                        taxType: "re_holding",
                        name: "\uBCF4\uC720\uC138 \uACE0\uC9C0\uC11C",
                        description: `\uBCF4\uC720\uC138 (${periodLabel})`,
                        amount: breakdown.amount,
                        amountPaid: 0,
                        status: "pending",
                        isPaid: false,
                        issuedAt,
                        createdAt: issuedAt,
                        dueDate: dueDateTimestamp,
                        lateFeePolicy,
                        periodKey,
                        periodStart: periodStartTimestamp,
                        periodEnd: periodEndTimestamp,
                        meta: {
                            deskCount: breakdown.deskCount,
                            totalOfficialPrice: breakdown.totalOfficialPrice,
                            totalHoldingDays: breakdown.totalHoldingDays,
                            taxRate: holdingTaxRate,
                            cutoverAt: cutoverTimestamp,
                            deskIds: breakdown.deskBreakdown.map((desk) => desk.deskId).filter(Boolean),
                            deskBreakdown: breakdown.deskBreakdown,
                        },
                    },
                });

                issuedCount += 1;
                totalAmount += breakdown.amount;
            }

            if (shouldBackfillCutoverAt) {
                transaction.set(
                    configRef,
                    {
                        holdingTaxCutoverAt: admin.firestore.Timestamp.fromDate(holdingTaxCutoverAt),
                    },
                    { merge: true },
                );
            }

            pendingBillWrites.forEach(({ ref, data }) => {
                transaction.set(ref, data);
            });

            const runRef = db.doc(`classes/${classId}/real_estate/holding_tax_runs/runs/${periodKey}`);
            transaction.set(
                runRef,
                {
                    classId,
                    periodKey,
                    periodLabel,
                    periodDays,
                    periodStart: periodStartTimestamp,
                    periodEnd: periodEndTimestamp,
                    dueDate: dueDateTimestamp,
                    cutoverAt: cutoverTimestamp,
                    taxRate: holdingTaxRate,
                    issuedCount,
                    existingCount,
                    skippedCount,
                    totalAmount,
                    issuedBy: request.auth.uid,
                    issuedAt,
                    updatedAt: issuedAt,
                },
                { merge: true },
            );

            return {
                success: true,
                periodKey,
                periodLabel,
                periodDays,
                cutoverDate: formatDateKeyInKST(holdingTaxCutoverAt),
                issuedCount,
                existingCount,
                skippedCount,
                totalAmount,
            };
        });
    } catch (error) {
        console.error("[issueRealEstateHoldingTaxBills] failed:", error);
        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError("internal",
            error?.message ||
                "\uBCF4\uC720\uC138 \uACE0\uC9C0\uC11C \uBC1C\uAE09 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.",
        );
    }
});

exports.syncHoldingTaxStatusSummary = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/taxBills/{billId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, studentUid } = event.params;
        if (!classId || !studentUid) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;
        const beforeRelevant = beforeData?.billKind === HOLDING_TAX_BILL_KIND;
        const afterRelevant = afterData?.billKind === HOLDING_TAX_BILL_KIND;

        if (!beforeRelevant && !afterRelevant) {
            return;
        }

        await recomputeHoldingTaxStatusSummary(classId, studentUid);
    },
);


exports.payRent = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, deskId } = request.data;
    const requestedDays = Math.max(0, toWholeNumber(request.data?.days));
    const requestedWeeks = Math.max(0, toWholeNumber(request.data?.weeks || 1));
    const tenantUid = request.auth.uid;
    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `realestate_rent_${tenantUid}_${deskId}_${Date.now()}`,
    );

    if (!classId || !deskId) {
        throw new HttpsError("invalid-argument", "필수 정보가 누락되었습니다.");
    }

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const tenantRef = db.doc(`classes/${classId}/students/${tenantUid}`);
        const classRef = db.doc(`classes/${classId}`);
        const operationRef = db.doc(
            `classes/${classId}/real_estate/rent_operations/records/pay_${batchKey}`,
        );

        const [layoutSnap, configSnap, tenantSnap, classSnap, operationSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(tenantRef),
            transaction.get(classRef),
            transaction.get(operationRef),
        ]);

        if (operationSnap.exists) {
            return operationSnap.data()?.response || {
                success: true,
                message: "이미 처리된 임대료 납부 요청입니다.",
            };
        }

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }

        if (!tenantSnap.exists) {
            throw new HttpsError("not-found", "입주자 정보를 찾을 수 없습니다.");
        }

        const groups = layoutSnap.data().groups || [];
        const classData = classSnap.data() || {};
        const config = configSnap.data() || {};
        const tenantData = tenantSnap.data();
        const logContext = {
            config: globalConfig,
            planType: classData.planType || "FREE",
            serviceName: "realestate",
        };
        const isSystemEnabled = config.enabled !== false;
        if (!isSystemEnabled) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        let targetGroupIndex = -1;
        let targetDeskIndex = -1;
        let desk = null;

        for (let g = 0; g < groups.length; g++) {
            const dIdx = groups[g].desks.findIndex((d) => d.id === deskId);
            if (dIdx !== -1) {
                targetGroupIndex = g;
                targetDeskIndex = dIdx;
                desk = groups[g].desks[dIdx];
                break;
            }
        }

        if (!desk) {
            throw new HttpsError("not-found", "해당 자리를 찾을 수 없습니다.");
        }

        const resolvedDeskLabel = getResolvedDeskLabel(desk);

        if (desk.studentId !== tenantUid) {
            throw new HttpsError("permission-denied", "현재 배정된 입주자만 임대료를 납부할 수 있습니다.");
        }

        if (desk.ownerId === tenantUid) {
            throw new HttpsError("failed-precondition", "자기 소유 자리에는 임대료 납부가 필요하지 않습니다.");
        }

        const unitRent = Number(desk.weeklyRent || desk.rentPrice || 0);
        const rentContract = buildRentContractContext(desk);
        const isContractMode = rentContract.hasConfiguredContract;
        const paymentDays = isContractMode
            ? (requestedDays || requestedWeeks * RENT_DAYS_PER_WEEK)
            : (requestedDays > 0
                ? requestedDays
                : requestedWeeks * RENT_DAYS_PER_WEEK);
        const legacyWeeks = Math.max(
            0,
            requestedWeeks || Math.floor(paymentDays / RENT_DAYS_PER_WEEK),
        );

        if (paymentDays <= 0) {
            throw new HttpsError("invalid-argument", "납부 일수는 1일 이상이어야 합니다.");
        }

        if (!isContractMode && paymentDays % RENT_DAYS_PER_WEEK !== 0) {
            throw new HttpsError(
                "failed-precondition",
                "계약 등록 전에는 7일 단위로만 납부할 수 있습니다.",
            );
        }

        if (isContractMode && desk.rentTenantId !== tenantUid) {
            throw new HttpsError(
                "failed-precondition",
                "현재 계약에 등록된 임차인만 임대료를 납부할 수 있습니다.",
            );
        }

        if (
            isContractMode &&
            getRentContractLifecycleStatus(desk) !== RENT_CONTRACT_STATUS.ACTIVE
        ) {
            throw new HttpsError(
                "failed-precondition",
                "임대 관리에서 ‘첫 납부’를 완료해 주세요.",
            );
        }

        if (isContractMode) {
            const remainingContractDays = Math.max(
                0,
                rentContract.totalContractDays - rentContract.paidDays,
            );
            if (remainingContractDays <= 0) {
                throw new HttpsError(
                    "failed-precondition",
                    "현재 계약 기간은 모두 납부되었습니다. 연장이 필요하면 새 계약을 등록해 주세요.",
                );
            }
            if (paymentDays > remainingContractDays) {
                throw new HttpsError(
                    "failed-precondition",
                    `현재 계약에서는 ${remainingContractDays}일까지만 추가 납부할 수 있습니다.`,
                );
            }
        }

        const totalRentAmount = isContractMode
            ? calculateCumulativeRentCharge({
                weeklyRent: unitRent,
                paidDays: rentContract.paidDays,
                paidAmount: rentContract.paidAmount,
                requestedDays: paymentDays,
            })
            : unitRent * legacyWeeks;

        if (totalRentAmount <= 0) {
            throw new HttpsError("failed-precondition", "임대료가 설정되어 있지 않습니다.");
        }

        const tenantBalance = tenantData.assets?.cash || 0;
        if (tenantBalance < totalRentAmount) {
            throw new HttpsError("resource-exhausted", `잔액이 부족합니다. (필요 금액: ${totalRentAmount.toLocaleString()})`);
        }

        const now = startOfDayInKST(new Date());
        const currentPaidUntilDate = startOfDayInKST(toDate(desk.rentPaidUntil));
        const rentStartDate = startOfDayInKST(toDate(desk.rentStartAt));

        let startDate = now;
        let newPaidUntil = null;
        let coverageStartDate = null;
        let updatedRentPaidDays = Math.max(0, toWholeNumber(desk?.rentPaidDays));
        let updatedRentPaidAmount = Math.max(0, Number(desk?.rentPaidAmount || 0));
        if (isContractMode) {
            coverageStartDate = addCalendarDaysInKST(
                rentContract.contractStartDate,
                rentContract.paidDays,
            );
            newPaidUntil = addCalendarDaysInKST(
                rentContract.contractStartDate,
                rentContract.paidDays + paymentDays,
            );
            updatedRentPaidDays = rentContract.paidDays + paymentDays;
            updatedRentPaidAmount = rentContract.paidAmount + totalRentAmount;
        } else {
            if (rentStartDate && rentStartDate.getTime() > startDate.getTime()) {
                startDate = rentStartDate;
            }
            if (currentPaidUntilDate && currentPaidUntilDate.getTime() > startDate.getTime()) {
                startDate = currentPaidUntilDate;
            }
            coverageStartDate = startDate;
            newPaidUntil = addCalendarDaysInKST(startDate, legacyWeeks * RENT_DAYS_PER_WEEK);
        }

        const paymentWeeks = paymentDays % RENT_DAYS_PER_WEEK === 0
            ? paymentDays / RENT_DAYS_PER_WEEK
            : null;
        const paymentLabel = paymentWeeks
            ? `${paymentWeeks}주`
            : `${paymentDays}일`;

        transaction.update(tenantRef, {
            "assets.cash": FieldValue.increment(-totalRentAmount),
        });

        const ownerUid = desk.ownerId;
        const isStateOwned = !ownerUid;
        let paymentWithheldTaxAmount = 0;

        stageActivityLog(transaction, classId, {
            studentUid: tenantUid,
            type: "expense",
            category: "real_estate",
            subCategory: "rent_pay",
            amount: totalRentAmount,
            description: `${resolvedDeskLabel} 임대료 납부 (${paymentLabel})`,
            currency: "class_currency",
            taxEvent: isStateOwned ? {
                sourceKey: "realEstateStateRent",
                taxCategory: "state_revenue",
                taxType: "state_rent",
                amount: totalRentAmount,
            } : null,
        }, logContext);

        const paymentRef = db.doc(
            `classes/${classId}/real_estate/rent_payments/records/pay_${batchKey}`,
        );
        const paymentLineKey = toSafeId(paymentRef.id, "rent_payment");
        const tenantName = tenantData.name || "이름 없음";
        const ownerName = desk.ownerId ? (desk.ownerName || "이름 없음") : "국유지";
        const paymentRelatedDoc = {
            collection: "real_estate_rent_payments",
            id: paymentRef.id,
        };
        let taxRecordPointer = null;

        transaction.set(paymentRef, {
            deskId: desk.id,
            deskLabel: resolvedDeskLabel,
            tenantId: tenantUid,
            tenantName,
            ownerId: desk.ownerId || "STATE",
            ownerName,
            amount: totalRentAmount,
            days: paymentDays,
            weeks: paymentWeeks,
            aggregateBatchKey: batchKey,
            paidAt: FieldValue.serverTimestamp(),
            coverageStartAt: coverageStartDate
                ? admin.firestore.Timestamp.fromDate(coverageStartDate)
                : null,
            coverageEndAt: newPaidUntil
                ? admin.firestore.Timestamp.fromDate(newPaidUntil)
                : null,
            rateSnapshot: {
                weeklyRent: unitRent,
            },
            contractId: desk.rentContractId || null,
            contractTenantId: desk.rentTenantId || tenantUid,
            contractTenantName: desk.rentTenantName || tenantName,
            contractStartAt: isContractMode && rentContract.contractStartDate
                ? admin.firestore.Timestamp.fromDate(rentContract.contractStartDate)
                : null,
            contractLastDateAt: isContractMode && rentContract.contractLastDate
                ? admin.firestore.Timestamp.fromDate(rentContract.contractLastDate)
                : null,
            validUntil: admin.firestore.Timestamp.fromDate(newPaidUntil),
        });

        if (isStateOwned) {
            const stateTaxId = `realestate_rent_state_${batchKey}`;
            const stateTaxLineId = `${paymentLineKey}_state_rent`;
            const stateTaxResult = stageTaxIncome(
                transaction,
                classId,
                {
                    amount: totalRentAmount,
                    taxType: "state_rent",
                    description: `${resolvedDeskLabel} 임대료 수익 (국유지)`,
                    studentUid: tenantUid,
                    studentName: tenantName,
                    source: "real_estate",
                },
                "system",
                {
                    ...logContext,
                    classData,
                    sourceKey: "realEstateStateRent",
                    ensurePeriodSettlement: true,
                    customId: stateTaxId,
                    aggregateMeta: {
                        group: "realestate_state_rent",
                        batchKey,
                        pageKey: "realestate",
                        actorUid: tenantUid,
                        actorName: tenantName,
                        mode: "pay_rent_state",
                    },
                    detailLines: [
                        {
                            id: stateTaxLineId,
                            amount: totalRentAmount,
                            source: "real_estate",
                            taxType: "state_rent",
                            description: `${resolvedDeskLabel} 임대료 수익 (국유지)`,
                            studentUid: tenantUid,
                            studentName: tenantName,
                            relatedDoc: paymentRelatedDoc,
                            externalId: stateTaxLineId,
                            meta: {
                                deskId: desk.id,
                                paymentId: paymentRef.id,
                                days: paymentDays,
                                weeks: paymentWeeks,
                                ownerType: "state",
                            },
                        },
                    ],
                    detailCollection: TAX_LINE_COLLECTION,
                }
            );

            if (!stateTaxResult?.skipped && stateTaxResult?.id) {
                taxRecordPointer = buildTaxRecordPointer(
                    "taxIncomes",
                    stateTaxId,
                    stateTaxLineId,
                );
            }
        } else {
            const incomeTaxSnapshot = buildRealEstateRentIncomeTaxSnapshot({
                grossAmount: totalRentAmount,
                config,
            });
            const taxAmount = incomeTaxSnapshot.withheldAmount;
            paymentWithheldTaxAmount = taxAmount;
            const netIncome = incomeTaxSnapshot.netAmount;

            const ownerRef = db.doc(`classes/${classId}/students/${ownerUid}`);
            transaction.update(ownerRef, {
                "assets.cash": FieldValue.increment(netIncome),
            });

            stageActivityLog(transaction, classId, {
                studentUid: ownerUid,
                type: "income",
                category: "real_estate",
                subCategory: "rent_income",
                amount: netIncome,
                grossAmount: incomeTaxSnapshot.grossAmount,
                withheldAmount: incomeTaxSnapshot.withheldAmount,
                netAmount: incomeTaxSnapshot.netAmount,
                incomeTax: incomeTaxSnapshot.incomeTax,
                description: taxAmount > 0
                    ? `${resolvedDeskLabel} 임대료 수익 (${paymentLabel}, 세금: -${taxAmount})`
                    : `${resolvedDeskLabel} 임대료 수익 (${paymentLabel})`,
                currency: "class_currency",
            }, logContext);

            if (taxAmount > 0) {
                const rentTaxId = `realestate_rent_tax_${batchKey}`;
                const rentTaxLineId = `${paymentLineKey}_rent_tax`;
                const rentTaxResult = stageTaxIncome(
                    transaction,
                    classId,
                    {
                        amount: taxAmount,
                        taxType: "rental_income_tax",
                        description: `${resolvedDeskLabel} 임대소득세`,
                        studentUid: ownerUid,
                        studentName: ownerName,
                        source: "real_estate",
                    },
                    "system",
                    {
                        ...logContext,
                        classData,
                        sourceKey: "realEstateRent",
                        ensurePeriodSettlement: true,
                        customId: rentTaxId,
                        aggregateMeta: {
                            group: "realestate_rent_tax",
                            batchKey,
                            pageKey: "realestate",
                            actorUid: tenantUid,
                            actorName: tenantName,
                            mode: "pay_rent_private",
                        },
                        detailLines: [
                            {
                                id: rentTaxLineId,
                                amount: taxAmount,
                                source: "real_estate",
                                taxType: "rental_income_tax",
                                description: `${resolvedDeskLabel} 임대소득세`,
                                studentUid: ownerUid,
                                studentName: ownerName,
                                relatedDoc: paymentRelatedDoc,
                                externalId: rentTaxLineId,
                                meta: {
                                    deskId: desk.id,
                                    paymentId: paymentRef.id,
                                    days: paymentDays,
                                    weeks: paymentWeeks,
                                    ownerType: "private",
                                    incomeTax: incomeTaxSnapshot.incomeTax,
                                },
                            },
                        ],
                        detailCollection: TAX_LINE_COLLECTION,
                    }
                );

                if (!rentTaxResult?.skipped && rentTaxResult?.id) {
                    taxRecordPointer = buildTaxRecordPointer(
                        "taxIncomes",
                        rentTaxId,
                        rentTaxLineId,
                    );
                }
            }
        }

        if (taxRecordPointer) {
            transaction.set(
                paymentRef,
                {
                    taxRecord: taxRecordPointer,
                    taxRecordedAt: FieldValue.serverTimestamp(),
                    taxCancelled: false,
                },
                { merge: true },
            );
        }

        const updatedGroups = [...groups];
        updatedGroups[targetGroupIndex].desks[targetDeskIndex] = {
            ...desk,
            rentPaidDays: updatedRentPaidDays,
            rentPaidAmount: updatedRentPaidAmount,
            rentPaidWithheldTaxAmount:
                Math.max(0, toWholeNumber(desk.rentPaidWithheldTaxAmount)) +
                paymentWithheldTaxAmount,
            rentPaidUntil: admin.firestore.Timestamp.fromDate(newPaidUntil),
        };

        stageRealEstateLayout(transaction, layoutRef, { groups: updatedGroups });

        const response = {
            success: true,
            message: `${paymentLabel} 임대료 납부가 완료되었습니다.`,
            newPaidUntil: newPaidUntil.toISOString(),
        };
        transaction.set(operationRef, {
            type: "rent_payment",
            clientRequestId: request.data?.clientRequestId || null,
            contractId: desk.rentContractId || null,
            deskId: desk.id,
            tenantId: tenantUid,
            response,
            createdAt: FieldValue.serverTimestamp(),
        });
        return response;
    });
});

exports.payRentDeposit = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, deskId } = request.data || {};
    const tenantUid = request.auth.uid;
    if (!classId || !deskId) {
        throw new HttpsError("invalid-argument", "classId와 deskId가 필요합니다.");
    }
    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        request.data,
        `realestate_start_${tenantUid}_${deskId}_${Date.now()}`,
    );

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const tenantRef = db.doc(`classes/${classId}/students/${tenantUid}`);
        const classRef = db.doc(`classes/${classId}`);
        const operationRef = db.doc(
            `classes/${classId}/real_estate/rent_operations/records/start_${batchKey}`,
        );
        const [layoutSnap, configSnap, tenantSnap, classSnap, operationSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(tenantRef),
            transaction.get(classRef),
            transaction.get(operationRef),
        ]);

        if (operationSnap.exists) {
            return operationSnap.data()?.response || {
                success: true,
                message: "이미 처리된 첫 납부입니다.",
            };
        }

        if (!layoutSnap.exists || !tenantSnap.exists) {
            throw new HttpsError("not-found", "임대 계약 또는 임차인 정보를 찾을 수 없습니다.");
        }
        if (configSnap.data()?.enabled === false) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const groups = Array.isArray(layoutSnap.data()?.groups) ? layoutSnap.data().groups : [];
        let groupIndex = -1;
        let deskIndex = -1;
        let desk = null;
        for (let g = 0; g < groups.length; g++) {
            const d = (groups[g]?.desks || []).findIndex((item) => item?.id === deskId);
            if (d >= 0) {
                groupIndex = g;
                deskIndex = d;
                desk = groups[g].desks[d];
                break;
            }
        }
        if (!desk) throw new HttpsError("not-found", "대상 자리를 찾을 수 없습니다.");

        const deposit = getRentDepositSnapshot(desk);
        if (
            desk.studentId !== tenantUid ||
            String(desk.rentTenantId || "") !== tenantUid
        ) {
            throw new HttpsError("permission-denied", "현재 계약의 임차인만 보증금을 납부할 수 있습니다.");
        }
        const rentContract = buildRentContractContext(desk);
        if (!desk.rentContractId || !rentContract.hasConfiguredContract) {
            throw new HttpsError("failed-precondition", "시작할 임대 계약이 없습니다.");
        }
        if (getRentContractLifecycleStatus(desk) === RENT_CONTRACT_STATUS.ACTIVE) {
            throw new HttpsError("already-exists", "이미 시작된 임대 계약입니다.");
        }

        const today = startOfDayInKST(new Date());
        const elapsedContractDays = today.getTime() < rentContract.contractStartDate.getTime()
            ? 0
            : countInclusiveDaysInKST(
                rentContract.contractStartDate,
                today.getTime() > rentContract.contractLastDate.getTime()
                    ? rentContract.contractLastDate
                    : today,
            );
        const initialPaymentDays = calculateInitialPrepaidDays({
            totalContractDays: rentContract.totalContractDays,
            elapsedContractDays,
        });
        const unitRent = getDeskWeeklyRentAmount(desk);
        const initialRentAmount = calculateCumulativeRentCharge({
            weeklyRent: unitRent,
            paidDays: rentContract.paidDays,
            paidAmount: rentContract.paidAmount,
            requestedDays: initialPaymentDays,
        });
        const totalPaymentAmount = deposit.amount + initialRentAmount;

        const tenantData = tenantSnap.data() || {};
        const tenantCash = Math.max(0, Number(tenantData?.assets?.cash || 0));
        if (tenantCash < totalPaymentAmount) {
            throw new HttpsError(
                "resource-exhausted",
                `잔액이 부족합니다. (필요 금액: ${totalPaymentAmount.toLocaleString()})`,
            );
        }

        const ownerUid = String(desk.ownerId || "").trim();
        const ownerRef = ownerUid ? db.doc(`classes/${classId}/students/${ownerUid}`) : null;
        if (ownerRef) {
            const ownerSnap = await transaction.get(ownerRef);
            if (!ownerSnap.exists) throw new HttpsError("not-found", "임대인 정보를 찾을 수 없습니다.");
        }

        const config = configSnap.data() || {};
        const incomeTaxSnapshot = ownerRef
            ? buildRealEstateRentIncomeTaxSnapshot({ grossAmount: initialRentAmount, config })
            : null;
        const rentNetAmount = incomeTaxSnapshot?.netAmount || 0;
        const ownerCreditAmount = deposit.amount + rentNetAmount;

        transaction.update(tenantRef, {
            "assets.cash": FieldValue.increment(-totalPaymentAmount),
        });
        if (ownerRef && ownerCreditAmount > 0) {
            transaction.update(ownerRef, {
                "assets.cash": FieldValue.increment(ownerCreditAmount),
            });
        }

        const deskLabel = getResolvedDeskLabel(desk);
        const tenantName = tenantData.name || desk.studentName || "이름 없음";
        const logContext = {
            config: globalConfig,
            planType: classSnap.data()?.planType || "FREE",
            serviceName: "realestate",
        };
        const recordRef = db.doc(
            `classes/${classId}/real_estate/rent_deposits/records/${desk.rentContractId}_payment`,
        );
        if (deposit.amount > 0) {
            transaction.set(recordRef, {
                type: "payment",
                contractId: desk.rentContractId,
                deskId: desk.id,
                deskLabel,
                tenantId: tenantUid,
                tenantName,
                ownerId: ownerUid || "STATE",
                ownerName: ownerUid ? (desk.ownerName || "이름 없음") : "국유지",
                amount: deposit.amount,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: tenantUid,
            });

            stageActivityLog(transaction, classId, {
                studentUid: tenantUid,
                type: "expense",
                category: "real_estate",
                subCategory: "rent_deposit_payment",
                amount: deposit.amount,
                description: `${deskLabel} 임대 보증금 납부`,
                currency: "class_currency",
            }, { ...logContext, customId: `rent_start_deposit_pay_${batchKey}` });
            if (ownerUid) {
                stageActivityLog(transaction, classId, {
                    studentUid: ownerUid,
                    type: "income",
                    category: "real_estate",
                    subCategory: "rent_deposit_received",
                    amount: deposit.amount,
                    description: `${deskLabel} 임대 보증금 수령 (반환 의무)`,
                    currency: "class_currency",
                }, { ...logContext, customId: `rent_start_deposit_income_${batchKey}` });
            }
        }

        const coverageStartAt = rentContract.contractStartDate;
        const coverageEndAt = addCalendarDaysInKST(
            rentContract.contractStartDate,
            rentContract.paidDays + initialPaymentDays,
        );
        const paymentRef = db.doc(
            `classes/${classId}/real_estate/rent_payments/records/start_${batchKey}`,
        );
        const ownerName = ownerUid ? (desk.ownerName || "이름 없음") : "국유지";
        const paymentWeeks = initialPaymentDays % RENT_DAYS_PER_WEEK === 0
            ? initialPaymentDays / RENT_DAYS_PER_WEEK
            : null;
        const paymentLabel = paymentWeeks ? `${paymentWeeks}주` : `${initialPaymentDays}일`;
        const paymentRelatedDoc = {
            collection: "real_estate_rent_payments",
            id: paymentRef.id,
        };
        let taxRecordPointer = null;

        transaction.set(paymentRef, {
            deskId: desk.id,
            deskLabel,
            tenantId: tenantUid,
            tenantName,
            ownerId: ownerUid || "STATE",
            ownerName,
            amount: initialRentAmount,
            days: initialPaymentDays,
            weeks: paymentWeeks,
            paymentKind: "contract_start",
            aggregateBatchKey: batchKey,
            paidAt: FieldValue.serverTimestamp(),
            coverageStartAt: admin.firestore.Timestamp.fromDate(coverageStartAt),
            coverageEndAt: admin.firestore.Timestamp.fromDate(coverageEndAt),
            validUntil: admin.firestore.Timestamp.fromDate(coverageEndAt),
            rateSnapshot: { weeklyRent: unitRent },
            contractId: desk.rentContractId,
            contractTenantId: tenantUid,
            contractTenantName: desk.rentTenantName || tenantName,
            contractStartAt: admin.firestore.Timestamp.fromDate(rentContract.contractStartDate),
            contractLastDateAt: admin.firestore.Timestamp.fromDate(rentContract.contractLastDate),
        });

        stageActivityLog(transaction, classId, {
            studentUid: tenantUid,
            type: "expense",
            category: "real_estate",
            subCategory: "rent_pay",
            amount: initialRentAmount,
            description: `${deskLabel} 계약 시작 임대료 납부 (${paymentLabel})`,
            currency: "class_currency",
            taxEvent: ownerUid ? null : {
                sourceKey: "realEstateStateRent",
                taxCategory: "state_revenue",
                taxType: "state_rent",
                amount: initialRentAmount,
            },
        }, { ...logContext, customId: `rent_start_pay_${batchKey}` });

        const classData = classSnap.data() || {};
        const paymentLineKey = toSafeId(paymentRef.id, "rent_start");
        if (!ownerUid) {
            const stateTaxId = `realestate_rent_state_${batchKey}`;
            const stateTaxLineId = `${paymentLineKey}_state_rent`;
            const stateTaxResult = stageTaxIncome(transaction, classId, {
                amount: initialRentAmount,
                taxType: "state_rent",
                description: `${deskLabel} 임대료 수익 (국유지)`,
                studentUid: tenantUid,
                studentName: tenantName,
                source: "real_estate",
            }, "system", {
                ...logContext,
                classData,
                sourceKey: "realEstateStateRent",
                ensurePeriodSettlement: true,
                customId: stateTaxId,
                aggregateMeta: {
                    group: "realestate_state_rent",
                    batchKey,
                    pageKey: "realestate",
                    actorUid: tenantUid,
                    actorName: tenantName,
                    mode: "start_rent_state",
                },
                detailLines: [{
                    id: stateTaxLineId,
                    amount: initialRentAmount,
                    source: "real_estate",
                    taxType: "state_rent",
                    description: `${deskLabel} 임대료 수익 (국유지)`,
                    studentUid: tenantUid,
                    studentName: tenantName,
                    relatedDoc: paymentRelatedDoc,
                    externalId: stateTaxLineId,
                    meta: { deskId: desk.id, paymentId: paymentRef.id, days: initialPaymentDays },
                }],
                detailCollection: TAX_LINE_COLLECTION,
            });
            if (!stateTaxResult?.skipped && stateTaxResult?.id) {
                taxRecordPointer = buildTaxRecordPointer("taxIncomes", stateTaxId, stateTaxLineId);
            }
        } else {
            const taxAmount = incomeTaxSnapshot.withheldAmount;
            stageActivityLog(transaction, classId, {
                studentUid: ownerUid,
                type: "income",
                category: "real_estate",
                subCategory: "rent_income",
                amount: rentNetAmount,
                grossAmount: incomeTaxSnapshot.grossAmount,
                withheldAmount: taxAmount,
                netAmount: rentNetAmount,
                incomeTax: incomeTaxSnapshot.incomeTax,
                description: taxAmount > 0
                    ? `${deskLabel} 계약 시작 임대료 수익 (${paymentLabel}, 세금: -${taxAmount})`
                    : `${deskLabel} 계약 시작 임대료 수익 (${paymentLabel})`,
                currency: "class_currency",
            }, { ...logContext, customId: `rent_start_income_${batchKey}` });

            if (taxAmount > 0) {
                const rentTaxId = `realestate_rent_tax_${batchKey}`;
                const rentTaxLineId = `${paymentLineKey}_rent_tax`;
                const rentTaxResult = stageTaxIncome(transaction, classId, {
                    amount: taxAmount,
                    taxType: "rental_income_tax",
                    description: `${deskLabel} 임대소득세`,
                    studentUid: ownerUid,
                    studentName: ownerName,
                    source: "real_estate",
                }, "system", {
                    ...logContext,
                    classData,
                    sourceKey: "realEstateRent",
                    ensurePeriodSettlement: true,
                    customId: rentTaxId,
                    aggregateMeta: {
                        group: "realestate_rent_tax",
                        batchKey,
                        pageKey: "realestate",
                        actorUid: tenantUid,
                        actorName: tenantName,
                        mode: "start_rent_private",
                    },
                    detailLines: [{
                        id: rentTaxLineId,
                        amount: taxAmount,
                        source: "real_estate",
                        taxType: "rental_income_tax",
                        description: `${deskLabel} 임대소득세`,
                        studentUid: ownerUid,
                        studentName: ownerName,
                        relatedDoc: paymentRelatedDoc,
                        externalId: rentTaxLineId,
                        meta: { deskId: desk.id, paymentId: paymentRef.id, days: initialPaymentDays },
                    }],
                    detailCollection: TAX_LINE_COLLECTION,
                });
                if (!rentTaxResult?.skipped && rentTaxResult?.id) {
                    taxRecordPointer = buildTaxRecordPointer("taxIncomes", rentTaxId, rentTaxLineId);
                }
            }
        }

        if (taxRecordPointer) {
            transaction.set(paymentRef, {
                taxRecord: taxRecordPointer,
                taxRecordedAt: FieldValue.serverTimestamp(),
                taxCancelled: false,
            }, { merge: true });
        }

        const updatedGroups = [...groups];
        updatedGroups[groupIndex] = {
            ...updatedGroups[groupIndex],
            desks: [...updatedGroups[groupIndex].desks],
        };
        updatedGroups[groupIndex].desks[deskIndex] = {
            ...desk,
            rentContractStatus: RENT_CONTRACT_STATUS.ACTIVE,
            rentActivatedAt: admin.firestore.Timestamp.fromDate(new Date()),
            rentPaidDays: rentContract.paidDays + initialPaymentDays,
            rentPaidAmount: rentContract.paidAmount + initialRentAmount,
            rentPaidUntil: admin.firestore.Timestamp.fromDate(coverageEndAt),
            rentInitialPaymentDays: initialPaymentDays,
            rentInitialPaymentAmount: initialRentAmount,
            rentPaidWithheldTaxAmount: incomeTaxSnapshot?.withheldAmount || 0,
            rentDepositStatus: deposit.amount > 0
                ? RENT_DEPOSIT_STATUS.PAID
                : RENT_DEPOSIT_STATUS.NOT_REQUIRED,
            rentDepositPaidAmount: deposit.amount,
            rentDepositReturnedAmount: 0,
            rentDepositDeductedAmount: 0,
            rentDepositPaidAt: admin.firestore.Timestamp.fromDate(new Date()),
            rentDepositReturnedAt: null,
            rentDepositSettlementReason: null,
        };
        stageRealEstateLayout(transaction, layoutRef, { groups: updatedGroups, updatedAt: FieldValue.serverTimestamp() });

        const response = {
            success: true,
            message: `첫 납부 금액 ${totalPaymentAmount.toLocaleString()}을 납부했습니다.`,
            depositAmount: deposit.amount,
            rentAmount: initialRentAmount,
            prepaidDays: initialPaymentDays,
        };
        transaction.set(operationRef, {
            type: "rent_contract_start",
            clientRequestId: request.data?.clientRequestId || null,
            contractId: desk.rentContractId,
            deskId: desk.id,
            tenantId: tenantUid,
            response,
            createdAt: FieldValue.serverTimestamp(),
        });
        return response;
    });
});

exports.settleRentDeposit = onCall(async (request) => {
    const { classId, deskId, deductionAmount: rawDeduction, reason, forceSettle } = request.data || {};
    if (!classId || !deskId) {
        throw new HttpsError("invalid-argument", "classId와 deskId가 필요합니다.");
    }
    const actorCtx = getRealEstateAuthContext(request, classId);
    const globalConfig = await getGlobalConfig();

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const actorRef = db.doc(`classes/${classId}/students/${actorCtx.uid}`);
        const classRef = db.doc(`classes/${classId}`);
        const [layoutSnap, configSnap, actorSnap, classSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(actorRef),
            transaction.get(classRef),
        ]);
        if (!layoutSnap.exists) throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        if (!actorCtx.isAdmin && !actorSnap.exists) {
            throw new HttpsError("permission-denied", "같은 학급 구성원만 처리할 수 있습니다.");
        }
        if (configSnap.data()?.enabled === false) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const groups = Array.isArray(layoutSnap.data()?.groups) ? layoutSnap.data().groups : [];
        let groupIndex = -1;
        let deskIndex = -1;
        let desk = null;
        for (let g = 0; g < groups.length; g++) {
            const d = (groups[g]?.desks || []).findIndex((item) => item?.id === deskId);
            if (d >= 0) {
                groupIndex = g;
                deskIndex = d;
                desk = groups[g].desks[d];
                break;
            }
        }
        if (!desk) throw new HttpsError("not-found", "대상 자리를 찾을 수 없습니다.");

        const isOwner = String(desk.ownerId || "") === actorCtx.uid;
        if (!(isOwner || actorCtx.canManageRealEstate)) {
            throw new HttpsError("permission-denied", "임대인 또는 담당 교사만 보증금을 정산할 수 있습니다.");
        }
        const deposit = getRentDepositSnapshot(desk);
        if (deposit.outstandingAmount <= 0) {
            throw new HttpsError("failed-precondition", "정산할 보증금이 없습니다.");
        }

        const today = startOfDayInKST(new Date());
        const contractLastDate = startOfDayInKST(toDate(desk.rentLastDateAt));
        if (!actorCtx.canManageRealEstate && contractLastDate && today.getTime() <= contractLastDate.getTime()) {
            throw new HttpsError("failed-precondition", "실제거주 마지막일이 지난 뒤 정산할 수 있습니다.");
        }

        const tenantUid = String(desk.rentTenantId || "").trim();
        if (!tenantUid) throw new HttpsError("failed-precondition", "계약 임차인을 찾을 수 없습니다.");
        const ownerUid = String(desk.ownerId || "").trim();
        const tenantRef = db.doc(`classes/${classId}/students/${tenantUid}`);
        const ownerRef = ownerUid ? db.doc(`classes/${classId}/students/${ownerUid}`) : null;
        const tenantSnap = tenantUid === actorCtx.uid ? actorSnap : await transaction.get(tenantRef);
        const ownerSnap = ownerRef
            ? (ownerUid === actorCtx.uid ? actorSnap : await transaction.get(ownerRef))
            : null;
        if (!tenantSnap.exists || (ownerRef && !ownerSnap.exists)) {
            throw new HttpsError("not-found", "임대 당사자 정보를 찾을 수 없습니다.");
        }

        const unpaidRentAmount = calculateRentDepositUnpaidAmount(desk, today);
        const requestedDeduction = Math.max(0, toWholeNumber(rawDeduction));
        const settlementReason = String(reason || "").trim();
        if (!actorCtx.canManageRealEstate && requestedDeduction > unpaidRentAmount) {
            throw new HttpsError(
                "failed-precondition",
                `임대인은 미납 임대료 ${unpaidRentAmount.toLocaleString()}까지만 차감할 수 있습니다.`,
            );
        }
        if (requestedDeduction > 0 && !settlementReason) {
            throw new HttpsError("invalid-argument", "보증금 차감 사유를 입력해 주세요.");
        }

        const deductionAmount = Math.min(deposit.outstandingAmount, requestedDeduction);
        const refundDue = Math.max(0, deposit.outstandingAmount - deductionAmount);
        const ownerCash = ownerSnap ? Math.max(0, Number(ownerSnap.data()?.assets?.cash || 0)) : refundDue;
        const teacherForceSettle = actorCtx.canManageRealEstate && forceSettle === true;
        const ownerDebitAmount = ownerRef ? Math.min(ownerCash, refundDue) : 0;
        const refundAmount = ownerRef && !teacherForceSettle ? ownerDebitAmount : refundDue;
        const systemCoveredAmount = ownerRef ? Math.max(0, refundAmount - ownerDebitAmount) : 0;
        const remainingAmount = Math.max(0, deposit.outstandingAmount - deductionAmount - refundAmount);

        if (refundAmount > 0) {
            transaction.update(tenantRef, { "assets.cash": FieldValue.increment(refundAmount) });
        }
        if (ownerRef && ownerDebitAmount > 0) {
            transaction.update(ownerRef, { "assets.cash": FieldValue.increment(-ownerDebitAmount) });
        }

        const deskLabel = getResolvedDeskLabel(desk);
        const logContext = {
            config: globalConfig,
            planType: classSnap.data()?.planType || "FREE",
            serviceName: "realestate",
        };
        const recordRef = db.collection(`classes/${classId}/real_estate/rent_deposits/records`).doc();
        transaction.set(recordRef, {
            type: remainingAmount > 0 ? "partial_settlement" : "settlement",
            contractId: desk.rentContractId,
            deskId: desk.id,
            deskLabel,
            tenantId: tenantUid,
            tenantName: desk.rentTenantName || desk.studentName || "이름 없음",
            ownerId: ownerUid || "STATE",
            ownerName: ownerUid ? (desk.ownerName || "이름 없음") : "국유지",
            refundAmount,
            deductionAmount,
            remainingAmount,
            unpaidRentAmount,
            systemCoveredAmount,
            reason: settlementReason || null,
            forcedByTeacher: teacherForceSettle,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actorCtx.uid,
        });

        if (refundAmount > 0) {
            stageActivityLog(transaction, classId, {
                studentUid: tenantUid,
                type: "income",
                category: "real_estate",
                subCategory: "rent_deposit_refund",
                amount: refundAmount,
                description: `${deskLabel} 임대 보증금 반환`,
                currency: "class_currency",
            }, logContext);
        }
        if (ownerUid && ownerDebitAmount > 0) {
            stageActivityLog(transaction, classId, {
                studentUid: ownerUid,
                type: "expense",
                category: "real_estate",
                subCategory: "rent_deposit_refund",
                amount: ownerDebitAmount,
                description: `${deskLabel} 임대 보증금 반환`,
                currency: "class_currency",
            }, logContext);
        }
        if (deductionAmount > 0) {
            stageActivityLog(transaction, classId, {
                studentUid: tenantUid,
                type: "system",
                category: "real_estate",
                subCategory: "rent_deposit_deduction",
                amount: deductionAmount,
                description: `${deskLabel} 임대 보증금 차감 (${settlementReason})`,
                currency: "class_currency",
            }, logContext);
        }
        if (remainingAmount > 0) {
            stageActivityLog(transaction, classId, {
                studentUid: tenantUid,
                type: "system",
                category: "real_estate",
                subCategory: "rent_deposit_return_pending",
                amount: remainingAmount,
                description: `${deskLabel} 임대 보증금 반환 대기 (임대인 잔액 부족)`,
                currency: "class_currency",
            }, logContext);
        }

        const updatedGroups = [...groups];
        updatedGroups[groupIndex] = {
            ...updatedGroups[groupIndex],
            desks: [...updatedGroups[groupIndex].desks],
        };
        updatedGroups[groupIndex].desks[deskIndex] = {
            ...desk,
            rentDepositStatus: remainingAmount > 0
                ? RENT_DEPOSIT_STATUS.RETURN_PENDING
                : RENT_DEPOSIT_STATUS.SETTLED,
            rentDepositReturnedAmount: deposit.returnedAmount + refundAmount,
            rentDepositDeductedAmount: deposit.deductedAmount + deductionAmount,
            rentDepositReturnedAt: remainingAmount > 0
                ? null
                : admin.firestore.Timestamp.fromDate(new Date()),
            rentDepositSettlementReason: settlementReason || null,
        };
        stageRealEstateLayout(transaction, layoutRef, { groups: updatedGroups, updatedAt: FieldValue.serverTimestamp() });

        return {
            success: true,
            message: remainingAmount > 0
                ? `${refundAmount.toLocaleString()}을 반환했고 ${remainingAmount.toLocaleString()}은 반환 대기 상태입니다.`
                : `보증금 정산이 완료되었습니다. 반환 ${refundAmount.toLocaleString()}, 차감 ${deductionAmount.toLocaleString()}`,
        };
    });
});

exports.settleExpiredStateRentDeposits = onSchedule(
    {
        schedule: "10 0 * * *",
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async () => {
        const [classesSnap, globalConfig] = await Promise.all([
            db.collection("classes").get(),
            getGlobalConfig(),
        ]);
        const today = startOfDayInKST(new Date());
        let settledCount = 0;

        for (const classSnap of classesSnap.docs) {
            const classId = classSnap.id;
            const classData = classSnap.data() || {};
            const classSettledCount = await runRealEstateTransaction(db, async (transaction) => {
                const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
                const layoutSnap = await readRealEstateLayout(db, layoutRef, transaction);
                if (!layoutSnap.exists) return 0;

                const groups = Array.isArray(layoutSnap.data()?.groups)
                    ? layoutSnap.data().groups
                    : [];
                const candidates = [];
                groups.forEach((group, groupIndex) => {
                    (group?.desks || []).forEach((desk, deskIndex) => {
                        const deposit = getRentDepositSnapshot(desk);
                        const lastDate = startOfDayInKST(toDate(desk?.rentLastDateAt));
                        if (
                            !desk?.ownerId &&
                            desk?.rentContractId &&
                            deposit.outstandingAmount > 0 &&
                            deposit.status === RENT_DEPOSIT_STATUS.PAID &&
                            lastDate &&
                            today.getTime() > lastDate.getTime()
                        ) {
                            candidates.push({ groupIndex, deskIndex, desk, deposit });
                        }
                    });
                });
                if (candidates.length === 0) return 0;

                const tenantRefsById = new Map();
                candidates.forEach(({ desk }) => {
                    const tenantUid = String(desk.rentTenantId || "").trim();
                    if (tenantUid && !tenantRefsById.has(tenantUid)) {
                        tenantRefsById.set(
                            tenantUid,
                            db.doc(`classes/${classId}/students/${tenantUid}`),
                        );
                    }
                });
                const tenantRefs = [...tenantRefsById.values()];
                const tenantSnaps = tenantRefs.length > 0
                    ? await transaction.getAll(...tenantRefs)
                    : [];
                const existingTenantIds = new Set(
                    tenantSnaps.filter((snap) => snap.exists).map((snap) => snap.id),
                );

                const updatedGroups = groups.map((group) => ({
                    ...group,
                    desks: Array.isArray(group?.desks) ? [...group.desks] : [],
                }));
                const tenantRefunds = new Map();
                let processedCount = 0;
                const logContext = {
                    config: globalConfig,
                    planType: classData.planType || "FREE",
                    serviceName: "realestate",
                };

                candidates.forEach(({ groupIndex, deskIndex, desk, deposit }) => {
                    const tenantUid = String(desk.rentTenantId || "").trim();
                    if (!tenantUid || !existingTenantIds.has(tenantUid)) return;

                    const deductionAmount = Math.min(
                        deposit.outstandingAmount,
                        calculateRentDepositUnpaidAmount(desk, today),
                    );
                    const refundAmount = Math.max(0, deposit.outstandingAmount - deductionAmount);
                    const deskLabel = getResolvedDeskLabel(desk);
                    if (refundAmount > 0) {
                        tenantRefunds.set(
                            tenantUid,
                            (tenantRefunds.get(tenantUid) || 0) + refundAmount,
                        );
                        stageActivityLog(transaction, classId, {
                            studentUid: tenantUid,
                            type: "income",
                            category: "real_estate",
                            subCategory: "rent_deposit_refund",
                            amount: refundAmount,
                            description: `${deskLabel} 국유지 임대 보증금 자동 반환`,
                            currency: "class_currency",
                        }, logContext);
                    }
                    if (deductionAmount > 0) {
                        stageActivityLog(transaction, classId, {
                            studentUid: tenantUid,
                            type: "system",
                            category: "real_estate",
                            subCategory: "rent_deposit_deduction",
                            amount: deductionAmount,
                            description: `${deskLabel} 국유지 임대 보증금 차감 (미납 임대료)`,
                            currency: "class_currency",
                        }, logContext);
                    }

                    const recordRef = db.doc(
                        `classes/${classId}/real_estate/rent_deposits/records/${desk.rentContractId}_state_auto_settlement`,
                    );
                    transaction.set(recordRef, {
                        type: "automatic_state_settlement",
                        contractId: desk.rentContractId,
                        deskId: desk.id,
                        deskLabel,
                        tenantId: tenantUid,
                        tenantName: desk.rentTenantName || desk.studentName || "이름 없음",
                        ownerId: "STATE",
                        ownerName: "국유지",
                        refundAmount,
                        deductionAmount,
                        remainingAmount: 0,
                        reason: deductionAmount > 0 ? "미납 임대료 자동 차감" : null,
                        createdAt: FieldValue.serverTimestamp(),
                        createdBy: "system",
                    });
                    updatedGroups[groupIndex].desks[deskIndex] = {
                        ...desk,
                        rentDepositStatus: RENT_DEPOSIT_STATUS.SETTLED,
                        rentDepositReturnedAmount: deposit.returnedAmount + refundAmount,
                        rentDepositDeductedAmount: deposit.deductedAmount + deductionAmount,
                        rentDepositReturnedAt: admin.firestore.Timestamp.fromDate(new Date()),
                        rentDepositSettlementReason: deductionAmount > 0
                            ? "미납 임대료 자동 차감"
                            : null,
                    };
                    processedCount += 1;
                });

                tenantRefunds.forEach((amount, tenantUid) => {
                    transaction.update(tenantRefsById.get(tenantUid), {
                        "assets.cash": FieldValue.increment(amount),
                    });
                });
                if (processedCount > 0) {
                    stageRealEstateLayout(transaction, layoutRef, {
                        groups: updatedGroups,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                return processedCount;
            });
            settledCount += classSettledCount;
        }

        console.log(`[realestate] expired state rent deposits settled: ${settledCount}`);
    },
);

/**
 * 시세 조정 (교사 전용)
 * - 경제 이벤트에 따른 부동산 시세 변동
 * - layout 업데이트 + ledger 기록
 */
exports.updateRealEstateDeskState = onCall(async (request) => {
    const { classId, deskId, action, payload = {} } = request.data || {};

    if (!classId || !deskId || !action) {
        throw new HttpsError("invalid-argument", "classId, deskId, action은 필수입니다.");
    }

    const actorCtx = getRealEstateAuthContext(request, classId);
    const actorUid = actorCtx.uid;
    const globalConfig = await getGlobalConfig();
    const allowWhenDisabledActions = new Set([
        "submit_signature",
        "cancel_contract",
        "cancel_sale",
        "cancel_purchase_request",
    ]);

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const actorRef = db.doc(`classes/${classId}/students/${actorUid}`);

        const [layoutSnap, configSnap, actorSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(actorRef),
        ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }

        if (!actorCtx.isAdmin && !actorSnap.exists) {
            throw new HttpsError("permission-denied", "같은 학급 구성원만 처리할 수 있습니다.");
        }

        const config = configSnap.data() || {};
        const isSystemEnabled = config.enabled !== false;
        if (!isSystemEnabled && !allowWhenDisabledActions.has(action)) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const actorData = actorSnap.exists ? actorSnap.data() : {};
        const actorName = String(
            actorData?.name ||
            actorData?.displayName ||
            request.auth.token?.name ||
            request.auth.token?.email ||
            "익명",
        ).trim() || "익명";

        const groups = Array.isArray(layoutSnap.data()?.groups)
            ? layoutSnap.data().groups
            : [];

        let targetGroupIndex = -1;
        let targetDeskIndex = -1;
        let targetDesk = null;

        for (let g = 0; g < groups.length; g++) {
            const desks = Array.isArray(groups[g]?.desks) ? groups[g].desks : [];
            const dIdx = desks.findIndex((desk) => desk?.id === deskId);
            if (dIdx !== -1) {
                targetGroupIndex = g;
                targetDeskIndex = dIdx;
                targetDesk = desks[dIdx];
                break;
            }
        }

        if (!targetDesk) {
            throw new HttpsError("not-found", "대상 자리를 찾을 수 없습니다.");
        }

        if (isClassFundOwnedDesk(targetDesk)) {
            throw new HttpsError(
                "failed-precondition",
                "기금 소유 부동산은 기금 모드에서만 관리할 수 있습니다.",
            );
        }

        const canManageClass = actorCtx.canManageRealEstate;
        const isStateOwned = !targetDesk.ownerId;
        const isOwner = targetDesk.ownerId === actorUid;
        const isBuyer = targetDesk.buyerId === actorUid;
        const isAccountSwitching = request.auth.token?.sw === true;
        const canRepresentStateOwner = !isAccountSwitching && (actorCtx.isAdmin || actorCtx.isTeacher);
        const isSeller = isOwner || (isStateOwned && canRepresentStateOwner);
        const targetContract =
            typeof targetDesk.contractState === "object" && targetDesk.contractState
                ? targetDesk.contractState
                : {};
        const hasSelectedContract =
            targetDesk.tradeStatus === "contracting" &&
            (
                !!targetContract.selectedAt ||
                targetContract.sellerSigned === true ||
                targetContract.buyerSigned === true
            );
        const isLegacyPendingRequest =
            targetDesk.tradeStatus === "contracting" &&
            !!targetDesk.buyerId &&
            !hasSelectedContract;
        const purchaseRequests = normalizePurchaseRequests(targetDesk.purchaseRequests);
        const effectivePurchaseRequests =
            isLegacyPendingRequest &&
            !purchaseRequests.some((requestItem) => requestItem.buyerId === targetDesk.buyerId)
                ? [
                    ...purchaseRequests,
                    {
                        buyerId: targetDesk.buyerId,
                        buyerName: String(targetContract?.buyerName || "익명").trim() || "익명",
                        requestedAt: targetContract?.requestedAt || null,
                    },
                ]
                : purchaseRequests;

        let nextDesk = { ...targetDesk };

        switch (action) {
        case "request_purchase": {
            if (isOwner) {
                throw new HttpsError("invalid-argument", "본인 소유 자리는 구매할 수 없습니다.");
            }

            await ensureNoOverdueHoldingTaxBills(transaction, classId, actorUid);

            if (!targetDesk.isForSale && targetDesk.tradeStatus !== "contracting") {
                throw new HttpsError("failed-precondition", "현재 구매 가능한 매물이 아닙니다.");
            }
            if (targetDesk.tradeStatus === "contracting" && !isLegacyPendingRequest) {
                throw new HttpsError("aborted", "이미 계약자가 선택되어 계약이 진행 중입니다.");
            }

            const alreadyRequested = effectivePurchaseRequests.some(
                (requestItem) => requestItem.buyerId === actorUid,
            );
            if (alreadyRequested) {
                nextDesk = {
                    ...targetDesk,
                    tradeStatus: "on_sale",
                    purchaseRequests: effectivePurchaseRequests,
                    buyerId: null,
                    contractState: null,
                };
                break;
            }
            if (effectivePurchaseRequests.length >= 30) {
                throw new HttpsError("resource-exhausted", "구매 신청자가 너무 많습니다. 매도자가 먼저 계약자를 선택해야 합니다.");
            }

            nextDesk = {
                ...targetDesk,
                tradeStatus: "on_sale",
                isForSale: true,
                buyerId: null,
                contractState: null,
                purchaseRequests: [
                    ...effectivePurchaseRequests,
                    {
                        buyerId: actorUid,
                        buyerName: actorName,
                        requestedAt: new Date().toISOString(),
                    },
                ],
            };
            break;
        }

        case "select_contract_buyer": {
            if (!isSeller) {
                throw new HttpsError("permission-denied", "매도자만 계약자를 선택할 수 있습니다.");
            }
            if (!targetDesk.isForSale || (targetDesk.tradeStatus === "contracting" && !isLegacyPendingRequest)) {
                throw new HttpsError("failed-precondition", "계약자를 선택할 수 있는 매물이 아닙니다.");
            }

            const selectedBuyerId = String(payload?.buyerId || "").trim();
            if (!selectedBuyerId) {
                throw new HttpsError("invalid-argument", "선택할 매수자를 확인할 수 없습니다.");
            }
            if (selectedBuyerId === targetDesk.ownerId) {
                throw new HttpsError("invalid-argument", "소유자는 계약자로 선택할 수 없습니다.");
            }

            const selectedRequest = effectivePurchaseRequests.find(
                (requestItem) => requestItem.buyerId === selectedBuyerId,
            );
            if (!selectedRequest) {
                throw new HttpsError("not-found", "구매 신청자를 찾을 수 없습니다.");
            }

            nextDesk = {
                ...targetDesk,
                tradeStatus: "contracting",
                buyerId: selectedRequest.buyerId,
                isForSale: true,
                purchaseRequests: effectivePurchaseRequests.filter(
                    (requestItem) => requestItem.buyerId !== selectedRequest.buyerId,
                ),
                contractState: {
                    sellerSigned: false,
                    buyerSigned: false,
                    buyerName: selectedRequest.buyerName,
                    selectedAt: new Date().toISOString(),
                    selectedBy: actorUid,
                    signedAt: null,
                },
            };
            break;
        }

        case "cancel_purchase_request": {
            if (targetDesk.tradeStatus === "contracting" && !isLegacyPendingRequest) {
                throw new HttpsError("failed-precondition", "이미 계약이 진행 중인 신청은 계약 취소로 처리해야 합니다.");
            }

            nextDesk = {
                ...targetDesk,
                ...(isLegacyPendingRequest && targetDesk.buyerId === actorUid
                    ? {
                        tradeStatus: "on_sale",
                        buyerId: null,
                        contractState: null,
                    }
                    : {}),
                purchaseRequests: effectivePurchaseRequests.filter(
                    (requestItem) => requestItem.buyerId !== actorUid,
                ),
            };
            break;
        }

        case "submit_signature": {
            if (targetDesk.tradeStatus !== "contracting") {
                throw new HttpsError("failed-precondition", "계약 진행 중인 자리에서만 서명할 수 있습니다.");
            }
            if (isLegacyPendingRequest) {
                throw new HttpsError("failed-precondition", "매도자가 계약자를 먼저 선택해야 계약서 서명을 진행할 수 있습니다.");
            }

            const signingRole = isBuyer ? "buyer" : isSeller ? "seller" : null;
            if (!signingRole) {
                throw new HttpsError("permission-denied", "계약 당사자만 서명할 수 있습니다.");
            }

            const signatureImg = typeof payload.signatureImg === "string"
                ? payload.signatureImg
                : "";
            if (signatureImg.length > 200000) {
                throw new HttpsError("invalid-argument", "서명 이미지가 너무 큽니다.");
            }

            const signerName = String(payload?.signerName || "").trim();
            if (!signerName) {
                throw new HttpsError("invalid-argument", "서명자 이름을 입력해 주세요.");
            }

            const confirmationText = normalizeContractConfirmationText(payload?.confirmationText);
            if (confirmationText !== SALE_CONTRACT_CONFIRMATION_TEXT) {
                throw new HttpsError("invalid-argument", "계약 확인 문구를 정확히 입력해 주세요.");
            }

            const submittedChecklistIds = Array.isArray(payload?.reviewChecklistIds)
                ? payload.reviewChecklistIds.map((item) => String(item || "").trim()).filter(Boolean)
                : [];
            const expectedChecklistIds = signingRole === "seller"
                ? SALE_CONTRACT_REVIEW_CHECKLIST_IDS.seller
                : SALE_CONTRACT_REVIEW_CHECKLIST_IDS.buyer;
            const hasAllChecklistItems = expectedChecklistIds.every((item) =>
                submittedChecklistIds.includes(item),
            );
            if (!hasAllChecklistItems) {
                throw new HttpsError("invalid-argument", "계약서 핵심 확인 항목을 모두 확인해 주세요.");
            }

            const currentContract =
                typeof targetDesk.contractState === "object" && targetDesk.contractState
                    ? targetDesk.contractState
                    : {};
            const nextContract = { ...currentContract };
            const nowIso = new Date().toISOString();
            const confirmationRecord = {
                signerName,
                confirmationText,
                reviewChecklistIds: expectedChecklistIds,
                contractDateKey: formatDateKeyInKST(new Date()),
                confirmedAt: nowIso,
            };

            if (signingRole === "seller") {
                nextContract.sellerSigned = true;
                if (signatureImg) nextContract.sellerSignatureImg = signatureImg;
                nextContract.sellerConfirmation = confirmationRecord;
                nextContract.sellerSignedAt = nowIso;
            }
            if (signingRole === "buyer") {
                nextContract.buyerSigned = true;
                if (signatureImg) nextContract.buyerSignatureImg = signatureImg;
                nextContract.buyerConfirmation = confirmationRecord;
                nextContract.buyerSignedAt = nowIso;
            }

            if (!nextContract.buyerName) {
                nextContract.buyerName = isBuyer ? signerName : actorName;
            }

            if (nextContract.sellerSigned && nextContract.buyerSigned) {
                nextContract.signedAt = new Date().toISOString();
            }

            nextDesk = {
                ...targetDesk,
                tradeStatus: "contracting",
                buyerId: targetDesk.buyerId || (isBuyer ? actorUid : targetDesk.buyerId),
                contractState: nextContract,
            };
            break;
        }

        case "cancel_contract": {
            if (targetDesk.tradeStatus !== "contracting") {
                throw new HttpsError("failed-precondition", "진행 중인 계약이 없습니다.");
            }
            if (!(isSeller || isBuyer || canManageClass)) {
                throw new HttpsError("permission-denied", "계약 당사자만 취소할 수 있습니다.");
            }

            nextDesk = {
                ...targetDesk,
                tradeStatus: "on_sale",
                buyerId: null,
                contractState: null,
                purchaseRequests: purchaseRequests.filter(
                    (requestItem) => requestItem.buyerId !== targetDesk.buyerId,
                ),
            };
            break;
        }

        case "register_sale": {
            if (!isSeller) {
                throw new HttpsError("permission-denied", "소유자만 매물을 등록할 수 있습니다.");
            }

            const askingPrice = Math.floor(Number(payload.askingPrice));
            if (!Number.isFinite(askingPrice) || askingPrice <= 0) {
                throw new HttpsError("invalid-argument", "매물 가격은 1 이상이어야 합니다.");
            }

            nextDesk = {
                ...targetDesk,
                tradeStatus: "on_sale",
                askingPrice,
                isForSale: true,
                buyerId: null,
                contractState: null,
                purchaseRequests: [],
            };
            break;
        }

        case "cancel_sale": {
            const canCancelSale =
                isSeller || (canManageClass && !isStateOwned);

            if (!canCancelSale) {
                throw new HttpsError("permission-denied", "매물 소유자만 매물 해제가 가능합니다.");
            }

            nextDesk = {
                ...targetDesk,
                tradeStatus: "idle",
                isForSale: false,
                askingPrice: 0,
                buyerId: null,
                contractState: null,
                purchaseRequests: [],
            };
            break;
        }

        case "terminate_rent_contract":
        case "replace_rent_contract": {
            if (!canManageClass) {
                throw new HttpsError(
                    "permission-denied",
                    "시작된 임대 계약의 종료와 재계약은 담당 교사만 처리할 수 있습니다.",
                );
            }

            const rentContract = buildRentContractContext(targetDesk);
            if (!rentContract.hasConfiguredContract) {
                throw new HttpsError("failed-precondition", "처리할 임대 계약이 없습니다.");
            }

            const lifecycleStatus = getRentContractLifecycleStatus(targetDesk);
            if (lifecycleStatus !== RENT_CONTRACT_STATUS.ACTIVE) {
                if (action === "replace_rent_contract") {
                    nextDesk = await buildUpdatedRentContractDesk({
                        transaction,
                        classId,
                        config,
                        targetDesk,
                        actorUid,
                        canManageClass,
                        payload,
                    });
                } else {
                    nextDesk = clearDeskRentContract(targetDesk, 0);
                }
                break;
            }

            const tenantUid = String(targetDesk.rentTenantId || "").trim();
            if (!tenantUid) {
                throw new HttpsError("failed-precondition", "계약 임차인을 찾을 수 없습니다.");
            }
            const ownerUid = String(targetDesk.ownerId || "").trim();
            const tenantRef = db.doc(`classes/${classId}/students/${tenantUid}`);
            const ownerRef = ownerUid
                ? db.doc(`classes/${classId}/students/${ownerUid}`)
                : null;

            let replacementDesk = null;
            if (action === "replace_rent_contract") {
                replacementDesk = await buildUpdatedRentContractDesk({
                    transaction,
                    classId,
                    config,
                    targetDesk: clearDeskRentContract(targetDesk, 0),
                    actorUid,
                    canManageClass,
                    payload,
                });
            }

            const [tenantSnap, ownerSnap] = await Promise.all([
                tenantUid === actorUid ? Promise.resolve(actorSnap) : transaction.get(tenantRef),
                ownerRef
                    ? (ownerUid === actorUid ? Promise.resolve(actorSnap) : transaction.get(ownerRef))
                    : Promise.resolve(null),
            ]);
            if (!tenantSnap.exists || (ownerRef && !ownerSnap?.exists)) {
                throw new HttpsError("not-found", "임대 당사자 정보를 찾을 수 없습니다.");
            }

            const deposit = getRentDepositSnapshot(targetDesk);
            const today = startOfDayInKST(new Date());
            const accruedEnd = today.getTime() > rentContract.contractLastDate.getTime()
                ? rentContract.contractLastDate
                : today;
            const accruedDays = today.getTime() < rentContract.contractStartDate.getTime()
                ? 0
                : Math.min(
                    rentContract.totalContractDays,
                    countInclusiveDaysInKST(rentContract.contractStartDate, accruedEnd),
                );
            const unusedRentAmount = action === "replace_rent_contract"
                ? calculateUnusedPrepaidRent({
                    weeklyRent: getDeskWeeklyRentAmount(targetDesk),
                    paidDays: rentContract.paidDays,
                    paidAmount: rentContract.paidAmount,
                    accruedDays,
                })
                : 0;
            const hasTrackedPaidTax = Object.prototype.hasOwnProperty.call(
                targetDesk,
                "rentPaidWithheldTaxAmount",
            );
            const fallbackTaxSnapshot = ownerRef && !hasTrackedPaidTax
                ? buildRealEstateRentIncomeTaxSnapshot({
                    grossAmount: rentContract.paidAmount,
                    config,
                })
                : null;
            const totalPaidTaxAmount = ownerRef
                ? Math.max(
                    0,
                    toWholeNumber(
                        hasTrackedPaidTax
                            ? targetDesk.rentPaidWithheldTaxAmount
                            : fallbackTaxSnapshot?.withheldAmount,
                    ),
                )
                : 0;
            const unusedRentTaxAmount = rentContract.paidAmount > 0
                ? Math.min(
                    totalPaidTaxAmount,
                    Math.floor(
                        totalPaidTaxAmount *
                        (unusedRentAmount / rentContract.paidAmount),
                    ),
                )
                : 0;
            const ownerRentDebit = ownerRef
                ? Math.max(0, unusedRentAmount - unusedRentTaxAmount)
                : 0;
            const tenantRefundAmount = deposit.outstandingAmount + unusedRentAmount;
            const ownerAmountDue = deposit.outstandingAmount + ownerRentDebit;
            const ownerCash = ownerSnap
                ? Math.max(0, Number(ownerSnap.data()?.assets?.cash || 0))
                : 0;
            const ownerDebitAmount = ownerRef ? Math.min(ownerCash, ownerAmountDue) : 0;
            const systemCoveredAmount = ownerRef
                ? Math.max(0, ownerAmountDue - ownerDebitAmount)
                : tenantRefundAmount;

            if (tenantRefundAmount > 0) {
                transaction.update(tenantRef, {
                    "assets.cash": FieldValue.increment(tenantRefundAmount),
                });
            }
            if (ownerRef && ownerDebitAmount > 0) {
                transaction.update(ownerRef, {
                    "assets.cash": FieldValue.increment(-ownerDebitAmount),
                });
            }

            const deskLabel = getResolvedDeskLabel(targetDesk);
            const logContext = {
                config: globalConfig,
                planType: "FREE",
                serviceName: "realestate",
            };
            if (deposit.outstandingAmount > 0) {
                stageActivityLog(transaction, classId, {
                    studentUid: tenantUid,
                    type: "income",
                    category: "real_estate",
                    subCategory: "rent_deposit_refund",
                    amount: deposit.outstandingAmount,
                    description: `${deskLabel} 임대 보증금 반환`,
                    currency: "class_currency",
                }, logContext);
            }
            if (unusedRentAmount > 0) {
                stageActivityLog(transaction, classId, {
                    studentUid: tenantUid,
                    type: "income",
                    category: "real_estate",
                    subCategory: "rent_refund",
                    amount: unusedRentAmount,
                    description: `${deskLabel} 재계약 미사용 선납 임대료 반환`,
                    currency: "class_currency",
                }, logContext);
                if (unusedRentTaxAmount > 0) {
                    stageTaxExpense(transaction, classId, {
                        amount: unusedRentTaxAmount,
                        expenseType: "rental_income_tax_refund",
                        category: "tax_refund",
                        description: `${deskLabel} 재계약 임대소득세 환급 조정`,
                        studentUid: ownerUid || null,
                        studentName: targetDesk.ownerName || null,
                        source: "real_estate_recontract",
                    }, actorUid, {
                        ...logContext,
                        customId: `realestate_recontract_tax_${toSafeId(targetDesk.rentContractId)}`,
                        skipFeatureGate: true,
                    });
                }
            }
            if (ownerUid && ownerDebitAmount > 0) {
                stageActivityLog(transaction, classId, {
                    studentUid: ownerUid,
                    type: "expense",
                    category: "real_estate",
                    subCategory: action === "replace_rent_contract"
                        ? "rent_recontract_refund"
                        : "rent_deposit_refund",
                    amount: ownerDebitAmount,
                    description: action === "replace_rent_contract"
                        ? `${deskLabel} 재계약 정산 반환`
                        : `${deskLabel} 임대 보증금 반환`,
                    currency: "class_currency",
                }, logContext);
            }

            const settlementRef = db.doc(
                `classes/${classId}/real_estate/rent_deposits/records/close_${toSafeId(targetDesk.rentContractId)}`,
            );
            transaction.set(settlementRef, {
                type: action === "replace_rent_contract" ? "recontract" : "termination",
                contractId: targetDesk.rentContractId,
                deskId: targetDesk.id,
                tenantId: tenantUid,
                ownerId: ownerUid || "STATE",
                depositRefundAmount: deposit.outstandingAmount,
                unusedRentRefundAmount: unusedRentAmount,
                taxRefundAmount: unusedRentTaxAmount,
                ownerDebitAmount,
                systemCoveredAmount,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: actorUid,
            });

            nextDesk = action === "replace_rent_contract"
                ? replacementDesk
                : clearDeskRentContract(targetDesk, 0);
            break;
        }

        case "update_rent_fee": {
            nextDesk = await buildUpdatedRentContractDesk({
                transaction,
                classId,
                config,
                targetDesk,
                actorUid,
                canManageClass,
                payload,
            });
            break;
        }

        default:
            throw new HttpsError("invalid-argument", "지원하지 않는 action입니다.");
        }

        const updatedGroups = [...groups];
        const targetGroup = { ...updatedGroups[targetGroupIndex] };
        const updatedDesks = Array.isArray(targetGroup.desks) ? [...targetGroup.desks] : [];
        updatedDesks[targetDeskIndex] = nextDesk;
        targetGroup.desks = updatedDesks;
        updatedGroups[targetGroupIndex] = targetGroup;

        stageRealEstateLayout(transaction, layoutRef, {
            groups: updatedGroups,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true, action };
    });
});

exports.updateRealEstateRentContractsBulk = onCall(async (request) => {
    const {
        classId,
        deskIds,
        weeklyRent,
        depositAmount,
        rentStartDateKey,
        rentLastDateKey,
    } = request.data || {};

    if (!classId) {
        throw new HttpsError("invalid-argument", "classId가 필요합니다.");
    }

    if (!Array.isArray(deskIds) || deskIds.length === 0) {
        throw new HttpsError("invalid-argument", "임대 계약을 설정할 자리를 하나 이상 선택해 주세요.");
    }

    const normalizedDeskIds = [...new Set(
        deskIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean),
    )];

    if (normalizedDeskIds.length === 0) {
        throw new HttpsError("invalid-argument", "유효한 자리 ID가 없습니다.");
    }

    if (normalizedDeskIds.length > 100) {
        throw new HttpsError("invalid-argument", "한 번에 최대 100개 자리까지만 처리할 수 있습니다.");
    }

    const actorCtx = getRealEstateAuthContext(request, classId);
    if (!actorCtx.canManageRealEstate) {
        throw new HttpsError("permission-denied", "임대 계약 일괄 설정 권한이 없습니다.");
    }

    if (request.data?.settleExpiredContracts === true) {
        return runExpiredRentBulkReset({ db, request, actorCtx, deskIds: normalizedDeskIds, deps: {
            getGlobalConfig, runRealEstateTransaction, readRealEstateLayout, stageRealEstateLayout,
            getResolvedDeskLabel, buildRentContractContext, getRentContractLifecycleStatus,
            calculateRentAmountFromDays, getDeskWeeklyRentAmount, getRentDepositSnapshot,
            isClassFundOwnedDesk, toWholeNumber, buildRealEstateRentIncomeTaxSnapshot,
            toSafeId, clearDeskRentContract, buildUpdatedRentContractDesk, FieldValue,
            stageActivityLog, stageTaxExpense,
        } });
    }

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const actorRef = db.doc(`classes/${classId}/students/${actorCtx.uid}`);

        const [layoutSnap, configSnap, actorSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(actorRef),
        ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }

        if (!actorCtx.isAdmin && !actorSnap.exists) {
            throw new HttpsError("permission-denied", "같은 학급 구성원만 처리할 수 있습니다.");
        }

        const config = configSnap.data() || {};
        const isSystemEnabled = config.enabled !== false;
        if (!isSystemEnabled) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const groups = Array.isArray(layoutSnap.data()?.groups)
            ? layoutSnap.data().groups
            : [];
        const pendingDeskIds = new Set(normalizedDeskIds);
        const updatedGroups = groups.map((group) => ({
            ...group,
            desks: Array.isArray(group?.desks) ? [...group.desks] : [],
        }));
        const updatedDeskLabels = [];
        const bulkPayload = {
            weeklyRent,
            rentStartDateKey,
            rentLastDateKey,
            ...(depositAmount === undefined ? {} : { depositAmount }),
        };

        for (let g = 0; g < updatedGroups.length; g++) {
            for (let d = 0; d < updatedGroups[g].desks.length; d++) {
                const targetDesk = updatedGroups[g].desks[d];
                if (!pendingDeskIds.has(targetDesk?.id)) continue;

                try {
                    updatedGroups[g].desks[d] = await buildUpdatedRentContractDesk({
                        transaction,
                        classId,
                        config,
                        targetDesk,
                        actorUid: actorCtx.uid,
                        canManageClass: actorCtx.canManageRealEstate,
                        payload: bulkPayload,
                    });
                } catch (error) {
                    if (error instanceof HttpsError) {
                        throw new HttpsError(
                            error.code,
                            `${getResolvedDeskLabel(targetDesk)}: ${error.message}`,
                        );
                    }
                    throw error;
                }

                pendingDeskIds.delete(targetDesk.id);
                updatedDeskLabels.push(getResolvedDeskLabel(targetDesk));
            }
        }

        if (pendingDeskIds.size > 0) {
            throw new HttpsError(
                "not-found",
                "선택한 자리 중 일부를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
            );
        }

        stageRealEstateLayout(transaction, layoutRef, {
            groups: updatedGroups,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            updatedCount: updatedDeskLabels.length,
            updatedDeskLabels,
            message: Number(weeklyRent) > 0
                ? `${updatedDeskLabels.length}개 자리의 임대 계약을 설정했습니다.`
                : `${updatedDeskLabels.length}개 자리의 임대 계약을 해제했습니다.`,
        };
    });
});

exports.adjustMarketPrice = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const {
        classId,
        deskIds,
        adjustmentRate,
        targetPrice,
        reason,
        reasonType,
    } = request.data;

    if (!classId) {
        throw new HttpsError("invalid-argument", "classId가 필요합니다.");
    }

    if (!deskIds || !Array.isArray(deskIds) || deskIds.length === 0) {
        throw new HttpsError("invalid-argument", "조정할 자리를 하나 이상 선택해 주세요.");
    }

    if (!reason) {
        throw new HttpsError("invalid-argument", "조정 사유를 입력해 주세요.");
    }

    const normalizedRate = Number(adjustmentRate);
    const normalizedTargetPrice = Math.round(Number(targetPrice));
    const hasRateAdjustment = Number.isFinite(normalizedRate) && normalizedRate !== 0;
    const hasFixedAdjustment =
        Number.isFinite(normalizedTargetPrice) && normalizedTargetPrice > 0;

    if (hasRateAdjustment && hasFixedAdjustment) {
        throw new HttpsError(
            "invalid-argument",
            "조정 비율과 직접 지정 금액 중 하나만 입력해 주세요.",
        );
    }

    if (!hasRateAdjustment && !hasFixedAdjustment) {
        throw new HttpsError(
            "invalid-argument",
            "조정 비율 또는 직접 지정 금액을 올바르게 입력해 주세요.",
        );
    }

    const callerCtx = getRealEstateAuthContext(request, classId);
    if (!callerCtx.canManageRealEstate) {
        throw new HttpsError("permission-denied", "시세 조정 권한이 없습니다.");
    }
    const callerUid = callerCtx.uid;
    const adjustmentMode = hasFixedAdjustment ? "fixed" : "rate";

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const [layoutSnap, configSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
        ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }

        const groups = layoutSnap.data().groups || [];
        const config = configSnap.data() || {};
        const isSystemEnabled = config.enabled !== false;
        if (!isSystemEnabled) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const officialPriceRatio = config.officialPriceRatio ?? 70;

        const deskIdSet = new Set(deskIds);
        const adjustedDesks = [];
        const updatedGroups = groups.map((group) => ({
            ...group,
            desks: Array.isArray(group?.desks)
                ? group.desks.map((desk) => ({ ...desk }))
                : [],
        }));

        for (let g = 0; g < updatedGroups.length; g++) {
            for (let d = 0; d < updatedGroups[g].desks.length; d++) {
                const desk = updatedGroups[g].desks[d];

                const recordedMarketPrice = Number(desk.lastPurchasePrice || desk.price || 0);
                const canAdjustDesk = deskIdSet.has(desk.id) && (
                    adjustmentMode === "fixed" || recordedMarketPrice > 0
                );
                if (canAdjustDesk) {
                    const previousPrice = recordedMarketPrice;
                    const newPrice = adjustmentMode === "fixed"
                        ? normalizedTargetPrice
                        : Math.max(
                            0,
                            Math.round(previousPrice * (1 + normalizedRate / 100)),
                        );
                    const newOfficialPrice = Math.round(newPrice * (officialPriceRatio / 100));
                    const resolvedDeskLabel = getResolvedDeskLabel(desk);
                    const derivedChangePercent = previousPrice > 0
                        ? Number(
                            (
                                ((newPrice - previousPrice) / previousPrice) *
                                100
                            ).toFixed(2),
                        )
                        : 0;

                    updatedGroups[g].desks[d] = {
                        ...desk,
                        lastPurchasePrice: newPrice,
                        price: newOfficialPrice,
                    };

                    adjustedDesks.push({
                        deskId: desk.id,
                        deskLabel: resolvedDeskLabel,
                        ownerId: desk.ownerId || null,
                        ownerName: desk.ownerName || "국유지",
                        previousPrice,
                        newPrice,
                        previousOfficialPrice: desk.price,
                        newOfficialPrice,
                        changeMode: adjustmentMode,
                        changePercent: derivedChangePercent,
                        targetPrice: adjustmentMode === "fixed" ? normalizedTargetPrice : null,
                        requestedAdjustmentRate:
                            adjustmentMode === "rate" ? normalizedRate : null,
                    });
                }
            }
        }

        if (adjustedDesks.length === 0) {
            throw new HttpsError(
                "not-found",
                "조정 가능한 자리가 없습니다. (시세 정보가 있는 자리만 조정 가능)"
            );
        }

        stageRealEstateLayout(transaction, layoutRef, {
            groups: updatedGroups,
            lastAdjustedAt: FieldValue.serverTimestamp(),
        });
        const nextSeedMarketPrice = Math.max(
            0,
            Math.round(
                adjustedDesks.reduce((sum, adjusted) => sum + Number(adjusted.newPrice || 0), 0) /
                adjustedDesks.length
            )
        );
        transaction.set(
            configRef,
            {
                seedMarketPrice: nextSeedMarketPrice,
            },
            { merge: true }
        );

        for (const adjusted of adjustedDesks) {
            const ledgerRef = db.collection(`classes/${classId}/real_estate/ledger/transactions`).doc();
            transaction.set(ledgerRef, {
                type: "market_adjustment",
                deskId: adjusted.deskId,
                deskLabel: adjusted.deskLabel,
                ownerId: adjusted.ownerId,
                ownerName: adjusted.ownerName,
                previousPrice: adjusted.previousPrice,
                newPrice: adjusted.newPrice,
                previousOfficialPrice: adjusted.previousOfficialPrice,
                newOfficialPrice: adjusted.newOfficialPrice,
                changeMode: adjusted.changeMode,
                changePercent: adjusted.changePercent,
                targetPrice: adjusted.targetPrice,
                requestedAdjustmentRate: adjusted.requestedAdjustmentRate,
                reason,
                reasonType: reasonType || "custom",
                adjustedBy: callerUid,
                timestamp: FieldValue.serverTimestamp(),
            });
        }

        const summaryRef = db.collection(`classes/${classId}/real_estate/logs/market_events`).doc();
        transaction.set(summaryRef, {
            type: "price_adjustment",
            reason,
            reasonType: reasonType || "custom",
            adjustmentMode,
            adjustmentRate: adjustmentMode === "rate" ? normalizedRate : null,
            targetPrice: adjustmentMode === "fixed" ? normalizedTargetPrice : null,
            affectedDesks: adjustedDesks.length,
            deskSummary: adjustedDesks.map((d) => ({
                label: d.deskLabel,
                prev: d.previousPrice,
                new: d.newPrice,
                mode: d.changeMode,
            })),
            adjustedBy: callerUid,
            timestamp: FieldValue.serverTimestamp(),
        });

        const adjustmentLabel = adjustmentMode === "fixed"
            ? `${normalizedTargetPrice.toLocaleString()}`
            : `${normalizedRate > 0 ? "+" : ""}${normalizedRate}%`;

        return {
            success: true,
            adjustmentMode,
            adjustedCount: adjustedDesks.length,
            message: adjustmentMode === "fixed"
                ? `${adjustedDesks.length}개 자리의 시세를 ${adjustmentLabel}로 맞췄습니다.`
                : `${adjustedDesks.length}개 자리의 시세가 ${adjustmentLabel} 조정되었습니다.`,
            adjustedDesks: adjustedDesks.map((d) => ({
                label: d.deskLabel,
                prev: d.previousPrice,
                new: d.newPrice,
            })),
        };
    });
});

exports.updateRealEstateLedgerState = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, action, ledgerIds } = request.data || {};

    if (!classId) {
        throw new HttpsError("invalid-argument", "classId가 필요합니다.");
    }

    if (!["archive", "restore", "delete"].includes(action)) {
        throw new HttpsError("invalid-argument", "지원하지 않는 거래기록 정리 작업입니다.");
    }

    if (!Array.isArray(ledgerIds) || ledgerIds.length === 0) {
        throw new HttpsError("invalid-argument", "정리할 거래기록을 하나 이상 선택해 주세요.");
    }

    const normalizedLedgerIds = [...new Set(
        ledgerIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean),
    )];

    if (normalizedLedgerIds.length === 0) {
        throw new HttpsError("invalid-argument", "유효한 거래기록 ID가 없습니다.");
    }

    if (normalizedLedgerIds.length > 100) {
        throw new HttpsError("invalid-argument", "한 번에 최대 100건까지만 정리할 수 있습니다.");
    }

    const callerCtx = getRealEstateAuthContext(request, classId);
    if (!callerCtx.canManageRealEstate) {
        throw new HttpsError("permission-denied", "거래기록 정리 권한이 없습니다.");
    }

    return runRealEstateTransaction(db, async (transaction) => {
        const nowTimestamp = FieldValue.serverTimestamp();
        const ledgerRefs = normalizedLedgerIds.map((ledgerId) =>
            db.doc(`classes/${classId}/real_estate/ledger/transactions/${ledgerId}`),
        );
        const ledgerSnaps = await Promise.all(
            ledgerRefs.map((ledgerRef) => transaction.get(ledgerRef)),
        );

        let processedCount = 0;

        ledgerSnaps.forEach((ledgerSnap, index) => {
            if (!ledgerSnap.exists) return;

            const ledgerData = ledgerSnap.data() || {};
            const alreadyArchived =
                ledgerData.isArchived === true || !!ledgerData.archivedAt;

            if (action === "delete") {
                transaction.delete(ledgerRefs[index]);
                processedCount += 1;
                return;
            }

            if (action === "archive") {
                if (alreadyArchived) return;
                transaction.set(
                    ledgerRefs[index],
                    {
                        isArchived: true,
                        archivedAt: nowTimestamp,
                        archivedByUid: callerCtx.uid,
                    },
                    { merge: true },
                );
                processedCount += 1;
                return;
            }

            if (!alreadyArchived) return;

            transaction.set(
                ledgerRefs[index],
                {
                    isArchived: false,
                    archivedAt: FieldValue.delete(),
                    archivedByUid: FieldValue.delete(),
                },
                { merge: true },
            );
            processedCount += 1;
        });

        return {
            success: true,
            action,
            processedCount,
        };
    });
});

exports.updateRealEstateRentPaymentState = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const {
        classId,
        deskId,
        action,
        paymentIds,
    } = request.data || {};

    if (!classId) {
        throw new HttpsError("invalid-argument", "classId가 필요합니다.");
    }

    if (!deskId || typeof deskId !== "string") {
        throw new HttpsError("invalid-argument", "deskId가 필요합니다.");
    }

    if (!["delete"].includes(action)) {
        throw new HttpsError("invalid-argument", "지원하지 않는 임대기록 정리 작업입니다.");
    }

    if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
        throw new HttpsError("invalid-argument", "정리할 임대기록을 하나 이상 선택해 주세요.");
    }

    const normalizedPaymentIds = [...new Set(
        paymentIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean),
    )];

    if (normalizedPaymentIds.length === 0) {
        throw new HttpsError("invalid-argument", "유효한 임대기록 ID가 없습니다.");
    }

    if (normalizedPaymentIds.length > 100) {
        throw new HttpsError("invalid-argument", "한 번에 최대 100건까지만 정리할 수 있습니다.");
    }

    const callerCtx = getRealEstateAuthContext(request, classId);
    if (!callerCtx.canManageRealEstate) {
        throw new HttpsError("permission-denied", "임대기록 정리 권한이 없습니다.");
    }

    return runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const paymentsQuery = db
            .collection(`classes/${classId}/real_estate/rent_payments/records`)
            .where("deskId", "==", deskId);

        const [layoutSnap, paymentsSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(paymentsQuery),
        ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }

        const groups = layoutSnap.data().groups || [];
        let targetGroupIndex = -1;
        let targetDeskIndex = -1;
        let targetDesk = null;

        for (let g = 0; g < groups.length; g++) {
            const dIdx = groups[g].desks.findIndex((desk) => desk.id === deskId);
            if (dIdx !== -1) {
                targetGroupIndex = g;
                targetDeskIndex = dIdx;
                targetDesk = groups[g].desks[dIdx];
                break;
            }
        }

        if (!targetDesk) {
            throw new HttpsError("not-found", "해당 자리를 찾을 수 없습니다.");
        }

        const selectedIdSet = new Set(normalizedPaymentIds);
        const matchingPaymentDocs = paymentsSnap.docs.filter((docSnap) =>
            selectedIdSet.has(docSnap.id),
        );

        if (matchingPaymentDocs.length === 0) {
            throw new HttpsError("not-found", "선택한 임대기록을 찾을 수 없습니다.");
        }

        const invalidPayment = matchingPaymentDocs.find((docSnap) =>
            String(docSnap.data()?.deskId || "") !== String(deskId),
        );
        if (invalidPayment) {
            throw new HttpsError("failed-precondition", "다른 자리의 임대기록은 함께 정리할 수 없습니다.");
        }

        const remainingPayments = paymentsSnap.docs
            .filter((docSnap) => !selectedIdSet.has(docSnap.id))
            .map((docSnap) => docSnap.data() || {});
        const recalculatedSnapshot = buildDeskRentPaymentSnapshot(targetDesk, remainingPayments);

        matchingPaymentDocs.forEach((docSnap) => {
            transaction.delete(docSnap.ref);
        });

        const updatedGroups = [...groups];
        const targetGroup = { ...updatedGroups[targetGroupIndex] };
        const updatedDesks = Array.isArray(targetGroup.desks) ? [...targetGroup.desks] : [];
        updatedDesks[targetDeskIndex] = {
            ...targetDesk,
            rentPaidDays: recalculatedSnapshot.paidDays,
            rentPaidAmount: recalculatedSnapshot.paidAmount,
            rentPaidUntil: recalculatedSnapshot.paidUntil
                ? admin.firestore.Timestamp.fromDate(recalculatedSnapshot.paidUntil)
                : null,
        };
        targetGroup.desks = updatedDesks;
        updatedGroups[targetGroupIndex] = targetGroup;

        stageRealEstateLayout(transaction, layoutRef, {
            groups: updatedGroups,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            action,
            processedCount: matchingPaymentDocs.length,
        };
    });
});




