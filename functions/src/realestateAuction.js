const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const { readRealEstateLayout, stageRealEstateLayout, runRealEstateTransaction } = require("../utils/realEstateStorage");
const { FieldValue } = admin.firestore;
const { getFunctions } = require("firebase-admin/functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onTaskDispatched } = require("firebase-functions/v2/tasks");
const { stageActivityLog } = require("../utils/logUtils");
const { getGlobalConfig } = require("../utils/planManager");
const { isClassFundOwnedDesk } = require("../utils/classFundRealEstatePolicy");
const {
    addCalendarDaysInKST,
    endOfDayInKST,
    startOfDayInKST,
    toDate,
} = require("../utils/dateUtils");

const REAL_ESTATE_ADMIN_TOKEN_KEY = "a_rst";
const DEFAULT_AUCTION_DURATION_DAYS = 3;
const DEFAULT_PAYMENT_DUE_DAYS = 3;
const DEFAULT_FORECLOSURE_START_RATE = 80;
const DEFAULT_PUBLIC_START_RATE = 100;
const DEFAULT_BID_STEP_RATE = 5;
const REAL_ESTATE_REGION = "asia-northeast3";
const AUCTION_ACTIVATION_TASK_FUNCTION = "activateQueuedRealEstateAuctionTask";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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
        throw new HttpsError("permission-denied", "다른 학급 데이터에는 접근할 수 없습니다.");
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

const findDeskLocation = (groups, deskId) => {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const desks = Array.isArray(groups[groupIndex]?.desks) ? groups[groupIndex].desks : [];
        const deskIndex = desks.findIndex((desk) => desk?.id === deskId);
        if (deskIndex !== -1) {
            return {
                groupIndex,
                deskIndex,
                desk: desks[deskIndex],
            };
        }
    }

    return { groupIndex: -1, deskIndex: -1, desk: null };
};

const replaceDeskInGroups = (groups, groupIndex, deskIndex, nextDesk) => {
    const updatedGroups = Array.isArray(groups) ? [...groups] : [];
    const targetGroup = { ...(updatedGroups[groupIndex] || {}) };
    const updatedDesks = Array.isArray(targetGroup.desks) ? [...targetGroup.desks] : [];
    updatedDesks[deskIndex] = nextDesk;
    targetGroup.desks = updatedDesks;
    updatedGroups[groupIndex] = targetGroup;
    return updatedGroups;
};

const resolveStudentName = (studentData, fallback = "익명") => {
    const candidate = String(
        studentData?.name || studentData?.displayName || studentData?.email || fallback,
    ).trim();
    return candidate || fallback;
};

const resolveAuctionPricing = ({ desk, startPrice, bidStep, defaultStartRate }) => {
    const basePrice = Math.max(1, Math.round(Number(desk?.lastPurchasePrice || desk?.price || 0)));
    const suggestedStartPrice = Math.max(1, Math.round(basePrice * (Number(defaultStartRate || 0) / 100)));
    const parsedStartPrice = Math.floor(Number(startPrice));
    const resolvedStartPrice =
        Number.isFinite(parsedStartPrice) && parsedStartPrice > 0 ? parsedStartPrice : suggestedStartPrice;
    const parsedBidStep = Math.floor(Number(bidStep));
    const resolvedBidStep =
        Number.isFinite(parsedBidStep) && parsedBidStep > 0
            ? parsedBidStep
            : Math.max(1, Math.round(resolvedStartPrice * (DEFAULT_BID_STEP_RATE / 100)));

    return {
        basePrice,
        startPrice: resolvedStartPrice,
        bidStep: resolvedBidStep,
    };
};

const resolveAuctionEndAt = (endAt, fallbackDays = DEFAULT_AUCTION_DURATION_DAYS) => {
    const fallbackDate = addCalendarDaysInKST(new Date(), fallbackDays) || new Date();
    const resolvedEndAt = endOfDayInKST(endAt || fallbackDate);

    if (!resolvedEndAt) {
        throw new HttpsError("invalid-argument", "경매 마감일을 확인할 수 없습니다.");
    }
    if (resolvedEndAt.getTime() <= Date.now()) {
        throw new HttpsError("failed-precondition", "경매 마감일은 현재 시각 이후여야 합니다.");
    }

    return resolvedEndAt;
};

const resolveAuctionDateTime = (value, { fieldLabel = "일시", isEnd = false } = {}) => {
    if (!value) return null;

    const text = typeof value === "string" ? value.trim() : "";
    if (text && DATE_KEY_RE.test(text)) {
        const parsed = isEnd ? endOfDayInKST(text) : startOfDayInKST(text);
        if (parsed) return parsed;
    }

    const parsed = toDate(value);
    if (!parsed) {
        throw new HttpsError("invalid-argument", `${fieldLabel}을 확인할 수 없습니다.`);
    }

    return parsed;
};

const resolveAuctionSchedule = ({
    startAt = null,
    endAt = null,
    now = new Date(),
    fallbackDays = DEFAULT_AUCTION_DURATION_DAYS,
    requireEndAt = true,
    allowFallbackEndAt = false,
} = {}) => {
    const resolvedStartAt = resolveAuctionDateTime(startAt, {
        fieldLabel: "경매 시작 일시",
        isEnd: false,
    });

    let resolvedEndAt = resolveAuctionDateTime(endAt, {
        fieldLabel: "경매 마감 일시",
        isEnd: true,
    });

    if (!resolvedEndAt) {
        if (allowFallbackEndAt) {
            const fallbackDate = addCalendarDaysInKST(now, fallbackDays) || now;
            resolvedEndAt = endOfDayInKST(fallbackDate);
        } else if (requireEndAt) {
            throw new HttpsError("invalid-argument", "경매 마감 일시가 필요합니다.");
        }
    }

    if (!resolvedEndAt) {
        return {
            resolvedStartAt,
            resolvedEndAt: null,
            startsImmediately: !resolvedStartAt || resolvedStartAt.getTime() <= now.getTime(),
        };
    }

    if (resolvedStartAt && resolvedEndAt.getTime() <= resolvedStartAt.getTime()) {
        throw new HttpsError("failed-precondition", "경매 마감 일시는 시작 일시보다 늦어야 합니다.");
    }

    const startsImmediately = !resolvedStartAt || resolvedStartAt.getTime() <= now.getTime();
    const minimumEndMs = startsImmediately ? now.getTime() : resolvedStartAt.getTime();

    if (resolvedEndAt.getTime() <= minimumEndMs) {
        throw new HttpsError("failed-precondition", "경매 마감 일시는 진행 시작 이후여야 합니다.");
    }

    return {
        resolvedStartAt,
        resolvedEndAt,
        startsImmediately,
    };
};

const getAuctionActivationTaskQueue = () =>
    getFunctions().taskQueue(`locations/${REAL_ESTATE_REGION}/functions/${AUCTION_ACTIVATION_TASK_FUNCTION}`);

const buildAuctionActivationTaskId = (auctionId) =>
    `activate_${String(auctionId || "").replace(/[^A-Za-z0-9_-]/g, "_")}`;

const enqueueQueuedAuctionActivation = async ({
    classId,
    auctionId,
    scheduledStartAt,
}) => {
    if (!classId || !auctionId || !(scheduledStartAt instanceof Date)) {
        return false;
    }

    try {
        await getAuctionActivationTaskQueue().enqueue(
            {
                classId,
                auctionId,
                scheduledStartAt: scheduledStartAt.toISOString(),
            },
            {
                id: buildAuctionActivationTaskId(auctionId),
                scheduleTime: scheduledStartAt,
                dispatchDeadlineSeconds: 300,
            },
        );
        return true;
    } catch (error) {
        if (error?.code === "functions/task-already-exists") {
            return true;
        }

        console.error("[realestateAuction] failed to enqueue activation task:", {
            classId,
            auctionId,
            message: error?.message || String(error),
        });
        return false;
    }
};

const buildDeskAuctionSummary = ({
    auctionId,
    source,
    status,
    startPrice,
    currentBid = 0,
    bidStep,
    startAt = null,
    endAt = null,
    highestBidName = null,
    paymentDueAt = null,
}) => {
    const summary = {
        auctionId,
        source,
        status,
        startPrice,
        currentBid,
        bidStep,
    };

    if (highestBidName) summary.highestBidName = highestBidName;
    if (startAt) summary.startAt = admin.firestore.Timestamp.fromDate(startAt);
    if (endAt) summary.endAt = admin.firestore.Timestamp.fromDate(endAt);
    if (paymentDueAt) summary.paymentDueAt = admin.firestore.Timestamp.fromDate(paymentDueAt);

    return summary;
};

const buildAuctionSettlement = ({ config, finalPrice }) => {
    const safeFinalPrice = Math.max(0, Math.floor(Number(finalPrice || 0)));
    const acquisitionTaxRate =
        config?.acquisitionTaxEnabled === false ? 0 : Math.max(0, Number(config?.acquisitionTaxRate || 0));
    const acquisitionTax = Math.floor(safeFinalPrice * (acquisitionTaxRate / 100));
    const officialPriceRatio = Number.isFinite(Number(config?.officialPriceRatio))
        ? Number(config.officialPriceRatio)
        : 70;
    const officialPrice = Math.max(0, Math.floor(safeFinalPrice * (officialPriceRatio / 100)));

    return {
        finalPrice: safeFinalPrice,
        acquisitionTaxRate,
        acquisitionTax,
        totalDue: safeFinalPrice + acquisitionTax,
        officialPrice,
    };
};

const buildAuctionDoc = ({
    classId,
    desk,
    source,
    status,
    actorUid,
    actorName,
    startPrice,
    bidStep,
    scheduledStartAt = null,
    endAt = null,
    originalOwnerUid = null,
    originalOwnerName = null,
    foreclosureReason = "",
}) => {
    const now = new Date();
    const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
    const docData = {
        classId,
        deskId: desk.id,
        deskLabel: getResolvedDeskLabel(desk),
        deskNumber: desk?.number ?? null,
        occupantUid: desk?.studentId || null,
        occupantName: desk?.studentName || null,
        source,
        status,
        startPrice,
        bidStep,
        currentBid: 0,
        highestBidUid: null,
        highestBidName: null,
        bidCount: 0,
        createdByUid: actorUid,
        createdByName: actorName,
        createdAt: nowTimestamp,
        updatedAt: nowTimestamp,
        originalOwnerUid,
        originalOwnerName,
        foreclosureReason: foreclosureReason || "",
    };

    if (status === "queued") docData.queuedAt = nowTimestamp;
    if (scheduledStartAt) docData.scheduledStartAt = admin.firestore.Timestamp.fromDate(scheduledStartAt);
    if (endAt) docData.endAt = admin.firestore.Timestamp.fromDate(endAt);
    if (status === "active" && endAt) {
        docData.startedAt = nowTimestamp;
    }

    return docData;
};

const activateQueuedAuctionInTransaction = ({
    transaction,
    auctionRef,
    auctionId,
    auction,
    layoutRef,
    groups,
    location,
    targetDesk,
    now,
    nowTimestamp,
    requestedEndAt = null,
}) => {
    const { resolvedEndAt } = resolveAuctionSchedule({
        endAt: auction?.endAt || requestedEndAt || null,
        now,
        allowFallbackEndAt: true,
    });

    transaction.set(
        auctionRef,
        {
            status: "active",
            startedAt: nowTimestamp,
            endAt: admin.firestore.Timestamp.fromDate(resolvedEndAt),
            updatedAt: nowTimestamp,
        },
        { merge: true },
    );

    const nextDesk = {
        ...targetDesk,
        auctionSummary: buildDeskAuctionSummary({
            auctionId,
            source: auction.source,
            status: "active",
            startPrice: auction.startPrice,
            currentBid: Number(auction.currentBid || 0),
            bidStep: auction.bidStep,
            startAt: now,
            endAt: resolvedEndAt,
            highestBidName: auction.highestBidName || null,
        }),
        foreclosureInfo: targetDesk.foreclosureInfo
            ? {
                ...targetDesk.foreclosureInfo,
                status: "auction_active",
            }
            : targetDesk.foreclosureInfo || null,
    };

    stageRealEstateLayout(transaction, layoutRef, {
        groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { resolvedEndAt };
};

const clearAuctionStateFromDesk = (desk, { keepForeclosureInfo = false } = {}) => ({
    ...desk,
    auctionSummary: null,
    foreclosureInfo: keepForeclosureInfo ? desk.foreclosureInfo || null : null,
});
exports.updateRealEstateAuctionState = onCall(async (request) => {
    const { classId, action, payload = {} } = request.data || {};

    if (!classId || !action) {
        throw new HttpsError("invalid-argument", "classId와 action은 필수입니다.");
    }

    const actorCtx = getRealEstateAuthContext(request, classId);
    const actorUid = actorCtx.uid;
    const globalConfig = await getGlobalConfig();

    const result = await runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const configRef = db.doc(`classes/${classId}/real_estate/config`);
        const actorRef = db.doc(`classes/${classId}/students/${actorUid}`);
        const classRef = db.doc(`classes/${classId}`);

        const [layoutSnap, configSnap, actorSnap, classSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(configRef),
            transaction.get(actorRef),
            transaction.get(classRef),
        ]);

        if (!layoutSnap.exists) {
            throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        }
        if (!actorCtx.isAdmin && !actorSnap.exists) {
            throw new HttpsError("permission-denied", "같은 학급 구성원만 처리할 수 있습니다.");
        }

        const config = configSnap.data() || {};
        const classData = classSnap.exists ? classSnap.data() || {} : {};
        if (config.enabled === false) {
            throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        }

        const actorData = actorSnap.exists ? actorSnap.data() : {};
        const actorName = resolveStudentName(actorData, request.auth.token?.name || "익명");
        const logContext = {
            config: globalConfig,
            planType: classData.planType || "FREE",
            serviceName: "realestate",
        };
        const groups = Array.isArray(layoutSnap.data()?.groups) ? layoutSnap.data().groups : [];
        const now = new Date();
        const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
        const nowIso = now.toISOString();

        if (action === "manual_foreclosure") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "압류 권한이 없습니다.");
            }

            const { deskId, mode = "queue", reason = "수동 압류", startPrice, bidStep, endAt } = payload || {};
            const startAt = payload?.startAt || null;
            if (!deskId) {
                throw new HttpsError("invalid-argument", "deskId가 필요합니다.");
            }

            const location = findDeskLocation(groups, deskId);
            const targetDesk = location.desk;
            if (!targetDesk) {
                throw new HttpsError("not-found", "압류할 자리를 찾을 수 없습니다.");
            }
            if (!targetDesk.ownerId) {
                throw new HttpsError("failed-precondition", "국유 자리는 압류할 수 없습니다.");
            }
            if (isClassFundOwnedDesk(targetDesk)) {
                throw new HttpsError(
                    "failed-precondition",
                    "기금 소유 부동산은 압류 경매로 등록할 수 없습니다.",
                );
            }
            if (targetDesk.auctionSummary?.auctionId) {
                throw new HttpsError("failed-precondition", "이미 경매 상태인 자리입니다.");
            }

            let auctionStatus = mode === "auction_now" ? "active" : "queued";
            const pricing = resolveAuctionPricing({
                desk: targetDesk,
                startPrice,
                bidStep,
                defaultStartRate: DEFAULT_FORECLOSURE_START_RATE,
            });
            let scheduledStartAt = null;
            let resolvedEndAt = null;
            if (mode === "auction_now") {
                const schedule = resolveAuctionSchedule({
                    endAt,
                    now,
                    requireEndAt: true,
                });
                resolvedEndAt = schedule.resolvedEndAt;
            } else {
                if (!startAt || !endAt) {
                    throw new HttpsError(
                        "invalid-argument",
                        "경매 대기는 시작 일시와 마감 일시를 함께 설정해야 합니다.",
                    );
                }
                const schedule = resolveAuctionSchedule({
                    startAt,
                    endAt,
                    now,
                    requireEndAt: true,
                });
                if (schedule.startsImmediately) {
                    throw new HttpsError(
                        "failed-precondition",
                        "경매 대기 시작 일시는 현재 시각보다 이후여야 합니다.",
                    );
                }
                scheduledStartAt = schedule.resolvedStartAt;
                resolvedEndAt = schedule.resolvedEndAt;
            }
            const auctionRef = db.collection(`classes/${classId}/real_estate_auctions`).doc();

            transaction.set(
                auctionRef,
                buildAuctionDoc({
                    classId,
                    desk: targetDesk,
                    source: "foreclosure",
                    status: auctionStatus,
                    actorUid,
                    actorName,
                    startPrice: pricing.startPrice,
                    bidStep: pricing.bidStep,
                    scheduledStartAt,
                    endAt: resolvedEndAt,
                    originalOwnerUid: targetDesk.ownerId,
                    originalOwnerName: targetDesk.ownerName || "이름 없음",
                    foreclosureReason: reason,
                }),
            );

            const nextDesk = {
                ...targetDesk,
                ownerId: null,
                ownerName: null,
                ownerSinceAt: null,
                ownerSource: "foreclosure",
                ownerUpdatedAt: nowIso,
                tradeStatus: "idle",
                isForSale: false,
                askingPrice: 0,
                buyerId: null,
                contractState: null,
                auctionSummary: buildDeskAuctionSummary({
                    auctionId: auctionRef.id,
                    source: "foreclosure",
                    status: auctionStatus,
                    startPrice: pricing.startPrice,
                    currentBid: 0,
                    bidStep: pricing.bidStep,
                    startAt: auctionStatus === "active" ? now : scheduledStartAt,
                    endAt: resolvedEndAt,
                }),
                foreclosureInfo: {
                    status: auctionStatus === "active" ? "auction_active" : "queued",
                    reason,
                    foreclosedAt: nowIso,
                    foreclosedByUid: actorUid,
                    foreclosedByName: actorName,
                    originalOwnerUid: targetDesk.ownerId,
                    originalOwnerName: targetDesk.ownerName || "이름 없음",
                    auctionId: auctionRef.id,
                },
            };

            stageRealEstateLayout(transaction, layoutRef, {
                groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return {
                success: true,
                action,
                auctionId: auctionRef.id,
                source: "foreclosure",
                status: auctionStatus,
                activationTask:
                    auctionStatus === "queued" && scheduledStartAt
                        ? {
                            classId,
                            auctionId: auctionRef.id,
                            scheduledStartAt,
                        }
                        : null,
            };
        }

        if (action === "create_public") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "공공 경매 등록 권한이 없습니다.");
            }

            const { deskId, startPrice, bidStep, endAt } = payload || {};
            if (!deskId) {
                throw new HttpsError("invalid-argument", "deskId가 필요합니다.");
            }

            const location = findDeskLocation(groups, deskId);
            const targetDesk = location.desk;
            if (!targetDesk) {
                throw new HttpsError("not-found", "경매 등록할 자리를 찾을 수 없습니다.");
            }
            if (targetDesk.ownerId) {
                throw new HttpsError("failed-precondition", "국유 자리만 공공 경매로 등록할 수 있습니다.");
            }
            if (targetDesk.foreclosureInfo?.status) {
                throw new HttpsError("failed-precondition", "압류 자산은 공공 경매로 등록할 수 없습니다.");
            }
            if (targetDesk.auctionSummary?.auctionId) {
                throw new HttpsError("failed-precondition", "이미 경매 상태인 자리입니다.");
            }

            const pricing = resolveAuctionPricing({
                desk: targetDesk,
                startPrice,
                bidStep,
                defaultStartRate: DEFAULT_PUBLIC_START_RATE,
            });
            const schedule = resolveAuctionSchedule({
                startAt: payload?.startAt || null,
                endAt,
                now,
                requireEndAt: true,
            });
            const publicAuctionStatus = schedule.startsImmediately ? "active" : "queued";
            const scheduledStartAt = schedule.startsImmediately ? null : schedule.resolvedStartAt;
            const resolvedEndAt = schedule.resolvedEndAt;
            const auctionRef = db.collection(`classes/${classId}/real_estate_auctions`).doc();

            transaction.set(
                auctionRef,
                buildAuctionDoc({
                    classId,
                    desk: targetDesk,
                    source: "public",
                    status: publicAuctionStatus,
                    actorUid,
                    actorName,
                    startPrice: pricing.startPrice,
                    bidStep: pricing.bidStep,
                    scheduledStartAt,
                    endAt: resolvedEndAt,
                }),
            );

            const nextDesk = {
                ...targetDesk,
                tradeStatus: "idle",
                isForSale: false,
                askingPrice: 0,
                buyerId: null,
                contractState: null,
                auctionSummary: buildDeskAuctionSummary({
                    auctionId: auctionRef.id,
                    source: "public",
                    status: publicAuctionStatus,
                    startPrice: pricing.startPrice,
                    currentBid: 0,
                    bidStep: pricing.bidStep,
                    startAt: publicAuctionStatus === "active" ? now : scheduledStartAt,
                    endAt: resolvedEndAt,
                }),
            };

            stageRealEstateLayout(transaction, layoutRef, {
                groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return {
                success: true,
                action,
                auctionId: auctionRef.id,
                source: "public",
                status: publicAuctionStatus,
                activationTask:
                    publicAuctionStatus === "queued" && scheduledStartAt
                        ? {
                            classId,
                            auctionId: auctionRef.id,
                            scheduledStartAt,
                        }
                        : null,
            };
        }

        const { auctionId } = payload || {};
        if (!auctionId) {
            throw new HttpsError("invalid-argument", "auctionId가 필요합니다.");
        }

        const auctionRef = db.doc(`classes/${classId}/real_estate_auctions/${auctionId}`);
        const auctionSnap = await transaction.get(auctionRef);
        if (!auctionSnap.exists) {
            throw new HttpsError("not-found", "경매 정보를 찾을 수 없습니다.");
        }
        const auction = auctionSnap.data() || {};
        const location = findDeskLocation(groups, auction.deskId);
        const targetDesk = location.desk;
        if (!targetDesk && !["delete_record", "archive_record"].includes(action)) {
            throw new HttpsError("not-found", "경매 대상 자리를 찾을 수 없습니다.");
        }

        if (action === "activate_queued") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "경매 시작 권한이 없습니다.");
            }
            if (auction.status !== "queued") {
                throw new HttpsError("failed-precondition", "경매대기 상태에서만 시작할 수 있습니다.");
            }
            const scheduledStartAt = toDate(auction.scheduledStartAt);
            if (scheduledStartAt && scheduledStartAt.getTime() > now.getTime()) {
                throw new HttpsError("failed-precondition", "예약된 시작 시각 전에는 수동으로 시작할 수 없습니다.");
            }

            activateQueuedAuctionInTransaction({
                transaction,
                auctionRef,
                auctionId,
                auction,
                layoutRef,
                groups,
                location,
                targetDesk,
                now,
                nowTimestamp,
                requestedEndAt: payload?.endAt || null,
            });

            return { success: true, action, auctionId, status: "active" };
        }
        if (action === "place_bid") {
            if (!actorSnap.exists) {
                throw new HttpsError("permission-denied", "학생만 입찰할 수 있습니다.");
            }
            if (auction.status !== "active") {
                throw new HttpsError("failed-precondition", "진행 중인 경매가 아닙니다.");
            }

            const auctionEndAt = toDate(auction.endAt);
            if (!auctionEndAt || auctionEndAt.getTime() <= now.getTime()) {
                throw new HttpsError("failed-precondition", "이미 마감된 경매입니다. 먼저 경매를 정산해 주세요.");
            }

            await ensureNoOverdueHoldingTaxBills(transaction, classId, actorUid);

            const actorCash = Math.max(0, Number(actorData?.assets?.cash || 0));
            const bidAmount = Math.floor(Number(payload.bidAmount));
            const minimumBid = auction.currentBid > 0
                ? Number(auction.currentBid || 0) + Math.max(1, Number(auction.bidStep || 1))
                : Math.max(1, Number(auction.startPrice || 1));

            if (!Number.isFinite(bidAmount) || bidAmount < minimumBid) {
                throw new HttpsError("invalid-argument", `입찰가는 최소 ${minimumBid.toLocaleString()} 이상이어야 합니다.`);
            }
            if (actorCash < bidAmount) {
                throw new HttpsError("resource-exhausted", `잔액이 부족합니다. (필요 금액: ${bidAmount.toLocaleString()})`);
            }

            const bidderName = resolveStudentName(actorData, request.auth.token?.name || "익명");
            const bidRef = db.collection(`classes/${classId}/real_estate_auctions/${auctionId}/bids`).doc();
            transaction.set(bidRef, {
                bidderUid: actorUid,
                bidderName,
                bidAmount,
                createdAt: nowTimestamp,
            });

            transaction.set(
                auctionRef,
                {
                    currentBid: bidAmount,
                    highestBidUid: actorUid,
                    highestBidName: bidderName,
                    bidCount: FieldValue.increment(1),
                    lastBidAt: nowTimestamp,
                    updatedAt: nowTimestamp,
                },
                { merge: true },
            );

            const nextDesk = {
                ...targetDesk,
                auctionSummary: buildDeskAuctionSummary({
                    auctionId,
                    source: auction.source,
                    status: "active",
                    startPrice: auction.startPrice,
                    currentBid: bidAmount,
                    bidStep: auction.bidStep,
                    endAt: toDate(auction.endAt),
                    highestBidName: bidderName,
                }),
            };

            stageRealEstateLayout(transaction, layoutRef, {
                groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return {
                success: true,
                action,
                auctionId,
                bidAmount,
                minimumBid,
            };
        }

        if (action === "close") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "경매 마감 권한이 없습니다.");
            }
            if (auction.status !== "active") {
                throw new HttpsError("failed-precondition", "진행 중인 경매만 마감할 수 있습니다.");
            }

            if (Number(auction.bidCount || 0) > 0 && auction.highestBidUid) {
                const settlement = buildAuctionSettlement({
                    config,
                    finalPrice: auction.currentBid,
                });
                const paymentDueAt = endOfDayInKST(
                    addCalendarDaysInKST(now, DEFAULT_PAYMENT_DUE_DAYS) || now,
                );

                transaction.set(
                    auctionRef,
                    {
                        status: "awaiting_payment",
                        winnerUid: auction.highestBidUid,
                        winnerName: auction.highestBidName || null,
                        finalPrice: settlement.finalPrice,
                        paymentDueAt: admin.firestore.Timestamp.fromDate(paymentDueAt),
                        settlement,
                        closedAt: nowTimestamp,
                        updatedAt: nowTimestamp,
                    },
                    { merge: true },
                );

                const nextDesk = {
                    ...targetDesk,
                    auctionSummary: buildDeskAuctionSummary({
                        auctionId,
                        source: auction.source,
                        status: "awaiting_payment",
                        startPrice: auction.startPrice,
                        currentBid: settlement.finalPrice,
                        bidStep: auction.bidStep,
                        highestBidName: auction.highestBidName || null,
                        paymentDueAt,
                    }),
                    foreclosureInfo: targetDesk.foreclosureInfo
                        ? {
                            ...targetDesk.foreclosureInfo,
                            status: "awaiting_payment",
                        }
                        : targetDesk.foreclosureInfo || null,
                };

                stageRealEstateLayout(transaction, layoutRef, {
                    groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                    updatedAt: FieldValue.serverTimestamp(),
                });

                return {
                    success: true,
                    action,
                    auctionId,
                    status: "awaiting_payment",
                    totalDue: settlement.totalDue,
                };
            }

            if (auction.source === "foreclosure") {
                transaction.set(
                    auctionRef,
                    {
                        status: "queued",
                        currentBid: 0,
                        highestBidUid: null,
                        highestBidName: null,
                        bidCount: 0,
                        queuedAt: nowTimestamp,
                        requeuedAt: nowTimestamp,
                        updatedAt: nowTimestamp,
                        scheduledStartAt: FieldValue.delete(),
                        startedAt: FieldValue.delete(),
                        endAt: FieldValue.delete(),
                        lastBidAt: FieldValue.delete(),
                        paymentDueAt: FieldValue.delete(),
                        settlement: FieldValue.delete(),
                        winnerUid: FieldValue.delete(),
                        winnerName: FieldValue.delete(),
                        finalPrice: FieldValue.delete(),
                    },
                    { merge: true },
                );

                const nextDesk = {
                    ...targetDesk,
                    auctionSummary: buildDeskAuctionSummary({
                        auctionId,
                        source: auction.source,
                        status: "queued",
                        startPrice: auction.startPrice,
                        currentBid: 0,
                        bidStep: auction.bidStep,
                    }),
                    foreclosureInfo: targetDesk.foreclosureInfo
                        ? {
                            ...targetDesk.foreclosureInfo,
                            status: "queued",
                        }
                        : targetDesk.foreclosureInfo || null,
                };

                stageRealEstateLayout(transaction, layoutRef, {
                    groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                    updatedAt: FieldValue.serverTimestamp(),
                });

                return { success: true, action, auctionId, status: "queued" };
            }

            transaction.set(
                auctionRef,
                {
                    status: "ended_no_bid",
                    closedAt: nowTimestamp,
                    updatedAt: nowTimestamp,
                },
                { merge: true },
            );
            stageRealEstateLayout(transaction, layoutRef, {
                groups: replaceDeskInGroups(
                    groups,
                    location.groupIndex,
                    location.deskIndex,
                    clearAuctionStateFromDesk(targetDesk),
                ),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return { success: true, action, auctionId, status: "ended_no_bid" };
        }

        if (action === "cancel") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "경매 취소 권한이 없습니다.");
            }
            if (["settled", "cancelled", "ended_no_bid"].includes(auction.status)) {
                throw new HttpsError("failed-precondition", "이미 종료된 경매입니다.");
            }

            transaction.set(
                auctionRef,
                {
                    status: "cancelled",
                    cancelledAt: nowTimestamp,
                    cancelledByUid: actorUid,
                    cancelledByName: actorName,
                    updatedAt: nowTimestamp,
                },
                { merge: true },
            );

            const nextDesk = auction.source === "foreclosure"
                ? {
                    ...clearAuctionStateFromDesk(targetDesk, { keepForeclosureInfo: true }),
                    foreclosureInfo: targetDesk.foreclosureInfo
                        ? {
                            ...targetDesk.foreclosureInfo,
                            status: "foreclosed",
                        }
                        : targetDesk.foreclosureInfo || null,
                }
                : clearAuctionStateFromDesk(targetDesk);

            stageRealEstateLayout(transaction, layoutRef, {
                groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return { success: true, action, auctionId, status: "cancelled" };
        }
        if (action === "delete_record") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "경매 기록 삭제 권한이 없습니다.");
            }

            if (auction.source !== "public") {
                throw new HttpsError("failed-precondition", "공공 경매 기록만 삭제할 수 있습니다.");
            }

            if (!["cancelled", "ended_no_bid"].includes(auction.status)) {
                throw new HttpsError("failed-precondition", "취소되었거나 유찰된 경매만 삭제할 수 있습니다.");
            }

            if (Number(auction.bidCount || 0) > 0 || auction.highestBidUid || auction.winnerUid || auction.settlement) {
                throw new HttpsError("failed-precondition", "입찰 또는 정산 이력이 있는 경매 기록은 삭제할 수 없습니다.");
            }

            if (targetDesk?.auctionSummary?.auctionId === auctionId) {
                stageRealEstateLayout(transaction, layoutRef, {
                    groups: replaceDeskInGroups(
                        groups,
                        location.groupIndex,
                        location.deskIndex,
                        clearAuctionStateFromDesk(targetDesk),
                    ),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            transaction.delete(auctionRef);

            return { success: true, action, auctionId, deleted: true };
        }
        if (action === "archive_record") {
            if (!actorCtx.canManageRealEstate) {
                throw new HttpsError("permission-denied", "경매 기록 보관 권한이 없습니다.");
            }

            if (["queued", "active", "awaiting_payment"].includes(auction.status)) {
                throw new HttpsError("failed-precondition", "진행 중이거나 결제 대기 중인 경매는 보관할 수 없습니다.");
            }

            transaction.set(
                auctionRef,
                {
                    isArchived: true,
                    archivedAt: nowTimestamp,
                    archivedByUid: actorUid,
                    archivedByName: actorName,
                    updatedAt: nowTimestamp,
                },
                { merge: true },
            );

            return { success: true, action, auctionId, archived: true };
        }
        if (action === "pay") {
            if (auction.status !== "awaiting_payment") {
                throw new HttpsError("failed-precondition", "낙찰자 결제 대기 상태가 아닙니다.");
            }
            if (!actorCtx.canManageRealEstate && auction.winnerUid !== actorUid) {
                throw new HttpsError("permission-denied", "낙찰자만 결제할 수 있습니다.");
            }

            const winnerUid = auction.winnerUid;
            if (!winnerUid) {
                throw new HttpsError("failed-precondition", "낙찰자 정보가 없습니다.");
            }

            const winnerRef = db.doc(`classes/${classId}/students/${winnerUid}`);
            const winnerSnap = await transaction.get(winnerRef);
            if (!winnerSnap.exists) {
                throw new HttpsError("not-found", "낙찰자 정보를 찾을 수 없습니다.");
            }

            const winnerData = winnerSnap.data() || {};
            const winnerName = resolveStudentName(winnerData, auction.winnerName || "익명");
            const settlement = auction.settlement && typeof auction.settlement === "object"
                ? auction.settlement
                : buildAuctionSettlement({ config, finalPrice: auction.currentBid });
            const resolvedDeskLabel = auction.deskLabel || getResolvedDeskLabel(targetDesk);
            const unnamedOwnerFallback = "\uC774\uB984 \uC5C6\uC74C";
            const originalOwnerUid = auction.source === "foreclosure"
                ? String(
                    auction.originalOwnerUid ||
                    targetDesk?.foreclosureInfo?.originalOwnerUid ||
                    "",
                ).trim()
                : "";
            const originalOwnerName = auction.source === "foreclosure"
                ? String(
                    auction.originalOwnerName ||
                    targetDesk?.foreclosureInfo?.originalOwnerName ||
                    "ì´ë¦„ ì—†ìŒ",
                ).trim() || "ì´ë¦„ ì—†ìŒ"
                : null;
            const totalDue = Math.max(0, Number(settlement.totalDue || 0));
            const winnerCash = Math.max(0, Number(winnerData?.assets?.cash || 0));

            if (winnerCash < totalDue) {
                throw new HttpsError("resource-exhausted", `잔액이 부족합니다. (필요 금액: ${totalDue.toLocaleString()})`);
            }

            transaction.update(winnerRef, {
                "assets.cash": FieldValue.increment(-totalDue),
            });

            const nextDesk = {
                ...targetDesk,
                ownerId: winnerUid,
                ownerName: winnerName,
                ownerSinceAt: nowIso,
                ownerSource: auction.source === "foreclosure" ? "foreclosure_auction" : "public_auction",
                ownerUpdatedAt: nowIso,
                lastPurchasePrice: settlement.finalPrice,
                price: settlement.officialPrice,
                tradeStatus: "idle",
                isForSale: false,
                askingPrice: 0,
                buyerId: null,
                contractState: null,
                auctionSummary: null,
                foreclosureInfo: null,
                hasTradeHistory: true,
            };

            stageRealEstateLayout(transaction, layoutRef, {
                groups: replaceDeskInGroups(groups, location.groupIndex, location.deskIndex, nextDesk),
                updatedAt: FieldValue.serverTimestamp(),
            });

            transaction.set(
                auctionRef,
                {
                    status: "settled",
                    buyerUid: winnerUid,
                    buyerName: winnerName,
                    settledAt: nowTimestamp,
                    paidAt: nowTimestamp,
                    updatedAt: nowTimestamp,
                },
                { merge: true },
            );

            const ledgerRef = db.collection(`classes/${classId}/real_estate/ledger/transactions`).doc();
            stageActivityLog(transaction, classId, {
                studentUid: winnerUid,
                type: "expense",
                category: "real_estate",
                subCategory: "auction_purchase",
                amount: totalDue,
                description: auction.source === "foreclosure"
                    ? `${resolvedDeskLabel} ì••ë¥˜ ê²½ë§¤ ë‚™ì°° ì™„ë£Œ (ë‚™ì°°ê°€: ${settlement.finalPrice}, ì·¨ë“ì„¸: ${settlement.acquisitionTax})`
                    : `${resolvedDeskLabel} ê³µê³µ ê²½ë§¤ ë‚™ì°° ì™„ë£Œ (ë‚™ì°°ê°€: ${settlement.finalPrice}, ì·¨ë“ì„¸: ${settlement.acquisitionTax})`,
                currency: "class_currency",
                relatedDoc: { collection: "real_estate_ledger", id: ledgerRef.id },
            }, logContext);

            if (originalOwnerUid) {
                stageActivityLog(transaction, classId, {
                    studentUid: originalOwnerUid,
                    type: "expense",
                    category: "real_estate",
                    subCategory: "auction_sale",
                    amount: 0,
                    description: `${resolvedDeskLabel} ì••ë¥˜ ê²½ë§¤ ë§¤ê° ì™„ë£Œ (ë‚™ì°°ê°€: ${settlement.finalPrice})`,
                    currency: "class_currency",
                    relatedDoc: { collection: "real_estate_ledger", id: ledgerRef.id },
                    note: auction.foreclosureReason || "",
                }, logContext);
            }
            transaction.set(ledgerRef, {
                type: "auction_sale",
                source: auction.source,
                deskId: auction.deskId,
                deskLabel: resolvedDeskLabel,
                buyerId: winnerUid,
                buyerName: winnerName,
                sellerId: "STATE",
                previousOwnerId: originalOwnerUid || null,
                previousOwnerName: originalOwnerName,
                sellerName: auction.source === "foreclosure" ? "압류 자산" : "국가",
                amount: settlement.finalPrice,
                finalPrice: settlement.finalPrice,
                acquisitionTax: settlement.acquisitionTax,
                totalDue,
                auctionId,
                timestamp: FieldValue.serverTimestamp(),
            });

            return {
                success: true,
                action,
                auctionId,
                status: "settled",
                totalDue,
            };
        }

        throw new HttpsError("invalid-argument", "지원하지 않는 경매 action입니다.");
    });

    if (result?.activationTask) {
        const taskScheduled = await enqueueQueuedAuctionActivation(result.activationTask);
        result.taskScheduled = taskScheduled;
        delete result.activationTask;
    }

    return result;
});

exports.activateQueuedRealEstateAuctionTask = onTaskDispatched(
    {
        region: REAL_ESTATE_REGION,
        memory: "256MiB",
        timeoutSeconds: 300,
        retryConfig: {
            maxAttempts: 5,
            minBackoffSeconds: 60,
            maxDoublings: 5,
        },
        rateLimits: {
            maxConcurrentDispatches: 20,
        },
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        const auctionId = String(request.data?.auctionId || "").trim();
        const expectedScheduledStartAt = toDate(request.data?.scheduledStartAt);

        if (!classId || !auctionId || !expectedScheduledStartAt) {
            console.warn("[activateQueuedRealEstateAuctionTask] invalid payload:", request.data || null);
            return;
        }

        const classRef = db.doc(`classes/${classId}`);
        const auctionRef = classRef.collection("real_estate_auctions").doc(auctionId);
        const configRef = classRef.collection("real_estate").doc("config");
        const configSnap = await configRef.get();

        if (configSnap.exists && configSnap.data()?.enabled === false) {
            return;
        }

        const now = new Date();
        const activated = await runRealEstateTransaction(db, async (transaction) => {
            const layoutRef = classRef.collection("real_estate").doc("layout");
            const [layoutSnap, auctionSnap] = await Promise.all([
                readRealEstateLayout(db, layoutRef, transaction),
                transaction.get(auctionRef),
            ]);

            if (!layoutSnap.exists || !auctionSnap.exists) {
                return false;
            }

            const latestAuction = auctionSnap.data() || {};
            const latestScheduledStartAt = toDate(latestAuction?.scheduledStartAt);

            if (
                String(latestAuction?.status || "") !== "queued" ||
                !latestScheduledStartAt ||
                latestScheduledStartAt.getTime() > now.getTime()
            ) {
                return false;
            }

            if (latestScheduledStartAt.getTime() !== expectedScheduledStartAt.getTime()) {
                return false;
            }

            const groups = Array.isArray(layoutSnap.data()?.groups) ? layoutSnap.data().groups : [];
            const location = findDeskLocation(groups, latestAuction.deskId);
            const targetDesk = location.desk;
            if (!targetDesk) {
                return false;
            }

            activateQueuedAuctionInTransaction({
                transaction,
                auctionRef,
                auctionId,
                auction: latestAuction,
                layoutRef,
                groups,
                location,
                targetDesk,
                now,
                nowTimestamp: admin.firestore.Timestamp.fromDate(now),
            });

            return true;
        });

        if (activated) {
            console.log(`[activateQueuedRealEstateAuctionTask] activated auction ${auctionId} in class ${classId}.`);
        }
    },
);
