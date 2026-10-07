"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

if (admin.apps.length === 0) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const { stageTaxIncome } = require("../utils/taxIncome");
const { stageActivityLog } = require("../utils/logUtils");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const { selectMiniQuizSubmission, calculateMiniQuizReward, miniQuizProgressFromAttempts } = require("../utils/miniQuizSubmission");
const {
    DEFAULT_CLASS_CURRENCY_UNIT,
    resolveClassCurrencyUnit,
} = require("../utils/currencyUnit");
const {
    buildTrackedInventoryAcquisition,
    consumeTrackedInventoryAcquisitions,
} = require("../utils/inventoryAccounting");
const {
    buildRandomBoxRewardUsageTransition,
} = require("../utils/randomBoxTracking");

const ARCADE_OPTS = {
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 60,
};
const TAX_LINE_COLLECTION = "lines";

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

const buildArcadePrizeIncomeTax = (classData = {}, grossAmount = 0) =>
    buildIncomeTaxSnapshot({
        sourceKey: "arcadePrize",
        grossAmount,
        policy: getWithholdingPolicy(classData, "arcadePrize") || {},
    });

const VALID_PAYMENT_TYPES = new Set(["cash", "ticket"]);
const VALID_LOTTO_MANAGE_ACTIONS = new Set([
    "create",
    "update",
    "open",
    "pause",
    "resume",
    "close",
    "delete",
    "publish_results",
    "set_enabled",
]);
const VALID_NOSTALGIA_PICK_MANAGE_ACTIONS = new Set([
    "create",
    "update",
    "open",
    "pause",
    "resume",
    "close",
    "delete",
    "draw",
    "publish_results",
    "set_enabled",
]);
const DRAWABLE_LOTTO_STATUSES = new Set(["closed", "finished"]);
const DEFAULT_ALLOWED_PAYMENT_TYPES = ["cash", "ticket"];
const KOREA_TIMEZONE = "Asia/Seoul";
const MISSION_TOKEN_UNIT = "mission token";

function getLottoPendingResultRef(classId, roundId) {
    return db.doc(
        `classes/${classId}/arcadePrivate/lottoPendingResults/rounds/${roundId}`,
    );
}

function getNostalgiaPickPendingResultRef(classId, roundId) {
    return db.doc(
        `classes/${classId}/arcadePrivate/nostalgiaPickPendingResults/rounds/${roundId}`,
    );
}

function toYmdInTimeZone(date = new Date(), timeZone = KOREA_TIMEZONE) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const values = {};
    for (const part of parts) {
        if (part.type === "year" || part.type === "month" || part.type === "day") {
            values[part.type] = part.value;
        }
    }
    return `${values.year}-${values.month}-${values.day}`;
}

function assertPaymentType(paymentType) {
    if (!VALID_PAYMENT_TYPES.has(paymentType)) {
        throw new HttpsError("invalid-argument", "??????椰????????????????⑥レ뿥??????????????????嚥???癲??? ??????????꿔꺂???癰?????????癲ル슢?싩땟????????????????꿔꺂???⑸븶?????????????????");
    }
}

function normalizeAllowedPaymentTypes(allowedPaymentTypes) {
    if (!Array.isArray(allowedPaymentTypes)) {
        return [...DEFAULT_ALLOWED_PAYMENT_TYPES];
    }

    const normalized = [
        ...new Set(
            allowedPaymentTypes
                .map((type) => String(type || "").trim())
                .filter((type) => VALID_PAYMENT_TYPES.has(type)),
        ),
    ];

    return normalized.length > 0
        ? normalized
        : [...DEFAULT_ALLOWED_PAYMENT_TYPES];
}

/*
function getPaymentTypeLabel(paymentType) {
    return paymentType === "ticket" ? "???????? : "????????????;
}

function assertGamePaymentAllowed(gameLabel, gameConfig, paymentType) {
    const allowedPaymentTypes = normalizeAllowedPaymentTypes(
        gameConfig?.allowedPaymentTypes,
    );

    if (allowedPaymentTypes.includes(paymentType)) return;

    const paymentPolicyLabel =
        allowedPaymentTypes.length === 1
            ? `${getPaymentTypeLabel(allowedPaymentTypes[0])} only`
            : "configured payment methods only";

    throw new HttpsError(
        "failed-precondition",
        `${gameLabel}?? ${paymentPolicyLabel} ????????饔낅떽?????怨뚮옩鴉?????????????????????????살몝??`,
    );
}

*/

function getPaymentTypeLabel(paymentType) {
    return paymentType === "ticket" ? "ticket" : "cash";
}

function assertGamePaymentAllowed(gameLabel, gameConfig, paymentType) {
    const allowedPaymentTypes = normalizeAllowedPaymentTypes(
        gameConfig?.allowedPaymentTypes,
    );

    if (allowedPaymentTypes.includes(paymentType)) return;

    const paymentPolicyLabel =
        allowedPaymentTypes.length === 1
            ? `${getPaymentTypeLabel(allowedPaymentTypes[0])} only`
            : "configured payment methods only";

    throw new HttpsError(
        "failed-precondition",
        `${gameLabel}: ${paymentPolicyLabel}`,
    );
}

function assertTeacherOrAdmin(auth) {
    const role = auth?.token?.role;
    if (!["teacher", "admin"].includes(role)) {
        throw new HttpsError("permission-denied", "?????????????????????嶺뚮ㅎ?볠꽴?????????????臾?????????????????????????????????????????살몝??");
    }
}

function isArcadeUsageLimitExempt(auth) {
    return auth?.token?.role === "teacher";
}

function canPreviewHiddenArcadeGame(auth) {
    return ["teacher", "admin"].includes(auth?.token?.role);
}

// eslint-disable-next-line no-unused-vars
function legacyAssertTeacherClassScope(auth, classId) {
    const role = auth?.token?.role;
    const tokenClassId = auth?.token?.classId;
    if (role === "teacher" && tokenClassId && tokenClassId !== classId) {
        throw new HttpsError("permission-denied", "???????????濚밸Ŧ?????????????遺얘턁????????????????????????????????ㅻ깹??????????????????????嚥???癲??????????????????대첐??");
    }
}

function assertTeacherClassScopeStrict(auth, classId) {
    const role = auth?.token?.role;
    const tokenClassId = auth?.token?.classId;
    if (role === "teacher" && tokenClassId && tokenClassId !== classId) {
        throw new HttpsError(
            "permission-denied",
            "Teacher can only manage rounds in their own class.",
        );
    }
}

function assertArcadeAccessible(globalConfig, planType, arcadeSettings) {
    if (
        !canUseFeature(globalConfig, planType, "arcade", "accessible") ||
        arcadeSettings?.enabled === false
    ) {
        throw new HttpsError("failed-precondition", "????????????????거???????????????? ???????????????????????????????????????");
    }
}

function getArcadeTicketInventoryQuery(classId, userId) {
    return db
        .collection(`classes/${classId}/students/${userId}/inventory`)
        .where("quantity", ">", 0);
}

function isArcadeTicketInventoryData(data = {}) {
    return data?.functionTag === "arcade_ticket" ||
        (data?.itemType === "ticket" && !data?.functionTag);
}

function sumTicketQuantity(ticketQuerySnap) {
    return (ticketQuerySnap?.docs || []).reduce(
        (sum, docSnap) =>
            isArcadeTicketInventoryData(docSnap.data())
                ? sum + Math.max(0, Number(docSnap.data()?.quantity || 0))
                : sum,
        0,
    );
}

function resolveTicketSnap(ticketQuerySnap, preferredRef = null) {
    const docs = (ticketQuerySnap?.docs || []).filter((docSnap) =>
        isArcadeTicketInventoryData(docSnap.data()),
    );
    if (!docs.length) return null;
    if (!preferredRef) return docs[0];

    return docs.find((docSnap) => docSnap.ref.path === preferredRef.path) || docs[0];
}

function applyRandomBoxRewardUsageTracking(
    tx,
    { classId, studentUid, detail, usedAt },
) {
    const transition = buildRandomBoxRewardUsageTransition(detail);
    if (!transition || !classId) {
        return;
    }

    const openEventRef = db.doc(
        `classes/${classId}/storeRedemptions/${transition.purchaseId}/openEvents/${transition.randomBoxOpenId}`,
    );
    const redemptionRef = db.doc(
        `classes/${classId}/storeRedemptions/${transition.purchaseId}`,
    );

    tx.set(
        openEventRef,
        {
            rewardUsedQty: FieldValue.increment(transition.usedQuantity),
            rewardRemainingQty: transition.remainingQuantityAfterUse,
            rewardUsageStatus: transition.nextStatus,
            rewardLastUsedAt: usedAt,
            updatedAt: usedAt,
            ...(studentUid ? { studentUid } : {}),
        },
        { merge: true },
    );

    const summaryUpdates = Object.entries(transition.summaryCounterUpdates).reduce(
        (accumulator, [fieldName, delta]) => {
            if (!delta) {
                return accumulator;
            }
            accumulator[fieldName] = FieldValue.increment(delta);
            return accumulator;
        },
        {},
    );

    tx.set(
        redemptionRef,
        {
            ...summaryUpdates,
            randomBoxLastUsedAt: usedAt,
        },
        { merge: true },
    );
}

function consumeArcadeTicket(
    tx,
    {
        classId,
        userId,
        ticketSnap,
        studentRef,
        totalTicketCount,
        note = "",
        usedBy = null,
    },
) {
    if (!ticketSnap?.exists) {
        throw new HttpsError("failed-precondition", "?????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
    }

    if (!classId || !userId) {
        throw new HttpsError("failed-precondition", "?????????????嫄???????????????癲꾧퀗?닺짆?????????????????????鶯??????????????쎛 ??????????諛몃마嶺뚮?????????????硫λ젒?????????????????????");
    }

    const ticketData = ticketSnap.data() || {};
    const currentQty = Number(ticketData.quantity || 0);
    const ticketAccounting = consumeTrackedInventoryAcquisitions(
        ticketData.acquisitions,
        1,
        ticketData,
    );
    if (currentQty <= 0) {
        throw new HttpsError("failed-precondition", "?????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
    }

    if (ticketAccounting.remainingQuantity > 0) {
        for (let index = 0; index < ticketAccounting.remainingQuantity; index += 1) {
            ticketAccounting.consumptionDetails.push({
                sourceType: "purchase",
                fromName: null,
                message: null,
                obtainedFrom: ticketData?.obtainedFrom || null,
                quantity: 1,
                unitValue: Math.max(0, Number(ticketData.price || 0)),
                assetValueApplied: true,
                ticketCountApplied: true,
            });
        }
    }

    const studentUpdates = {
        "assets.ticket": Math.max(Number(totalTicketCount || 0) - 1, 0),
    };
    if (ticketAccounting.totalAssetValueToRemove > 0) {
        studentUpdates["assets.itemValue"] = FieldValue.increment(
            -ticketAccounting.totalAssetValueToRemove,
        );
    }
    tx.update(studentRef, studentUpdates);

    const usageLogCol = db.collection(
        `classes/${classId}/students/${userId}/usageHistory`,
    );
    for (const detail of ticketAccounting.consumptionDetails) {
        tx.set(usageLogCol.doc(), {
            itemId: ticketData.itemId || ticketSnap.id,
            itemName: ticketData.itemName || "Arcade Ticket",
            quantity: detail.quantity,
            sourceType: detail.sourceType,
            fromName: detail.fromName,
            message: detail.message,
            unitValue: detail.unitValue || 0,
            assetValueApplied: detail.assetValueApplied === true,
            ticketCountApplied: detail.ticketCountApplied === true,
            obtainedFrom: detail.obtainedFrom || null,
            sourcePurchaseId: detail.sourcePurchaseId || null,
            randomBoxOpenId: detail.randomBoxOpenId || null,
            boxItemId: detail.boxItemId || null,
            boxItemName: detail.boxItemName || null,
            note,
            usedDate: FieldValue.serverTimestamp(),
            status: "used",
            ...(usedBy?.uid && {
                usedByUid: usedBy.uid,
                usedByName: usedBy.name || "",
                usedByRole: usedBy.role || "",
            }),
        });
        applyRandomBoxRewardUsageTracking(tx, {
            classId,
            studentUid: userId,
            detail,
            usedAt: FieldValue.serverTimestamp(),
        });
    }

    if (currentQty <= 1) {
        tx.delete(ticketSnap.ref);
        return;
    }

    tx.update(ticketSnap.ref, {
        quantity: FieldValue.increment(-1),
        acquisitions: ticketAccounting.updatedAcquisitions,
        totalUsed: FieldValue.increment(1),
    });
}

function rethrowCallableError(error) {
    if (error instanceof HttpsError) throw error;
    if (typeof error?.code === "string") {
        throw new HttpsError(
            error.code,
            error.message || "??????????????椰??????????????遺얘턁???????猷몄굣?????????????????????嶺???????????? ?????????썹땟戮녹??諭?????⑸㎦?????????????????耀붾굝???????????????????????????????살몝??",
        );
    }
    throw new HttpsError(
        "internal",
        error?.message || "??????????????椰??????????????遺얘턁???????猷몄굣?????????????????????嶺???????????? ?????????썹땟戮녹??諭?????⑸㎦?????????????????耀붾굝???????????????????????????????살몝??",
    );
}

/** ?????????嚥싲갭큔????????? ????????釉먮폁???????????????????붺몭????? ?????????썹땟戮녹??諭?????⑸㎦???????????*/
function getToday() {
    return toYmdInTimeZone(new Date(), KOREA_TIMEZONE);
}

/** ?????????嚥싲갭큔????????? ???????????????거?????????????????????????? ?????????썹땟戮녹??諭?????⑸㎦???????????*/
function getWeekStart() {
    const nowInKst = new Date(
        new Date().toLocaleString("en-US", { timeZone: KOREA_TIMEZONE }),
    );
    const day = nowInKst.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    nowInKst.setDate(nowInKst.getDate() + diff);
    return toYmdInTimeZone(nowInKst, KOREA_TIMEZONE);
}

function assertNonNegativeFiniteNumber(value, fieldName) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
        throw new HttpsError(
            "failed-precondition",
            `${fieldName} ???????????????????? ???????????????????살몝??`,
        );
    }
    return n;
}

function getArcadeFeeAmount(config, fieldPrefix) {
    return assertNonNegativeFiniteNumber(
        config?.feeAmount || 0,
        `${fieldPrefix}.feeAmount`,
    );
}

function getArcadeCashChargeAmount({ paymentType, price, feeAmount }) {
    const basePrice = paymentType === "cash" ? Number(price) || 0 : 0;
    return basePrice + (Number(feeAmount) || 0);
}

function buildArcadeChargeText({
    paymentType,
    price,
    feeAmount,
    currencyUnit = DEFAULT_CLASS_CURRENCY_UNIT,
}) {
    const safePrice = Number(price) || 0;
    const safeFeeAmount = Number(feeAmount) || 0;

    if (paymentType === "ticket") {
        if (safeFeeAmount > 0) {
            return `이용권 1장 + 수수료 ${safeFeeAmount} ${currencyUnit}`;
        }
        return "이용권 1장";
    }

    if (safeFeeAmount > 0) {
        return `${safePrice} ${currencyUnit} + 수수료 ${safeFeeAmount} ${currencyUnit}`;
    }

    return `${safePrice} ${currencyUnit}`;
}

function toDateFromFirestoreValue(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.toMillis === "function") return new Date(value.toMillis());
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getLottoTicketUsageDate(ticketData = {}) {
    const explicitDate = String(ticketData.usageDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) return explicitDate;

    const purchasedAt = toDateFromFirestoreValue(ticketData.purchasedAt);
    return purchasedAt ? toYmdInTimeZone(purchasedAt, KOREA_TIMEZONE) : getToday();
}

function assertLottoRoundRefundable(roundData = {}) {
    if (!["open", "paused"].includes(roundData.status)) {
        throw new HttpsError(
            "failed-precondition",
            "Only open or paused lotto rounds can be refunded.",
        );
    }

    if (roundData.settings?.endTime) {
        const end = new Date(roundData.settings.endTime).getTime();
        if (Number.isFinite(end) && Date.now() > end) {
            throw new HttpsError(
                "failed-precondition",
                "Lotto tickets can only be refunded before the round deadline.",
            );
        }
    }
}

function resolveLottoTicketCharge(ticketData = {}, lottoGameConfig = {}) {
    const price = assertNonNegativeFiniteNumber(
        ticketData.price ?? ticketData.chargeSnapshot?.price ?? lottoGameConfig.price ?? 500,
        "lotto.refund.price",
    );
    const feeAmount = assertNonNegativeFiniteNumber(
        ticketData.feeAmount ?? ticketData.chargeSnapshot?.feeAmount ?? lottoGameConfig.feeAmount ?? 0,
        "lotto.refund.feeAmount",
    );
    const paymentType = VALID_PAYMENT_TYPES.has(ticketData.paymentType)
        ? ticketData.paymentType
        : "cash";
    const fallbackCashChargeAmount = getArcadeCashChargeAmount({
        paymentType,
        price,
        feeAmount,
    });
    const cashChargeAmount = assertNonNegativeFiniteNumber(
        ticketData.cashChargeAmount ?? ticketData.chargeSnapshot?.cashChargeAmount ?? fallbackCashChargeAmount,
        "lotto.refund.cashChargeAmount",
    );

    return {
        paymentType,
        price,
        feeAmount,
        cashChargeAmount,
        cashRefundAmount: cashChargeAmount,
    };
}

function getLottoRefundInventoryRef(classId, studentUid, ticketData = {}) {
    const path = String(
        ticketData.ticketInventoryPath ||
        ticketData.sourceTicketInventoryPath ||
        "",
    ).trim();
    const allowedPrefix = `classes/${classId}/students/${studentUid}/inventory/`;
    if (path.startsWith(allowedPrefix)) {
        return db.doc(path);
    }

    const itemId = String(
        ticketData.sourceTicketInventoryId ||
        ticketData.ticketInventory?.itemId ||
        ticketData.refundTicketItemId ||
        "",
    ).trim();
    if (itemId) {
        return db.doc(`classes/${classId}/students/${studentUid}/inventory/${itemId}`);
    }

    return null;
}

function restoreRefundedArcadeTicket(
    tx,
    {
        ticketId,
        ticketData,
        inventoryRef,
        inventorySnap,
        nowTs,
    },
) {
    const existingData = inventorySnap?.exists ? (inventorySnap.data() || {}) : {};
    const storedInventory = ticketData.ticketInventory || {};
    const itemId =
        existingData.itemId ||
        storedInventory.itemId ||
        inventoryRef.id ||
        "arcade_ticket_refund";
    const itemName =
        existingData.itemName ||
        storedInventory.itemName ||
        "Arcade Ticket";
    const itemType =
        existingData.itemType ||
        storedInventory.itemType ||
        "ticket";
    const functionTag =
        existingData.functionTag ??
        storedInventory.functionTag ??
        "arcade_ticket";
    const price = Math.max(
        0,
        Number(
            ticketData.ticketUnitValue ??
            storedInventory.price ??
            existingData.price ??
            0,
        ) || 0,
    );
    const acquisition = buildTrackedInventoryAcquisition({
        type: "lotto_refund",
        lottoTicketId: ticketId,
        roundId: ticketData.roundId || null,
        quantity: 1,
        acquiredAt: admin.firestore.Timestamp.now(),
        unitValue: price,
        assetValueApplied: price > 0 &&
            (existingData.currencyType || storedInventory.currencyType) !== "usdBalance",
        ticketCountApplied: true,
        obtainedFrom: "lotto_refund",
    });
    const inventoryData = {
        itemId,
        itemName,
        itemType,
        functionTag,
        isGiftAllowed:
            existingData.isGiftAllowed !== undefined
                ? existingData.isGiftAllowed
                : storedInventory.isGiftAllowed !== false,
        price,
        currencyType:
            existingData.currencyType ||
            storedInventory.currencyType ||
            "cash",
        currencyUnit:
            existingData.currencyUnit ||
            storedInventory.currencyUnit ||
            null,
        lastAcquiredDate: nowTs,
        obtainedFrom: "lotto_refund",
    };

    if (inventorySnap?.exists) {
        tx.update(inventoryRef, {
            ...inventoryData,
            quantity: FieldValue.increment(1),
            totalAcquired: FieldValue.increment(1),
            acquisitions: FieldValue.arrayUnion(acquisition),
        });
    } else {
        tx.set(inventoryRef, {
            ...inventoryData,
            quantity: 1,
            totalAcquired: 1,
            totalUsed: 0,
            createdAt: nowTs,
            acquisitions: [acquisition],
        });
    }

    return { itemValue: (existingData.currencyType || storedInventory.currencyType) === "usdBalance" ? 0 : price };
}

function stageArcadeRevenue(
    tx,
    {
        classId,
        userId,
        studentName,
        gameId,
        gameLabel,
        classData,
        amount,
        paymentType,
        nowTs,
        globalConfig,
        planType,
        customId = null,
    },
) {
    const revenueAmount = Number(amount) || 0;
    if (!(revenueAmount > 0)) return;

    const revenueLogs = db.collection(`classes/${classId}/arcade/config/revenueLogs`);
    const revenueRef = customId ? revenueLogs.doc(customId) : revenueLogs.doc();
    const taxRecordId = `${gameId}_${revenueRef.id}`;
    const taxLineId = revenueRef.id;
    const description = `${gameLabel} 수익 - ${studentName || "학생"}`;
    stageActivityLog(
        tx,
        classId,
        {
            studentUid: userId,
            type: "expense",
            category: "arcade_treasury",
            amount: revenueAmount,
            description,
            taxEvent: {
                sourceKey: "arcadeRevenue",
                taxCategory: "service_revenue",
                taxType: "arcade_revenue",
                amount: revenueAmount,
            },
        },
        {
            config: globalConfig,
            planType,
            serviceName: "arcade",
            customId: `arcade_tax_${revenueRef.id}`,
        },
    );

    const taxResult = stageTaxIncome(
        tx,
        classId,
        {
            amount: revenueAmount,
            source: "arcade",
            taxType: "arcade_revenue",
            studentUid: userId,
            studentName: studentName || null,
            description,
        },
        userId,
        {
            config: globalConfig,
            planType,
            serviceName: "arcade",
            classData,
            sourceKey: "arcadeRevenue",
            customId: taxRecordId,
            aggregateMeta: {
                group: `arcade_${gameId}`,
                batchKey: revenueRef.id,
                pageKey: "arcade",
                actorUid: userId,
                actorName: studentName || null,
                mode: `play_${gameId}`,
            },
            detailLines: [
                {
                    id: taxLineId,
                    amount: revenueAmount,
                    source: "arcade",
                    taxType: "arcade_revenue",
                    description,
                    studentUid: userId,
                    studentName: studentName || null,
                    relatedDoc: {
                        collection: "arcadeRevenueLogs",
                        id: revenueRef.id,
                    },
                    externalId: taxLineId,
                    meta: {
                        paymentType,
                        game: gameId,
                    },
                },
            ],
            detailCollection: TAX_LINE_COLLECTION,
        },
    );
    const isTaxRecorded = !taxResult?.skipped && !!taxResult?.id;

    tx.set(
        revenueRef,
        {
            type: `${gameId}_fee`,
            game: gameId,
            studentUid: userId,
            studentName: studentName || null,
            amount: revenueAmount,
            paymentType,
            createdAt: nowTs,
            ...(isTaxRecorded
                ? {
                    taxRecord: buildTaxRecordPointer(
                        "taxIncomes",
                        taxRecordId,
                        taxLineId,
                    ),
                    taxRecordedAt: nowTs,
                    taxCancelled: false,
                }
                : {}),
        },
        { merge: true },
    );
}

function parseLottoEndTime(value) {
    const raw = String(value || "").trim();
    if (!raw) return new Date(NaN);

    // Values from datetime-local have no timezone. Treat them as Korea time so
    // Cloud Functions' UTC runtime does not move the teacher's selected deadline.
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    if (hasTimezone) return new Date(raw);

    const match = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
    );
    if (!match) return new Date(raw);

    const [, year, month, day, hour, minute, second = "0"] = match;
    const utcMs = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour) - 9,
        Number(minute),
        Number(second),
    );
    return new Date(utcMs);
}

function normalizeLottoEndTimeValue(value) {
    if (value == null || String(value).trim() === "") {
        return "";
    }

    const parsed = parseLottoEndTime(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new HttpsError("invalid-argument", "Invalid lotto endTime.");
    }
    return parsed.toISOString();
}

function normalizeLottoRoundSettings(rawSettings = {}, globalGameSettings = {}) {
    const title = String(rawSettings.title || "").trim();
    if (!title) {
        throw new HttpsError("invalid-argument", "????????????????????嫄?????????????룰퀬????????????傭??????????????獄쏅챶留덌┼??????????????筌롈살젔?????????嫄??????????");
    }

    const price = assertNonNegativeFiniteNumber(
        globalGameSettings.price ?? 500,
        "lotto.settings.price",
    );
    const feeAmount = getArcadeFeeAmount(globalGameSettings, "lotto.settings");
    const maxNumber = Math.trunc(Number(rawSettings.maxNumber || 0));
    const pickCount = Math.trunc(Number(rawSettings.pickCount || 0));
    const useBonus = rawSettings.useBonus !== false;

    if (
        !Number.isFinite(maxNumber) ||
        !Number.isFinite(pickCount) ||
        maxNumber <= 0 ||
        pickCount <= 0 ||
        pickCount > maxNumber
    ) {
        throw new HttpsError(
            "invalid-argument",
            "????????????????????/ ?????????????????????????????????????????????????????? ??????? ????????????????????대첐??",
        );
    }

    let endTime = "";
    if (rawSettings.endTime != null && String(rawSettings.endTime).trim() !== "") {
        const parsed = parseLottoEndTime(rawSettings.endTime);
        if (Number.isNaN(parsed.getTime())) {
            throw new HttpsError("invalid-argument", "endTime ???????椰???????????????嚥싲갭큔???????????? ????????????????????대첐??");
        }
        endTime = parsed.toISOString();
    }

    const rawPrizes = Array.isArray(rawSettings.prizes) ? rawSettings.prizes : [];
    if (rawPrizes.length === 0) {
        throw new HttpsError("invalid-argument", "??????????????????ㅻ깹??????????怨뚰뇠??????????????????1????????????獄쏅챶留덌┼??????????????筌롈살젔?????????嫄??????????");
    }

    const prizes = rawPrizes.map((prize, idx) => {
        const type = prize?.type === "item" ? "item" : "money";
        const label = String(prize?.label || "").trim();
        if (!label) {
            throw new HttpsError(
                "invalid-argument",
                `lotto.prizes[${idx}].label ??????????獄쏅챶留덌┼??????????????筌롈살젔????????븐뼐????????꿔꺂?????????耀붾굝????????????????????쎛 ?????????????????????????????대첐??`,
            );
        }

        if (type === "item") {
            const itemId = String(prize?.itemId || "").trim();
            if (!itemId) {
                throw new HttpsError(
                    "invalid-argument",
                    `lotto.prizes[${idx}] item ???????????ㅻ깹??????????怨뚰뇠???????????????itemId??????????? ??????????獄쏅챶留덌┼??????????????筌롈살젔?????????嫄??????????`,
                );
            }
            return {
                rank: idx + 1,
                type,
                label,
                itemId,
            };
        }

        const amount = assertNonNegativeFiniteNumber(
            prize?.amount || 0,
            `lotto.prizes[${idx}].amount`,
        );
        return {
            rank: idx + 1,
            type,
            label,
            amount,
        };
    });

    return {
        title,
        settings: {
            price,
            feeAmount,
            maxNumber,
            pickCount,
            useBonus,
            endTime,
            enabled: true,
            prizes,
        },
    };
}

function buildArcadePlayActivityLogData({
    userId,
    netChange,
    paymentType,
    prizeAmount,
    cashChargeAmount,
    price,
    feeAmount,
    incomeTaxSnapshot = null,
    description,
}) {
    return {
        studentUid: userId,
        type: netChange >= 0 ? "income" : "expense",
        category: "arcade",
        amount: Math.abs(Number(netChange) || 0),
        ...(incomeTaxSnapshot
            ? {
                grossAmount: incomeTaxSnapshot.grossAmount,
                withheldAmount: incomeTaxSnapshot.withheldAmount,
                netAmount: incomeTaxSnapshot.netAmount,
                incomeTax: incomeTaxSnapshot.incomeTax,
            }
            : {}),
        description,
    };
}

function normalizeNostalgiaPickRoundSettings(rawSettings = {}, globalGameSettings = {}) {
    const title = String(rawSettings.title || "").trim();
    if (!title) {
        throw new HttpsError("invalid-argument", "Nostalgia pick round title is required.");
    }

    const price = assertNonNegativeFiniteNumber(
        globalGameSettings.price ?? 100,
        "nostalgiaPick.settings.price",
    );
    const feeAmount = getArcadeFeeAmount(globalGameSettings, "nostalgiaPick.settings");
    const boardSize = Math.trunc(Number(rawSettings.boardSize || 0));
    if (!Number.isFinite(boardSize) || boardSize <= 0 || boardSize > 500) {
        throw new HttpsError(
            "invalid-argument",
            "Nostalgia pick boardSize must be between 1 and 500.",
        );
    }

    const maxEntriesPerStudent = Math.trunc(
        Number(rawSettings.maxEntriesPerStudent || 0),
    );
    if (
        !Number.isFinite(maxEntriesPerStudent) ||
        maxEntriesPerStudent < 0 ||
        maxEntriesPerStudent > boardSize
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Nostalgia pick maxEntriesPerStudent is invalid.",
        );
    }

    let endTime = "";
    if (rawSettings.endTime != null && String(rawSettings.endTime).trim() !== "") {
        const parsed = parseLottoEndTime(rawSettings.endTime);
        if (Number.isNaN(parsed.getTime())) {
            throw new HttpsError("invalid-argument", "Invalid nostalgia pick endTime.");
        }
        endTime = parsed.toISOString();
    }

    const rawPrizes = Array.isArray(rawSettings.prizes) ? rawSettings.prizes : [];
    if (rawPrizes.length === 0) {
        throw new HttpsError(
            "invalid-argument",
            "Nostalgia pick requires at least one prize.",
        );
    }

    const prizes = rawPrizes.map((prize, idx) => {
        const type = prize?.type === "item" ? "item" : "money";
        const label = String(prize?.label || "").trim();
        if (!label) {
            throw new HttpsError(
                "invalid-argument",
                `nostalgiaPick.prizes[${idx}].label is required.`,
            );
        }

        if (type === "item") {
            const itemId = String(prize?.itemId || "").trim();
            if (!itemId) {
                throw new HttpsError(
                    "invalid-argument",
                    `nostalgiaPick.prizes[${idx}].itemId is required.`,
                );
            }
            return {
                rank: idx + 1,
                type,
                label,
                itemId,
            };
        }

        const amount = assertNonNegativeFiniteNumber(
            prize?.amount || 0,
            `nostalgiaPick.prizes[${idx}].amount`,
        );
        return {
            rank: idx + 1,
            type,
            label,
            amount,
        };
    });

    return {
        title,
        settings: {
            price,
            feeAmount,
            boardSize,
            maxEntriesPerStudent,
            duplicateWinnersAllowed: rawSettings.duplicateWinnersAllowed === true,
            endTime,
            enabled: true,
            prizes,
        },
    };
}

function shuffleRows(rows = []) {
    const nextRows = [...rows];
    for (let index = nextRows.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [nextRows[index], nextRows[target]] = [nextRows[target], nextRows[index]];
    }
    return nextRows;
}

function stageArcadeSideEffects(
    tx,
    {
        classId,
        gameId,
        classData,
        gameLabel,
        userId,
        studentName,
        paymentType,
        planType,
        incomeToTreasury = false,
        cashChargeAmount = 0,
        price = 0,
        feeAmount = 0,
        prizeAmount = 0,
        incomeTaxSnapshot = null,
        activityLogData = null,
        globalConfig,
        nowTs = FieldValue.serverTimestamp(),
    },
) {
    if (activityLogData) {
        stageActivityLog(
            tx,
            classId,
            activityLogData,
            {
                config: globalConfig,
                planType,
                serviceName: "arcade",
                forceWrite: true,
            },
        );
    }

    if (incomeToTreasury === true && Number(cashChargeAmount || 0) > 0) {
        stageArcadeRevenue(tx, {
            classId,
            userId,
            studentName: studentName || null,
            gameId: gameId || "arcade",
            gameLabel: gameLabel || gameId || "게임",
            amount: cashChargeAmount,
            classData,
            paymentType,
            nowTs,
            globalConfig,
            planType: planType || "FREE",
        });
    }

    if (incomeTaxSnapshot?.withheldAmount > 0) {
        stageTaxIncome(
            tx,
            classId,
            {
                amount: incomeTaxSnapshot.withheldAmount,
                source: "arcade_prize_withholding",
                taxType: "income_tax",
                description: `${gameLabel || gameId || "게임"} 상금 원천징수`,
                studentUid: userId,
                studentName: studentName || null,
                breakdown: {
                    baseAmount: incomeTaxSnapshot.grossAmount,
                    taxAmount: incomeTaxSnapshot.withheldAmount,
                    taxRate: incomeTaxSnapshot.incomeTax.taxRate,
                },
            },
            userId,
            {
                config: globalConfig,
                planType: planType || "FREE",
                serviceName: "arcade",
                classData,
                sourceKey: "arcadePrize",
                detailLines: [
                    {
                        id: `${gameId || "arcade"}_${userId}_${Date.now()}`,
                        amount: incomeTaxSnapshot.withheldAmount,
                        source: "arcade_prize_withholding",
                        taxType: "income_tax",
                        description: `${gameLabel || gameId || "게임"} 상금 원천징수`,
                        studentUid: userId,
                        studentName: studentName || null,
                        meta: {
                            incomeTax: incomeTaxSnapshot.incomeTax,
                        },
                    },
                ],
            },
        );
    }
}

function pickPrizeByChance(rawPrizes, { gameName }) {
    if (!Array.isArray(rawPrizes) || rawPrizes.length === 0) {
        throw new HttpsError(
            "failed-precondition",
            `${gameName} ??????????⑤벡??????????곌퇈猷???????????????????????????????????????????????????????살몝??`,
        );
    }

    const prizes = rawPrizes.map((prize, idx) => {
        const chance = Number(prize?.chance);
        if (!Number.isFinite(chance) || chance < 0) {
            throw new HttpsError(
                "failed-precondition",
                `${gameName} ??????????⑤벡??????????곌퇈猷??????????${idx + 1})?????????嫄?????????chance) ???????????????????? ???????????????????살몝??`,
            );
        }
        return { ...prize, __chance: chance };
    });

    const chanceSum = prizes.reduce((sum, prize) => sum + prize.__chance, 0);
    if (chanceSum <= 0) {
        throw new HttpsError(
            "failed-precondition",
            `${gameName} ??????????⑤벡??????????곌퇈猷?????????????????嫄?????????????????猷몄굣????????????? 0 ???????????밸븶筌믩끃??獄???????멥렑?????????????`,
        );
    }

    // ????????????????????????????100?????????????繹먮끍???????????????????諛몃마嶺뚮?????????????硫λ젒?????????????????????嫄??????????븐뼐??????????ш끽維???????????????썹땟戮녹??諭?????⑸㎦??????蹂㏓???????????????????????거??????????
    const normalized = prizes.map((prize) => ({
        ...prize,
        __normalizedChance:
            chanceSum >= 99.9 && chanceSum <= 100.1
                ? prize.__chance
                : (prize.__chance / chanceSum) * 100,
    }));

    const randomVal = Math.random() * 100;
    let cumulative = 0;
    for (const prize of normalized) {
        cumulative += prize.__normalizedChance;
        if (randomVal < cumulative) {
            const { __chance, __normalizedChance, ...safePrize } = prize;
            return safePrize;
        }
    }
    const { __chance, __normalizedChance, ...fallbackPrize } =
        normalized[normalized.length - 1];
    return fallbackPrize;
}

function resolveMoneyPrizeAmount(selectedPrize, price, fieldPrefix) {
    const rewardMode =
        selectedPrize.rewardMode === "amount"
            ? "amount"
            : selectedPrize.rewardMode === "multiplier"
                ? "multiplier"
                : null;
    const hasMultiplier =
        selectedPrize.multiplier !== undefined &&
        selectedPrize.multiplier !== null;
    const hasAmount =
        selectedPrize.amount !== undefined &&
        selectedPrize.amount !== null;
    const multiplierNumber = Number(selectedPrize.multiplier);
    const amountNumber = Number(selectedPrize.amount);
    const hasNonZeroMultiplier =
        Number.isFinite(multiplierNumber) && multiplierNumber !== 0;
    const hasNonZeroAmount =
        Number.isFinite(amountNumber) && amountNumber !== 0;

    if (hasNonZeroMultiplier && hasNonZeroAmount) {
        throw new HttpsError(
            "failed-precondition",
            `${fieldPrefix} money reward can use multiplier or amount, not both.`,
        );
    }

    if (rewardMode === "amount") {
        return assertNonNegativeFiniteNumber(
            selectedPrize.amount ?? 0,
            `${fieldPrefix}.amount`,
        );
    }

    if (rewardMode === "multiplier") {
        const multiplier = assertNonNegativeFiniteNumber(
            selectedPrize.multiplier ?? 0,
            `${fieldPrefix}.multiplier`,
        );
        return Math.round(price * multiplier);
    }

    if (hasNonZeroMultiplier || (hasMultiplier && !hasAmount)) {
        const multiplier = assertNonNegativeFiniteNumber(
            selectedPrize.multiplier ?? 0,
            `${fieldPrefix}.multiplier`,
        );
        return Math.round(price * multiplier);
    }

    if (hasNonZeroAmount || (hasAmount && !hasMultiplier)) {
        return assertNonNegativeFiniteNumber(
            selectedPrize.amount ?? 0,
            `${fieldPrefix}.amount`,
        );
    }

    return 0;
}

function hasArcadeMoneyReward(prize = {}) {
    if (prize?.moneyEnabled === true) return true;
    if (prize?.moneyEnabled === false) return false;
    if (prize?.type === "money" || prize?.type === "bundle") return true;
    if (prize?.type === "item") return false;
    return (
        prize?.rewardMode != null ||
        prize?.multiplier != null ||
        prize?.amount != null
    );
}

function hasArcadeItemReward(prize = {}) {
    if (prize?.itemEnabled === true) return true;
    if (prize?.itemEnabled === false) return false;
    if (prize?.type === "item" || prize?.type === "bundle") return true;
    if (prize?.type === "money") return false;
    return String(prize?.itemId || "").trim().length > 0;
}

function inferArcadePrizeType(prize = {}) {
    const money = hasArcadeMoneyReward(prize);
    const item = hasArcadeItemReward(prize);

    if (money && item) return "bundle";
    if (money) return "money";
    if (item) return "item";
    return null;
}

function normalizeStoreCurrencyType(currencyType) {
    return ["missionToken", "usdBalance"].includes(currencyType) ? currencyType : "cash";
}

function getStoreCurrencyMeta(itemData = {}, classData = {}) {
    const currencyType = normalizeStoreCurrencyType(itemData?.currencyType);
    const currencyUnit =
        currencyType === "usdBalance"
            ? "FIN"
            : currencyType === "missionToken"
                ? MISSION_TOKEN_UNIT
                : resolveClassCurrencyUnit(classData);

    return { currencyType, currencyUnit };
}

function isArcadeTicketStoreItem(itemData = {}) {
    return itemData?.itemType === "ticket" ||
        itemData?.functionTag === "arcade_ticket";
}

function validateArcadePrize(selectedPrize, { price, fieldPrefix, gameLabel }) {
    const prizeType = inferArcadePrizeType(selectedPrize);

    if (!prizeType) {
        throw new HttpsError(
            "failed-precondition",
            `${gameLabel} reward must include money or item.`,
        );
    }

    const hasMoney = prizeType === "money" || prizeType === "bundle";
    const hasItem = prizeType === "item" || prizeType === "bundle";
    const prizeAmount = hasMoney
        ? resolveMoneyPrizeAmount(selectedPrize, price, fieldPrefix)
        : 0;

    if (hasItem && !String(selectedPrize?.itemId || "").trim()) {
        throw new HttpsError(
            "failed-precondition",
            `${gameLabel} item reward requires itemId.`,
        );
    }

    return { prizeType, prizeAmount, hasMoney, hasItem };
}

function grantArcadeItemReward(
    tx,
    {
        classId,
        userId,
        studentRef,
        selectedPrize,
        storeItemData,
        inventorySnap,
        classData,
        nowTs,
        sourceType = "arcade_reward",
        obtainedFrom = "arcade",
    },
) {
    const itemId = String(selectedPrize?.itemId || "").trim();
    if (!itemId) {
        return {
            itemId: null,
            itemName: null,
            itemValue: 0,
        };
    }

    const existingData = inventorySnap?.exists ? (inventorySnap.data() || {}) : {};
    const itemName =
        storeItemData?.name ||
        existingData?.itemName ||
        selectedPrize?.label ||
        "Reward Item";
    const itemType =
        storeItemData?.itemType ||
        existingData?.itemType ||
        "general";
    const functionTag =
        storeItemData?.functionTag ??
        existingData?.functionTag ??
        null;
    const itemValue = Math.max(
        0,
        Number(
            storeItemData?.price ??
            existingData?.price ??
            0,
        ),
    );
    const currencyMeta = getStoreCurrencyMeta(
        {
            currencyType:
                storeItemData?.currencyType ??
                existingData?.currencyType ??
                "cash",
        },
        classData,
    );
    const isGiftAllowed =
        storeItemData?.isGiftAllowed !== undefined
            ? storeItemData.isGiftAllowed
            : existingData?.isGiftAllowed !== undefined
                ? existingData.isGiftAllowed
                : true;
    const isTicket = isArcadeTicketStoreItem({ itemType, functionTag });
    const acquisition = buildTrackedInventoryAcquisition({
        type: sourceType,
        quantity: 1,
        acquiredAt: admin.firestore.Timestamp.now(),
        obtainedFrom,
        unitValue: itemValue,
        assetValueApplied: itemValue > 0 && currencyMeta.currencyType !== "usdBalance",
        ticketCountApplied: isTicket,
    });
    const inventoryRef = db.doc(
        `classes/${classId}/students/${userId}/inventory/${itemId}`,
    );
    const commonInventoryData = {
        itemId,
        itemName,
        itemType,
        functionTag,
        isGiftAllowed,
        price: itemValue,
        currencyType: currencyMeta.currencyType,
        currencyUnit: currencyMeta.currencyUnit,
        lastAcquiredDate: nowTs,
        obtainedFrom,
    };

    if (inventorySnap?.exists) {
        tx.update(inventoryRef, {
            ...commonInventoryData,
            quantity: FieldValue.increment(1),
            totalAcquired: FieldValue.increment(1),
            acquisitions: FieldValue.arrayUnion(acquisition),
        });
    } else {
        tx.set(inventoryRef, {
            ...commonInventoryData,
            quantity: 1,
            totalAcquired: 1,
            totalUsed: 0,
            createdAt: nowTs,
            acquisitions: [acquisition],
        });
    }

    const studentUpdates = {};
    if (itemValue > 0 && currencyMeta.currencyType !== "usdBalance") {
        studentUpdates["assets.itemValue"] = FieldValue.increment(itemValue);
    }
    if (isTicket) {
        studentUpdates["assets.ticket"] = FieldValue.increment(1);
    }
    if (Object.keys(studentUpdates).length > 0) {
        tx.update(studentRef, studentUpdates);
    }

    return {
        itemId,
        itemName,
        itemValue: currencyMeta.currencyType === "usdBalance" ? 0 : itemValue,
    };
}

function normalizeManualLottoDrawInput({
    winningNumbers,
    bonusNumber,
    maxNumber,
    pickCount,
    useBonus,
}) {
    if (!Array.isArray(winningNumbers)) {
        return null;
    }

    const normalizedWinningNumbers = winningNumbers.map((value) => Math.trunc(Number(value)));
    if (normalizedWinningNumbers.length !== pickCount) {
        throw new HttpsError(
            "invalid-argument",
            `winningNumbers must contain exactly ${pickCount} numbers.`,
        );
    }
    if (normalizedWinningNumbers.some((value) => !Number.isFinite(value))) {
        throw new HttpsError("invalid-argument", "winningNumbers must be valid numbers.");
    }

    const uniqueWinningNumbers = new Set(normalizedWinningNumbers);
    if (uniqueWinningNumbers.size !== normalizedWinningNumbers.length) {
        throw new HttpsError("invalid-argument", "winningNumbers must not contain duplicates.");
    }
    if (
        normalizedWinningNumbers.some(
            (value) => value <= 0 || value > maxNumber,
        )
    ) {
        throw new HttpsError(
            "invalid-argument",
            `winningNumbers must be between 1 and ${maxNumber}.`,
        );
    }

    let normalizedBonusNumber = null;
    if (useBonus) {
        normalizedBonusNumber = Math.trunc(Number(bonusNumber));
        if (!Number.isFinite(normalizedBonusNumber)) {
            throw new HttpsError(
                "invalid-argument",
                "bonusNumber is required when bonus mode is enabled.",
            );
        }
        if (
            normalizedBonusNumber <= 0 ||
            normalizedBonusNumber > maxNumber ||
            uniqueWinningNumbers.has(normalizedBonusNumber)
        ) {
            throw new HttpsError(
                "invalid-argument",
                "bonusNumber must be unique and within the valid range.",
            );
        }
    }

    return {
        winningNumbers: [...normalizedWinningNumbers].sort((a, b) => a - b),
        bonusNumber: useBonus ? normalizedBonusNumber : null,
        drawMode: "manual",
    };
}

function buildLottoRankLabel(rankIndex) {
    return `${Number(rankIndex) + 1}등`;
}

function buildInventoryRewardState(inventorySnap) {
    const data = inventorySnap?.exists ? (inventorySnap.data() || {}) : {};

    return {
        exists: inventorySnap?.exists === true,
        data: {
            ...data,
            acquisitions: Array.isArray(data?.acquisitions)
                ? [...data.acquisitions]
                : [],
        },
    };
}

function syncGrantedArcadeItemRewardState(
    state,
    {
        selectedPrize,
        storeItemData,
        classData,
        nowTs,
        sourceType = "arcade_reward",
        obtainedFrom = "arcade",
    },
) {
    const itemId = String(selectedPrize?.itemId || "").trim();
    if (!itemId) {
        return null;
    }

    const previousData = state?.data || {};
    const itemName =
        storeItemData?.name ||
        previousData?.itemName ||
        selectedPrize?.label ||
        "Reward Item";
    const itemType =
        storeItemData?.itemType ||
        previousData?.itemType ||
        "general";
    const functionTag =
        storeItemData?.functionTag ??
        previousData?.functionTag ??
        null;
    const itemValue = Math.max(
        0,
        Number(storeItemData?.price ?? previousData?.price ?? 0),
    );
    const currencyMeta = getStoreCurrencyMeta(
        {
            currencyType:
                storeItemData?.currencyType ??
                previousData?.currencyType ??
                "cash",
        },
        classData,
    );
    const isGiftAllowed =
        storeItemData?.isGiftAllowed !== undefined
            ? storeItemData.isGiftAllowed
            : previousData?.isGiftAllowed !== undefined
                ? previousData.isGiftAllowed
                : true;
    const isTicket = isArcadeTicketStoreItem({ itemType, functionTag });
    const acquisition = buildTrackedInventoryAcquisition({
        type: sourceType,
        quantity: 1,
        acquiredAt: admin.firestore.Timestamp.now(),
        obtainedFrom,
        unitValue: itemValue,
        assetValueApplied: itemValue > 0 && currencyMeta.currencyType !== "usdBalance",
        ticketCountApplied: isTicket,
    });
    const currentQuantity = Math.max(
        0,
        Math.floor(Number(previousData?.quantity || 0)),
    );
    const currentTotalAcquired = Math.max(
        0,
        Math.floor(Number(previousData?.totalAcquired || 0)),
    );

    state.exists = true;
    state.data = {
        ...previousData,
        itemId,
        itemName,
        itemType,
        functionTag,
        isGiftAllowed,
        price: itemValue,
        currencyType: currencyMeta.currencyType,
        currencyUnit: currencyMeta.currencyUnit,
        obtainedFrom,
        lastAcquiredDate: nowTs,
        quantity: currentQuantity + 1,
        totalAcquired: currentTotalAcquired + 1,
        acquisitions: [
            ...(Array.isArray(previousData?.acquisitions)
                ? previousData.acquisitions
                : []),
            acquisition,
        ],
        createdAt: previousData?.createdAt || nowTs,
        totalUsed: Number(previousData?.totalUsed || 0),
    };

    return {
        itemId,
        itemName,
        itemValue: currencyMeta.currencyType === "usdBalance" ? 0 : itemValue,
    };
}

function buildArcadeResultPayload(
    selectedPrize,
    {
        prizeType,
        prizeAmount = 0,
        itemReward = null,
    } = {},
) {
    const hasMoney = Number(prizeAmount || 0) > 0;
    const hasItem = Boolean(itemReward?.itemId || (hasArcadeItemReward(selectedPrize) && selectedPrize?.itemId));
    const resolvedType =
        hasMoney && hasItem
            ? "bundle"
            : hasMoney
                ? "money"
                : hasItem
                    ? "item"
                    : prizeType || inferArcadePrizeType(selectedPrize) || selectedPrize?.type || "money";

    return {
        ...selectedPrize,
        type: resolvedType,
        moneyEnabled: hasArcadeMoneyReward(selectedPrize),
        itemEnabled: hasArcadeItemReward(selectedPrize),
        amount: prizeAmount,
        itemId: itemReward?.itemId || selectedPrize?.itemId || null,
        itemName: itemReward?.itemName || null,
        itemValue: itemReward?.itemValue || 0,
    };
}

/** ?????癲ル슢?싩땟?????????????????????????????????????*/
function getDefaultGameConfig(gameId) {
    const defaults = {
        scratch: {
            enabled: true,
            price: 100,
            feeAmount: 0,
            dailyLimit: 5,
            prizes: [
                { id: 1, multiplier: 0, chance: 40, label: "Miss", type: "money" },
                { id: 2, multiplier: 1, chance: 25, label: "Break even", type: "money" },
                { id: 3, multiplier: 2, chance: 20, label: "2x", type: "money" },
                { id: 4, multiplier: 5, chance: 10, label: "5x", type: "money" },
            ],
        },
        paperpick: { enabled: true, price: 100, feeAmount: 0, dailyLimit: 0 },
        nostalgiaPick: { enabled: false, price: 100, feeAmount: 0, dailyLimit: 0 },
        miniQuiz: {
            enabled: false,
            price: 0,
            feeAmount: 0,
            dailyLimit: 1,
            weeklyLimit: 0,
            questionCount: 3,
            participationReward: 50,
            rewardPerCorrect: 100,
            perfectBonus: 300,
            sourceSetId: "",
            questions: [],
        },
    };
    return defaults[gameId] || { enabled: false, price: 100, feeAmount: 0 };
}

function normalizeMiniQuizText(value) {
    return String(value ?? "").trim();
}

function normalizeMiniQuizAnswer(value) {
    return normalizeMiniQuizText(value)
        .toLowerCase()
        .replace(/\s+/g, "");
}

function normalizeMiniQuizQuestion(rawQuestion = {}) {
    const type = ["ox", "short_answer", "multiple_choice"].includes(rawQuestion.type)
        ? rawQuestion.type
        : "multiple_choice";
    const options = Array.isArray(rawQuestion.options)
        ? rawQuestion.options.map(normalizeMiniQuizText).filter(Boolean).slice(0, 5)
        : [];
    const correctAnswers = Array.isArray(rawQuestion.correctAnswers)
        ? rawQuestion.correctAnswers.map(normalizeMiniQuizText).filter(Boolean)
        : normalizeMiniQuizText(rawQuestion.correctAnswers)
            .split(/\s*(?:,|\||;|\/)\s*/g)
            .map(normalizeMiniQuizText)
            .filter(Boolean);

    return {
        id: normalizeMiniQuizText(rawQuestion.id),
        type,
        prompt: normalizeMiniQuizText(rawQuestion.prompt),
        imageUrl: normalizeMiniQuizText(rawQuestion.imageUrl),
        options: type === "ox" ? ["O", "X"] : type === "short_answer" ? [] : options,
        correctAnswers,
        explanation: normalizeMiniQuizText(rawQuestion.explanation),
    };
}

function getMiniQuizQuestions(gameConfig = {}) {
    return (Array.isArray(gameConfig.questions) ? gameConfig.questions : [])
        .map(normalizeMiniQuizQuestion)
        .filter((question) =>
            question.id &&
            (question.prompt || question.imageUrl) &&
            question.correctAnswers.length > 0 &&
            (question.type === "short_answer" || question.options.length >= 2),
        );
}

async function getMiniQuizQuestionsForGameConfig(tx, classId, gameConfig = {}) {
    const sourceSetId = normalizeMiniQuizText(gameConfig.sourceSetId);
    if (!sourceSetId) return getMiniQuizQuestions(gameConfig);

    const questionsSnap = await tx.get(
        db
            .collection(`classes/${classId}/miniQuizQuestionSets/${sourceSetId}/questions`)
            .orderBy("order", "asc"),
    );

    return questionsSnap.docs
        .map((docSnap) => {
            const data = docSnap.data() || {};
            return normalizeMiniQuizQuestion({
                ...data,
                id: data.id || docSnap.id,
            });
        })
        .filter((question) =>
            question.id &&
            (question.prompt || question.imageUrl) &&
            question.correctAnswers.length > 0 &&
            (question.type === "short_answer" || question.options.length >= 2),
        );
}

async function assertMiniQuizClassScope(auth, classId) {
    if (auth.token?.role === "admin") return;
    const tokenClassId = auth.token?.classId;
    if (tokenClassId) {
        if (tokenClassId === classId) return;
    } else {
        const profile = await db.doc(`users/${auth.uid}`).get();
        if (profile.exists && profile.data()?.classId === classId) return;
    }
    throw new HttpsError("permission-denied", "Mini quiz access is limited to your current class.");
}

exports.getMiniQuizQuestions = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    const classId = normalizeMiniQuizText(request.data?.classId);
    if (!classId) throw new HttpsError("invalid-argument", "classId is required.");
    await assertMiniQuizClassScope(request.auth, classId);
    const isTeacherPreview = canPreviewHiddenArcadeGame(request.auth);
    if (isTeacherPreview) assertTeacherClassScopeStrict(request.auth, classId);
    else {
        const studentSnap = await db.doc(`classes/${classId}/students/${request.auth.uid}`).get();
        if (!studentSnap.exists) throw new HttpsError("permission-denied", "Class access denied.");
    }
    const [classSnap, configSnap] = await Promise.all([
        db.doc(`classes/${classId}`).get(),
        db.doc(`classes/${classId}/arcade/config`).get(),
    ]);
    const classData = classSnap.data() || {};
    let config = { ...getDefaultGameConfig("miniQuiz"), ...(configSnap.data()?.games?.miniQuiz || {}) };
    if (!isTeacherPreview) {
        const globalConfig = await getGlobalConfig();
        assertArcadeAccessible(globalConfig, classData.planType || "FREE", classData.services?.arcade || {});
        if (config.enabled === false) throw new HttpsError("failed-precondition", "Mini quiz is not open.");
    }
    if (request.data?.list === true) {
        const [sets, attempts] = await Promise.all([
            db.collection(`classes/${classId}/miniQuizQuestionSets`).where("visibility", "==", "public").get(),
            db.collection(`classes/${classId}/arcade/config/miniQuizAttempts`).where("studentUid", "==", request.auth.uid).get(),
        ]);
        const rows = attempts.docs.map((snapshot) => snapshot.data());
        return { quizzes: sets.docs.map((snapshot) => {
            const quiz = snapshot.data();
            const saved = rows.find((row) => row.kind === "quiz-progress" && row.sourceSetId === snapshot.id);
            const progress = saved || miniQuizProgressFromAttempts(rows, snapshot.id);
            const settings = { ...config, ...(quiz.settings || {}) };
            return { id: snapshot.id, title: quiz.title || "퀴즈", questionCount: Math.min(Number(quiz.questionCount || 0), Number(settings.questionCount || 3)), bestCorrectCount: progress.bestCorrectCount || 0, paidGross: progress.paidGross || 0, settings: Object.fromEntries(["questionCount", "dailyLimit", "weeklyLimit", "participationReward", "rewardPerCorrect", "perfectBonus", "showCorrectAfterSubmit"].map((key) => [key, settings[key]])) };
        }) };
    }
    const requestedQuizId = normalizeMiniQuizText(request.data?.quizId);
    if (requestedQuizId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestedQuizId)) throw new HttpsError("invalid-argument", "Invalid quizId.");
    if (requestedQuizId) {
        const quizSnap = await db.doc(`classes/${classId}/miniQuizQuestionSets/${requestedQuizId}`).get();
        if (!quizSnap.exists || (!isTeacherPreview && quizSnap.data()?.visibility !== "public")) throw new HttpsError("failed-precondition", "Mini quiz set is not published.");
        config = { ...config, ...(quizSnap.data().settings || {}), sourceSetId: requestedQuizId };
    }
    if (config.sourceSetId) {
        const setSnap = await db.doc(`classes/${classId}/miniQuizQuestionSets/${config.sourceSetId}`).get();
        if (!setSnap.exists || (!isTeacherPreview && setSnap.data()?.visibility !== "public")) {
            throw new HttpsError("failed-precondition", "Mini quiz set is not published.");
        }
    }
    const questions = config.sourceSetId
        ? (await db.collection(`classes/${classId}/miniQuizQuestionSets/${config.sourceSetId}/questions`).orderBy("order", "asc").get())
            .docs.map((snapshot) => normalizeMiniQuizQuestion({ ...snapshot.data(), id: snapshot.id }))
        : getMiniQuizQuestions(config);
    return {
        questions: questions
            .filter((question) => question.id && (question.prompt || question.imageUrl) && question.correctAnswers.length > 0 && (question.type === "short_answer" || question.options.length >= 2))
            .slice(0, Math.max(1, Number(config.questionCount || 3)))
            .map(({ id, type, prompt, imageUrl, options }) => ({ id, type, prompt, imageUrl, options })),
    };
});

function isMiniQuizAnswerCorrect(question, submittedAnswer) {
    const submitted = normalizeMiniQuizAnswer(submittedAnswer);
    if (!submitted) return false;
    return question.correctAnswers.some(
        (answer) => normalizeMiniQuizAnswer(answer) === submitted,
    );
}

function getWeeklyArcadeUsageCount(gameUsage = {}, weekStart) {
    return Object.entries(gameUsage)
        .filter(([date]) => date >= weekStart)
        .reduce((sum, [, count]) => sum + Number(count || 0), 0);
}

/* ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
 * [EXPORTS] 1. ???????????썹땟戮녹??諭?????⑸㎦???????????????????⑤벡瑜??????롮쾸????????????????⑤벡???????븐뼐???????????????袁⑸즴筌?씛彛???????????? (playScratch)
 * ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
exports.submitMiniQuiz = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");

    const userId = request.auth.uid;
    const { classId, answers = [], requestId, quizId } = request.data || {};
    if (!classId) throw new HttpsError("invalid-argument", "classId is required.");
    await assertMiniQuizClassScope(request.auth, classId);
    if (!Array.isArray(answers) || answers.length === 0) {
        throw new HttpsError("invalid-argument", "answers are required.");
    }
    if (requestId != null && (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{10,80}$/.test(requestId))) {
        throw new HttpsError("invalid-argument", "Invalid requestId.");
    }
    if (quizId != null && (typeof quizId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(quizId))) throw new HttpsError("invalid-argument", "Invalid quizId.");

    const globalConfig = await getGlobalConfig();
    const isUsageLimitExempt = isArcadeUsageLimitExempt(request.auth);

    try {
        return await db.runTransaction(async (tx) => {
            const studentRef = db.doc(`classes/${classId}/students/${userId}`);
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const usageRef = db.doc(
                `classes/${classId}/arcade/config/usage/${userId}`,
            );
            const attemptsCollection = db.collection(`classes/${classId}/arcade/config/miniQuizAttempts`);
            const attemptRef = requestId
                ? attemptsCollection.doc(`${userId}_${requestId}`)
                : attemptsCollection.doc();

            const [studentSnap, classSnap, arcadeConfigSnap, usageSnap, existingAttemptSnap] =
                await Promise.all([
                    tx.get(studentRef),
                    tx.get(classRef),
                    tx.get(arcadeConfigRef),
                    tx.get(usageRef),
                    requestId ? tx.get(attemptRef) : Promise.resolve(null),
                ]);

            if (existingAttemptSnap?.exists) {
                const prior = existingAttemptSnap.data();
                if (prior.studentUid !== userId) throw new HttpsError("permission-denied", "Attempt belongs to another student.");
                if (quizId && prior.sourceSetId !== quizId) throw new HttpsError("invalid-argument", "Request ID belongs to another quiz.");
                return {
                    success: true,
                    attemptId: attemptRef.id,
                    questionCount: prior.questionCount,
                    correctCount: prior.correctCount,
                    grossRewardAmount: prior.grossRewardAmount,
                    rewardAmount: prior.rewardAmount,
                    withheldAmount: prior.withheldAmount,
                    results: prior.showCorrectAfterSubmit === false
                        ? (prior.results || []).map(({ questionId, isCorrect }) => ({ questionId, isCorrect }))
                        : prior.results,
                };
            }

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "Student not found.");
            }

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.exists ? arcadeConfigSnap.data() || {} : {};
            let gameConfig = {
                ...getDefaultGameConfig("miniQuiz"),
                ...(arcadeConfig.games?.miniQuiz || {}),
            };

            const sourceSetId = quizId || gameConfig.sourceSetId;
            let progressRef;
            let progress = { paidGross: 0, bestCorrectCount: 0, usage: {} };
            if (sourceSetId) {
                const setSnap = await tx.get(db.doc(`classes/${classId}/miniQuizQuestionSets/${sourceSetId}`));
                if (!setSnap.exists || setSnap.data()?.visibility !== "public") throw new HttpsError("failed-precondition", "Mini quiz set is not published.");
                gameConfig = { ...gameConfig, ...(setSnap.data().settings || {}), sourceSetId };
                progressRef = attemptsCollection.doc(`${userId}_progress_${sourceSetId}`);
                const progressSnap = await tx.get(progressRef);
                if (progressSnap.exists) progress = progressSnap.data();
                else {
                    const history = await tx.get(attemptsCollection.where("studentUid", "==", userId));
                    progress = miniQuizProgressFromAttempts(history.docs.map((snapshot) => snapshot.data()), sourceSetId);
                }
            }

            assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            if (gameConfig.enabled === false && !canPreviewHiddenArcadeGame(request.auth)) {
                throw new HttpsError("failed-precondition", "Mini quiz is not open.");
            }

            const questions = await getMiniQuizQuestionsForGameConfig(
                tx,
                classId,
                gameConfig,
            );
            if (!questions.length) {
                throw new HttpsError("failed-precondition", "No mini quiz questions are configured.");
            }
            if (gameConfig.sourceSetId && !canPreviewHiddenArcadeGame(request.auth)) {
                const setSnap = await tx.get(db.doc(`classes/${classId}/miniQuizQuestionSets/${gameConfig.sourceSetId}`));
                if (!setSnap.exists || setSnap.data()?.visibility !== "public") {
                    throw new HttpsError("failed-precondition", "Mini quiz set is not published.");
                }
            }

            const usageData = usageSnap.exists ? usageSnap.data() || {} : {};
            const miniQuizUsage = progressRef ? progress.usage || {} : usageData.miniQuiz || {};
            const today = getToday();
            const weekStart = getWeekStart();
            const dailyCount = Number(miniQuizUsage[today] || 0);
            const weeklyCount = getWeeklyArcadeUsageCount(miniQuizUsage, weekStart);
            const dailyLimit = Number(gameConfig.dailyLimit || 0);
            const weeklyLimit = Number(gameConfig.weeklyLimit || 0);

            if (
                !isUsageLimitExempt &&
                Number.isFinite(dailyLimit) &&
                dailyLimit > 0 &&
                dailyCount >= dailyLimit
            ) {
                throw new HttpsError("resource-exhausted", "Daily mini quiz limit reached.");
            }
            if (
                !isUsageLimitExempt &&
                Number.isFinite(weeklyLimit) &&
                weeklyLimit > 0 &&
                weeklyCount >= weeklyLimit
            ) {
                throw new HttpsError("resource-exhausted", "Weekly mini quiz limit reached.");
            }

            const questionLimit = Math.max(1, Number(gameConfig.questionCount || 3));
            const submission = selectMiniQuizSubmission(questions, answers, questionLimit);
            if (!submission) {
                throw new HttpsError("invalid-argument", "All quiz questions must be answered.");
            }
            const { selectedQuestions: answeredQuestions, answerMap } = submission;

            const resultRows = answeredQuestions.map((question) => {
                const submittedAnswer = answerMap.get(question.id);
                const isCorrect = isMiniQuizAnswerCorrect(question, submittedAnswer);
                return {
                    questionId: question.id,
                    type: question.type,
                    prompt: question.prompt,
                    submittedAnswer,
                    correctAnswers: question.correctAnswers,
                    explanation: question.explanation || "",
                    isCorrect,
                };
            });
            const correctCount = resultRows.filter((row) => row.isCorrect).length;
            const questionCount = resultRows.length;
            const participationReward = assertNonNegativeFiniteNumber(
                gameConfig.participationReward || 0,
                "miniQuiz.participationReward",
            );
            const rewardPerCorrect = assertNonNegativeFiniteNumber(
                gameConfig.rewardPerCorrect || 0,
                "miniQuiz.rewardPerCorrect",
            );
            const perfectBonus = assertNonNegativeFiniteNumber(
                gameConfig.perfectBonus || 0,
                "miniQuiz.perfectBonus",
            );
            const entitlement =
                participationReward +
                correctCount * rewardPerCorrect +
                (correctCount === questionCount ? perfectBonus : 0);
            const rewardProgress = progressRef ? calculateMiniQuizReward(gameConfig, correctCount, questionCount, progress.paidGross || 0, progress.attemptCount ? progress.bestCorrectCount : -1) : null;
            const grossRewardAmount = rewardProgress ? rewardProgress.grossRewardAmount : entitlement;
            const incomeTaxSnapshot = buildArcadePrizeIncomeTax(
                classData,
                grossRewardAmount,
            );
            const rewardAmount = incomeTaxSnapshot.netAmount;
            const nowTs = FieldValue.serverTimestamp();
            const studentName = studentSnap.data().name || null;

            tx.update(studentRef, {
                "assets.cash": FieldValue.increment(rewardAmount),
                lastUpdated: nowTs,
            });
            if (progressRef) tx.set(progressRef, { kind: "quiz-progress", studentUid: userId, sourceSetId, attemptCount: Number(progress.attemptCount || 0) + 1, paidGross: rewardProgress.cumulativeGrossReward, bestCorrectCount: Math.max(Number(progress.bestCorrectCount || 0), correctCount), usage: { ...miniQuizUsage, [today]: dailyCount + 1 }, updatedAt: nowTs });

            if (!isUsageLimitExempt) {
                tx.set(
                    usageRef,
                    { miniQuiz: { ...(usageData.miniQuiz || {}), [today]: Number(usageData.miniQuiz?.[today] || 0) + 1 } },
                    { merge: true },
                );
            }

            tx.set(attemptRef, {
                id: attemptRef.id,
                requestId: requestId || null,
                studentUid: userId,
                studentName,
                questionCount,
                correctCount,
                grossRewardAmount,
                rewardAmount,
                withheldAmount: incomeTaxSnapshot.withheldAmount,
                incomeTax: incomeTaxSnapshot.incomeTax,
                sourceSetId: gameConfig.sourceSetId || null,
                showCorrectAfterSubmit: gameConfig.showCorrectAfterSubmit !== false,
                results: resultRows,
                createdAt: nowTs,
                usageDate: today,
            });

            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "miniQuiz",
                gameLabel: "간단퀴즈",
                userId,
                studentName,
                paymentType: "cash",
                planType,
                incomeToTreasury: false,
                cashChargeAmount: 0,
                price: 0,
                feeAmount: 0,
                prizeAmount: grossRewardAmount,
                incomeTaxSnapshot,
                activityLogData: {
                    studentUid: userId,
                    type: "income",
                    category: "arcade",
                    subCategory: "mini_quiz",
                    amount: rewardAmount,
                    grossAmount: incomeTaxSnapshot.grossAmount,
                    withheldAmount: incomeTaxSnapshot.withheldAmount,
                    netAmount: rewardAmount,
                    incomeTax: incomeTaxSnapshot.incomeTax,
                    description: `간단퀴즈 보상: ${correctCount}/${questionCount} 정답`,
                    relatedDoc: {
                        collection: "miniQuizAttempts",
                        id: attemptRef.id,
                    },
                },
                globalConfig,
                nowTs,
            });

            return {
                success: true,
                attemptId: attemptRef.id,
                questionCount,
                correctCount,
                grossRewardAmount,
                rewardAmount,
                withheldAmount: incomeTaxSnapshot.withheldAmount,
                results: gameConfig.showCorrectAfterSubmit === false
                    ? resultRows.map(({ questionId, isCorrect }) => ({ questionId, isCorrect }))
                    : resultRows,
            };
        });
    } catch (error) {
        rethrowCallableError(error);
    }
});

exports.playScratch = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");

    const userId = request.auth.uid;
    const { classId, paymentType = "cash" } = request.data || {};
    if (!classId) throw new HttpsError("invalid-argument", "classId is required.");
    assertPaymentType(paymentType);

    const globalConfig = await getGlobalConfig();
    const isUsageLimitExempt = isArcadeUsageLimitExempt(request.auth);

    try {
    // [STEP 0: ?????????????????????
        if (false && paymentType === "ticket") {
            const qs = await getArcadeTicketInventoryQuery(classId, userId).get();
            const ticketDocSnap = resolveTicketSnap(qs);

            if (!ticketDocSnap) {
                throw new HttpsError("failed-precondition", "???????????????????????????ㅼ뒧???嫄???????????????????????????????濡?씀?濾?????????????????살몝??");
            }
            void ticketDocSnap;
        }

        return await db.runTransaction(async (tx) => {
            const studentRef = db.doc(`classes/${classId}/students/${userId}`);
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const usageRef = db.doc(
                `classes/${classId}/arcade/config/usage/${userId}`,
            );
            const [studentSnap, classSnap, arcadeConfigSnap, usageSnap] =
                await Promise.all([
                    tx.get(studentRef),
                    tx.get(classRef),
                    tx.get(arcadeConfigRef),
                    tx.get(usageRef),
                ]);

            const classData = classSnap.data() || {};
            const currencyUnit = resolveClassCurrencyUnit(classData);
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.data() || {};
            const gameConfig = {
                ...getDefaultGameConfig("scratch"),
                ...(arcadeConfig.games?.scratch || {}),
            };

            assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            if (gameConfig.enabled === false && !canPreviewHiddenArcadeGame(request.auth)) {
                throw new HttpsError("failed-precondition", "???????????썹땟戮녹??諭?????⑸㎦???????????????????⑤벡瑜??????롮쾸???????????????? ???????????????????????????????????????");
            }
            assertGamePaymentAllowed("scratch", gameConfig, paymentType);
            const usageData = usageSnap.exists ? usageSnap.data() : {};
            const scratchUsage = usageData.scratch || {};
            const today = getToday();
            const dailyCount = scratchUsage[today] || 0;
            const price = assertNonNegativeFiniteNumber(gameConfig.price || 0, "scratch.price");
            const feeAmount = getArcadeFeeAmount(gameConfig, "scratch");
            const cashChargeAmount = getArcadeCashChargeAmount({
                paymentType,
                price,
                feeAmount,
            });
            const dailyLimitNum = Number(gameConfig.dailyLimit || 0);
            const isPreviewOnly =
                canPreviewHiddenArcadeGame(request.auth) && !studentSnap.exists;

            if (isPreviewOnly) {
                const selectedPrize = pickPrizeByChance(gameConfig.prizes, {
                    gameName: "scratch",
                });
                const prizeValidation = validateArcadePrize(selectedPrize, {
                    price,
                    fieldPrefix: "scratch.prize",
                    gameLabel: "스크래처",
                });

                let itemReward = null;
                if (prizeValidation.hasItem) {
                    const itemId = String(selectedPrize.itemId || "").trim();
                    const itemSnap = await tx.get(
                        db.doc(`classes/${classId}/storeItems/${itemId}`),
                    );
                    const itemData = itemSnap.exists ? itemSnap.data() || {} : {};
                    itemReward = {
                        itemId,
                        itemName: itemData.name || selectedPrize.label || "Reward Item",
                        itemValue: Math.max(0, Number(itemData.price || 0)),
                    };
                }

                const incomeTaxSnapshot = buildArcadePrizeIncomeTax(
                    classData,
                    prizeValidation.prizeAmount,
                );
                const netPrizeAmount = incomeTaxSnapshot.netAmount;

                return {
                    success: true,
                    preview: true,
                    result: buildArcadeResultPayload(selectedPrize, {
                        prizeType: prizeValidation.prizeType,
                        prizeAmount: prizeValidation.prizeAmount,
                        itemReward,
                    }),
                    netChange: netPrizeAmount - cashChargeAmount,
                    feeAmount,
                    cashChargeAmount,
                    newBalance: null,
                    chargedAt: new Date().toISOString(),
                    attemptNumberToday: null,
                    remainingToday: null,
                    limitExempt: true,
                };
            }

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "Student not found.");
            }

            if (
                !isUsageLimitExempt &&
                gameConfig.dailyLimit &&
                dailyCount >= gameConfig.dailyLimit
            ) {
                throw new HttpsError("resource-exhausted", "????????釉먮폁??????????????????????????????거?????????????????????????????????살몝??");
            }

            let ticketSnap = null;
            let totalTicketCount = 0;
            if (paymentType === "ticket") {
                const ticketInventorySnap = await tx.get(
                    getArcadeTicketInventoryQuery(classId, userId),
                );
                totalTicketCount = sumTicketQuantity(ticketInventorySnap);
                ticketSnap = resolveTicketSnap(ticketInventorySnap);
                if (!ticketSnap || totalTicketCount <= 0) {
                    throw new HttpsError("failed-precondition", "???????????????嫄???????????????癲꾧퀗?닺짆?????????????????????鶯??????????????쎛 ??????? ???????????????????살몝??");
                }
                if (!ticketSnap.exists || (ticketSnap.data().quantity || 0) <= 0) {
                    throw new HttpsError("failed-precondition", "?????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
                }
            } else {
                if ((studentSnap.data().assets?.cash || 0) < price) {
                    throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
                }
            }

            if ((studentSnap.data().assets?.cash || 0) < cashChargeAmount) {
                throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
            }

            const selectedPrize = pickPrizeByChance(gameConfig.prizes, {
                gameName: "scratch",
            });

            const prizeValidation = validateArcadePrize(selectedPrize, {
                price,
                fieldPrefix: "scratch.prize",
                gameLabel: "스크래처",
            });

            let storeItemData = null,
                currentInvSnap = null;
            if (prizeValidation.hasItem) {
                const siRef = db.doc(
                    `classes/${classId}/storeItems/${selectedPrize.itemId}`,
                );
                const iiRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${selectedPrize.itemId}`,
                );
                const [si, ii] = await Promise.all([tx.get(siRef), tx.get(iiRef)]);
                storeItemData = si.exists ? si.data() : null;
                currentInvSnap = ii;
            }

            const nowTs = FieldValue.serverTimestamp();
            const prizeAmount = prizeValidation.prizeAmount;
            /*
             * Legacy scratch reward validation is superseded by validateArcadePrize.
            if (false) {
                prizeAmount = resolveMoneyPrizeAmount(
                    selectedPrize,
                    price,
                    "scratch.prize",
                );
            } else if (false) {
                throw new HttpsError(
                    "failed-precondition",
                    "???????????썹땟戮녹??諭?????⑸㎦???????????????????⑤벡瑜??????롮쾸????????????????⑤벡??????????곌퇈猷??????????????? money ?????item ??????????濡?씀?濾?????????????거??????????",
                );
            }
            if (
                false &&
        !String(selectedPrize.itemId || "").trim()
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "???????????썹땟戮녹??諭?????⑸㎦???????????????????⑤벡瑜??????롮쾸??????item ??????????⑤벡??????????곌퇈猷??????????????itemId??????????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????",
                );
            }
            */
            const incomeTaxSnapshot = buildArcadePrizeIncomeTax(classData, prizeAmount);
            const netPrizeAmount = incomeTaxSnapshot.netAmount;
            const netChange = netPrizeAmount - cashChargeAmount;

            // ????????癲ル슢?싩땟???????????????椰??????????????遺얘턁???????猷몄굣??????????????????됰엨???????(??????????⑤벡瑜?????????
            if (paymentType === "ticket") {
                totalTicketCount = Number(totalTicketCount || 0);
                consumeArcadeTicket(tx, {
                    classId,
                    userId,
                    ticketSnap,
                    studentRef,
                    totalTicketCount,
                    note: "arcade scratch play",
                    usedBy: {
                        uid: userId,
                        name: studentSnap.data().name || "",
                        role: "student",
                    },
                });
                if (feeAmount > 0) {
                    tx.update(studentRef, {
                        "assets.cash": FieldValue.increment(-feeAmount),
                    });
                }
            } else {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(-cashChargeAmount),
                });
            }

            let itemReward = null;
            if (prizeAmount > 0) {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(netPrizeAmount),
                });
            }
            /*
            else if (false && selectedPrize.itemId) {
                const invRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${selectedPrize.itemId}`,
                );
                const acq = {
                    type: "arcade_reward",
                    quantity: 1,
                    acquiredAt: admin.firestore.Timestamp.now(),
                };
                if (currentInvSnap?.exists) {
                    tx.update(invRef, {
                        quantity: FieldValue.increment(1),
                        acquisitions: FieldValue.arrayUnion(acq),
                        lastAcquiredDate: nowTs,
                    });
                } else {
                    tx.set(invRef, {
                        itemId: selectedPrize.itemId,
                        itemName: storeItemData?.name || selectedPrize.label,
                        itemType: storeItemData?.itemType || "general",
                        functionTag: storeItemData?.functionTag || null,
                        quantity: 1,
                        totalAcquired: 1,
                        createdAt: nowTs,
                        acquisitions: [acq],
                    });
                }
            }
            */
            if (prizeValidation.hasItem) {
                itemReward = grantArcadeItemReward(tx, {
                    classId,
                    userId,
                    studentRef,
                    selectedPrize,
                    storeItemData,
                    inventorySnap: currentInvSnap,
                    classData,
                    nowTs,
                    sourceType: "arcade_reward",
                    obtainedFrom: "scratch",
                });
            }

            if (!isUsageLimitExempt) {
                tx.set(
                    usageRef,
                    { scratch: { ...scratchUsage, [today]: dailyCount + 1 } },
                    { merge: true },
                );
            }

            const chargeText = buildArcadeChargeText({
                paymentType,
                price,
                feeAmount,
                currencyUnit,
            });

            const responsePayload = {
                success: true,
                result: buildArcadeResultPayload(selectedPrize, {
                    prizeType: prizeValidation.prizeType,
                    prizeAmount,
                    itemReward,
                }),
                netChange,
                feeAmount,
                cashChargeAmount,
                newBalance: (studentSnap.data().assets?.cash || 0) + netChange,
                chargedAt: new Date().toISOString(),
                attemptNumberToday: isUsageLimitExempt ? null : dailyCount + 1,
                remainingToday:
                    !isUsageLimitExempt && dailyLimitNum > 0
                        ? Math.max(dailyLimitNum - (dailyCount + 1), 0)
                        : null,
                limitExempt: isUsageLimitExempt,
            };
            const activityLogData = buildArcadePlayActivityLogData({
                userId,
                netChange,
                paymentType,
                prizeAmount,
                cashChargeAmount,
                price,
                feeAmount,
                incomeTaxSnapshot,
                description: `스크래치 결과: ${selectedPrize.label} (${chargeText})`,
            });
            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "scratch",
                gameLabel: "스크래처",
                userId,
                studentName: studentSnap.data().name || null,
                paymentType,
                planType,
                incomeToTreasury: arcadeSettings.incomeToTreasury === true,
                cashChargeAmount,
                price,
                feeAmount,
                prizeAmount,
                incomeTaxSnapshot,
                activityLogData,
                globalConfig,
                nowTs,
            });
            return responsePayload;
        });
    } catch (e) {
        rethrowCallableError(e);
    }
});

exports.playPaperPick = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");

    const userId = request.auth.uid;
    const { classId, slotIndex, paymentType = "cash" } = request.data || {};
    if (!classId || slotIndex === undefined)
        throw new HttpsError("invalid-argument", "classId and slotIndex are required.");
    assertPaymentType(paymentType);
    const normalizedSlotIndex = Number(slotIndex);
    if (!Number.isInteger(normalizedSlotIndex) || normalizedSlotIndex < 0) {
        throw new HttpsError("invalid-argument", "?????????? ??? ?????????????????");
    }

    const globalConfig = await getGlobalConfig();
    const isUsageLimitExempt = isArcadeUsageLimitExempt(request.auth);

    try {
        if (false && paymentType === "ticket") {
            const qs = await getArcadeTicketInventoryQuery(classId, userId).get();
            const ticketDocSnap = resolveTicketSnap(qs);
            if (!ticketDocSnap) {
                throw new HttpsError("failed-precondition", "???????????????????????????ㅼ뒧???嫄???????????????????????????????濡?씀?濾?????????????????살몝??");
            }
            void ticketDocSnap;
        }

        return await db.runTransaction(async (tx) => {
            const studentRef = db.doc(`classes/${classId}/students/${userId}`);
            const boardRef = db.doc(
                `classes/${classId}/arcade_metadata/paperpick_board`,
            );
            const usageRef = db.doc(
                `classes/${classId}/arcade/config/usage/${userId}`,
            );
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);

            const [studentSnap, boardSnap, usageSnap, classSnap, arcadeConfigSnap] =
                await Promise.all([
                    tx.get(studentRef),
                    tx.get(boardRef),
                    tx.get(usageRef),
                    tx.get(classRef),
                    tx.get(arcadeConfigRef),
                ]);

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "?????????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }
            if (!boardSnap.exists) {
                throw new HttpsError("failed-precondition", "??????????諛몃마嶺뚮?????????????硫λ젒????????椰????????????釉먮폁??????????????????野껊챶???????????????????????椰????????????거?????????????????????????濡?씀?濾?????????????????살몝??");
            }
            const boardData = boardSnap.data() || {};
            const slots = Array.isArray(boardData.slots) ? boardData.slots : [];

            if (!slots[normalizedSlotIndex]) {
                throw new HttpsError("invalid-argument", "?????????? ??? ?????????????????");
            }
            if (slots[normalizedSlotIndex].picked) {
                throw new HttpsError("failed-precondition", "???? ??????椰??????????????????????????");
            }

            const classData = classSnap.data() || {};
            const currencyUnit = resolveClassCurrencyUnit(classData);
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.data() || {};
            const gameConfig = {
                ...getDefaultGameConfig("paperpick"),
                ...(arcadeConfig.games?.paperpick || {}),
            };

            assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            if (gameConfig.enabled === false) {
                throw new HttpsError("failed-precondition", "?????????關?쒎첎?嫄??????????椰????????????거?????????????????????嚥싲갭큔?댁쉮??????????????? ???????????????????????????????????????");
            }

            const usageData = usageSnap.exists ? usageSnap.data() : {};
            assertGamePaymentAllowed("paperpick", gameConfig, paymentType);
            const paperpickUsage = usageData.paperpick || {};
            const today = getToday();
            const weekStart = getWeekStart();
            const dailyCount = Number(paperpickUsage[today] || 0);
            const weeklyCount = Object.entries(paperpickUsage)
                .filter(([date]) => date >= weekStart)
                .reduce((sum, [, count]) => sum + Number(count || 0), 0);
            const dailyLimitNum = Number(gameConfig.dailyLimit || 0);
            const weeklyLimitNum = Number(gameConfig.weeklyLimit || 0);

            if (!isUsageLimitExempt && dailyLimitNum > 0 && dailyCount >= dailyLimitNum) {
                throw new HttpsError("resource-exhausted", "????????釉먮폁??????????????????????????????거?????????????????????????????????살몝??");
            }
            if (!isUsageLimitExempt && weeklyLimitNum > 0 && weeklyCount >= weeklyLimitNum) {
                throw new HttpsError("resource-exhausted", "?????????????????????????????거?????????????????????????????????살몝??");
            }

            const price = assertNonNegativeFiniteNumber(
                boardData.price ?? gameConfig.price ?? 100,
                "paperpick.price",
            );
            const feeAmount = getArcadeFeeAmount(gameConfig, "paperpick");
            const cashChargeAmount = getArcadeCashChargeAmount({
                paymentType,
                price,
                feeAmount,
            });

            let ticketSnap = null;
            let totalTicketCount = 0;
            if (paymentType === "ticket") {
                const ticketInventorySnap = await tx.get(
                    getArcadeTicketInventoryQuery(classId, userId),
                );
                totalTicketCount = sumTicketQuantity(ticketInventorySnap);
                ticketSnap = resolveTicketSnap(ticketInventorySnap);
                if (!ticketSnap || totalTicketCount <= 0) {
                    throw new HttpsError("failed-precondition", "???????????????嫄???????????????癲꾧퀗?닺짆?????????????????????鶯??????????????쎛 ??????? ???????????????????살몝??");
                }
                if (!ticketSnap.exists || (ticketSnap.data().quantity || 0) <= 0) {
                    throw new HttpsError("failed-precondition", "?????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
                }
            } else {
                if ((studentSnap.data().assets?.cash || 0) < price) {
                    throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
                }
            }

            if ((studentSnap.data().assets?.cash || 0) < cashChargeAmount) {
                throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
            }

            const selectedPrize = slots[normalizedSlotIndex];

            const prizeValidation = validateArcadePrize(selectedPrize, {
                price,
                fieldPrefix: "paperpick.prize",
                gameLabel: "종이 뽑기",
            });

            let storeItemData = null,
                currentInvSnap = null;
            if (prizeValidation.hasItem) {
                const siRef = db.doc(
                    `classes/${classId}/storeItems/${selectedPrize.itemId}`,
                );
                const iiRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${selectedPrize.itemId}`,
                );
                const [si, ii] = await Promise.all([tx.get(siRef), tx.get(iiRef)]);
                storeItemData = si.exists ? si.data() : null;
                currentInvSnap = ii;
            }

            const nowJsDate = new Date();
            const nowTs = FieldValue.serverTimestamp();
            const prizeAmount = prizeValidation.prizeAmount;
            /*
             * Legacy paperpick reward validation is superseded by validateArcadePrize.
            if (false) {
                prizeAmount = resolveMoneyPrizeAmount(
                    selectedPrize,
                    price,
                    "paperpick.prize",
                );
            } else if (false) {
                throw new HttpsError(
                    "failed-precondition",
                    "?????????關?쒎첎?嫄??????????椰????????????거?????????????????????⑤벡??????????곌퇈猷??????????????? money ?????item ??????????濡?씀?濾?????????????거??????????",
                );
            }
            if (
                false &&
        !String(selectedPrize.itemId || "").trim()
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "?????????關?쒎첎?嫄??????????椰????????????거???????????item ??????????⑤벡??????????곌퇈猷??????????????itemId??????????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????",
                );
            }
            */
            const incomeTaxSnapshot = buildArcadePrizeIncomeTax(classData, prizeAmount);
            const netPrizeAmount = incomeTaxSnapshot.netAmount;
            const netChange = netPrizeAmount - cashChargeAmount;

            const updatedSlots = [...slots];
            updatedSlots[normalizedSlotIndex] = {
                ...updatedSlots[normalizedSlotIndex],
                picked: true,
                userId,
                pickedAt: nowJsDate,
            };

            tx.update(boardRef, {
                slots: updatedSlots,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // ????????癲ル슢?싩땟???????????????椰??????????????遺얘턁???????猷몄굣??????(??????????⑤벡瑜?????????
            if (paymentType === "ticket") {
                consumeArcadeTicket(tx, {
                    classId,
                    userId,
                    ticketSnap,
                    studentRef,
                    totalTicketCount,
                    note: "arcade paperpick play",
                    usedBy: {
                        uid: userId,
                        name: studentSnap.data().name || "",
                        role: "student",
                    },
                });
                if (feeAmount > 0) {
                    tx.update(studentRef, {
                        "assets.cash": FieldValue.increment(-feeAmount),
                    });
                }
            } else {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(-cashChargeAmount),
                });
            }

            let itemReward = null;
            if (prizeAmount > 0) {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(netPrizeAmount),
                });
            }
            /*
            else if (false && selectedPrize.itemId) {
                const invRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${selectedPrize.itemId}`,
                );
                const acq = {
                    type: "arcade_reward",
                    quantity: 1,
                    acquiredAt: admin.firestore.Timestamp.now(),
                };
                if (currentInvSnap?.exists) {
                    tx.update(invRef, {
                        quantity: FieldValue.increment(1),
                        acquisitions: FieldValue.arrayUnion(acq),
                        lastAcquiredDate: nowTs,
                    });
                } else {
                    tx.set(invRef, {
                        itemId: selectedPrize.itemId,
                        itemName: storeItemData?.name || selectedPrize.label,
                        itemType: storeItemData?.itemType || "general",
                        functionTag: storeItemData?.functionTag || null,
                        quantity: 1,
                        totalAcquired: 1,
                        createdAt: nowTs,
                        acquisitions: [acq],
                    });
                }
            }
            */
            if (prizeValidation.hasItem) {
                itemReward = grantArcadeItemReward(tx, {
                    classId,
                    userId,
                    studentRef,
                    selectedPrize,
                    storeItemData,
                    inventorySnap: currentInvSnap,
                    classData,
                    nowTs,
                    sourceType: "arcade_reward",
                    obtainedFrom: "paperpick",
                });
            }

            if (!isUsageLimitExempt) {
                tx.set(
                    usageRef,
                    { paperpick: { ...paperpickUsage, [today]: dailyCount + 1 } },
                    { merge: true },
                );
            }

            const chargeText = buildArcadeChargeText({
                paymentType,
                price,
                feeAmount,
                currencyUnit,
            });

            const responsePayload = {
                success: true,
                result: buildArcadeResultPayload(selectedPrize, {
                    prizeType: prizeValidation.prizeType,
                    prizeAmount,
                    itemReward,
                }),
                netChange,
                feeAmount,
                cashChargeAmount,
            };
            const activityLogData = buildArcadePlayActivityLogData({
                userId,
                netChange,
                paymentType,
                prizeAmount,
                cashChargeAmount,
                price,
                feeAmount,
                incomeTaxSnapshot,
                description: `종이 뽑기 ${normalizedSlotIndex + 1}번: ${selectedPrize.label} (${chargeText})`,
            });
            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "paperpick",
                gameLabel: "종이 뽑기",
                userId,
                studentName: studentSnap.data().name || null,
                paymentType,
                planType,
                incomeToTreasury: arcadeSettings.incomeToTreasury === true,
                cashChargeAmount,
                price,
                feeAmount,
                prizeAmount,
                incomeTaxSnapshot,
                activityLogData,
                globalConfig,
                nowTs,
            });
            return responsePayload;
        });
    } catch (e) {
        console.error("playPaperPick Error:", e);
        rethrowCallableError(e);
    }
});

/* ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
 * [??????????諛몃마嶺뚮?????????????硫λ젒????????곗뿨?????? ?????????????????븐뼐?????????μ떜媛?걫???????????猷고???????????????? (playRoulette)
 * ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
exports.buyNostalgiaPickEntry = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");

    const userId = request.auth.uid;
    const { classId, slotNumber, paymentType = "cash" } = request.data || {};
    if (!classId || slotNumber === undefined) {
        throw new HttpsError("invalid-argument", "classId and slotNumber are required.");
    }
    assertPaymentType(paymentType);

    const normalizedSlotNumber = Math.trunc(Number(slotNumber));
    if (!Number.isInteger(normalizedSlotNumber) || normalizedSlotNumber <= 0) {
        throw new HttpsError("invalid-argument", "slotNumber must be a positive integer.");
    }

    const globalConfig = await getGlobalConfig();
    const isUsageLimitExempt = isArcadeUsageLimitExempt(request.auth);

    try {
        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const roundsRef = db.collection(
                `classes/${classId}/arcade/config/nostalgiaPickRounds`,
            );
            const studentRef = db.doc(`classes/${classId}/students/${userId}`);
            const usageRef = db.doc(`classes/${classId}/arcade/config/usage/${userId}`);

            const [classSnap, arcadeConfigSnap, openRoundQuery, studentSnap, usageSnap] =
                await Promise.all([
                    tx.get(classRef),
                    tx.get(arcadeConfigRef),
                    tx.get(roundsRef.where("status", "==", "open").limit(1)),
                    tx.get(studentRef),
                    tx.get(usageRef),
                ]);

            if (!classSnap.exists) {
                throw new HttpsError("not-found", "Class not found.");
            }
            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "Student not found.");
            }
            if (openRoundQuery.empty) {
                throw new HttpsError("failed-precondition", "No open nostalgia pick round.");
            }

            const classData = classSnap.data() || {};
            const currencyUnit = resolveClassCurrencyUnit(classData);
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.exists ? (arcadeConfigSnap.data() || {}) : {};
            const gameConfig = {
                ...getDefaultGameConfig("nostalgiaPick"),
                ...(arcadeConfig.games?.nostalgiaPick || {}),
            };

            assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            assertGamePaymentAllowed("nostalgiaPick", gameConfig, paymentType);
            if (gameConfig.enabled === false && !canPreviewHiddenArcadeGame(request.auth)) {
                throw new HttpsError("failed-precondition", "Nostalgia pick is disabled.");
            }

            const roundSnap = openRoundQuery.docs[0];
            const roundData = roundSnap.data() || {};
            const settings = roundData.settings || {};
            if (settings.enabled === false && !canPreviewHiddenArcadeGame(request.auth)) {
                throw new HttpsError("failed-precondition", "Nostalgia pick round is hidden.");
            }

            const boardSize = Math.trunc(Number(settings.boardSize || 0));
            if (boardSize <= 0 || normalizedSlotNumber > boardSize) {
                throw new HttpsError("invalid-argument", "slotNumber is outside the board.");
            }

            if (settings.endTime) {
                const end = new Date(settings.endTime).getTime();
                if (Number.isFinite(end) && Date.now() > end) {
                    throw new HttpsError("failed-precondition", "Nostalgia pick round is closed by deadline.");
                }
            }

            const usageData = usageSnap.exists ? usageSnap.data() : {};
            const gameUsage = usageData.nostalgiaPick || {};
            const today = getToday();
            const weekStart = getWeekStart();
            const dailyCount = Number(gameUsage[today] || 0);
            const weeklyCount = Object.entries(gameUsage)
                .filter(([date]) => date >= weekStart)
                .reduce((sum, [, count]) => sum + Number(count || 0), 0);
            const dailyLimitNum = Number(gameConfig.dailyLimit || 0);
            const weeklyLimitNum = Number(gameConfig.weeklyLimit || 0);

            if (!isUsageLimitExempt && dailyLimitNum > 0 && dailyCount >= dailyLimitNum) {
                throw new HttpsError("resource-exhausted", "Daily nostalgia pick limit reached.");
            }
            if (!isUsageLimitExempt && weeklyLimitNum > 0 && weeklyCount >= weeklyLimitNum) {
                throw new HttpsError("resource-exhausted", "Weekly nostalgia pick limit reached.");
            }

            const entryRef = roundSnap.ref
                .collection("entries")
                .doc(`slot_${normalizedSlotNumber}`);
            const studentEntriesQuery = roundSnap.ref
                .collection("entries")
                .where("studentUid", "==", userId)
                .where("status", "==", "active");
            const [entrySnap, studentEntriesSnap] = await Promise.all([
                tx.get(entryRef),
                tx.get(studentEntriesQuery),
            ]);

            if (entrySnap.exists && String(entrySnap.data()?.status || "active") === "active") {
                throw new HttpsError("already-exists", "This slot is already taken.");
            }

            const maxEntriesPerStudent = Math.trunc(
                Number(settings.maxEntriesPerStudent || 0),
            );
            if (
                maxEntriesPerStudent > 0 &&
                studentEntriesSnap.size >= maxEntriesPerStudent
            ) {
                throw new HttpsError("resource-exhausted", "Student entry limit reached.");
            }

            const price = assertNonNegativeFiniteNumber(
                gameConfig.price ?? settings.price ?? 100,
                "nostalgiaPick.price",
            );
            const feeAmount = getArcadeFeeAmount(gameConfig, "nostalgiaPick");
            const cashChargeAmount = getArcadeCashChargeAmount({
                paymentType,
                price,
                feeAmount,
            });
            const studentData = studentSnap.data() || {};
            if ((studentData.assets?.cash || 0) < cashChargeAmount) {
                throw new HttpsError("failed-precondition", "Not enough cash.");
            }

            let ticketSnap = null;
            let totalTicketCount = 0;
            if (paymentType === "ticket") {
                const ticketInventorySnap = await tx.get(
                    getArcadeTicketInventoryQuery(classId, userId),
                );
                totalTicketCount = sumTicketQuantity(ticketInventorySnap);
                ticketSnap = resolveTicketSnap(ticketInventorySnap);
                if (!ticketSnap || totalTicketCount <= 0) {
                    throw new HttpsError("failed-precondition", "Not enough arcade tickets.");
                }
            }

            const nowTs = FieldValue.serverTimestamp();
            const usageDate = getToday();
            if (paymentType === "ticket") {
                consumeArcadeTicket(tx, {
                    classId,
                    userId,
                    ticketSnap,
                    studentRef,
                    totalTicketCount,
                    note: "arcade nostalgia pick entry",
                    usedBy: {
                        uid: userId,
                        name: studentData.name || "",
                        role: "student",
                    },
                });
                if (feeAmount > 0) {
                    tx.update(studentRef, {
                        "assets.cash": FieldValue.increment(-feeAmount),
                    });
                }
            } else {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(-cashChargeAmount),
                });
            }

            tx.set(entryRef, {
                slotNumber: normalizedSlotNumber,
                studentUid: userId,
                studentName: studentData.name || "student",
                purchasedAt: nowTs,
                paymentType,
                price,
                feeAmount,
                cashChargeAmount,
                usageDate,
                roundId: roundSnap.id,
                status: "active",
            });
            tx.update(roundSnap.ref, {
                entryCount: FieldValue.increment(1),
                updatedAt: nowTs,
            });

            if (!isUsageLimitExempt) {
                tx.set(
                    usageRef,
                    { nostalgiaPick: { ...gameUsage, [usageDate]: dailyCount + 1 } },
                    { merge: true },
                );
            }

            const chargeText = buildArcadeChargeText({
                paymentType,
                price,
                feeAmount,
                currencyUnit,
            });
            const activityLogData = buildArcadePlayActivityLogData({
                userId,
                netChange: -cashChargeAmount,
                paymentType,
                prizeAmount: 0,
                cashChargeAmount,
                price,
                feeAmount,
                description: `추억의 뽑기 ${normalizedSlotNumber}번 응모 (${chargeText})`,
            });
            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "nostalgiaPick",
                gameLabel: "추억의 뽑기",
                userId,
                studentName: studentData.name || null,
                paymentType,
                planType,
                incomeToTreasury: arcadeSettings.incomeToTreasury === true,
                cashChargeAmount,
                price,
                feeAmount,
                prizeAmount: 0,
                activityLogData,
                globalConfig,
                nowTs,
            });

            return {
                success: true,
                roundId: roundSnap.id,
                entryId: entryRef.id,
                slotNumber: normalizedSlotNumber,
                feeAmount,
                cashChargeAmount,
            };
        });
    } catch (e) {
        console.error("buyNostalgiaPickEntry Error:", e);
        rethrowCallableError(e);
    }
});

exports.manageNostalgiaPickRound = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    assertTeacherOrAdmin(request.auth);

    const callerUid = request.auth.uid;
    const callerRole = request.auth.token?.role;
    const { classId, action, roundId, round, enabled } = request.data || {};
    if (!classId || !action) {
        throw new HttpsError("invalid-argument", "classId and action are required.");
    }
    if (!VALID_NOSTALGIA_PICK_MANAGE_ACTIONS.has(action)) {
        throw new HttpsError("invalid-argument", "Invalid nostalgia pick action.");
    }
    assertTeacherClassScopeStrict(request.auth, classId);

    const globalConfig = await getGlobalConfig();

    try {
        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const callerRef = db.doc(`classes/${classId}/students/${callerUid}`);
            const roundsRef = db.collection(
                `classes/${classId}/arcade/config/nostalgiaPickRounds`,
            );

            const [classSnap, arcadeConfigSnap] = await Promise.all([
                tx.get(classRef),
                tx.get(arcadeConfigRef),
            ]);
            if (!classSnap.exists) {
                throw new HttpsError("not-found", "Class not found.");
            }
            if (callerRole !== "admin") {
                const callerSnap = await tx.get(callerRef);
                if (!callerSnap.exists) {
                    throw new HttpsError("permission-denied", "Teacher profile not found.");
                }
            }

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            if (action !== "set_enabled") {
                assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            }

            const arcadeConfigData = arcadeConfigSnap.exists
                ? (arcadeConfigSnap.data() || {})
                : {};
            const globalGameSettings = arcadeConfigData.games?.nostalgiaPick || {};

            if (action === "create") {
                const normalized = normalizeNostalgiaPickRoundSettings(
                    round || {},
                    globalGameSettings,
                );
                const roundDocRef = roundsRef.doc();
                tx.set(roundDocRef, {
                    title: normalized.title,
                    status: "ready",
                    entryCount: 0,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    settings: normalized.settings,
                });
                return { success: true, action, roundId: roundDocRef.id };
            }

            if (!roundId || typeof roundId !== "string") {
                throw new HttpsError("invalid-argument", "roundId is required.");
            }

            const roundRef = roundsRef.doc(roundId);
            const roundSnap = await tx.get(roundRef);
            if (!roundSnap.exists) {
                throw new HttpsError("not-found", "Nostalgia pick round not found.");
            }
            const roundData = roundSnap.data() || {};

            if (action === "update") {
                if (roundData.status !== "ready") {
                    const updateKeys = Object.keys(round || {}).filter(
                        (key) => round[key] !== undefined,
                    );
                    const canUpdateDeadlineOnly =
                        ["open", "paused"].includes(roundData.status) &&
                        updateKeys.length > 0 &&
                        updateKeys.every((key) => key === "endTime");

                    if (canUpdateDeadlineOnly) {
                        tx.update(roundRef, {
                            "settings.endTime": normalizeLottoEndTimeValue(round.endTime),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                        return { success: true, action, roundId };
                    }
                    throw new HttpsError(
                        "failed-precondition",
                        "Only ready nostalgia pick rounds can be edited.",
                    );
                }

                const normalized = normalizeNostalgiaPickRoundSettings(
                    round || {},
                    globalGameSettings,
                );
                tx.update(roundRef, {
                    title: normalized.title,
                    settings: normalized.settings,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "open") {
                const openRoundSnap = await tx.get(
                    roundsRef.where("status", "in", ["open", "paused"]).limit(2),
                );
                if (openRoundSnap.docs.some((docSnap) => docSnap.id !== roundId)) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Another nostalgia pick round is already active.",
                    );
                }
                tx.update(roundRef, {
                    status: "open",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "pause") {
                if (roundData.status !== "open") {
                    throw new HttpsError("failed-precondition", "Only open rounds can be paused.");
                }
                tx.update(roundRef, {
                    status: "paused",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "resume") {
                if (roundData.status !== "paused") {
                    throw new HttpsError("failed-precondition", "Only paused rounds can be resumed.");
                }
                tx.update(roundRef, {
                    status: "open",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "close") {
                if (!["open", "paused"].includes(roundData.status)) {
                    throw new HttpsError("failed-precondition", "Only active rounds can be closed.");
                }
                tx.update(roundRef, {
                    status: "closed",
                    closedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "set_enabled") {
                if (typeof enabled !== "boolean") {
                    throw new HttpsError("invalid-argument", "enabled must be boolean.");
                }
                tx.update(roundRef, {
                    "settings.enabled": enabled,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId, enabled };
            }

            if (action === "delete") {
                if (roundData.status !== "ready") {
                    throw new HttpsError(
                        "failed-precondition",
                        "Only ready nostalgia pick rounds can be deleted.",
                    );
                }
                tx.delete(roundRef);
                return { success: true, action, roundId };
            }

            if (action === "draw") {
                if (!["closed", "finished"].includes(roundData.status)) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Close the nostalgia pick round before drawing.",
                    );
                }
                if (roundData.resultsPublished === true) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Nostalgia pick results have already been published.",
                    );
                }

                const pendingResultRef = getNostalgiaPickPendingResultRef(classId, roundId);
                const pendingResultSnap = await tx.get(pendingResultRef);
                if (pendingResultSnap.exists) {
                    const pendingResult = pendingResultSnap.data() || {};
                    return {
                        success: true,
                        action,
                        roundId,
                        winners: Array.isArray(pendingResult.winners)
                            ? pendingResult.winners
                            : [],
                        totalEntries: Number(pendingResult.totalEntries || 0),
                        resultsPending: true,
                    };
                }

                const settings = roundData.settings || {};
                const prizeRules = Array.isArray(settings.prizes) ? settings.prizes : [];
                if (!prizeRules.length) {
                    throw new HttpsError("failed-precondition", "No nostalgia pick prizes configured.");
                }

                const entriesSnap = await tx.get(roundRef.collection("entries"));
                const activeEntries = entriesSnap.docs
                    .map((docSnap) => ({
                        id: docSnap.id,
                        ref: docSnap.ref,
                        data: docSnap.data() || {},
                    }))
                    .filter((entry) => String(entry.data.status || "active") === "active");
                if (!activeEntries.length) {
                    throw new HttpsError("failed-precondition", "No active nostalgia pick entries.");
                }

                const duplicateWinnersAllowed =
                    settings.duplicateWinnersAllowed === true;
                const shuffledEntries = shuffleRows(activeEntries);
                const pickedEntryIds = new Set();
                const pickedStudentUids = new Set();
                const winnerRows = [];

                for (const [index, prize] of prizeRules.entries()) {
                    const candidate = shuffledEntries.find((entry) => {
                        if (pickedEntryIds.has(entry.id)) return false;
                        if (
                            !duplicateWinnersAllowed &&
                            pickedStudentUids.has(entry.data.studentUid)
                        ) {
                            return false;
                        }
                        return true;
                    });

                    if (!candidate) break;
                    pickedEntryIds.add(candidate.id);
                    pickedStudentUids.add(candidate.data.studentUid);
                    winnerRows.push({
                        rank: index + 1,
                        prize,
                        entry: candidate,
                    });
                }

                const nowTs = FieldValue.serverTimestamp();
                const pendingWinnerRows = winnerRows.map((winner) => ({
                    rank: winner.rank,
                    entryId: winner.entry.id,
                    slotNumber: winner.entry.data.slotNumber,
                    studentUid: winner.entry.data.studentUid,
                    studentName: winner.entry.data.studentName || "student",
                    prize: winner.prize,
                    prizeLabel: winner.prize.label || `${winner.rank}등`,
                }));
                const publicWinners = pendingWinnerRows.map((winner) => ({
                    rank: winner.rank,
                    slotNumber: winner.slotNumber,
                    studentUid: winner.studentUid,
                    studentName: winner.studentName,
                    prizeLabel: winner.prizeLabel,
                }));

                tx.set(pendingResultRef, {
                    classId,
                    roundId,
                    status: "pending",
                    winners: publicWinners,
                    winnerRows: pendingWinnerRows,
                    totalEntries: activeEntries.length,
                    drawnAt: nowTs,
                    drawnBy: callerUid,
                    updatedAt: nowTs,
                });

                tx.update(roundRef, {
                    status: "finished",
                    drawnAt: nowTs,
                    drawnBy: callerUid,
                    winners: FieldValue.delete(),
                    resultsPending: true,
                    resultsPublished: false,
                    updatedAt: nowTs,
                });

                return {
                    success: true,
                    action,
                    roundId,
                    winners: publicWinners,
                    totalEntries: activeEntries.length,
                    resultsPending: true,
                };
            }

            if (action === "publish_results") {
                if (roundData.resultsPublished === true) {
                    return { success: true, action, roundId, alreadyPublished: true };
                }

                const pendingResultRef = getNostalgiaPickPendingResultRef(classId, roundId);
                const pendingResultSnap = await tx.get(pendingResultRef);
                if (!pendingResultSnap.exists) {
                    throw new HttpsError(
                        "failed-precondition",
                        "No pending nostalgia pick result to publish.",
                    );
                }

                const pendingResult = pendingResultSnap.data() || {};
                const pendingWinnerRows = Array.isArray(pendingResult.winnerRows)
                    ? pendingResult.winnerRows
                    : [];
                const rewardContexts = [];

                for (const winner of pendingWinnerRows) {
                    const studentUid = String(winner.studentUid || "").trim();
                    const entryId = String(winner.entryId || "").trim();
                    if (!studentUid || !entryId) continue;

                    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
                    const entryRef = roundRef.collection("entries").doc(entryId);
                    const [studentSnap, entrySnap] = await Promise.all([
                        tx.get(studentRef),
                        tx.get(entryRef),
                    ]);

                    if (!studentSnap.exists || !entrySnap.exists) continue;

                    const prizeValidation = validateArcadePrize(winner.prize, {
                        price: 0,
                        fieldPrefix: `nostalgiaPick.prizes[${Number(winner.rank || 1) - 1}]`,
                        gameLabel: "추억의 뽑기",
                    });
                    let storeItemData = null;
                    let inventorySnap = null;

                    if (prizeValidation.hasItem) {
                        const itemId = String(winner.prize?.itemId || "").trim();
                        const storeItemRef = db.doc(`classes/${classId}/storeItems/${itemId}`);
                        const inventoryRef = db.doc(
                            `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
                        );
                        const [storeItemSnap, currentInventorySnap] = await Promise.all([
                            tx.get(storeItemRef),
                            tx.get(inventoryRef),
                        ]);
                        storeItemData = storeItemSnap.exists ? storeItemSnap.data() : null;
                        inventorySnap = currentInventorySnap;
                    }

                    rewardContexts.push({
                        ...winner,
                        studentUid,
                        studentRef,
                        studentSnap,
                        entryRef,
                        entrySnap,
                        prizeValidation,
                        storeItemData,
                        inventorySnap,
                    });
                }

                const nowTs = FieldValue.serverTimestamp();
                const publicWinners = [];

                for (const context of rewardContexts) {
                    const studentName =
                        context.studentName ||
                        context.entrySnap.data()?.studentName ||
                        context.studentSnap.data()?.name ||
                        "student";
                    const prizeAmount = context.prizeValidation.prizeAmount;
                    const incomeTaxSnapshot = buildArcadePrizeIncomeTax(classData, prizeAmount);
                    const netPrizeAmount = incomeTaxSnapshot.netAmount;
                    let itemReward = null;

                    if (prizeAmount > 0) {
                        tx.update(context.studentRef, {
                            "assets.cash": FieldValue.increment(netPrizeAmount),
                        });
                    }

                    if (context.prizeValidation.hasItem) {
                        itemReward = grantArcadeItemReward(tx, {
                            classId,
                            userId: context.studentUid,
                            studentRef: context.studentRef,
                            selectedPrize: context.prize,
                            storeItemData: context.storeItemData,
                            inventorySnap: context.inventorySnap,
                            classData,
                            nowTs,
                            sourceType: "nostalgia_pick_reward",
                            obtainedFrom: "nostalgiaPick",
                        });
                    }

                    tx.update(context.entryRef, {
                        status: "won",
                        rank: context.rank,
                        prizeLabel: context.prizeLabel || context.prize?.label || `${context.rank}등`,
                        result: {
                            rank: context.rank,
                            prize: prizeAmount,
                            itemId: itemReward?.itemId || context.prize?.itemId || null,
                        },
                        drawnAt: nowTs,
                    });

                    const activityLogData = buildArcadePlayActivityLogData({
                        userId: context.studentUid,
                        netChange: netPrizeAmount,
                        paymentType: "lotto_reward",
                        prizeAmount,
                        cashChargeAmount: 0,
                        price: 0,
                        feeAmount: 0,
                        incomeTaxSnapshot,
                        description: `추억의 뽑기 ${context.rank}등 당첨: ${context.slotNumber}번`,
                    });
                    stageArcadeSideEffects(tx, {
                        classData,
                        classId,
                        gameId: "nostalgiaPick",
                        gameLabel: "추억의 뽑기",
                        userId: context.studentUid,
                        studentName,
                        paymentType: "lotto_reward",
                        planType,
                        incomeToTreasury: false,
                        cashChargeAmount: 0,
                        price: 0,
                        feeAmount: 0,
                        prizeAmount,
                        incomeTaxSnapshot,
                        activityLogData,
                        globalConfig,
                        nowTs,
                    });

                    publicWinners.push({
                        rank: context.rank,
                        slotNumber: context.slotNumber,
                        studentUid: context.studentUid,
                        studentName,
                        prizeLabel: context.prizeLabel || context.prize?.label || `${context.rank}등`,
                    });
                }

                tx.update(roundRef, {
                    winners: publicWinners,
                    totalEntries: Number(pendingResult.totalEntries || 0),
                    resultsPending: false,
                    resultsPublished: true,
                    publishedAt: nowTs,
                    publishedBy: callerUid,
                    updatedAt: nowTs,
                });
                tx.delete(pendingResultRef);

                return {
                    success: true,
                    action,
                    roundId,
                    winners: publicWinners,
                    totalEntries: Number(pendingResult.totalEntries || 0),
                };
            }

            throw new HttpsError("invalid-argument", "Invalid nostalgia pick action.");
        });
    } catch (e) {
        console.error("manageNostalgiaPickRound Error:", e);
        rethrowCallableError(e);
    }
});

exports.playRoulette = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth)
        throw new HttpsError("unauthenticated", "???????嫄?????????????釉랁닑??????????紐껊뭸?????????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????");

    const userId = request.auth.uid;
    const { classId, paymentType = "cash" } = request.data || {};
    if (!classId)
        throw new HttpsError(
            "invalid-argument",
            "???????耀붾굝????????????????????諛몃마嶺뚮?????????????硫λ젒???????????classId)??????????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????????????????",
        );
    assertPaymentType(paymentType);

    const globalConfig = await getGlobalConfig();
    const isUsageLimitExempt = isArcadeUsageLimitExempt(request.auth);

    try {
    // [STEP 0: ?????????????癲ル슢?싩땟????????????????????????????
        if (false && paymentType === "ticket") {
            const qs = await getArcadeTicketInventoryQuery(classId, userId).get();
            const ticketDocSnap = resolveTicketSnap(qs);

            if (!ticketDocSnap) {
                throw new HttpsError("failed-precondition", "???????????????????????????ㅼ뒧???嫄???????????????????????????????濡?씀?濾?????????????????살몝??");
            }
            void ticketDocSnap;
        }

        return await db.runTransaction(async (tx) => {
            // [STEP 1: ?????????????????????亦낃콛?????READS)] ---------------------------------------
            const studentRef = db.doc(`classes/${classId}/students/${userId}`);
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const usageRef = db.doc(
                `classes/${classId}/arcade/config/usage/${userId}`,
            );
            const [studentSnap, classSnap, arcadeConfigSnap, usageSnap] =
                await Promise.all([
                    tx.get(studentRef),
                    tx.get(classRef),
                    tx.get(arcadeConfigRef),
                    tx.get(usageRef),
                ]);

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "?????????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }

            const classData = classSnap.data() || {};
            const currencyUnit = resolveClassCurrencyUnit(classData);
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.data() || {};
            const gameConfig = arcadeConfig.games?.roulette || {
                enabled: true,
                price: 50,
                feeAmount: 0,
            };

            assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            if (gameConfig.enabled === false) {
                throw new HttpsError("failed-precondition", "???????猷고????????????????????????????????????????????????");
            }

            const usageData = usageSnap.exists ? usageSnap.data() : {};
            assertGamePaymentAllowed("roulette", gameConfig, paymentType);
            const rouletteUsage = usageData.roulette || {};
            const today = getToday();
            const dailyCount = rouletteUsage[today] || 0;

            if (
                !isUsageLimitExempt &&
                gameConfig.dailyLimit &&
                dailyCount >= gameConfig.dailyLimit
            ) {
                throw new HttpsError("resource-exhausted", "Daily limit reached.");
            }

            const price = assertNonNegativeFiniteNumber(
                gameConfig.price || 0,
                "roulette.price",
            );
            const feeAmount = getArcadeFeeAmount(gameConfig, "roulette");
            const cashChargeAmount = getArcadeCashChargeAmount({
                paymentType,
                price,
                feeAmount,
            });
            let ticketSnap = null;
            let totalTicketCount = 0;
            if (paymentType === "ticket") {
                const ticketInventorySnap = await tx.get(
                    getArcadeTicketInventoryQuery(classId, userId),
                );
                totalTicketCount = sumTicketQuantity(ticketInventorySnap);
                ticketSnap = resolveTicketSnap(ticketInventorySnap);
                if (!ticketSnap || totalTicketCount <= 0) {
                    throw new HttpsError("failed-precondition", "?????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
                }
            }
            if (
                paymentType !== "ticket" &&
        (studentSnap.data().assets?.cash || 0) < price
            )
                throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");

            // [STEP 2: ??????????????????됰엨??????????????????? ------------------------------------------
            const selectedPrize = pickPrizeByChance(gameConfig.prizes, {
                gameName: "roulette",
            });

            if ((studentSnap.data().assets?.cash || 0) < cashChargeAmount) {
                throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
            }

            const prizeValidation = validateArcadePrize(selectedPrize, {
                price,
                fieldPrefix: "roulette.prize",
                gameLabel: "룰렛",
            });

            const prizeAmount = prizeValidation.prizeAmount;
            /*
             * Legacy roulette reward validation is superseded by validateArcadePrize.
            const hasMultiplier =
                selectedPrize.multiplier !== undefined &&
                selectedPrize.multiplier !== null;
            const hasAmount =
                selectedPrize.amount !== undefined &&
                selectedPrize.amount !== null;
            const multiplierNumber = Number(selectedPrize.multiplier);
            const amountNumber = Number(selectedPrize.amount);
            const hasNonZeroMultiplier =
                Number.isFinite(multiplierNumber) && multiplierNumber !== 0;
            const hasNonZeroAmount =
                Number.isFinite(amountNumber) && amountNumber !== 0;

            if (false) {
                if (hasNonZeroMultiplier && hasNonZeroAmount) {
                    throw new HttpsError(
                        "failed-precondition",
                        "???????猷고????????money ??????????⑤벡??????????곌퇈猷??????????? multiplier ?????amount ?????????꿔꺂???⑸븶??????遺얘턁?????????耀붾굝????????????袁⑸즴筌?씛彛?????????????????????????????????????????살몝??",
                    );
                }
                if (hasNonZeroMultiplier || (hasMultiplier && !hasAmount)) {
                    const multiplier = assertNonNegativeFiniteNumber(
                        selectedPrize.multiplier,
                        "roulette.prize.multiplier",
                    );
                    prizeAmount = Math.round(price * multiplier);
                } else if (hasNonZeroAmount || (hasAmount && !hasMultiplier)) {
                    prizeAmount = assertNonNegativeFiniteNumber(
                        selectedPrize.amount,
                        "roulette.prize.amount",
                    );
                }
            } else if (false) {
                if (!String(selectedPrize.itemId || "").trim()) {
                    throw new HttpsError(
                        "failed-precondition",
                        "???????猷고????????item ??????????⑤벡??????????곌퇈猷??????????????itemId??????????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????",
                    );
                }
            } else if (false) {
                throw new HttpsError(
                    "failed-precondition",
                    "???????猷고??????????????????⑤벡??????????곌퇈猷??????????????? money ?????item ??????????濡?씀?濾?????????????거??????????",
                );
            }
            */

            let storeItemData = null,
                invSnap = null,
                itemReward = null;
            if (prizeValidation.hasItem) {
                const siRef = db.doc(
                    `classes/${classId}/storeItems/${selectedPrize.itemId}`,
                );
                const iiRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${selectedPrize.itemId}`,
                );
                const [si, ii] = await Promise.all([tx.get(siRef), tx.get(iiRef)]);
                storeItemData = si.exists ? si.data() : null;
                invSnap = ii;
            }

            // [STEP 3: ?????????????????????산뭐????WRITES)] --------------------------------------
            const nowTs = FieldValue.serverTimestamp();
            const incomeTaxSnapshot = buildArcadePrizeIncomeTax(classData, prizeAmount);
            const netPrizeAmount = incomeTaxSnapshot.netAmount;
            const netChange = netPrizeAmount - cashChargeAmount;

            // ???1. ?????癲ル슢?싩땟???????????????椰??????????????遺얘턁???????猷몄굣??????(??????????⑤벡瑜?????????
            if (paymentType === "ticket") {
                const tSnap = ticketSnap;
                consumeArcadeTicket(tx, {
                    classId,
                    userId,
                    ticketSnap: tSnap,
                    studentRef,
                    totalTicketCount,
                    note: "arcade roulette play",
                    usedBy: {
                        uid: userId,
                        name: studentSnap.data().name || "",
                        role: "student",
                    },
                });
                if (feeAmount > 0) {
                    tx.update(studentRef, {
                        "assets.cash": FieldValue.increment(-feeAmount),
                    });
                }
            } else {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(-cashChargeAmount),
                });
            }

            if (prizeAmount > 0) {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(netPrizeAmount),
                });
            }
            /*
            else if (false && selectedPrize.itemId) {
                const itemAcq = {
                    type: "arcade_reward",
                    quantity: 1,
                    acquiredAt: admin.firestore.Timestamp.now(),
                };
                const invRef = db.doc(
                    `classes/${classId}/students/${userId}/inventory/${selectedPrize.itemId}`,
                );

                if (invSnap?.exists) {
                    tx.update(invRef, {
                        quantity: FieldValue.increment(1),
                        acquisitions: FieldValue.arrayUnion(itemAcq),
                        lastAcquiredDate: nowTs,
                    });
                } else {
                    tx.set(invRef, {
                        itemId: selectedPrize.itemId,
                        itemName: storeItemData?.name || selectedPrize.label,
                        itemType: storeItemData?.itemType || "general",
                        functionTag: storeItemData?.functionTag || null,
                        quantity: 1,
                        totalAcquired: 1,
                        createdAt: nowTs,
                        acquisitions: [itemAcq],
                    });
                }
            }
            */
            // Grant item reward when configured.
            if (prizeValidation.hasItem) {
                itemReward = grantArcadeItemReward(tx, {
                    classId,
                    userId,
                    studentRef,
                    selectedPrize,
                    storeItemData,
                    inventorySnap: invSnap,
                    classData,
                    nowTs,
                    sourceType: "arcade_reward",
                    obtainedFrom: "roulette",
                });
            }

            if (!isUsageLimitExempt) {
                tx.set(
                    usageRef,
                    { roulette: { ...rouletteUsage, [today]: dailyCount + 1 } },
                    { merge: true },
                );
            }

            if (false && cashChargeAmount > 0 && arcadeSettings.incomeToTreasury === true) {
                const revenueRef = db
                    .collection(`classes/${classId}/arcade/config/revenueLogs`)
                    .doc();
                const taxRecordId = `roulette_${revenueRef.id}`;
                const taxLineId = revenueRef.id;
                const taxResult = stageTaxIncome(
                    tx,
                    classId,
                    {
                        amount: cashChargeAmount,
                        source: "arcade",
                        taxType: "arcade_revenue",
                        studentUid: userId,
                        studentName: studentSnap.data().name || null,
                        description: `???????猷고??????????????椰??????????????산뭐???????- ${studentSnap.data().name}`,
                    },
                    userId,
                    {
                        config: globalConfig,
                        planType,
                        serviceName: "arcade",
                        customId: taxRecordId,
                        aggregateMeta: {
                            group: "arcade_roulette",
                            batchKey: revenueRef.id,
                            pageKey: "arcade",
                            actorUid: userId,
                            actorName: studentSnap.data().name || null,
                            mode: "play_roulette",
                        },
                        detailLines: [
                            {
                                id: taxLineId,
                                amount: cashChargeAmount,
                                source: "arcade",
                                taxType: "arcade_revenue",
                                description: `${gameLabel} revenue`,
                                studentUid: userId,
                                studentName: studentSnap.data().name || null,
                                relatedDoc: {
                                    collection: "arcadeRevenueLogs",
                                    id: revenueRef.id,
                                },
                                externalId: taxLineId,
                                meta: {
                                    paymentType,
                                    game: "roulette",
                                },
                            },
                        ],
                        detailCollection: TAX_LINE_COLLECTION,
                    },
                );
                const isTaxRecorded = !taxResult?.skipped && !!taxResult?.id;

                tx.set(
                    revenueRef,
                    {
                        type: "roulette_fee",
                        studentUid: userId,
                        studentName: studentSnap.data().name || null,
                        amount: cashChargeAmount,
                        paymentType,
                        createdAt: nowTs,
                        ...(isTaxRecorded
                            ? {
                                taxRecord: buildTaxRecordPointer(
                                    "taxIncomes",
                                    taxRecordId,
                                    taxLineId,
                                ),
                                taxRecordedAt: nowTs,
                                taxCancelled: false,
                            }
                            : {}),
                    },
                    { merge: true },
                );
            }

            const chargeText = buildArcadeChargeText({
                paymentType,
                price,
                feeAmount,
                currencyUnit,
            });

            if (false) stageActivityLog(
                tx,
                classId,
                {
                    studentUid: userId,
                    type: netChange >= 0 ? "income" : "expense",
                    category: "arcade",
                    amount: Math.abs(netChange),
                    incomeTax: incomeTaxSnapshot.incomeTax,
                    description: `???????猷고?????????????癲ル슢?싩땟????????? ${selectedPrize.label} (${chargeText})`,
                },
                { config: globalConfig, planType, serviceName: "arcade" },
            );

            const responsePayload = {
                success: true,
                result: buildArcadeResultPayload(selectedPrize, {
                    prizeType: prizeValidation.prizeType,
                    prizeAmount,
                    itemReward,
                }),
                prizeAmount,
                netChange,
                feeAmount,
                cashChargeAmount,
                newBalance: (studentSnap.data().assets?.cash || 0) + netChange,
            };
            const activityLogData = buildArcadePlayActivityLogData({
                userId,
                netChange,
                paymentType,
                prizeAmount,
                cashChargeAmount,
                price,
                feeAmount,
                incomeTaxSnapshot,
                description: `룰렛 결과: ${selectedPrize.label} (${chargeText})`,
            });
            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "roulette",
                gameLabel: "룰렛",
                userId,
                studentName: studentSnap.data().name || null,
                paymentType,
                planType,
                incomeToTreasury: arcadeSettings.incomeToTreasury === true,
                cashChargeAmount,
                price,
                feeAmount,
                prizeAmount,
                incomeTaxSnapshot,
                activityLogData,
                globalConfig,
                nowTs,
            });
            return responsePayload;
        });
    } catch (e) {
        rethrowCallableError(e);
    }
});

/* ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
 * [??????????⑤벡瑜???????? 4. ??????????썹땟戮녹??諭????????????꾨덱???????????????????????됰뼸???????????? (drawLotto) - ??????????⑤벡??????????????????????????諛몃마嶺뚮?????????????硫λ젒?????????????????????⑤벡??????????곌퇈猷?????????????? * ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
exports.drawLotto = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
    assertTeacherOrAdmin(request.auth);

    const adminUid = request.auth.uid;
    const adminRole = request.auth.token?.role;
    const {
        classId,
        roundId,
        winningNumbers: requestedWinningNumbers,
        bonusNumber: requestedBonusNumber,
    } = request.data || {};
    if (!classId || !roundId) {
        throw new HttpsError("invalid-argument", "classId?? roundId??????????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????");
    }

    const tokenClassId = request.auth.token?.classId;
    if (adminRole === "teacher" && tokenClassId && tokenClassId !== classId) {
        throw new HttpsError("permission-denied", "???????????繹먮끍???????????耀붾굝?????????????????????????????????됰뼸?????????????????濡?씀?濾?????????????????살몝??");
    }

    // ????????癲ル슢?싩땟????????????????????????????(??? ?????????썹땟戮녹??諭?????⑸㎦??????蹂㏓???????????????)
    const roundRef = db.doc(`classes/${classId}/arcade/config/lottoRounds/${roundId}`);
    const ticketsQuery = roundRef.collection("tickets");
    const globalConfig = await getGlobalConfig();

    try {
        return await db.runTransaction(async (tx) => {
            const adminRef = db.doc(`classes/${classId}/students/${adminUid}`);
            const classRef = db.doc(`classes/${classId}`);

            const [roundSnap, adminSnap, classSnap, ticketsSnap] = await Promise.all([
                tx.get(roundRef),
                tx.get(adminRef),
                tx.get(classRef),
                tx.get(ticketsQuery),
            ]);

            if (!roundSnap.exists) {
                throw new HttpsError("not-found", "????????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }
            if (adminRole !== "admin" && !adminSnap.exists) {
                throw new HttpsError("permission-denied", "???????耀붾굝??????????????????????????노듋?????????????????됰뼸??????????????????????????살몝??");
            }
            if (ticketsSnap.empty) {
                throw new HttpsError("failed-precondition", "???????????????????????????濡?씀?濾?????????????????살몝??");
            }

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            assertArcadeAccessible(globalConfig, planType, arcadeSettings);

            const roundData = roundSnap.data() || {};
            if (roundData.settings?.enabled === false) {
                throw new HttpsError("failed-precondition", "????????????饔낅떽???????? ???????????????????????????????????????");
            }

            // 'closed' ?????????????????????????????됰뼸?????????????????(????? 'open'??????????????썹땟戮녹??諭?????⑸㎦????????????????????????됰뼸???????????????怨뺤떪?????????????????????????????????????????????⑤벡瑜????????
            if (!DRAWABLE_LOTTO_STATUSES.has(roundData.status)) {
                throw new HttpsError(
                    "failed-precondition",
                    "??????????????????????????????쎛 ??????椰???????????耀붾굝????????closed) ?????????????????????????????됰뼸??????????????????????????살몝??",
                );
            }

            const { maxNumber, pickCount, useBonus, prizes } = roundData.settings || {};
            const maxNumberNum = Number(maxNumber || 0);
            const pickCountNum = Number(pickCount || 0);
            const prizeRules = Array.isArray(prizes) ? prizes : [];
            if (
                maxNumberNum <= 0 ||
                pickCountNum <= 0 ||
                pickCountNum > maxNumberNum ||
                prizeRules.length === 0
            ) {
                throw new HttpsError("failed-precondition", "??????????????????????????????? ???????????????????살몝??");
            }
            prizeRules.forEach((prize, idx) => {
                if (!["money", "item"].includes(prize?.type)) {
                    throw new HttpsError(
                        "failed-precondition",
                        `lotto.prizes[${idx}]??type ???????????????????? ???????????????????살몝??`,
                    );
                }
                if (!String(prize?.label || "").trim()) {
                    throw new HttpsError(
                        "failed-precondition",
                        `lotto.prizes[${idx}]??label ?????????????????????????????????????????살몝??`,
                    );
                }
                if (prize.type === "money") {
                    assertNonNegativeFiniteNumber(
                        prize.amount || 0,
                        `lotto.prizes[${idx}].amount`,
                    );
                }
                if (
                    prize.type === "item" &&
          !String(prize?.itemId || "").trim()
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        `lotto.prizes[${idx}] item ??????????⑤벡??????????곌퇈猷??????????????itemId??????????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????`,
                    );
                }
            });

            const manualDraw = normalizeManualLottoDrawInput({
                winningNumbers: requestedWinningNumbers,
                bonusNumber: requestedBonusNumber,
                maxNumber: maxNumberNum,
                pickCount: pickCountNum,
                useBonus,
            });

            let winningNumbers;
            let bonusNumber;
            let drawMode = "auto";

            if (manualDraw) {
                winningNumbers = manualDraw.winningNumbers;
                bonusNumber = manualDraw.bonusNumber;
                drawMode = manualDraw.drawMode;
            } else {
                const allNumbers = [];
                const totalToDraw = useBonus ? pickCountNum + 1 : pickCountNum;

                while (allNumbers.length < totalToDraw) {
                    const num = Math.floor(Math.random() * maxNumberNum) + 1;
                    if (!allNumbers.includes(num)) allNumbers.push(num);
                }

                winningNumbers = allNumbers
                    .slice(0, pickCountNum)
                    .sort((a, b) => a - b);
                bonusNumber = useBonus ? allNumbers[pickCountNum] : null;
            }

            if (roundData.deferResults !== false) {
                const pendingResultRef = getLottoPendingResultRef(classId, roundId);
                const winnerCounts = {};
                const winners = [];
                const ticketRows = ticketsSnap.docs
                    .map((ticketDoc) => ({
                        ticketDoc,
                        ticket: ticketDoc.data() || {},
                    }))
                    .filter(({ ticket }) => String(ticket.status || "active") === "active");
                const totalTickets = ticketRows.length;
                if (totalTickets <= 0) {
                    throw new HttpsError(
                        "failed-precondition",
                        "No active lotto tickets to draw.",
                    );
                }
                const ticketResults = [];

                for (const { ticketDoc, ticket } of ticketRows) {
                    const ticketNumbers = Array.isArray(ticket.numbers)
                        ? ticket.numbers
                        : [];
                    const matchCount = ticketNumbers.filter((n) =>
                        winningNumbers.includes(n),
                    ).length;
                    const hasBonus = bonusNumber
                        ? ticketNumbers.includes(bonusNumber)
                        : false;

                    let wonRankIdx = -1;
                    prizeRules.forEach((p, idx) => {
                        if (wonRankIdx !== -1) return;

                        if (idx === 0 && matchCount === pickCountNum) wonRankIdx = 0;
                        else if (useBonus) {
                            if (idx === 1 && matchCount === pickCountNum - 1 && hasBonus)
                                wonRankIdx = 1;
                            else if (idx > 1 && matchCount === pickCountNum - (idx - 1))
                                wonRankIdx = idx;
                        } else if (idx > 0 && matchCount === pickCountNum - idx) {
                            wonRankIdx = idx;
                        }
                    });

                    if (wonRankIdx !== -1) {
                        const prize = prizeRules[wonRankIdx];
                        if (!["money", "item"].includes(prize?.type)) {
                            throw new HttpsError(
                                "failed-precondition",
                                `lotto.prizes[${wonRankIdx}] type must be money or item.`,
                            );
                        }
                        const rankLabel = buildLottoRankLabel(wonRankIdx);
                        const moneyPrizeAmount =
                            prize.type === "money"
                                ? assertNonNegativeFiniteNumber(
                                    prize.amount || 0,
                                    `lotto.prizes[${wonRankIdx}].amount`,
                                )
                                : 0;
                        const resultPayload = {
                            matchCount,
                            bonusMatched: hasBonus,
                            rank: rankLabel,
                            prize: moneyPrizeAmount,
                        };

                        winnerCounts[rankLabel] = (winnerCounts[rankLabel] || 0) + 1;
                        winners.push({
                            uid: ticket.studentUid,
                            name: ticket.studentName || "student",
                            rank: rankLabel,
                            prizeLabel: prize.label || rankLabel,
                        });
                        ticketResults.push({
                            ticketId: ticketDoc.id,
                            studentUid: ticket.studentUid || null,
                            studentName: ticket.studentName || null,
                            result: resultPayload,
                            rankName: rankLabel,
                            status: "checked",
                        });
                    } else {
                        ticketResults.push({
                            ticketId: ticketDoc.id,
                            studentUid: ticket.studentUid || null,
                            studentName: ticket.studentName || null,
                            result: {
                                matchCount,
                                bonusMatched: hasBonus,
                                rank: null,
                                prize: 0,
                            },
                            rankName: null,
                            status: "checked",
                        });
                    }

                    tx.set(
                        ticketDoc.ref,
                        {
                            result: FieldValue.delete(),
                            rankName: FieldValue.delete(),
                            checkedAt: FieldValue.delete(),
                            status: "active",
                        },
                        { merge: true },
                    );
                }

                tx.set(pendingResultRef, {
                    classId,
                    roundId,
                    winningNumbers,
                    bonusNumber,
                    drawMode,
                    winnerCounts,
                    winners,
                    ticketResults,
                    totalTickets,
                    status: "pending",
                    drawnAt: FieldValue.serverTimestamp(),
                    drawnBy: adminUid,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                tx.update(roundRef, {
                    status: "finished",
                    winningNumbers: FieldValue.delete(),
                    bonusNumber: FieldValue.delete(),
                    winnerCounts: FieldValue.delete(),
                    winners: FieldValue.delete(),
                    drawMode,
                    totalTickets,
                    resultsPublished: false,
                    resultsPending: true,
                    drawnAt: FieldValue.serverTimestamp(),
                    drawnBy: adminUid,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                return {
                    success: true,
                    roundId,
                    winningNumbers,
                    bonusNumber,
                    drawMode,
                    winnerCounts,
                    winners,
                    totalTickets,
                    resultsPublished: false,
                };
            }

            const winnerCounts = {};
            const winners = [];
            const ticketRows = ticketsSnap.docs
                .map((ticketDoc) => ({
                    ticketDoc,
                    ticket: ticketDoc.data() || {},
                }))
                .filter(({ ticket }) => String(ticket.status || "active") === "active");
            const totalTickets = ticketRows.length;
            if (totalTickets <= 0) {
                throw new HttpsError(
                    "failed-precondition",
                    "No active lotto tickets to draw.",
                );
            }
            const uniqueStudentUids = [
                ...new Set(
                    ticketRows
                        .map(({ ticket }) => ticket.studentUid)
                        .filter(
                            (uid) => typeof uid === "string" && uid.trim().length > 0,
                        ),
                ),
            ];
            const studentSnapByUid = new Map();
            await Promise.all(
                uniqueStudentUids.map(async (uid) => {
                    const snap = await tx.get(
                        db.doc(`classes/${classId}/students/${uid}`),
                    );
                    studentSnapByUid.set(uid, snap);
                }),
            );

            const inventoryStateByKey = new Map();
            const storeItemDataById = new Map();
            const rewardNowTs = FieldValue.serverTimestamp();
            const itemRewardTargets = [];

            for (const { ticket } of ticketRows) {
                const ticketNumbers = Array.isArray(ticket.numbers) ? ticket.numbers : [];
                const matchCount = ticketNumbers.filter((n) =>
                    winningNumbers.includes(n),
                ).length;
                const hasBonus = bonusNumber
                    ? ticketNumbers.includes(bonusNumber)
                    : false;

                let wonRankIdx = -1;
                prizeRules.forEach((p, idx) => {
                    if (wonRankIdx !== -1) return;

                    if (idx === 0 && matchCount === pickCountNum) wonRankIdx = 0;
                    else if (useBonus) {
                        if (idx === 1 && matchCount === pickCountNum - 1 && hasBonus) {
                            wonRankIdx = 1;
                        } else if (idx > 1 && matchCount === pickCountNum - (idx - 1)) {
                            wonRankIdx = idx;
                        }
                    } else if (idx > 0 && matchCount === pickCountNum - idx) {
                        wonRankIdx = idx;
                    }
                });

                if (wonRankIdx === -1) continue;

                const prize = prizeRules[wonRankIdx];
                if (prize?.type !== "item") continue;

                const studentUid = String(ticket.studentUid || "").trim();
                const itemId = String(prize.itemId || "").trim();
                if (!studentUid || !itemId) continue;

                const inventoryKey = `${studentUid}::${itemId}`;
                itemRewardTargets.push({ inventoryKey, itemId });
            }

            const uniqueItemTargets = [
                ...new Map(
                    itemRewardTargets.map((target) => [target.inventoryKey, target]),
                ).values(),
            ];

            await Promise.all(
                uniqueItemTargets.map(async ({ inventoryKey, itemId }) => {
                    const [studentUid] = inventoryKey.split("::");
                    const inventorySnap = await tx.get(
                        db.doc(
                            `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
                        ),
                    );
                    inventoryStateByKey.set(
                        inventoryKey,
                        buildInventoryRewardState(inventorySnap),
                    );

                    if (!storeItemDataById.has(itemId)) {
                        const storeItemSnap = await tx.get(
                            db.doc(`classes/${classId}/storeItems/${itemId}`),
                        );
                        storeItemDataById.set(
                            itemId,
                            storeItemSnap.exists ? (storeItemSnap.data() || {}) : null,
                        );
                    }
                }),
            );

            for (const { ticketDoc, ticket } of ticketRows) {
                const ticketNumbers = Array.isArray(ticket.numbers) ? ticket.numbers : [];
                const matchCount = ticketNumbers.filter((n) =>
                    winningNumbers.includes(n),
                ).length;
                const hasBonus = bonusNumber
                    ? ticketNumbers.includes(bonusNumber)
                    : false;

                let wonRankIdx = -1;

                prizeRules.forEach((p, idx) => {
                    if (wonRankIdx !== -1) return;

                    if (idx === 0 && matchCount === pickCountNum) wonRankIdx = 0;
                    else if (useBonus) {
                        if (idx === 1 && matchCount === pickCountNum - 1 && hasBonus)
                            wonRankIdx = 1;
                        else if (idx > 1 && matchCount === pickCountNum - (idx - 1))
                            wonRankIdx = idx;
                    } else {
                        if (idx > 0 && matchCount === pickCountNum - idx)
                            wonRankIdx = idx;
                    }
                });

                if (wonRankIdx !== -1) {
                    const prize = prizeRules[wonRankIdx];
                    if (!["money", "item"].includes(prize?.type)) {
                        throw new HttpsError(
                            "failed-precondition",
                            `lotto.prizes[${wonRankIdx}]??type ???????????????????? ???????????????????살몝??`,
                        );
                    }
                    const rankLabel = buildLottoRankLabel(wonRankIdx);
                    const moneyPrizeAmount =
                        prize.type === "money"
                            ? assertNonNegativeFiniteNumber(
                                prize.amount || 0,
                                `lotto.prizes[${wonRankIdx}].amount`,
                            )
                            : 0;
                    const resultPayload = {
                        matchCount,
                        bonusMatched: hasBonus,
                        rank: rankLabel,
                        prize: moneyPrizeAmount,
                    };
                    const winnerStudentSnap = studentSnapByUid.get(ticket.studentUid);
                    if (!winnerStudentSnap?.exists) {
                        tx.set(
                            ticketDoc.ref,
                            {
                                result: {
                                    ...resultPayload,
                                    rank: null,
                                    prize: 0,
                                    skippedReason: "student-not-found",
                                },
                                rankName: null,
                                checkedAt: FieldValue.serverTimestamp(),
                                status: "invalid",
                            },
                            { merge: true },
                        );
                        continue;
                    }
                    const studentRef = winnerStudentSnap.ref;

                    // ?????癲ル슢?싩땟???????????????饔낅떽?????怨뚮옩鴉?????????????????????????                    winnerCounts[rankLabel] = (winnerCounts[rankLabel] || 0) + 1;

                    if (prize.type === "money") {
                        const incomeTaxSnapshot = buildArcadePrizeIncomeTax(
                            classData,
                            moneyPrizeAmount,
                        );
                        const netMoneyPrizeAmount = incomeTaxSnapshot.netAmount;
                        if (moneyPrizeAmount > 0) {
                            tx.update(studentRef, {
                                "assets.cash": FieldValue.increment(netMoneyPrizeAmount),
                            });
                        }
                    } else if (prize.type === "item" && prize.itemId) {
                        const studentUid = String(ticket.studentUid || "").trim();
                        const itemId = String(prize.itemId || "").trim();
                        const inventoryKey = `${studentUid}::${itemId}`;
                        const inventoryState =
                            inventoryStateByKey.get(inventoryKey) ||
                            buildInventoryRewardState(null);
                        inventoryStateByKey.set(inventoryKey, inventoryState);
                        const inventorySnap = {
                            exists: inventoryState.exists,
                            data: () => inventoryState.data || {},
                        };
                        const storeItemData = storeItemDataById.get(itemId) || null;

                        grantArcadeItemReward(tx, {
                            classId,
                            userId: ticket.studentUid,
                            studentRef,
                            selectedPrize: {
                                itemId,
                                label: prize.label || "당첨 상품",
                            },
                            storeItemData,
                            inventorySnap,
                            classData,
                            nowTs: rewardNowTs,
                            sourceType: "lotto_reward",
                            obtainedFrom: "lotto",
                        });
                        syncGrantedArcadeItemRewardState(inventoryState, {
                            selectedPrize: {
                                itemId,
                                label: prize.label || "당첨 상품",
                            },
                            storeItemData,
                            classData,
                            nowTs: rewardNowTs,
                            sourceType: "lotto_reward",
                            obtainedFrom: "lotto",
                        });
                    }
                    /*
                    else if (false && prize.type === "item" && prize.itemId) {
                        const itemAcq = {
                            type: "lotto_reward",
                            quantity: 1,
                            acquiredAt: admin.firestore.Timestamp.now(),
                        };
                        const inventoryRef = db
                            .collection(
                                `classes/${classId}/students/${ticket.studentUid}/inventory`,
                            )
                            .doc(prize.itemId);
                        tx.set(
                            inventoryRef,
                            {
                                itemId: prize.itemId,
                                itemName: prize.label || "당첨 상품",
                                itemType: "general",
                                quantity: FieldValue.increment(1),
                                totalAcquired: FieldValue.increment(1),
                                acquisitions: FieldValue.arrayUnion(itemAcq),
                                lastAcquiredDate: FieldValue.serverTimestamp(),
                                obtainedFrom: "lotto",
                            },
                            { merge: true },
                        );
                    }

                    */
                    tx.set(
                        ticketDoc.ref,
                        {
                            result: resultPayload,
                            rankName: rankLabel,
                            checkedAt: FieldValue.serverTimestamp(),
                            status: "checked",
                        },
                        { merge: true },
                    );
                    winners.push({
                        uid: ticket.studentUid,
                        name:
                            winnerStudentSnap.data()?.name ||
                            ticket.studentName ||
                            "student",
                        rank: rankLabel,
                        prizeLabel: prize.label || rankLabel,
                    });

                    // ????????거???????????????饔낅떽????????????????????????????????(stageActivityLog ?????????釉먮폁?????????????????????쎛 ???????嫄???????????????????거?????????????????????????
                    const incomeTaxSnapshot =
                        prize.type === "money"
                            ? buildArcadePrizeIncomeTax(classData, moneyPrizeAmount)
                            : null;
                    const netMoneyPrizeAmount = incomeTaxSnapshot?.netAmount || 0;
                    const activityLogData = buildArcadePlayActivityLogData({
                        classId,
                        userId: ticket.studentUid,
                        netChange: netMoneyPrizeAmount,
                        paymentType: "lotto_reward",
                        prizeAmount: moneyPrizeAmount,
                        cashChargeAmount: 0,
                        price: 0,
                        feeAmount: 0,
                        incomeTaxSnapshot,
                        description: `로또 ${roundId}회차 ${rankLabel} 당첨 (${prize.label})`,
                    });
                    stageArcadeSideEffects(tx, {
                        classData,
                        classId,
                        gameId: "lotto",
                        gameLabel: "로또",
                        userId: ticket.studentUid,
                        studentName:
                            winnerStudentSnap.data()?.name ||
                            ticket.studentName ||
                            null,
                        paymentType: "lotto_reward",
                        planType,
                        prizeAmount: moneyPrizeAmount,
                        incomeTaxSnapshot,
                        activityLogData,
                        globalConfig,
                    });
                } else {
                    tx.set(
                        ticketDoc.ref,
                        {
                            result: {
                                matchCount,
                                bonusMatched: hasBonus,
                                rank: null,
                                prize: 0,
                            },
                            rankName: null,
                            checkedAt: FieldValue.serverTimestamp(),
                            status: "checked",
                        },
                        { merge: true },
                    );
                }
            }

            tx.update(roundRef, {
                status: "finished",
                winningNumbers,
                bonusNumber,
                drawMode,
                winnerCounts,
                winners,
                totalTickets,
                resultsPublished: false,
                drawnAt: FieldValue.serverTimestamp(),
                drawnBy: adminUid,
            });

            return {
                success: true,
                roundId,
                winningNumbers,
                bonusNumber,
                drawMode,
                winnerCounts,
                winners,
                totalTickets,
                resultsPublished: false,
            };
        });
    } catch (e) {
        console.error("[Lotto Draw Error]:", e);
        rethrowCallableError(e);
    }
});

/* ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
 * [??????????諛몃마嶺뚮?????????????硫λ젒????????곗뿨?????? 5. ??????????썹땟戮녹??諭????????????꾨덱??????????????????????????(buyLottoTicket)
 * - ???????嫄?????????????????????????????諛몃마嶺뚮?????????????硫λ젒?????????????????椰???????????⑤벡瑜???????????????븍툖?????롮??????+ assets.ticket ???????????????????????????됰엨???????????????????됰뼸??? ??
 * ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????? */
exports.manageLottoRound = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "???????嫄?????????????釉랁닑??????????紐껊뭸?????????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????");
    }
    assertTeacherOrAdmin(request.auth);

    const callerUid = request.auth.uid;
    const callerRole = request.auth.token?.role;
    const { classId, action, roundId, round, enabled } = request.data || {};

    if (!classId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "classId?? action ???????????????????????????釉먮폁???????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????",
        );
    }
    if (!VALID_LOTTO_MANAGE_ACTIONS.has(action)) {
        throw new HttpsError("invalid-argument", "??????椰????????????????⑥レ뿥??????????????????嚥???癲??? ??????????꿔꺂???癰????action ???????????");
    }

    assertTeacherClassScopeStrict(request.auth, classId);
    const globalConfig = await getGlobalConfig();

    try {
        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const callerRef = db.doc(`classes/${classId}/students/${callerUid}`);
            const roundsRef = db.collection(`classes/${classId}/arcade/config/lottoRounds`);

            const classSnap = await tx.get(classRef);
            const arcadeConfigSnap = await tx.get(arcadeConfigRef);
            if (!classSnap.exists) {
                throw new HttpsError("not-found", "???????耀붾굝?????????????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }

            const arcadeConfigData = arcadeConfigSnap.exists ? (arcadeConfigSnap.data() || {}) : {};
            const globalLottoSettings = arcadeConfigData.games?.lotto || {};

            if (callerRole !== "admin") {
                const callerSnap = await tx.get(callerRef);
                if (!callerSnap.exists) {
                    throw new HttpsError(
                        "permission-denied",
                        "????????????耀붾굝???????????????????????????????노듋????????????????????????????????????살몝??",
                    );
                }
            }

            if (action === "create") {
                const normalized = normalizeLottoRoundSettings(round || {}, globalLottoSettings);
                const roundDocRef = roundsRef.doc();

                tx.set(roundDocRef, {
                    title: normalized.title,
                    status: "ready",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    settings: normalized.settings,
                });

                return {
                    success: true,
                    action,
                    roundId: roundDocRef.id,
                };
            }

            if (!roundId || typeof roundId !== "string") {
                throw new HttpsError("invalid-argument", "roundId ???????????????????????????釉먮폁???????? ??????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????");
            }

            const roundRef = roundsRef.doc(roundId);
            const roundSnap = await tx.get(roundRef);
            if (!roundSnap.exists) {
                throw new HttpsError("not-found", "?????????????????븐뼐?????????μ떜媛?걫???????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }
            const roundData = roundSnap.data() || {};

            if (action === "update") {
                if (roundData.status !== "ready") {
                    const updateKeys = Object.keys(round || {}).filter(
                        (key) => round[key] !== undefined,
                    );
                    const canUpdateDeadlineOnly =
                        ["open", "paused"].includes(roundData.status) &&
                        updateKeys.length > 0 &&
                        updateKeys.every((key) => key === "endTime");

                    if (canUpdateDeadlineOnly) {
                        tx.update(roundRef, {
                            "settings.endTime": normalizeLottoEndTimeValue(round.endTime),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                        return { success: true, action, roundId };
                    }

                    throw new HttpsError(
                        "failed-precondition",
                        "Only ready lotto rounds can be edited.",
                    );
                }

                const normalized = normalizeLottoRoundSettings(round || {}, globalLottoSettings);

                tx.update(roundRef, {
                    title: normalized.title,
                    settings: normalized.settings,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "open") {
                const openRoundSnap = await tx.get(
                    roundsRef.where("status", "in", ["open", "paused"]).limit(2),
                );
                if (openRoundSnap.docs.some((docSnap) => docSnap.id !== roundId)) {
                    throw new HttpsError(
                        "failed-precondition",
                        "???? ???????????????野껊챶??????????????????????????????????븐뼐?????????μ떜媛?걫????? ??????????? ??????????????????????⑤벡?????????癲ル슢?싩땟?????????????????????濡?씀?濾?????????????????살몝??",
                    );
                }

                tx.update(roundRef, {
                    status: "open",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "pause") {
                if (roundData.status !== "open") {
                    throw new HttpsError(
                        "failed-precondition",
                        "Only open lotto rounds can be paused.",
                    );
                }

                tx.update(roundRef, {
                    status: "paused",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "resume") {
                if (roundData.status !== "paused") {
                    throw new HttpsError(
                        "failed-precondition",
                        "Only paused lotto rounds can be resumed.",
                    );
                }

                const activeRoundSnap = await tx.get(
                    roundsRef.where("status", "in", ["open", "paused"]).limit(2),
                );
                if (activeRoundSnap.docs.some((docSnap) => docSnap.id !== roundId)) {
                    throw new HttpsError(
                        "failed-precondition",
                        "Another lotto round is already active.",
                    );
                }

                tx.update(roundRef, {
                    status: "open",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "close") {
                if (["closed", "finished"].includes(roundData.status)) {
                    return {
                        success: true,
                        action,
                        roundId,
                        alreadyClosed: true,
                    };
                }

                if (!["open", "paused"].includes(roundData.status)) {
                    throw new HttpsError(
                        "failed-precondition",
                        "open ?????????????????????????????椰???????????耀붾굝????????????????????????썹땟戮녹??諭?????⑸㎦?????????? ?????????????????????살몝??",
                    );
                }

                tx.update(roundRef, {
                    status: "closed",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId };
            }

            if (action === "delete") {
                tx.delete(roundRef);
                return { success: true, action, roundId };
            }

            if (action === "publish_results") {
                if (roundData.status !== "finished") {
                    throw new HttpsError(
                        "failed-precondition",
                        "Only finished lotto rounds can publish results.",
                    );
                }

                const pendingResultRef = getLottoPendingResultRef(classId, roundId);
                const pendingResultSnap = await tx.get(pendingResultRef);

                if (!pendingResultSnap.exists) {
                    if (roundData.resultsPublished === true) {
                        return {
                            success: true,
                            action,
                            roundId,
                            alreadyPublished: true,
                        };
                    }

                    tx.update(roundRef, {
                        resultsPublished: true,
                        resultsPending: false,
                        publishedAt: FieldValue.serverTimestamp(),
                        publishedBy: callerUid,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                    return { success: true, action, roundId, legacyPublish: true };
                }

                const pendingResult = pendingResultSnap.data() || {};
                const ticketResults = Array.isArray(pendingResult.ticketResults)
                    ? pendingResult.ticketResults
                    : [];
                const prizeRules = Array.isArray(roundData.settings?.prizes)
                    ? roundData.settings.prizes
                    : [];
                const classData = classSnap.data() || {};
                const planType = classData.planType || "FREE";

                const winningTicketResults = ticketResults.filter(
                    (ticketResult) => ticketResult?.rankName || ticketResult?.result?.rank,
                );
                const uniqueWinnerUids = [
                    ...new Set(
                        winningTicketResults
                            .map((ticketResult) =>
                                String(ticketResult?.studentUid || "").trim(),
                            )
                            .filter(Boolean),
                    ),
                ];
                const studentSnapByUid = new Map();
                await Promise.all(
                    uniqueWinnerUids.map(async (uid) => {
                        const snap = await tx.get(
                            db.doc(`classes/${classId}/students/${uid}`),
                        );
                        studentSnapByUid.set(uid, snap);
                    }),
                );

                const itemRewardTargets = [];
                winningTicketResults.forEach((ticketResult) => {
                    const rankNumber = Number(
                        String(ticketResult?.rankName || ticketResult?.result?.rank || "")
                            .match(/\d+/)?.[0] || 0,
                    );
                    const prize = prizeRules[rankNumber - 1];
                    const studentUid = String(ticketResult?.studentUid || "").trim();
                    const itemId = String(prize?.itemId || "").trim();
                    if (
                        prize?.type === "item" &&
                        studentUid &&
                        itemId &&
                        studentSnapByUid.get(studentUid)?.exists
                    ) {
                        itemRewardTargets.push({
                            inventoryKey: `${studentUid}::${itemId}`,
                            itemId,
                        });
                    }
                });

                const inventoryStateByKey = new Map();
                const storeItemDataById = new Map();
                const uniqueItemTargets = [
                    ...new Map(
                        itemRewardTargets.map((target) => [
                            target.inventoryKey,
                            target,
                        ]),
                    ).values(),
                ];

                await Promise.all(
                    uniqueItemTargets.map(async ({ inventoryKey, itemId }) => {
                        const [studentUid] = inventoryKey.split("::");
                        const inventorySnap = await tx.get(
                            db.doc(
                                `classes/${classId}/students/${studentUid}/inventory/${itemId}`,
                            ),
                        );
                        inventoryStateByKey.set(
                            inventoryKey,
                            buildInventoryRewardState(inventorySnap),
                        );

                        if (!storeItemDataById.has(itemId)) {
                            const storeItemSnap = await tx.get(
                                db.doc(`classes/${classId}/storeItems/${itemId}`),
                            );
                            storeItemDataById.set(
                                itemId,
                                storeItemSnap.exists ? (storeItemSnap.data() || {}) : null,
                            );
                        }
                    }),
                );

                const rewardNowTs = FieldValue.serverTimestamp();
                for (const ticketResult of ticketResults) {
                    const ticketId = String(ticketResult?.ticketId || "").trim();
                    if (!ticketId) continue;

                    const rankNumber = Number(
                        String(ticketResult?.rankName || ticketResult?.result?.rank || "")
                            .match(/\d+/)?.[0] || 0,
                    );
                    const prize = prizeRules[rankNumber - 1] || null;
                    const studentUid = String(ticketResult?.studentUid || "").trim();
                    const ticketRef = roundRef.collection("tickets").doc(ticketId);
                    const hasPrize = !!prize && rankNumber > 0;
                    const winnerStudentSnap = studentSnapByUid.get(studentUid);

                    if (hasPrize && !winnerStudentSnap?.exists) {
                        tx.set(
                            ticketRef,
                            {
                                result: {
                                    ...(ticketResult.result || {}),
                                    rank: null,
                                    prize: 0,
                                    skippedReason: "student-not-found",
                                },
                                rankName: null,
                                checkedAt: FieldValue.serverTimestamp(),
                                status: "invalid",
                            },
                            { merge: true },
                        );
                        continue;
                    }

                    tx.set(
                        ticketRef,
                        {
                            result: ticketResult.result || {
                                matchCount: 0,
                                bonusMatched: false,
                                rank: null,
                                prize: 0,
                            },
                            rankName: ticketResult.rankName || null,
                            checkedAt: FieldValue.serverTimestamp(),
                            status: ticketResult.status || "checked",
                        },
                        { merge: true },
                    );

                    if (!hasPrize) continue;

                    const studentRef = winnerStudentSnap.ref;
                    const moneyPrizeAmount =
                        prize.type === "money"
                            ? assertNonNegativeFiniteNumber(
                                prize.amount || 0,
                                `lotto.prizes[${rankNumber - 1}].amount`,
                            )
                            : 0;

                    if (prize.type === "money") {
                        const incomeTaxSnapshot = buildArcadePrizeIncomeTax(
                            classData,
                            moneyPrizeAmount,
                        );
                        const netMoneyPrizeAmount = incomeTaxSnapshot.netAmount;
                        if (moneyPrizeAmount > 0) {
                            tx.update(studentRef, {
                                "assets.cash": FieldValue.increment(netMoneyPrizeAmount),
                            });
                        }
                    } else if (prize.type === "item" && prize.itemId) {
                        const itemId = String(prize.itemId || "").trim();
                        const inventoryKey = `${studentUid}::${itemId}`;
                        const inventoryState =
                            inventoryStateByKey.get(inventoryKey) ||
                            buildInventoryRewardState(null);
                        inventoryStateByKey.set(inventoryKey, inventoryState);
                        const inventorySnap = {
                            exists: inventoryState.exists,
                            data: () => inventoryState.data || {},
                        };
                        const storeItemData = storeItemDataById.get(itemId) || null;

                        grantArcadeItemReward(tx, {
                            classId,
                            userId: studentUid,
                            studentRef,
                            selectedPrize: {
                                itemId,
                                label: prize.label || "당첨 상품",
                            },
                            storeItemData,
                            inventorySnap,
                            classData,
                            nowTs: rewardNowTs,
                            sourceType: "lotto_reward",
                            obtainedFrom: "lotto",
                        });
                        syncGrantedArcadeItemRewardState(inventoryState, {
                            selectedPrize: {
                                itemId,
                                label: prize.label || "당첨 상품",
                            },
                            storeItemData,
                            classData,
                            nowTs: rewardNowTs,
                            sourceType: "lotto_reward",
                            obtainedFrom: "lotto",
                        });
                    }

                    const incomeTaxSnapshot =
                        prize.type === "money"
                            ? buildArcadePrizeIncomeTax(classData, moneyPrizeAmount)
                            : null;
                    const netMoneyPrizeAmount = incomeTaxSnapshot?.netAmount || 0;
                    const activityLogData = buildArcadePlayActivityLogData({
                        classId,
                        userId: studentUid,
                        netChange: netMoneyPrizeAmount,
                        paymentType: "lotto_reward",
                        prizeAmount: moneyPrizeAmount,
                        cashChargeAmount: 0,
                        price: 0,
                        feeAmount: 0,
                        incomeTaxSnapshot,
                        description: `로또 ${roundId}회차 ${ticketResult.rankName} 당첨 (${prize.label})`,
                    });
                    stageArcadeSideEffects(tx, {
                        classData,
                        classId,
                        gameId: "lotto",
                        gameLabel: "로또",
                        userId: studentUid,
                        studentName: winnerStudentSnap.data()?.name || null,
                        paymentType: "lotto_reward",
                        planType,
                        prizeAmount: moneyPrizeAmount,
                        incomeTaxSnapshot,
                        activityLogData,
                        globalConfig,
                    });
                }

                tx.update(roundRef, {
                    winningNumbers: Array.isArray(pendingResult.winningNumbers)
                        ? pendingResult.winningNumbers
                        : [],
                    bonusNumber: pendingResult.bonusNumber ?? null,
                    drawMode: pendingResult.drawMode || "auto",
                    winnerCounts: pendingResult.winnerCounts || {},
                    winners: Array.isArray(pendingResult.winners)
                        ? pendingResult.winners.filter((winner) => {
                            const uid = String(winner?.uid || "").trim();
                            return !uid || studentSnapByUid.get(uid)?.exists;
                        })
                        : [],
                    totalTickets: Number(pendingResult.totalTickets || 0),
                    resultsPublished: true,
                    resultsPending: false,
                    publishedAt: FieldValue.serverTimestamp(),
                    publishedBy: callerUid,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                tx.delete(pendingResultRef);
                return { success: true, action, roundId };
            }

            if (action === "set_enabled") {
                if (typeof enabled !== "boolean") {
                    throw new HttpsError(
                        "invalid-argument",
                        "set_enabled ????????????enabled(boolean)????????????諛몃마嶺뚮?????????????硫λ젒?????????거??????????",
                    );
                }

                tx.update(roundRef, {
                    "settings.enabled": enabled,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: true, action, roundId, enabled };
            }

            throw new HttpsError("invalid-argument", "??????椰????????????????⑥レ뿥??????????????????嚥???癲??? ??????????꿔꺂???癰????action ???????????");
        });
    } catch (e) {
        console.error("[Lotto Manage Error]:", e);
        rethrowCallableError(e);
    }
});

exports.buyLottoTicket = onCall(ARCADE_OPTS, async (request) => {
    // 1. ???????嫄?????????????釉랁닑??????????紐껊뭸?????????嫄????????????
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "???????嫄?????????????釉랁닑??????????紐껊뭸?????????????諛몃마嶺뚮?????????????硫λ젒???????????거??????????????????????????????????살몖????????????????살몝??");
    }

    const userId = request.auth.uid;
    const { classId, numbers, paymentType = "cash" } = request.data || {};

    if (!classId || !numbers || !Array.isArray(numbers)) {
        throw new HttpsError("invalid-argument", "???????????????????????????????????????????살몝??");
    }
    assertPaymentType(paymentType);

    const globalConfig = await getGlobalConfig();
    const isUsageLimitExempt = isArcadeUsageLimitExempt(request.auth);

    try {
        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const roundsRef = db.collection(
                `classes/${classId}/arcade/config/lottoRounds`,
            );
            const studentRef = db.doc(`classes/${classId}/students/${userId}`);
            const usageRef = db.doc(`classes/${classId}/arcade/config/usage/${userId}`);
            const [classSnap, arcadeConfigSnap, openRoundQuery, studentSnap, usageSnap] = await Promise.all([
                tx.get(classRef),
                tx.get(arcadeConfigRef),
                tx.get(roundsRef.where("status", "==", "open").limit(1)),
                tx.get(studentRef),
                tx.get(usageRef),
            ]);

            const classData = classSnap.data() || {};
            const currencyUnit = resolveClassCurrencyUnit(classData);
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.data() || {};
            const lottoGameConfig = arcadeConfig.games?.lotto || {};
            assertArcadeAccessible(globalConfig, planType, arcadeSettings);

            if (openRoundQuery.empty) {
                throw new HttpsError("failed-precondition", "??????????諛몃마嶺뚮?????????????硫λ젒????????椰????????????釉먮폁??????????????????野껊챶??????????????????????????????????????????????????????쎛 ??????????濡?씀?濾?????????????????살몝??");
            }

            const roundSnap = openRoundQuery.docs[0];
            const roundData = roundSnap.data() || {};
            const settings = roundData.settings;

            if (!settings) {
                throw new HttpsError("failed-precondition", "??????????????????????????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }
            if (settings.enabled === false || lottoGameConfig.enabled === false) {
                throw new HttpsError("failed-precondition", "????????????饔낅떽???????? ???????????????????????????????????????");
            }

            const usageData = usageSnap.exists ? usageSnap.data() : {};
            assertGamePaymentAllowed("lotto", lottoGameConfig, paymentType);
            const lottoUsage = usageData.lotto || {};
            const today = getToday();
            const weekStart = getWeekStart();
            const dailyCount = Number(lottoUsage[today] || 0);
            const weeklyCount = Object.entries(lottoUsage)
                .filter(([date]) => date >= weekStart)
                .reduce((sum, [, count]) => sum + Number(count || 0), 0);
            const dailyLimitNum = Number(lottoGameConfig.dailyLimit || 0);
            const weeklyLimitNum = Number(lottoGameConfig.weeklyLimit || 0);

            if (!isUsageLimitExempt && dailyLimitNum > 0 && dailyCount >= dailyLimitNum) {
                throw new HttpsError(
                    "resource-exhausted",
                    "????????釉먮폁??????????????????????????????거?????????????????????????????????살몝??",
                );
            }
            if (!isUsageLimitExempt && weeklyLimitNum > 0 && weeklyCount >= weeklyLimitNum) {
                throw new HttpsError(
                    "resource-exhausted",
                    "?????????????????????????????거?????????????????????????????????살몝??",
                );
            }

            if (settings.endTime) {
                const now = Date.now();
                const end = new Date(settings.endTime).getTime();
                if (now > end) {
                    throw new HttpsError(
                        "failed-precondition",
                        "????????????????遺얘턁???????????????????쎛 ???? ??????椰???????????耀붾굝????????????????? ??????????????????????????????????????????嫄?????????",
                    );
                }
            }

            const pickCountNum = Number(settings.pickCount || 0);
            const maxNumberNum = Number(settings.maxNumber || 0);
            if (pickCountNum <= 0 || maxNumberNum <= 0 || pickCountNum > maxNumberNum) {
                throw new HttpsError("failed-precondition", "??????????????????????????????? ???????????????????살몝??");
            }

            const normalizedNumbers = numbers.map((n) => Number(n));
            if (normalizedNumbers.some((n) => !Number.isInteger(n))) {
                throw new HttpsError("invalid-argument", "????????????嫄???????????????濚밸Ŧ援??????????? ???????????????????살몝??");
            }

            if (normalizedNumbers.length !== pickCountNum) {
                throw new HttpsError(
                    "invalid-argument",
                    `??????????????⑥レ뿥???????????${pickCountNum}??????????????????????????濡?씀?濾????ㅼ굡????????????거??????????`,
                );
            }
            const outOfRange = normalizedNumbers.some(
                (n) => n < 1 || n > maxNumberNum,
            );
            if (outOfRange) {
                throw new HttpsError(
                    "invalid-argument",
                    `1????????μ떜媛?걫??????${maxNumberNum} ???????????????????μ떜媛?걫??????????????????????????????????????????ㅼ뒧???嫄??????????????????살몝??`,
                );
            }
            const isDuplicate = new Set(normalizedNumbers).size !== normalizedNumbers.length;
            if (isDuplicate) {
                throw new HttpsError("invalid-argument", "??????????野껊챶?????????????????????????????? ???????????거?????????????????????????????살몝??");
            }

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "?????????????嫄??????????????????椰??????????????????????濡?씀?濾?????????????????살몝??");
            }
            const studentData = studentSnap.data() || {};
            const price = assertNonNegativeFiniteNumber(
                lottoGameConfig.price ?? 500,
                "lotto.settings.price",
            );
            const feeAmount = assertNonNegativeFiniteNumber(
                lottoGameConfig.feeAmount ?? 0,
                "lotto.settings.feeAmount",
            );
            const cashChargeAmount = getArcadeCashChargeAmount({
                paymentType,
                price,
                feeAmount,
            });
            let totalTicketCount = 0;
            let consumedTicketSnap = null;

            if ((studentData.assets?.cash || 0) < cashChargeAmount) {
                throw new HttpsError("failed-precondition", "???????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
            }

            // 4. ?????癲ル슢?싩땟???????????????椰??????????????遺얘턁???????猷몄굣??????????????????됰엨???????(??????????⑤벡瑜???????????)
            if (paymentType === "ticket") {
                const ticketSnap = await tx.get(
                    getArcadeTicketInventoryQuery(classId, userId),
                );

                consumedTicketSnap = resolveTicketSnap(ticketSnap);
                if (!consumedTicketSnap) {
                    throw new HttpsError("failed-precondition", "??????????⑤벡??????????????거?????????????????????????????????????μ떜媛?걫????????????????????癲???????????????????살몝??");
                }
                totalTicketCount = sumTicketQuantity(ticketSnap);
                consumeArcadeTicket(tx, {
                    classId,
                    userId,
                    ticketSnap: consumedTicketSnap,
                    studentRef,
                    totalTicketCount,
                    note: "arcade lotto play",
                    usedBy: {
                        uid: userId,
                        name: studentData.name || "",
                        role: "student",
                    },
                });
                if (feeAmount > 0) {
                    tx.update(studentRef, {
                        "assets.cash": FieldValue.increment(-feeAmount),
                    });
                }
            } else {
                tx.update(studentRef, {
                    "assets.cash": FieldValue.increment(-cashChargeAmount),
                });
            }

            // 5. ????????????????熬곣뫖利당춯??쎾퐲???????????(???????tickets ????????거????????????遺얘턁?????꿔꺂?????諛ㅻ???????????癲ル슢?싩땟?????????
            const ticketRef = roundSnap.ref.collection("tickets").doc();
            const sortedNumbers = [...normalizedNumbers].sort((a, b) => a - b);
            const nowTs = FieldValue.serverTimestamp();
            const usageDate = getToday();
            const consumedTicketData = consumedTicketSnap?.data?.() || null;

            tx.set(ticketRef, {
                studentUid: userId,
                studentName: studentData.name || "student",
                numbers: sortedNumbers,
                purchasedAt: nowTs,
                paymentType,
                price,
                feeAmount,
                cashChargeAmount,
                usageDate,
                ...(consumedTicketSnap
                    ? {
                        sourceTicketInventoryPath: consumedTicketSnap.ref.path,
                        sourceTicketInventoryId: consumedTicketSnap.id,
                    }
                    : {}),
                ...(consumedTicketData
                    ? {
                        ticketInventory: {
                            itemId: consumedTicketData.itemId || consumedTicketSnap.id,
                            itemName: consumedTicketData.itemName || "Arcade Ticket",
                            itemType: consumedTicketData.itemType || "ticket",
                            functionTag: consumedTicketData.functionTag || null,
                            price: Number(consumedTicketData.price || 0),
                            currencyType: consumedTicketData.currencyType || "cash",
                            currencyUnit: consumedTicketData.currencyUnit || null,
                            isGiftAllowed: consumedTicketData.isGiftAllowed !== false,
                        },
                        ticketUnitValue: Number(consumedTicketData.price || 0),
                    }
                    : {}),
                roundId: roundSnap.id,
                status: "active",
            });
            tx.update(roundSnap.ref, {
                ticketCount: FieldValue.increment(1),
                updatedAt: nowTs,
            });
            if (!isUsageLimitExempt) {
                tx.set(
                    usageRef,
                    { lotto: { ...lottoUsage, [usageDate]: dailyCount + 1 } },
                    { merge: true },
                );
            }

            if (false && arcadeSettings.incomeToTreasury === true && cashChargeAmount > 0) {
                stageArcadeRevenue(tx, {
                    classId,
                    userId,
                    studentName: studentData.name || null,
                    gameId: "lotto",
                    classData,
                    gameLabel: "로또",
                    amount: cashChargeAmount,
                    paymentType,
                    nowTs: FieldValue.serverTimestamp(),
                    globalConfig,
                    planType,
                });
            }

            const responsePayload = {
                success: true,
                ticketId: ticketRef.id,
                numbers: sortedNumbers,
                feeAmount,
                cashChargeAmount,
            };
            const chargeText = buildArcadeChargeText({
                paymentType,
                price,
                feeAmount,
                currencyUnit,
            });
            const activityLogData = buildArcadePlayActivityLogData({
                userId,
                netChange: -cashChargeAmount,
                paymentType,
                prizeAmount: 0,
                cashChargeAmount,
                price,
                feeAmount,
                description: `로또 티켓 구매: ${sortedNumbers.join(", ")} (${chargeText})`,
            });
            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "lotto",
                gameLabel: "로또",
                userId,
                studentName: studentData.name || null,
                paymentType,
                planType,
                incomeToTreasury: arcadeSettings.incomeToTreasury === true,
                cashChargeAmount,
                price,
                feeAmount,
                prizeAmount: 0,
                activityLogData,
                globalConfig,
                nowTs,
            });
            return responsePayload;
        });
    } catch (e) {
        console.error(`[Lotto Purchase Error in ${classId}]:`, e.message);
        rethrowCallableError(e);
    }
});

exports.refundLottoTicket = onCall(ARCADE_OPTS, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    assertTeacherOrAdmin(request.auth);

    const callerUid = request.auth.uid;
    const { classId, roundId, ticketId } = request.data || {};
    if (!classId || !roundId || !ticketId) {
        throw new HttpsError(
            "invalid-argument",
            "classId, roundId, and ticketId are required.",
        );
    }
    assertTeacherClassScopeStrict(request.auth, classId);

    const globalConfig = await getGlobalConfig();

    try {
        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const arcadeConfigRef = db.doc(`classes/${classId}/arcade/config`);
            const roundRef = db.doc(
                `classes/${classId}/arcade/config/lottoRounds/${roundId}`,
            );
            const ticketRef = roundRef.collection("tickets").doc(ticketId);

            const [classSnap, arcadeConfigSnap, roundSnap, ticketSnap] =
                await Promise.all([
                    tx.get(classRef),
                    tx.get(arcadeConfigRef),
                    tx.get(roundRef),
                    tx.get(ticketRef),
                ]);

            if (!classSnap.exists) {
                throw new HttpsError("not-found", "Class not found.");
            }
            if (!roundSnap.exists) {
                throw new HttpsError("not-found", "Lotto round not found.");
            }
            if (!ticketSnap.exists) {
                throw new HttpsError("not-found", "Lotto ticket not found.");
            }

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const arcadeSettings = classData.services?.arcade || {};
            const arcadeConfig = arcadeConfigSnap.data() || {};
            const lottoGameConfig = arcadeConfig.games?.lotto || {};
            const roundData = roundSnap.data() || {};
            const ticketData = ticketSnap.data() || {};
            const ticketStatus = String(ticketData.status || "active");
            const studentUid = String(ticketData.studentUid || "").trim();
            if (!studentUid) {
                throw new HttpsError(
                    "failed-precondition",
                    "Lotto ticket has no student owner.",
                );
            }
            if (ticketStatus !== "active") {
                throw new HttpsError(
                    "failed-precondition",
                    "Only active lotto tickets can be refunded.",
                );
            }

            assertArcadeAccessible(globalConfig, planType, arcadeSettings);
            assertLottoRoundRefundable(roundData);

            const studentRef = db.doc(
                `classes/${classId}/students/${studentUid}`,
            );
            const usageRef = db.doc(
                `classes/${classId}/arcade/config/usage/${studentUid}`,
            );
            const charge = resolveLottoTicketCharge(ticketData, lottoGameConfig);
            let targetTicketInventoryRef = null;
            let targetTicketInventorySnap = null;

            if (charge.paymentType === "ticket") {
                targetTicketInventoryRef = getLottoRefundInventoryRef(
                    classId,
                    studentUid,
                    ticketData,
                );
                if (targetTicketInventoryRef) {
                    targetTicketInventorySnap = await tx.get(targetTicketInventoryRef);
                }

                if (!targetTicketInventorySnap?.exists) {
                    const ticketInventoryQuery = await tx.get(
                        getArcadeTicketInventoryQuery(classId, studentUid),
                    );
                    const fallbackSnap = resolveTicketSnap(ticketInventoryQuery);
                    if (fallbackSnap) {
                        targetTicketInventoryRef = fallbackSnap.ref;
                        targetTicketInventorySnap = fallbackSnap;
                    }
                }

                if (!targetTicketInventoryRef) {
                    targetTicketInventoryRef = db.doc(
                        `classes/${classId}/students/${studentUid}/inventory/arcade_ticket_refund`,
                    );
                }
            }

            const [studentSnap, usageSnap] = await Promise.all([
                tx.get(studentRef),
                tx.get(usageRef),
            ]);

            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "Student not found.");
            }

            const nowTs = FieldValue.serverTimestamp();
            const usageData = usageSnap.exists ? usageSnap.data() || {} : {};
            const lottoUsage = usageData.lotto || {};
            const usageDate = getLottoTicketUsageDate(ticketData);
            const currentUsageCount = Number(lottoUsage[usageDate] || 0);
            const studentUpdates = {};
            if (charge.cashRefundAmount > 0) {
                studentUpdates["assets.cash"] = FieldValue.increment(
                    charge.cashRefundAmount,
                );
            }

            let restoredTicketItemValue = 0;
            if (charge.paymentType === "ticket") {
                const restoreResult = restoreRefundedArcadeTicket(tx, {
                    ticketId,
                    ticketData: {
                        ...ticketData,
                        roundId,
                    },
                    inventoryRef: targetTicketInventoryRef,
                    inventorySnap: targetTicketInventorySnap,
                    nowTs,
                });
                restoredTicketItemValue = restoreResult.itemValue || 0;
                studentUpdates["assets.ticket"] = FieldValue.increment(1);
                if (restoredTicketItemValue > 0) {
                    studentUpdates["assets.itemValue"] = FieldValue.increment(
                        restoredTicketItemValue,
                    );
                }
            }

            if (Object.keys(studentUpdates).length > 0) {
                tx.update(studentRef, studentUpdates);
            }

            tx.set(
                usageRef,
                {
                    lotto: {
                        ...lottoUsage,
                        [usageDate]: Math.max(currentUsageCount - 1, 0),
                    },
                },
                { merge: true },
            );

            tx.update(roundRef, {
                ticketCount: Math.max(Number(roundData.ticketCount || 0) - 1, 0),
                refundedTicketCount: FieldValue.increment(1),
                updatedAt: nowTs,
            });

            tx.update(ticketRef, {
                status: "refunded",
                refundedAt: nowTs,
                refundedBy: callerUid,
                refund: {
                    cashRefundAmount: charge.cashRefundAmount,
                    restoredTicket:
                        charge.paymentType === "ticket" ? 1 : 0,
                    restoredTicketItemValue,
                    usageDate,
                },
                updatedAt: nowTs,
            });

            const refundParts = [];
            if (charge.cashRefundAmount > 0) {
                refundParts.push(`${charge.cashRefundAmount} 현금`);
            }
            if (charge.paymentType === "ticket") {
                refundParts.push("이용권 1장");
            }
            const activityLogData = buildArcadePlayActivityLogData({
                userId: studentUid,
                netChange: charge.cashRefundAmount,
                paymentType: charge.paymentType,
                prizeAmount: 0,
                cashChargeAmount: 0,
                price: charge.price,
                feeAmount: charge.feeAmount,
                description: `로또 티켓 환불: ${(ticketData.numbers || []).join(", ")} (${refundParts.join(" + ") || "환불 금액 없음"})`,
            });
            stageArcadeSideEffects(tx, {
                classData,
                classId,
                gameId: "lotto",
                gameLabel: "로또",
                userId: studentUid,
                studentName: ticketData.studentName || studentSnap.data()?.name || null,
                paymentType: charge.paymentType,
                planType,
                activityLogData,
                globalConfig,
                nowTs,
            });

            return {
                success: true,
                roundId,
                ticketId,
                studentUid,
                cashRefundAmount: charge.cashRefundAmount,
                restoredTicket: charge.paymentType === "ticket" ? 1 : 0,
            };
        });
    } catch (e) {
        console.error(`[Lotto Refund Error in ${classId}]:`, e.message);
        rethrowCallableError(e);
    }
});

