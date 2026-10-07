// functions/src/bank.js
"use strict";

const { onCall, HttpsError } = require("../utils/maintenanceHttps");
const admin = require("../firebaseAdminCompat");
const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());
const FieldValue = admin.firestore.FieldValue;

const { stageTaxIncome } = require("../utils/taxIncome");
const { stageActivityLog } = require("../utils/logUtils"); // ✅ 추가
const {
    stageNotification,
    scheduleReminder,
} = require("../utils/notificationUtils");
const {
    addCalendarDaysInKST,
    calculateMaturityDate,
    calculateRepaymentDate,
    getElapsedLoanDays,
    getLoanOverdueDays,
    startOfDayInKST,
} = require("../utils/dateUtils");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { getDepositInterestWithholdingPolicy } = require("../utils/taxPolicy");
const {
    buildSavingInterestTaxPolicySnapshot,
    isSavingInterestTaxPolicyActive,
    resolveSavingInterestTaxPolicy,
} = require("../utils/depositInterestTax");
const {
    calculatePeriodRateAdjustment,
    calculateSavingInterest,
    getSpendableBankBalance,
    resolveTierRateModifier,
    roundBankMoney,
    toSafeNumber,
} = require("../utils/bankMoney");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");

const { mustBeTeacherOrTaxAdmin } = require("../utils/permissions");

/* ------------------------------ helpers ------------------------------ */

// Firestore Timestamp, {seconds}, Date, ISO string 등 폭넓게 수용 → Date로 표준화
function toDayjsLike(tsOrDate) {
    if (!tsOrDate) return null;
    if (typeof tsOrDate.toDate === "function") return tsOrDate.toDate(); // Firestore Timestamp
    if (typeof tsOrDate.seconds === "number")
        return new Date(tsOrDate.seconds * 1000);
    if (tsOrDate instanceof Date) return tsOrDate;
    const d = new Date(tsOrDate);
    return isNaN(d.getTime()) ? null : d;
}

// UTC 기준 일수 더하기

// 날짜 차이(일)

function isPolicyActiveFrom(enabledFrom, referenceDate = new Date()) {
    return isSavingInterestTaxPolicyActive(enabledFrom, referenceDate);
}

function calculateLoanInterest(principal, ratePercentage) {
    return Math.max(
        0,
        Math.round(
            toSafeNumber(principal) * (toSafeNumber(ratePercentage) / 100),
        ),
    );
}

function isDecliningBalanceLoan(loan = {}) {
    return loan.interestModel === "declining_balance";
}

function getDecliningInterestBaseDate(loan = {}) {
    return (
        toDayjsLike(loan.interestState?.baseDate) ||
        toDayjsLike(loan.startedAt) ||
        toDayjsLike(loan.processedAt) ||
        toDayjsLike(loan.appliedAt)
    );
}

function getElapsedDecliningInterestDays(loan = {}, now = new Date()) {
    const baseDate = getDecliningInterestBaseDate(loan);
    if (!baseDate) return 0;

    const dueDate = calculateRepaymentDate(loan);
    const today = startOfDayInKST(now);
    const baseDay = startOfDayInKST(baseDate);
    if (!today || !baseDay) return 0;

    const accrualEndDay =
        dueDate && today.getTime() > dueDate.getTime() ? dueDate : today;

    const diffMs = accrualEndDay.getTime() - baseDay.getTime();
    if (diffMs <= 0) return 0;

    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function calculateDecliningLoanInterest(loan = {}, now = new Date()) {
    const state = loan.interestState || {};
    const principalLeft = toSafeNumber(
        loan.amountLeft ?? loan.principal ?? loan.amount,
    );
    const rate = toSafeNumber(
        loan.finalRateApplied ?? loan.rate ?? loan.baseRate,
    );
    const totalDays = Math.max(1, toSafeNumber(loan.days || 1));
    const elapsedDays = getElapsedDecliningInterestDays(loan, now);
    const newlyAccrued = Math.max(
        0,
        Math.round(principalLeft * (rate / 100) * (elapsedDays / totalDays)),
    );
    const accruedAmount = Math.max(
        0,
        toSafeNumber(state.accruedAmount) + newlyAccrued,
    );
    const paidAmount = toSafeNumber(
        loan.interestPaid ?? state.paidAmount ?? 0,
    );
    const waivedAmount = toSafeNumber(state.waivedAmount);

    return {
        accruedAmount,
        elapsedDays,
        interestDue: Math.max(0, accruedAmount - paidAmount - waivedAmount),
        newlyAccrued,
        paidAmount,
        waivedAmount,
    };
}

const OPEN_SAVING_STATUSES = new Set(["pending", "active"]);
const APPROVED_LOAN_STATUSES = new Set(["ongoing", "active"]);

function toWholeNumber(value) {
    const numericValue = Math.floor(Number(value));
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function sumSavingAmountsByStatus(snapshot, allowedStatuses) {
    if (!snapshot?.docs?.length) return 0;
    return snapshot.docs.reduce((total, doc) => {
        const data = doc.data() || {};
        if (!allowedStatuses.has(String(data.status || ""))) return total;
        return total + toWholeNumber(data.amount);
    }, 0);
}

function getLoanOutstandingAmount(loanData = {}) {
    const status = String(loanData.status || "");
    if (status === "pending") {
        return toWholeNumber(loanData.principal ?? loanData.amount);
    }
    return toWholeNumber(
        loanData.amountLeft ?? loanData.principal ?? loanData.amount,
    );
}

function sumLoanAmountsByStatus(snapshot, allowedStatuses) {
    if (!snapshot?.docs?.length) return 0;
    return snapshot.docs.reduce((total, doc) => {
        const data = doc.data() || {};
        if (!allowedStatuses.has(String(data.status || ""))) return total;
        return total + getLoanOutstandingAmount(data);
    }, 0);
}

const AUTO_APPROVAL_ACTOR = "auto_approval_system";

function resolveAutoApprovalFlag(settings = {}, kind) {
    const legacyFlag =
        typeof settings.isAutoApprovalEnabled === "boolean"
            ? settings.isAutoApprovalEnabled
            : false;

    if (kind === "deposit") {
        return typeof settings.depositAutoApprovalEnabled === "boolean"
            ? settings.depositAutoApprovalEnabled
            : legacyFlag;
    }

    if (kind === "loan") {
        return typeof settings.loanAutoApprovalEnabled === "boolean"
            ? settings.loanAutoApprovalEnabled
            : legacyFlag;
    }

    return legacyFlag;
}

function shouldReadLoanTierAdjustments(product = {}) {
    if (typeof product?.useTierRateAdjustment === "boolean") {
        return product.useTierRateAdjustment;
    }

    // Legacy products keep the previous behavior until they opt out explicitly.
    return true;
}

function shouldReadLoanProductSnapshot(product = {}) {
    return toWholeNumber(product?.maxLoanProductLimit) > 0;
}

function shouldCheckLoanLimitRatio(settings = {}) {
    return settings.isLoanLimitRatioEnabled === true;
}

function normalizeSignatureDataUrl(value) {
    const signature = String(value || "").trim();
    if (!signature) return "";
    if (!signature.startsWith("data:image/png;base64,")) return "";
    if (signature.length > 500000) return "";
    return signature;
}

function isProductEligibleForStudent(product = {}, uid, creditScore = 0) {
    const allowedStudentUids = Array.isArray(product.allowedStudentUids)
        ? product.allowedStudentUids
              .map((value) => String(value || "").trim())
              .filter(Boolean)
        : [];
    const isStudentRestricted =
        product.eligibilityMode === "students" ||
        (product.eligibilityMode === "both" && allowedStudentUids.length > 0);
    const matchesStudent = allowedStudentUids.includes(String(uid || "").trim());
    const minimumScore = Number(product.minCreditScore);
    const matchesTier =
        !Number.isFinite(minimumScore) || Number(creditScore) >= minimumScore;

    if (isStudentRestricted) return matchesStudent;
    return matchesTier;
}

/* ------------------------------ functions ------------------------------ */

/**
 * 송금 (백엔드 트리거 기반 creditTier 필드 적용 버전)
 */
exports.transferMoney = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, toUid, amount, memo, clientRequestId } = data || {};
        const fromUid = auth.uid;

        if (!classId || !toUid || !amount)
            throw new HttpsError("invalid-argument", "필수 매개변수 누락");
        if (toUid === fromUid)
            throw new HttpsError(
                "failed-precondition",
                "본인에게 송금할 수 없습니다.",
            );

        const amt = Math.floor(Number(amount));
        if (!Number.isSafeInteger(amt) || amt <= 0)
            throw new HttpsError("invalid-argument", "송금액은 0보다 커야 합니다.");

        if (clientRequestId != null && (
            typeof clientRequestId !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(clientRequestId)
        )) {
            throw new HttpsError("invalid-argument", "송금 요청 ID가 올바르지 않습니다.");
        }
        const transferMemo = String(memo || "").trim();

        const globalConfig =
      (typeof getGlobalConfig === "function" ? await getGlobalConfig() : {}) ||
      {};

        return await db.runTransaction(async (tx) => {
            // 1. 참조 준비
            const classRef = db.collection("classes").doc(classId);
            const fromRef = classRef.collection("students").doc(fromUid);
            const toRef = classRef.collection("students").doc(toUid);
            const idemRef = clientRequestId
                ? fromRef.collection("idempotency").doc(`transfer_${clientRequestId}`)
                : null;
            if (idemRef) {
                const idemSnap = await tx.get(idemRef);
                if (idemSnap.exists) {
                    const previous = idemSnap.data();
                    if (previous.toUid !== toUid || previous.amount !== amt || previous.memo !== transferMemo) {
                        throw new HttpsError("invalid-argument", "이미 사용된 요청 ID의 송금 내용이 다릅니다.");
                    }
                    return previous.result;
                }
            }
            const configRef = classRef
                .collection("bankConfig")
                .doc("tierAdjustments");

            // 2. 읽기
            const [fromSnap, toSnap, classSnap, configSnap] = await Promise.all([
                tx.get(fromRef),
                tx.get(toRef),
                tx.get(classRef),
                tx.get(configRef),
            ]);

            if (!fromSnap.exists || !toSnap.exists)
                throw new HttpsError("not-found", "사용자 정보를 찾을 수 없습니다.");

            const fromData = fromSnap.data();
            const toData = toSnap.data();
            const classData = classSnap.exists ? classSnap.data() : {};
            const configData = configSnap.exists ? configSnap.data() : {};

            const currencyField = classData.currencySettings?.field || "cash";
            const currencyName =
                classData.currencyUnit ||
                classData.currencySettings?.name ||
                "단위";

            // 3. 🚀 [핵심 수정] DB에 저장된 creditTier 필드 사용
            // 트리거가 이미 "3급" 같은 정보를 박아두었으므로, 복잡한 계산 없이 이름만 추출합니다.
            let myTierName = "무등급";
            if (fromData.creditTier) {
                myTierName =
          typeof fromData.creditTier === "object"
              ? fromData.creditTier.name
              : fromData.creditTier;
            }

            // 4. 수수료 확정
            const adjustments = configData.byTier || {};
            const mySettings = adjustments[myTierName] || {};
            const fee = Number(mySettings.transferFee || 0);

            const totalDeduction = amt + fee;

            // 5. 잔액 체크
            const currentAsset = getSpendableBankBalance(fromData.assets, currencyField);
            if (currentAsset < totalDeduction) {
                throw new HttpsError(
                    "failed-precondition",
                    `잔액이 부족합니다. (송금액 ${amt} + 수수료 ${fee} = 총 ${totalDeduction}${currencyName} 필요)`,
                );
            }

            // 6. 업데이트 (송금 실행)
            tx.update(fromRef, {
                [`assets.${currencyField}`]:
          admin.firestore.FieldValue.increment(-totalDeduction),
            });
            tx.update(toRef, {
                [`assets.${currencyField}`]: admin.firestore.FieldValue.increment(amt),
            });

            // 7. 로그 및 알림 (기존 로직 유지)
            const planType = classData.planType || "FREE";
            const logCtx = { config: globalConfig, planType, serviceName: "bank" };
            const fromName = fromData.name || "학생";
            const toName = toData.name || "학생";

            // [보내는 사람 로그]
            let senderDesc = `${toName}에게 송금`;
            if (memo) senderDesc += ` (${memo})`;
            if (fee > 0) senderDesc += ` [수수료 ${fee}${currencyName} 포함]`;

            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: fromUid,
                    type: "expense",
                    category: "transfer_out",
                    amount: totalDeduction,
                    description: senderDesc,
                    counterpartUid: toUid,
                    counterpartName: toName,
                    note: memo || (fee > 0 ? `등급: ${myTierName}` : ""),
                },
                logCtx,
            );

            // [받는 사람 로그]
            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: toUid,
                    type: "income",
                    category: "transfer_in",
                    amount: amt,
                    description: memo ? `${fromName}: ${memo}` : `${fromName}로부터 입금`,
                    counterpartUid: fromUid,
                    counterpartName: fromName,
                    note: memo || "",
                },
                logCtx,
            );

            // [알림 발송]
            if (typeof stageNotification === "function") {
                const formattedAmt = new Intl.NumberFormat("ko-KR").format(amt);
                stageNotification(tx, classId, {
                    uid: toUid,
                    title: "입금 안내",
                    message: `${fromName}님으로부터 ${formattedAmt}${currencyName}가 입금되었습니다.`,
                    type: "transfer_in",
                    link: "/bank/history",
                    priority: "medium",
                });
            }

            const result = { success: true };
            if (idemRef) {
                tx.set(idemRef, {
                    toUid,
                    amount: amt,
                    memo: transferMemo,
                    result,
                    createdAt: FieldValue.serverTimestamp(),
                });
            }
            return result;
        });
    },
);

/**
 * 🏦 예금 신청 (applyDeposit)
 * - 등급별 우대 금리를 예치 기간(days)에 비례하여 자동 계산합니다.
 * - 계산식: 최종금리 = 기본금리 + ((주간우대율 / 7) * 예치일수)
 */
exports.applyDeposit = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const uid = auth.uid;
        const { classId, productId, amount, studentName, clientRequestId } =
      data || {};

        if (!classId || !productId || !amount) {
            throw new HttpsError(
                "invalid-argument",
                "필수 매개변수가 누락되었습니다.",
            );
        }

        try {
            const globalConfig = await getGlobalConfig();

            // 💡 트랜잭션의 결과를 외부로 리턴하도록 보장
            return await db.runTransaction(async (tx) => {
                const classRef = db.collection("classes").doc(classId);
                const studentRef = classRef.collection("students").doc(uid);
                const bankSettingsRef = classRef.collection("bank").doc("settings");
                const adjRef = classRef.collection("bankConfig").doc("tierAdjustments");
                const existingSavingsQuery = studentRef
                    .collection("savings")
                    .where("productId", "==", String(productId));

                const readPromises = [
                    tx.get(classRef),
                    tx.get(studentRef),
                    tx.get(bankSettingsRef),
                    tx.get(adjRef),
                    tx.get(existingSavingsQuery),
                ];

                let idemRef = null;
                if (clientRequestId) {
                    idemRef = studentRef
                        .collection("idempotency")
                        .doc(`deposit_${clientRequestId}`);
                    readPromises.push(tx.get(idemRef));
                }

                const [
                    classSnap,
                    studentSnap,
                    bankSettingsSnap,
                    adjSnap,
                    existingSavingsSnap,
                    idemSnap,
                ] =
          await Promise.all(readPromises);

                if (clientRequestId && idemSnap?.exists) {
                    return {
                        success: true,
                        message: "이미 처리된 신청입니다.",
                        savingId: idemSnap.data().savingId,
                    };
                }

                if (!studentSnap.exists)
                    throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");

                const studentData = studentSnap.data();
                const bankSettingsData = bankSettingsSnap.data() || {};
                const classData = classSnap.data() || {};
                const planType = classData.planType || "FREE";
                const isLogEnabled = canUseFeature(
                    globalConfig,
                    planType,
                    "bank",
                    "enableLog",
                );
                const isAutoApprovalEnabled = resolveAutoApprovalFlag(
                    bankSettingsData,
                    "deposit",
                );
                const displayCurrencyUnit =
                    classData.currencyUnit || classData.currencySettings?.name || "원";
                const logCtx = {
                    config: globalConfig,
                    planType,
                    serviceName: "bank",
                };

                const product = (bankSettingsData.depositProducts || []).find(
                    (p) => String(p.id) === String(productId) && p.active,
                );
                if (!product)
                    throw new HttpsError(
                        "failed-precondition",
                        "유효하지 않은 상품입니다.",
                    );

                const myScore = Number(studentData.creditScore || 0);
                if (!isProductEligibleForStudent(product, uid, myScore)) {
                    throw new HttpsError(
                        "permission-denied",
                        product.eligibilityMode === "students"
                            ? "이 예금 상품은 지정된 학생만 가입할 수 있습니다."
                            : "이 예금 상품의 가입 조건을 충족하지 않습니다.",
                    );
                }

                const baseRate = Number(product.rate || 0);
                const productDays = Number(product.days || 0);

                const adjData = adjSnap.data()?.byTier || adjSnap.data() || {};
                const tierName = studentData.creditTier?.name || "무등급";
                const modifiers = adjData[tierName] || { depositRateModifier: 0 };
                const weeklyBonusRate = resolveTierRateModifier(
                    product.useTierRateAdjustment,
                    modifiers.depositRateModifier,
                );

                const bonusRate = calculatePeriodRateAdjustment(
                    weeklyBonusRate,
                    productDays,
                );
                const finalRate = Math.max(
                    0,
                    roundBankMoney(baseRate + bonusRate),
                );

                const amt = toWholeNumber(amount);
                if (amt <= 0) {
                    throw new HttpsError(
                        "invalid-argument",
                        "예금 금액은 1 이상이어야 합니다.",
                    );
                }

                const currentProductAmount = sumSavingAmountsByStatus(
                    existingSavingsSnap,
                    OPEN_SAVING_STATUSES,
                );
                const maxProductLimit = toWholeNumber(
                    product.maxDepositProductLimit,
                );
                if (
                    maxProductLimit > 0 &&
                    currentProductAmount + amt > maxProductLimit
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        `이 예금 상품은 현재 가입 중 금액을 포함해 최대 ${maxProductLimit.toLocaleString()}${displayCurrencyUnit}까지만 가입할 수 있습니다.`,
                    );
                }

                const expectedProfit = calculateSavingInterest(amt, finalRate);
                const expectedTotalAmount = roundBankMoney(amt + expectedProfit);

                const currencyField = classData.currencySettings?.field || "cash";
                const available = Number(studentData.assets?.[currencyField] ?? 0);

                if (available < amt)
                    throw new HttpsError("failed-precondition", "잔액이 부족합니다.");

                const savingRef = studentRef.collection("savings").doc();
                const label = product.label || "예금";
                const confirmedRate = Number(finalRate || baseRate || 0);
                const startedAt = isAutoApprovalEnabled
                    ? admin.firestore.Timestamp.now()
                    : null;
                const expectedMaturityDate = isAutoApprovalEnabled
                    ? addCalendarDaysInKST(startedAt.toDate(), productDays)
                    : null;
                const interestTaxPolicySnapshot =
                    buildSavingInterestTaxPolicySnapshot(
                        getDepositInterestWithholdingPolicy(classData),
                    );

                // 자산 차감
                tx.update(studentRef, {
                    [`assets.${currencyField}`]:
            admin.firestore.FieldValue.increment(-amt),
                });

                // 예금 신청서 저장
                const savingData = {
                    amount: amt,
                    days: productDays,
                    productId: String(product.id),
                    productLabel: product.label,
                    status: "pending",
                    classId,
                    requestedBy: uid,
                    studentName: studentName || studentData.name || "",
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    baseRate,
                    weeklyBonusRate,
                    bonusRate,
                    finalRate,
                    interestCalculatedOnRequest: expectedProfit,
                    expectedProfit,
                    expectedTotalAmount,
                    tierApplied: tierName,
                    tierIdApplied: studentData.creditTier?.id || "none",
                    earlyTerminationBlocked: product.earlyTerminationBlocked === true,
                    interestTaxPolicySnapshot,
                    ...(isAutoApprovalEnabled && {
                        status: "active",
                        rate: confirmedRate,
                        approvedAt: FieldValue.serverTimestamp(),
                        approvedBy: AUTO_APPROVAL_ACTOR,
                        startedAt,
                        expectedMaturityDate:
              admin.firestore.Timestamp.fromDate(expectedMaturityDate),
                        processedAt: FieldValue.serverTimestamp(),
                        processedBy: AUTO_APPROVAL_ACTOR,
                    }),
                };

                tx.set(savingRef, savingData);

                if (isAutoApprovalEnabled && amt > 0) {
                    tx.update(studentRef, {
                        "assets.deposit": FieldValue.increment(amt),
                    });
                }

                if (isAutoApprovalEnabled && isLogEnabled) {
                    stageActivityLog(
                        tx,
                        classId,
                        {
                            studentUid: uid,
                            type: "expense",
                            category: "deposit_started",
                            amount: amt,
                            currency: displayCurrencyUnit,
                            description: `'${label}' 예금 시작 (금리: ${confirmedRate}%)`,
                            relatedDoc: { collection: "savings", id: savingRef.id },
                            status: "active",
                            approvedAt: FieldValue.serverTimestamp(),
                            startedAt,
                            expectedMaturityDate:
                                expectedMaturityDate
                                    ? admin.firestore.Timestamp.fromDate(expectedMaturityDate)
                                    : null,
                        },
                        logCtx,
                    );
                }

                if (isAutoApprovalEnabled) {
                    stageNotification(tx, classId, {
                        uid,
                        title: "예금 승인 완료",
                        message: `신청하신 '${label}' 상품이 활성화되었습니다.`,
                        type: "deposit_approved",
                        priority: "medium",
                    });
                }

                // 💡 Idempotency 기록 (중복 처리 방지 마침표)
                if (clientRequestId && idemRef) {
                    tx.set(idemRef, {
                        savingId: savingRef.id,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }

                // 💡 트랜잭션 성공 리턴
                return {
                    success: true,
                    savingId: savingRef.id,
                    finalRate,
                    autoApproved: isAutoApprovalEnabled,
                };
            });
        } catch (e) {
            console.error("applyDeposit Error:", e);
            throw new HttpsError(e.code || "internal", e.message);
        }
    },
);

exports.applyLoan = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const uid = auth.uid;
    const {
        classId,
        productId,
        amount,
        clientRequestId,
        borrowerSignatureImg,
    } = data || {};

    if (!classId || !productId || !amount) {
        throw new HttpsError("invalid-argument", "필수 매개변수가 누락되었습니다.");
    }

    try {
        const globalConfig = await getGlobalConfig();

        const result = await db.runTransaction(async (tx) => {
            const classRef = db.collection("classes").doc(classId);
            const studentRef = classRef.collection("students").doc(uid);
            const bankSettingsRef = classRef.collection("bank").doc("settings");
            const adjRef = classRef.collection("bankConfig").doc("tierAdjustments");
            let idemRef = null;
            let idemSnap = null;
            if (clientRequestId) {
                idemRef = studentRef
                    .collection("idempotency")
                    .doc(`loan_${clientRequestId}`);
                idemSnap = await tx.get(idemRef);
                if (idemSnap.exists) {
                    return {
                        success: true,
                        message: "이미 처리된 신청입니다.",
                        loanId: idemSnap.data().loanId,
                    };
                }
            }

            const [classSnap, studentSnap, bankSettingsSnap] = await Promise.all([
                tx.get(classRef),
                tx.get(studentRef),
                tx.get(bankSettingsRef),
            ]);
            if (!studentSnap.exists)
                throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");

            const studentData = studentSnap.data();
            const classData = classSnap.data() || {};
            const bankSettings = bankSettingsSnap.data() || {};
            const amt = toWholeNumber(amount);
            const planType = classData.planType || "FREE";
            const currencyField = classData.currencySettings?.field || "cash";
            const currencyUnit = classData.currencyUnit || "단위";
            const logCtx = { config: globalConfig, planType, serviceName: "bank" };
            const isAutoApprovalEnabled = resolveAutoApprovalFlag(
                bankSettings,
                "loan",
            );
            const loanContractEnabled = bankSettings.loanContractEnabled === true;
            const normalizedBorrowerSignatureImg =
                normalizeSignatureDataUrl(borrowerSignatureImg);
            const displayCurrencyUnit =
                classData.currencyUnit || classData.currencySettings?.name || "원";

            // 2. 상품 및 자격 검증
            const product = (bankSettings.loanProducts || []).find(
                (p) => String(p.id) === String(productId) && p.active,
            );
            if (amt <= 0) {
                throw new HttpsError(
                    "invalid-argument",
                    "대출 금액은 1 이상이어야 합니다.",
                );
            }
            if (!product)
                throw new HttpsError(
                    "failed-precondition",
                    "유효하지 않은 상품입니다.",
                );
            if (loanContractEnabled && !normalizedBorrowerSignatureImg) {
                throw new HttpsError(
                    "invalid-argument",
                    "대출 계약서에 학생 서명이 필요합니다.",
                );
            }

            const myScore = Number(studentData.creditScore || 0);
            // 3. 한도 검증 (순자산 대비)
            if (!isProductEligibleForStudent(product, uid, myScore)) {
                throw new HttpsError(
                    "permission-denied",
                    product.eligibilityMode === "students"
                        ? "이 대출 상품은 지정된 학생만 신청할 수 있습니다."
                        : "대출 신청 자격이 부족합니다.",
                );
            }

            const shouldApplyTierRateAdjustment =
                shouldReadLoanTierAdjustments(product);
            const shouldCheckProductLimit =
                shouldReadLoanProductSnapshot(product);
            const shouldCheckLoanRatio =
                shouldCheckLoanLimitRatio(bankSettings);

            const existingProductLoansQuery = shouldCheckProductLimit ?
                studentRef
                    .collection("loans")
                    .where("productId", "==", String(productId)) :
                null;
            const [adjSnap, existingProductLoansSnap] =
                await Promise.all([
                    shouldApplyTierRateAdjustment ?
                        tx.get(adjRef) :
                        Promise.resolve(null),
                    existingProductLoansQuery ?
                        tx.get(existingProductLoansQuery) :
                        Promise.resolve(null),
                ]);
            const currentProductLoanAmount = sumLoanAmountsByStatus(
                existingProductLoansSnap,
                APPROVED_LOAN_STATUSES,
            );
            const maxProductLimit = toWholeNumber(product.maxLoanProductLimit);
            if (
                maxProductLimit > 0 &&
                currentProductLoanAmount + amt > maxProductLimit
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    `이 대출 상품은 현재 이용 중 금액을 포함해 최대 ${maxProductLimit.toLocaleString()}${displayCurrencyUnit}까지만 신청할 수 있습니다.`,
                );
            }

            if (shouldCheckLoanRatio) {
                const ratio =
          studentData.loanLimitRatio ??
          bankSettings.defaultLoanLimitRatio ??
          0.5;
                const assets = studentData.assets || {};
                const netAssets = Number(assets.totalNetWorth || 0);
                const limit = netAssets * ratio;
                const approvedLoanBalance = toWholeNumber(assets.loan || 0);
                const nextLoanBalance = approvedLoanBalance + amt;

                if (nextLoanBalance > limit) {
                    throw new HttpsError(
                        "failed-precondition",
                        `대출 가능 한도를 초과했습니다. (현재 대출 기준 최대 ${Math.floor(limit).toLocaleString()}${displayCurrencyUnit})`,
                    );
                }
            }

            // 4. 이율 및 조건 계산 (스냅샷 생성)
            const baseRate = Number(product.periodRate || 0);
            const productDays = Number(product.days || 0);
            const overdueRate = Number(product.overdueRate || 0); // 🚀 연체 벌금율 박제

            // 등급별 우대 금리
            const adjData = adjSnap?.data()?.byTier || adjSnap?.data() || {};
            const tierName = studentData.creditTier?.name || "일반";
            const modifiers = shouldApplyTierRateAdjustment ?
                (adjData[tierName] || { loanRateModifier: 0 }) :
                { loanRateModifier: 0 };
            const weeklyModifier = shouldApplyTierRateAdjustment ?
                Number(modifiers.loanRateModifier || 0) :
                0;

            // 최종 이율 (기간 비례 보정)
            const bonusRate = calculatePeriodRateAdjustment(
                weeklyModifier,
                productDays,
            );
            const finalRate = Math.max(0, baseRate + bonusRate);

            // 5. 총 예상 이자 계산 (박제용)
            // 나중에 상환할 때 (normalInterestAmount / days) * 경과일수로 계산합니다.
            const normalInterestAmount = calculateLoanInterest(amt, finalRate);

            // 6. DB 저장
            const loanRef = studentRef.collection("loans").doc();
            const label = product.label || "대출";
            const confirmedRate = Number(finalRate || baseRate || 0);
            const startedAt = isAutoApprovalEnabled
                ? admin.firestore.Timestamp.now()
                : null;
            const expectedRepaymentDate = isAutoApprovalEnabled
                ? addCalendarDaysInKST(startedAt.toDate(), productDays)
                : null;
            const loanData = {
                amount: amt,
                interestLeft: normalInterestAmount,
                interestModel: "declining_balance",
                principal: amt, // 원금
                normalInterestAmount, // 총 약정 이자
                overdueRate, // 일일 벌금율 (%)

                status: isAutoApprovalEnabled ? "ongoing" : "pending",
                days: productDays,

                // 근거 자료 박제
                baseRate,
                weeklyModifier,
                finalRateApplied: finalRate,
                tierApplied: tierName,
                productId: String(product.id),
                productLabel: product.label,

                classId,
                requestedBy: uid,
                studentName: studentData.name || "",
                ...(normalizedBorrowerSignatureImg && {
                    borrowerSignatureImg: normalizedBorrowerSignatureImg,
                    borrowerSignedAt: FieldValue.serverTimestamp(),
                }),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                ...(isAutoApprovalEnabled && {
                    rate: confirmedRate,
                    approvedAt: FieldValue.serverTimestamp(),
                    approvedBy: AUTO_APPROVAL_ACTOR,
                    startedAt,
                    expectedRepaymentDate:
            admin.firestore.Timestamp.fromDate(expectedRepaymentDate),
                    amountLeft: amt,
                    interestState: {
                        accruedAmount: 0,
                        paidAmount: 0,
                        waivedAmount: 0,
                        baseDate: startedAt,
                    },
                    interestPaid: 0,
                    penaltyPaid: 0,
                    processedAt: FieldValue.serverTimestamp(),
                    processedBy: AUTO_APPROVAL_ACTOR,
                }),
            };

            tx.set(loanRef, loanData);

            if (isAutoApprovalEnabled && amt > 0) {
                tx.update(studentRef, {
                    [`assets.${currencyField}`]: FieldValue.increment(amt),
                    "assets.loan": FieldValue.increment(amt),
                });
            }

            if (isAutoApprovalEnabled) {
                stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid: uid,
                        type: "income",
                        category: "loan_approve",
                        amount: amt,
                        description: `'${label}' 대출 승인 및 지급`,
                        relatedDoc: { collection: "loans", id: loanRef.id },
                        currency: currencyUnit,
                    },
                    logCtx,
                );

                stageNotification(tx, classId, {
                    uid,
                    title: "대출 승인 완료",
                    message: `신청하신 '${label}' 대출이 승인되어 지급되었습니다.`,
                    type: "loan_approved",
                    priority: "medium",
                });
            }

            if (clientRequestId && idemRef) {
                tx.set(idemRef, {
                    loanId: loanRef.id,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            return {
                success: true,
                loanId: loanRef.id,
                finalRate,
                autoApproved: isAutoApprovalEnabled,
                expectedRepaymentDate: expectedRepaymentDate
                    ? expectedRepaymentDate.toISOString()
                    : null,
            };
        });

        if (result.autoApproved && result.expectedRepaymentDate) {
            try {
                const expectedDate = new Date(result.expectedRepaymentDate);
                if (!Number.isNaN(expectedDate.getTime())) {
                    const baseAlertTime = new Date(expectedDate.getTime());
                    baseAlertTime.setHours(baseAlertTime.getHours() + 7);

                    const scheduledAt = new Date(baseAlertTime.getTime());
                    scheduledAt.setDate(scheduledAt.getDate() - 3);

                    if (scheduledAt > new Date()) {
                        await scheduleReminder(
                            classId,
                            uid,
                            result.loanId,
                            scheduledAt,
                            "3_days_before",
                            "sendLoanRepaymentReminder",
                        );
                    }
                }
            } catch (scheduleError) {
                console.error("applyLoan auto reminder error:", scheduleError);
            }
        }

        return result;
    } catch (e) {
        console.error("applyLoan Error:", e);
        throw new HttpsError(e.code || "internal", e.message);
    }
});

exports.processSavingAction = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, savingId, actionType } = data || {};
        if (!classId || !savingId || !actionType)
            throw new HttpsError("invalid-argument", "필수 매개변수 누락");

        const globalConfig = await getGlobalConfig();

        try {
            return await db.runTransaction(async (tx) => {
                const classRef = db.collection("classes").doc(classId);
                const studentRef = classRef.collection("students").doc(auth.uid);
                const savingRef = studentRef.collection("savings").doc(savingId);
                const bankSettingsRef = classRef.collection("bank").doc("settings");

                const [classSnap, studentSnap, savingSnap, bankSettingsSnap] = await Promise.all([
                    tx.get(classRef),
                    tx.get(studentRef),
                    tx.get(savingRef),
                    tx.get(bankSettingsRef),
                ]);

                if (!savingSnap.exists)
                    throw new HttpsError("not-found", "예금 정보를 찾을 수 없습니다.");

                const saving = savingSnap.data();
                const classData = classSnap.data() || {};
                const studentData = studentSnap.data() || {};
                const bankSettingsData = bankSettingsSnap.data() || {};
                const productConfig = (bankSettingsData.depositProducts || []).find(
                    (product) => String(product.id) === String(saving.productId || ""),
                );
                const studentName = studentData.name || "";
                const currencyField = classData.currencySettings?.field || "cash";
                const planType = classData.planType || "FREE";
                const taxFeatureEnabled = canUseFeature(
                    globalConfig,
                    planType,
                    "bank",
                    "enableTax",
                );
                const withholdingPolicy =
                    getDepositInterestWithholdingPolicy(classData);
                const logCtx = {
                    config: globalConfig,
                    planType,
                    serviceName: "bank",
                };

                let payoutAmount = 0;
                let interestPaid = 0;
                let grossInterestPaid = 0;
                let interestTaxAmount = 0;
                let interestTaxRateApplied = 0;
                let newStatus = "";
                let logCategory = "";
                let logDescription = "";

                const principal = toSafeNumber(saving.amount || 0);
                // 🚀 applyDeposit에서 저장한 예상 이자 사용
                const storedProfit = roundBankMoney(saving.expectedProfit || 0);
                const claimReferenceDate = new Date();
                const normalizedMaturityDate =
                    toDayjsLike(saving.expectedMaturityDate) ||
                    calculateMaturityDate(saving);
                if (normalizedMaturityDate) {
                    saving.expectedMaturityDate = {
                        toDate: () => normalizedMaturityDate,
                    };
                } else if (
                    saving.expectedMaturityDate &&
                    typeof saving.expectedMaturityDate.toDate !== "function"
                ) {
                    saving.expectedMaturityDate = null;
                }
                const savingInterestTaxPolicy = resolveSavingInterestTaxPolicy(
                    saving,
                    withholdingPolicy,
                    claimReferenceDate,
                );
                withholdingPolicy.enabled = savingInterestTaxPolicy.enabled;
                withholdingPolicy.taxRate = savingInterestTaxPolicy.taxRate;
                withholdingPolicy.enabledFrom =
                    savingInterestTaxPolicy.enabledFrom;

                // 1️⃣ 만기 수령 (Claim)
                if (actionType === "claim") {
                    if (saving.status !== "active")
                        throw new HttpsError(
                            "failed-precondition",
                            "활성화된 예금이 아닙니다.",
                        );

                    // 🚀 applyDeposit에서 저장한 만기일 사용 (없을 시를 대비한 fallback 포함)
                    const maturityDate = saving.expectedMaturityDate
                        ? saving.expectedMaturityDate.toDate()
                        : new Date(); // 만기일 정보가 없으면 즉시 수령 허용 (데이터 방어)

                    if (Date.now() < maturityDate.getTime())
                        throw new HttpsError(
                            "failed-precondition",
                            "아직 만기일이 되지 않았습니다.",
                        );

                    grossInterestPaid = storedProfit;
                    interestPaid = grossInterestPaid;
                    if (
                        taxFeatureEnabled &&
                        withholdingPolicy?.enabled === true &&
                        grossInterestPaid > 0 &&
                        isPolicyActiveFrom(withholdingPolicy?.enabledFrom)
                    ) {
                        const taxSnapshot = buildIncomeTaxSnapshot({
                            sourceKey: "depositInterest",
                            grossAmount: grossInterestPaid,
                            policy: withholdingPolicy,
                        });
                        interestTaxRateApplied = taxSnapshot.incomeTax.taxRate;
                        interestTaxAmount = taxSnapshot.withheldAmount;
                        interestPaid = roundBankMoney(taxSnapshot.netAmount);
                    }
                    payoutAmount = roundBankMoney(principal + interestPaid);
                    newStatus = "completed";
                    logCategory = "deposit_return";
                    logDescription = `'${saving.productLabel}' 만기 수령 (이자: ${interestPaid})`;

                    // 2️⃣ 중도 해지 (Terminate)
                } else if (actionType === "terminate") {
                    if (saving.status !== "active")
                        throw new HttpsError(
                            "failed-precondition",
                            "해지 가능한 상태가 아닙니다.",
                        );

                    if (
                        saving.earlyTerminationBlocked === true ||
                        productConfig?.earlyTerminationBlocked === true
                    ) {
                        throw new HttpsError(
                            "failed-precondition",
                            "이 예금 상품은 만기 전 중도해지가 제한되어 있습니다.",
                        );
                    }

                    interestPaid = 0; // 중도 해지는 이자 없음
                    payoutAmount = roundBankMoney(principal);
                    newStatus = "terminated";
                    logCategory = "deposit_terminate";
                    logDescription = `'${saving.productLabel}' 중도 해지 (원금 반환)`;

                    // 3️⃣ 신청 취소 (Cancel Request)
                } else if (actionType === "cancel_request") {
                    if (saving.status !== "pending")
                        throw new HttpsError(
                            "failed-precondition",
                            "취소 가능한 신청이 아닙니다.",
                        );

                    interestPaid = 0;
                    payoutAmount = roundBankMoney(principal);
                    newStatus = "cancelled_request";
                    logCategory = "deposit_cancel";
                    logDescription = `'${saving.productLabel}' 신청 취소`;
                }

                // --- ✍️ WRITE: 데이터 업데이트 ---

                // 1. 학생 계좌로 돈 입금 (원금 + 이자)
                if (payoutAmount > 0) {
                    tx.update(studentRef, {
                        [`assets.${currencyField}`]: FieldValue.increment(
                            payoutAmount,
                        ),
                    });
                }

                // 2. 예금 총액(deposit)에서 원금 제거 (취소가 아닌 경우에만)
                if (actionType !== "cancel_request" && principal > 0) {
                    tx.update(studentRef, {
                        "assets.deposit": FieldValue.increment(-principal),
                    });
                }

                // 3. 예금 문서 상태 업데이트
                tx.update(savingRef, {
                    status: newStatus,
                    processedAt: FieldValue.serverTimestamp(),
                    processedBy: auth.uid,
                    grossInterestPaid,
                    interestTaxWithheld: interestTaxAmount,
                    interestTaxRateApplied,
                    ...(grossInterestPaid > 0
                        ? {
                            incomeTax: buildIncomeTaxSnapshot({
                                sourceKey: "depositInterest",
                                grossAmount: grossInterestPaid,
                                policy: withholdingPolicy,
                            }).incomeTax,
                        }
                        : {}),
                    actualInterestPaid: roundBankMoney(interestPaid), // 실제 지급된 이자 박제
                    totalPaidAmount: roundBankMoney(payoutAmount), // 실제 총 지급액 박제
                });

                // 4. 로그 기록 (생략 가능하나 기존 로직 유지)
                stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid: auth.uid,
                        type: "income",
                        category: logCategory,
                        amount: payoutAmount,
                        description: logDescription,
                        relatedDoc: { collection: "savings", id: savingId },
                        ...(grossInterestPaid > 0
                            ? {
                                incomeTax: buildIncomeTaxSnapshot({
                                    sourceKey: "depositInterest",
                                    grossAmount: grossInterestPaid,
                                    policy: withholdingPolicy,
                                }).incomeTax,
                            }
                            : {}),
                    },
                    logCtx,
                );

                if (interestTaxAmount > 0) {
                    const taxDescription = `예금 이자 원천징수 (${saving.productLabel || "예금"})`;
                    stageTaxIncome(
                        tx,
                        classId,
                        {
                            amount: interestTaxAmount,
                            description: taxDescription,
                            source: "deposit_interest_withholding",
                            taxType: "deposit_interest_withholding",
                            studentUid: auth.uid,
                            studentName,
                            breakdown: {
                                baseAmount: grossInterestPaid,
                                taxAmount: interestTaxAmount,
                                taxRate: interestTaxRateApplied,
                            },
                        },
                        auth.uid,
                        {
                            config: globalConfig,
                            planType,
                            serviceName: "bank",
                            detailLines: [
                                {
                                    id: savingId,
                                    amount: interestTaxAmount,
                                    description: taxDescription,
                                    source: "deposit_interest_withholding",
                                    taxType: "deposit_interest_withholding",
                                    studentUid: auth.uid,
                                    studentName,
                                    relatedDoc: {
                                        collection: "savings",
                                        id: savingId,
                                    },
                                    meta: {
                                        grossInterestPaid,
                                        taxRate: interestTaxRateApplied,
                                        incomeTax: buildIncomeTaxSnapshot({
                                            sourceKey: "depositInterest",
                                            grossAmount: grossInterestPaid,
                                            policy: withholdingPolicy,
                                        }).incomeTax,
                                    },
                                },
                            ],
                        },
                    );
                }

                return {
                    success: true,
                    payoutAmount,
                    newStatus,
                    grossInterestPaid,
                    interestPaid,
                    interestTaxAmount,
                    interestTaxRateApplied,
                };
            });
        } catch (e) {
            console.error("processSavingAction Error:", e);
            if (e instanceof HttpsError) throw e;
            throw new HttpsError("internal", e.message);
        }
    },
);

/**
 * 3) 대출 상환 (repayLoan)
 */
exports.repayLoan = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, loanId, amount, clientRequestId } = data || {};
    const payAmount = Number(amount);

    if (!classId || !loanId || isNaN(payAmount) || payAmount <= 0) {
        throw new HttpsError("invalid-argument", "유효하지 않은 상환 정보입니다.");
    }

    try {
        return await db.runTransaction(async (tx) => {
            const classRef = db.collection("classes").doc(classId);
            const studentRef = classRef.collection("students").doc(auth.uid);
            const loanRef = studentRef.collection("loans").doc(loanId);

            const readPromises = [
                tx.get(classRef),
                tx.get(studentRef),
                tx.get(loanRef),
            ];

            let idemRef = null;
            if (clientRequestId) {
                idemRef = studentRef
                    .collection("idempotency")
                    .doc(`repay_${clientRequestId}`);
                readPromises.push(tx.get(idemRef));
            }

            const [classSnap, studentSnap, loanSnap, idemSnap] = await Promise.all(
                readPromises,
            );

            if (clientRequestId && idemSnap?.exists) {
                return {
                    success: true,
                    ...(idemSnap.data()?.response || {}),
                    duplicate: true,
                };
            }

            if (!loanSnap.exists)
                throw new HttpsError("not-found", "대출 정보가 없습니다.");

            const loan = loanSnap.data();
            const studentData = studentSnap.data();
            const classData = classSnap.data() || {};
            const currencyField = classData.currencySettings?.field || "cash";

            // 1. 자산 체크
            const currentCash = Number(studentData.assets?.[currencyField] || 0);
            if (currentCash < payAmount) {
                throw new HttpsError("failed-precondition", "보유 현금이 부족합니다.");
            }

            // 2. 계산 준비
            const now = new Date();
            const principalLeft = Number(loan.amountLeft ?? loan.principal ?? 0);
            const interestPaid = Number(loan.interestPaid ?? 0);
            const penaltyPaid = Number(loan.penaltyPaid ?? 0);

            const normalInterestTotal = Number(
                loan.normalInterestAmount ??
                loan.interestCalculatedOnRequest ??
                loan.expectedProfit ??
                loan.interestLeft ??
                0,
            );
            const totalDays = Number(loan.days || 1);
            const overdueRate = Number(loan.overdueRate || 0);
            const useDecliningInterest = isDecliningBalanceLoan(loan);

            // 3. 이자 계산 (일할 누적)
            let interestCalc = null;
            let interestDue = 0;

            if (useDecliningInterest) {
                interestCalc = calculateDecliningLoanInterest(loan, now);
                interestDue = interestCalc.interestDue;
            } else {
                const passedDays = Math.max(
                    0,
                    Math.min(totalDays, getElapsedLoanDays(loan, now)),
                );
                const accruedInterest = Math.round(
                    (normalInterestTotal / totalDays) * passedDays,
                );
                interestDue = Math.max(0, accruedInterest - interestPaid);
            }

            // 4. 연체료 계산 (기준일 방식 🚀)
            const dueDate = calculateRepaymentDate(loan);
            const overdueDays = dueDate ? getLoanOverdueDays(loan, now) : 0;
            let penaltyDue = 0;

            if (overdueDays > 0) {
                penaltyDue = Math.round(
                    principalLeft * (overdueRate / 100) * overdueDays,
                );
            }

            // 5. 상환 처리 (Waterfall: 연체료 -> 이자 -> 원금)
            let remainingMoney = payAmount;
            const payingPenalty = Math.min(remainingMoney, penaltyDue);
            remainingMoney -= payingPenalty;

            const payingInterest = Math.min(remainingMoney, interestDue);
            remainingMoney -= payingInterest;

            const payingPrincipal = Math.min(remainingMoney, principalLeft);
            remainingMoney -= payingPrincipal;

            // 6. 업데이트 값 준비
            const newPrincipalLeft = principalLeft - payingPrincipal;
            const newInterestPaid = interestPaid + payingInterest;
            const newPenaltyPaid = penaltyPaid + payingPenalty;
            const isFullyRepaid =
        newPrincipalLeft < 1 &&
        interestDue - payingInterest < 1 &&
        penaltyDue - payingPenalty < 1;
            const newInterestLeft = isFullyRepaid
                ? 0
                : useDecliningInterest
                    ? Math.max(0, interestDue - payingInterest)
                    : Math.max(0, normalInterestTotal - newInterestPaid);

            // 7. DB 업데이트 (트랜잭션)
            tx.update(studentRef, {
                [`assets.${currencyField}`]: FieldValue.increment(-payAmount),
                "assets.loan": FieldValue.increment(-payingPrincipal),
            });

            const loanUpdate = {
                amountLeft: newPrincipalLeft,
                interestLeft: newInterestLeft,
                interestPaid: newInterestPaid,
                penaltyPaid: newPenaltyPaid,
                status: isFullyRepaid ? "repaid" : "ongoing",
                lastRepaymentAt: FieldValue.serverTimestamp(),
                totalRepaidAmount: FieldValue.increment(payAmount),
                ...(overdueDays > 0 && {
                    penaltyBaseDate: FieldValue.serverTimestamp(),
                }),
                ...(isFullyRepaid && {
                    actualRepaymentDate: FieldValue.serverTimestamp(),
                }),
            };

            if (useDecliningInterest && interestCalc) {
                loanUpdate["interestState.accruedAmount"] =
                    interestCalc.accruedAmount;
                loanUpdate["interestState.paidAmount"] = newInterestPaid;
                loanUpdate["interestState.waivedAmount"] =
                    interestCalc.waivedAmount;
                if (interestCalc.elapsedDays > 0) {
                    loanUpdate["interestState.baseDate"] =
                        FieldValue.serverTimestamp();
                }
            }

            tx.update(loanRef, loanUpdate);

            // -----------------------------------------------------------
            // 8. 활동 로그 기록 (통합 1회 기록)
            // -----------------------------------------------------------
            const details = [];
            if (payingPenalty > 0)
                details.push(`연체료 ${payingPenalty.toLocaleString()}`);
            if (payingInterest > 0)
                details.push(`이자 ${payingInterest.toLocaleString()}`);
            if (payingPrincipal > 0)
                details.push(`원금 ${payingPrincipal.toLocaleString()}`);

            // 예: "'대출상품A' 상환 완료 (연체료 100, 이자 50, 원금 1,000)"
            const description = `'${loan.productLabel || "대출"}' 상환 (${details.join(", ")})`;

            const logData = {
                studentUid: auth.uid,
                type: "expense",
                category: "loan_repayment",
                amount: payAmount, // 총 상환액 하나만 기록
                currency:
                    classData.currencyUnit ||
                    classData.currencySettings?.name ||
                    "단위",
                description: description,
                relatedDoc: { collection: "loans", id: loanId },
            };

            const logContext = {
                planType: classData.planType || "FREE",
                serviceName: "bank",
            };

            // tx(writer)를 넘겨서 트랜잭션 내에서 로그 1줄 기록
            stageActivityLog(tx, classId, logData, logContext);

            const response = {
                success: true,
                paidPrincipal: payingPrincipal,
                paidInterest: payingInterest,
                paidPenalty: payingPenalty,
                fullyRepaid: isFullyRepaid,
            };

            if (clientRequestId && idemRef) {
                tx.set(idemRef, {
                    response,
                    createdAt: FieldValue.serverTimestamp(),
                });
            }

            return response;
        });
    } catch (e) {
        console.error("repayLoan Error:", e);
        throw new HttpsError(e.code || "internal", e.message);
    }
});

/**
 * [관리자 전용] 은행 상품 마스터 관리 (adminBankAction)
 */
exports.adminBankAction = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, targetUid, docId, type, payload } = data || {};
        if (!classId || !targetUid || !docId || !type) {
            throw new HttpsError("invalid-argument", "필수 매개변수 누락");
        }

        const globalConfig = await getGlobalConfig();

        return await db.runTransaction(async (tx) => {
            // 권한 체크
            await mustBeTeacherOrTaxAdmin(classId, auth.uid, { teacherOnly: true });

            const classRef = db.collection("classes").doc(classId);
            const studentRef = classRef.collection("students").doc(targetUid);
            const bankSettingsRef = classRef.collection("bank").doc("settings");
            const [classSnap, bankSettingsSnap] = await Promise.all([
                tx.get(classRef),
                tx.get(bankSettingsRef),
            ]);

            if (!classSnap.exists)
                throw new HttpsError("not-found", "클래스 정보 없음");

            const classData = classSnap.data();
            const bankSettingsData = bankSettingsSnap.data() || {};
            const logCtx = {
                config: globalConfig,
                planType: classData.planType || "FREE",
                serviceName: "bank",
            };
            const currencyField = classData.currencySettings?.field || "cash";

            // -------------------------------------------------------
            // 1️⃣ 금융 조건 마스터 수정 (예금/대출 통합)
            // -------------------------------------------------------
            if (type === "update_item_master") {
                const isLoan = payload.category === "loans";
                const coll = isLoan ? "loans" : "savings";
                const docRef = studentRef.collection(coll).doc(docId);
                const snap = await tx.get(docRef);

                if (!snap.exists) throw new HttpsError("not-found", "데이터 부재");

                const oldData = snap.data();
                const { days, rate, productLabel } = payload.fields;

                // [데이터 정규화]
                const updatedDays = days !== undefined ? Number(days) : oldData.days;
                const updatedRate =
          rate !== undefined ? Number(rate) : oldData.rate || 0;
                const currentPrincipal = Number(
                    oldData.principal ?? oldData.amount ?? 0,
                );
                const currentPrincipalLeft = Number(
                    oldData.amountLeft ?? oldData.principal ?? oldData.amount ?? 0,
                );

                // [날짜 재계산 준비]
                const dataForRecalc = {
                    ...oldData,
                    days: updatedDays,
                    rate: updatedRate,
                    expectedMaturityDate: null,
                    expectedRepaymentDate: null,
                };

                const newMaturity = calculateMaturityDate(dataForRecalc);

                // [이자 재계산]
                // 1. 전체 약정 이자 (가입 시점 기준 총액)
                const newTotalInterest = calculateSavingInterest(
                    currentPrincipal,
                    updatedRate,
                );

                const updatePayload = {
                    days: updatedDays,
                    rate: updatedRate,
                    productLabel: productLabel || oldData.productLabel,
                    interestCalculatedOnRequest: newTotalInterest,
                    // 🔥 선생님이 입력한 사유를 최우선 저장
                    adminNote: payload.adminNote || "관리자 마스터 수정",
                    lastEditedAt: FieldValue.serverTimestamp(),
                };

                // 2. 🔥 [대출 전용] 남은 이자 한도 동기화
                if (isLoan) {
                    updatePayload.expectedRepaymentDate = newMaturity;
                    // 남은 원금에 대해 새 이율을 적용하여 이자 잔액(주머니)을 새로 고침
                    const newInterestLeft = Math.floor(
                        currentPrincipalLeft * (updatedRate / 100),
                    );
                    updatePayload.interestLeft = newInterestLeft;
                } else {
                    updatePayload.expectedProfit = newTotalInterest;
                    updatePayload.expectedTotalAmount = roundBankMoney(
                        currentPrincipal + newTotalInterest,
                    );
                    updatePayload.expectedMaturityDate = newMaturity;
                }

                await tx.update(docRef, updatePayload);

                // [활동 로그 기록]
                await stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid: targetUid,
                        type: "system",
                        category: "bank_admin_edit",
                        amount: 0,
                        description: `[마스터키] '${updatePayload.productLabel}' 조건 변경: ${updatedDays}일 / ${updatedRate}%`,
                        relatedDoc: { collection: coll, id: docId },
                    },
                    logCtx,
                );
            }

            // -------------------------------------------------------
            // 2️⃣ 예금 강제 해지 (원금 반환)
            // -------------------------------------------------------
            else if (type === "force_terminate_saving") {
                const savingRef = studentRef.collection("savings").doc(docId);
                const savingSnap = await tx.get(savingRef);
                if (!savingSnap.exists) {
                    throw new HttpsError("not-found", "예금 정보를 찾을 수 없습니다.");
                }
                const saving = savingSnap.data();
                const principal = Number(saving.amount || 0);
                const savingStatus = String(saving.status || "");
                const isPendingRequest = savingStatus === "pending";
                const isActiveSaving = savingStatus === "active";
                const productConfig = (bankSettingsData.depositProducts || []).find(
                    (product) => String(product.id) === String(saving.productId || ""),
                );

                if (!isPendingRequest && !isActiveSaving) {
                    throw new HttpsError(
                        "failed-precondition",
                        "강제 처리할 수 있는 예금 상태가 아닙니다.",
                    );
                }

                if (
                    isActiveSaving &&
                    (saving.earlyTerminationBlocked === true ||
                        productConfig?.earlyTerminationBlocked === true)
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "이 예금 상품은 만기 전 중도해지가 제한되어 있습니다.",
                    );
                }

                const productLabel = saving.productLabel || "삭제된 예금 상품";

                if (principal > 0) {
                    await tx.update(studentRef, {
                        [`assets.${currencyField}`]: FieldValue.increment(principal),
                    });
                }

                if (!isPendingRequest && principal > 0) {
                    await tx.update(studentRef, {
                        "assets.deposit": FieldValue.increment(-principal),
                    });
                }

                await tx.update(savingRef, {
                    status: isPendingRequest ? "cancelled_request" : "terminated",
                    processedAt: FieldValue.serverTimestamp(),
                    processedBy: auth.uid,
                    actualInterestPaid: 0,
                    totalPaidAmount: principal,
                    adminNote: isPendingRequest
                        ? "관리자 강제 취소 (원금 복구)"
                        : "관리자 강제 해지 (원금 반환)",
                });

                await stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid: targetUid,
                        type: "income",
                        category: isPendingRequest
                            ? "deposit_cancel"
                            : "deposit_terminate",
                        amount: principal,
                        description: isPendingRequest
                            ? `[관리자] '${productLabel}' 예금 강제 취소`
                            : `[관리자] '${productLabel}' 예금 강제 해지`,
                        relatedDoc: { collection: "savings", id: docId },
                    },
                    logCtx,
                );
            }

            // -------------------------------------------------------
            // 3️⃣ 대출 강제 상환 (원금 차감)
            // -------------------------------------------------------
            else if (type === "force_repay_loan") {
                const loanRef = studentRef.collection("loans").doc(docId);
                const loanSnap = await tx.get(loanRef);
                if (!loanSnap.exists) {
                    throw new HttpsError("not-found", "대출 정보를 찾을 수 없습니다.");
                }
                const loan = loanSnap.data();
                const loanStatus = String(loan.status || "");
                const isPendingRequest = loanStatus === "pending";
                const isOngoingLoan =
                    loanStatus === "ongoing" || loanStatus === "active";

                if (!isPendingRequest && !isOngoingLoan) {
                    throw new HttpsError(
                        "failed-precondition",
                        "강제 처리할 수 있는 대출 상태가 아닙니다.",
                    );
                }

                const principalLeft = Number(
                    loan.amountLeft ?? loan.principal ?? loan.amount ?? 0,
                );
                const productLabel = loan.productLabel || "삭제된 대출 상품";

                if (!isPendingRequest && principalLeft > 0) {
                    await tx.update(studentRef, {
                        [`assets.${currencyField}`]: FieldValue.increment(-principalLeft),
                        "assets.loan": FieldValue.increment(-principalLeft),
                    });
                }

                await tx.update(loanRef, {
                    amountLeft: 0,
                    interestLeft: 0,
                    status: isPendingRequest ? "cancelled_request" : "repaid",
                    processedAt: FieldValue.serverTimestamp(),
                    processedBy: auth.uid,
                    totalRepaidAmount: isPendingRequest ? 0 : principalLeft,
                    ...(isPendingRequest
                        ? {
                            interestPaid: 0,
                            penaltyPaid: 0,
                            adminNote: "관리자 강제 취소",
                        }
                        : {
                            actualRepaymentDate: FieldValue.serverTimestamp(),
                            adminNote: "관리자 강제 상환",
                        }),
                });

                await stageActivityLog(
                    tx,
                    classId,
                    isPendingRequest
                        ? {
                            studentUid: targetUid,
                            type: "system",
                            category: "bank_admin_edit",
                            amount: 0,
                            description: `[관리자] '${productLabel}' 대출 강제 취소`,
                            relatedDoc: { collection: "loans", id: docId },
                        }
                        : {
                            studentUid: targetUid,
                            type: "expense",
                            category: "loan_repayment",
                            amount: principalLeft,
                            description: `[관리자] '${productLabel}' 대출 강제 상환`,
                            relatedDoc: { collection: "loans", id: docId },
                        },
                    logCtx,
                );
            }

            return { success: true };
        });
    },
);
