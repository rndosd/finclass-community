"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { onCallWithMaintenance: onCall } = require("../utils/maintenanceRequestHttps");
const logger = require("firebase-functions/logger");
const admin = require("../firebaseAdminCompat");
const { stageActivityLog } = require("../utils/logUtils");
const { getGlobalConfig } = require("../utils/planManager");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());
const FieldValue = admin.firestore.FieldValue;

const getKSTMidnight = (date = new Date()) => {
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(date.getTime() + kstOffset);
    return new Date(Date.UTC(kstDate.getUTCFullYear(), kstDate.getUTCMonth(), kstDate.getUTCDate()));
};

const toDateOrNull = (value, options = {}) => {
    if (value == null || value === "") return null;
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        if (options.isEndDate) {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
        return admin.firestore.Timestamp.fromDate(date);
    } catch (error) {
        return null;
    }
};

const toNumber = (value, fallback = 0) => {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : fallback;
};

const normalizeUidList = (uids) => {
    if (!Array.isArray(uids)) return [];
    return Array.from(new Set(uids.map((uid) => String(uid || "").trim()).filter(Boolean)));
};

const toJsDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toTimestampOrNull = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value;
    const parsed = toJsDate(value);
    return parsed ? admin.firestore.Timestamp.fromDate(parsed) : null;
};

const getValidPaymentHistory = (paymentHistory = []) =>
    paymentHistory.filter((entry) => entry && !entry.isCancelled);

const getPaymentSummary = (paymentHistory = []) => {
    const validHistory = getValidPaymentHistory(paymentHistory);
    const latestEntry = validHistory[validHistory.length - 1] || null;

    return {
        paymentCount: validHistory.length,
        totalAmount: validHistory.reduce((sum, entry) => sum + toNumber(entry?.amount, 0), 0),
        lastPaymentDate: toTimestampOrNull(latestEntry?.date || latestEntry?.paymentDate),
    };
};

const getMaxRecordedPaymentNumber = (paymentHistory = [], paymentCount = 0) =>
    paymentHistory.reduce((max, entry) => {
        if (!entry) return max;

        const candidates = [
            toNumber(entry?.num, Number.NaN),
            toNumber(entry?.originalNum, Number.NaN),
            toNumber(entry?.paymentNumber, Number.NaN),
            toNumber(entry?.paymentNum, Number.NaN),
        ].filter(Number.isFinite);

        return candidates.length > 0 ? Math.max(max, ...candidates) : max;
    }, Math.max(0, toNumber(paymentCount, 0)));

const getLatestValidPaymentNumber = (paymentHistory = []) =>
    getValidPaymentHistory(paymentHistory).reduce((max, entry) => {
        const num = toNumber(
            entry?.num ?? entry?.paymentNumber ?? entry?.paymentNum,
            Number.NaN,
        );
        return Number.isFinite(num) ? Math.max(max, num) : max;
    }, 0);

const reindexPaymentHistory = (paymentHistory = []) => {
    let nextNum = 1;
    return paymentHistory.map((entry) => {
        if (!entry) return entry;
        if (entry.isCancelled) {
            return {
                ...entry,
                originalNum: entry.originalNum ?? entry.num ?? entry.paymentNumber ?? entry.paymentNum ?? null,
                num: null,
            };
        }

        return {
            ...entry,
            num: nextNum++,
        };
    });
};

const computeSubscriptionInterest = ({ paymentHistory = [], weeklyInterestRate = 0, untilDate }) => {
    const endDate = toJsDate(untilDate);
    if (!endDate) return 0;

    const dailyRate = (toNumber(weeklyInterestRate, 0) / 100) / 7;
    if (dailyRate <= 0) return 0;

    const totalInterest = getValidPaymentHistory(paymentHistory).reduce((sum, entry) => {
        const paidAt = toJsDate(entry?.date || entry?.paymentDate);
        if (!paidAt) return sum;

        const days = Math.max(0, Math.floor((endDate - paidAt) / (1000 * 60 * 60 * 24)));
        return sum + (toNumber(entry?.amount, 0) * dailyRate * days);
    }, 0);

    return Math.floor(totalInterest);
};

exports.processSubscriptionPayment = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, productId, amount } = data || {};
    if (!classId || !productId || !amount) {
        throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
    }

    try {
        const globalConfig = await getGlobalConfig();
        return await db.runTransaction(async (tx) => {
            const classRef = db.doc(`classes/${classId}`);
            const productRef = classRef.collection("subscriptionProducts").doc(productId);
            const studentRef = classRef.collection("students").doc(auth.uid);
            const subDocRef = db.doc(`classes/${classId}/subscriptions/${auth.uid}`);

            const [classSnap, productSnap, studentSnap, subSnap] = await Promise.all([
                tx.get(classRef),
                tx.get(productRef),
                tx.get(studentRef),
                tx.get(subDocRef),
            ]);

            if (!classSnap.exists || !productSnap.exists) {
                throw new HttpsError("not-found", "청약 정보를 찾을 수 없습니다.");
            }
            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
            }

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const productData = productSnap.data() || {};
            const studentData = studentSnap.data() || {};
            const subData = subSnap.exists ? subSnap.data() : { activeSubscriptions: {} };
            const mySub = subData.activeSubscriptions?.[productId] || null;
            const isRejoiningClosedSubscription = !!(mySub?.isWithdrawn || mySub?.isTerminated);

            const targetStudents = normalizeUidList(productData.targetStudents);
            if (targetStudents.length > 0 && !targetStudents.includes(auth.uid)) {
                throw new HttpsError("permission-denied", "이 상품의 참여 대상이 아닙니다.");
            }

            const now = new Date();
            const todayMid = getKSTMidnight(now);
            const cycleDays = Math.max(1, toNumber(productData.paymentCycle, 1));

            if (!isRejoiningClosedSubscription && mySub?.lastPaymentDate && (mySub?.paymentCount || 0) > 0) {
                const lastMid = getKSTMidnight(mySub.lastPaymentDate.toDate());
                const nextMid = new Date(lastMid);
                nextMid.setUTCDate(lastMid.getUTCDate() + cycleDays);

                if (todayMid < nextMid) {
                    throw new HttpsError("failed-precondition", "아직 다음 납입 가능일이 아닙니다.");
                }
            }

            const payAmt = toNumber(amount);
            const minAmt = toNumber(productData.minAmount, 0);
            const maxAmt = productData.maxAmount != null ? toNumber(productData.maxAmount) : null;
            if (payAmt < minAmt) {
                throw new HttpsError(
                    "failed-precondition",
                    `최소 ${minAmt.toLocaleString()} 이상 납입해야 합니다.`,
                );
            }
            if (maxAmt !== null && payAmt > maxAmt) {
                throw new HttpsError(
                    "failed-precondition",
                    `최대 ${maxAmt.toLocaleString()}까지만 납입 가능합니다.`,
                );
            }

            const currencyField = classData.currencySettings?.field || "cash";
            const studentAssets = studentData.assets?.[currencyField] || 0;
            if (studentAssets < payAmt) {
                throw new HttpsError("failed-precondition", "잔액이 부족합니다.");
            }

            const existingHistory = !isRejoiningClosedSubscription && Array.isArray(mySub?.paymentHistory)
                ? [...mySub.paymentHistory]
                : [];
            const paymentNumber = getMaxRecordedPaymentNumber(
                existingHistory,
                mySub?.paymentCount || 0,
            ) + 1;

            const nextPayDate = new Date(todayMid);
            nextPayDate.setUTCDate(todayMid.getUTCDate() + cycleDays);
            nextPayDate.setUTCHours(0, 0, 0, 0);

            const paymentTimestamp = admin.firestore.Timestamp.now();
            const newRecord = {
                num: paymentNumber,
                paymentNumber,
                paymentNum: paymentNumber,
                amount: payAmt,
                date: paymentTimestamp,
                unit:
                    classData.currencyUnit ||
                    classData.currencySettings?.name ||
                    "원",
                isCancelled: false,
            };

            const nextHistory = [...existingHistory, newRecord];
            const nextSummary = getPaymentSummary(nextHistory);

            tx.update(studentRef, {
                [`assets.${currencyField}`]: FieldValue.increment(-payAmt),
            });

            const updatedSubInfo = {
                productId,
                productTitle: productData.title,
                productEndDate: productData.endDate || null,
                paymentCount: nextSummary.paymentCount,
                totalAmount: nextSummary.totalAmount,
                lastPaymentDate: nextSummary.lastPaymentDate,
                nextPaymentDate: admin.firestore.Timestamp.fromDate(nextPayDate),
                paymentHistory: nextHistory,
                isWithdrawn: false,
                isTerminated: false,
                ...(isRejoiningClosedSubscription ? { rejoinedAt: paymentTimestamp } : {}),
                updatedAt: admin.firestore.Timestamp.now(),
            };

            stageActivityLog(tx, classId, {
                studentUid: auth.uid,
                type: "expense",
                category: "subscription_payment",
                amount: payAmt,
                currency: classData.currencyUnit || classData.currencySettings?.name || "class_currency",
                description: `'${productData.title}' ${paymentNumber}회차 납입`,
                relatedDoc: { collection: "subscriptions", id: auth.uid },
                productId,
            }, { config: globalConfig, planType, serviceName: "bank" });

            if (!subSnap.exists) {
                tx.set(subDocRef, {
                    activeSubscriptions: { [productId]: updatedSubInfo },
                    uid: auth.uid,
                });
            } else {
                tx.update(subDocRef, {
                    [`activeSubscriptions.${productId}`]: updatedSubInfo,
                });
            }

            return { success: true, paymentNumber };
        });
    } catch (error) {
        logger.error(error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", error.message);
    }
});

exports.withdrawFromProduct = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, productId, studentUid: targetUid } = data || {};
    const studentUid = auth.token?.role === "student" ? auth.uid : (targetUid || auth.uid);

    try {
        const globalConfig = await getGlobalConfig();
        return await db.runTransaction(async (tx) => {
            const subDocRef = db.doc(`classes/${classId}/subscriptions/${studentUid}`);
            const productRef = db.doc(`classes/${classId}/subscriptionProducts/${productId}`);
            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const classRef = db.doc(`classes/${classId}`);

            const [subSnap, productSnap, studentSnap, classSnap] = await Promise.all([
                tx.get(subDocRef),
                tx.get(productRef),
                tx.get(studentRef),
                tx.get(classRef),
            ]);

            if (!productSnap.exists) {
                throw new HttpsError("not-found", "상품 정보를 찾을 수 없습니다.");
            }
            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
            }

            const mySub = subSnap.data()?.activeSubscriptions?.[productId];
            if (!mySub || mySub.isWithdrawn || mySub.isTerminated) {
                throw new HttpsError("failed-precondition", "수령 가능한 청약 내역이 없습니다.");
            }

            const productData = productSnap.data() || {};
            const endDate = productData.endDate?.toDate?.();
            if (!endDate || new Date() <= endDate) {
                throw new HttpsError("failed-precondition", "아직 만기일이 지나지 않았습니다.");
            }

            const principal = getPaymentSummary(mySub.paymentHistory || []).totalAmount;
            const interestAccrued = computeSubscriptionInterest({
                paymentHistory: mySub.paymentHistory || [],
                weeklyInterestRate: productData.weeklyInterestRate,
                untilDate: endDate,
            });
            const totalPayout = principal + interestAccrued;

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const currencyField = classData.currencySettings?.field || "cash";

            tx.update(studentRef, {
                [`assets.${currencyField}`]: FieldValue.increment(totalPayout),
            });
            tx.update(subDocRef, {
                [`activeSubscriptions.${productId}.isWithdrawn`]: true,
                [`activeSubscriptions.${productId}.withdrawnAmount`]: totalPayout,
                [`activeSubscriptions.${productId}.interestAccrued`]: interestAccrued,
                [`activeSubscriptions.${productId}.withdrawnAt`]: FieldValue.serverTimestamp(),
            });

            stageActivityLog(tx, classId, {
                studentUid,
                type: "income",
                category: "subscription_withdraw",
                amount: totalPayout,
                currency: classData.currencyUnit || classData.currencySettings?.name || "class_currency",
                description: `'${productData.title || mySub.productTitle || productId}' 만기 수령 (원금: ${principal}, 이자: ${interestAccrued})`,
                relatedDoc: { collection: "subscriptions", id: studentUid },
                productId,
            }, { config: globalConfig, planType, serviceName: "bank" });

            return { success: true, total: totalPayout, interest: interestAccrued };
        });
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", error.message);
    }
});

exports.terminateSubscription = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, productId, studentUid: targetUid } = data || {};
    const studentUid = auth.token?.role === "student" ? auth.uid : (targetUid || auth.uid);

    try {
        const globalConfig = await getGlobalConfig();
        return await db.runTransaction(async (tx) => {
            const subDocRef = db.doc(`classes/${classId}/subscriptions/${studentUid}`);
            const productRef = db.doc(`classes/${classId}/subscriptionProducts/${productId}`);
            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const classRef = db.doc(`classes/${classId}`);

            const [subSnap, productSnap, studentSnap, classSnap] = await Promise.all([
                tx.get(subDocRef),
                tx.get(productRef),
                tx.get(studentRef),
                tx.get(classRef),
            ]);

            if (!productSnap.exists) {
                throw new HttpsError("not-found", "상품 정보를 찾을 수 없습니다.");
            }
            if (!studentSnap.exists) {
                throw new HttpsError("not-found", "학생 정보를 찾을 수 없습니다.");
            }

            const mySub = subSnap.data()?.activeSubscriptions?.[productId];
            if (!mySub || mySub.isWithdrawn || mySub.isTerminated) {
                throw new HttpsError("failed-precondition", "해지 가능한 청약 내역이 없습니다.");
            }

            const productData = productSnap.data() || {};
            if (productData.earlyTerminationBlocked === true) {
                throw new HttpsError(
                    "failed-precondition",
                    "이 상품은 중도해지가 불가능하도록 설정되어 있습니다.",
                );
            }
            const principal = getPaymentSummary(mySub.paymentHistory || []).totalAmount;
            const interestAccrued = computeSubscriptionInterest({
                paymentHistory: mySub.paymentHistory || [],
                weeklyInterestRate: productData.hasInterest === false ? 0 : productData.weeklyInterestRate,
                untilDate: new Date(),
            });
            const totalPayout = principal + interestAccrued;

            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const currencyField = classData.currencySettings?.field || "cash";

            tx.update(studentRef, {
                [`assets.${currencyField}`]: FieldValue.increment(totalPayout),
            });
            tx.update(subDocRef, {
                [`activeSubscriptions.${productId}.isTerminated`]: true,
                [`activeSubscriptions.${productId}.terminatedAmount`]: totalPayout,
                [`activeSubscriptions.${productId}.interestAccrued`]: interestAccrued,
                [`activeSubscriptions.${productId}.terminatedAt`]: FieldValue.serverTimestamp(),
                [`activeSubscriptions.${productId}.nextPaymentDate`]: null,
            });

            stageActivityLog(tx, classId, {
                studentUid,
                type: "income",
                category: "subscription_terminate",
                amount: totalPayout,
                currency: classData.currencyUnit || classData.currencySettings?.name || "class_currency",
                description: `'${productData.title || mySub.productTitle || productId}' 중도 해지 (원금: ${principal}, 이자: ${interestAccrued})`,
                relatedDoc: { collection: "subscriptions", id: studentUid },
                productId,
            }, { config: globalConfig, planType, serviceName: "bank" });

            return { success: true, total: totalPayout, interest: interestAccrued };
        });
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", error.message);
    }
});

exports.cancelSubscriptionPayment = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    const { classId, productId, paymentNum, studentUid } = data || {};

    if (!["teacher", "admin"].includes(auth.token?.role)) {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    try {
        const globalConfig = await getGlobalConfig();
        return await db.runTransaction(async (tx) => {
            const subDocRef = db.doc(`classes/${classId}/subscriptions/${studentUid}`);
            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const classRef = db.doc(`classes/${classId}`);

            const [subSnap, classSnap] = await Promise.all([tx.get(subDocRef), tx.get(classRef)]);
            const subData = subSnap.data()?.activeSubscriptions?.[productId];
            if (!subData) throw new HttpsError("not-found", "납입 기록이 없습니다.");

            const history = Array.isArray(subData.paymentHistory) ? [...subData.paymentHistory] : [];
            const targetIdx = history.findIndex((entry) => entry.num === paymentNum && !entry.isCancelled);
            // A replay of an already cancelled payment does not issue another refund.
            if (targetIdx === -1) return { success: true, alreadyCancelled: true };
            if (subData.isWithdrawn || subData.isTerminated) {
                throw new HttpsError(
                    "failed-precondition",
                    "이미 수령한 청약의 납입금은 다시 환불할 수 없습니다. 금액 보정은 자산 조정에서 처리해 주세요.",
                    { reason: "subscription-already-settled" },
                );
            }
            const latestValidPaymentNum = getLatestValidPaymentNumber(history);
            if (latestValidPaymentNum > 0 && paymentNum !== latestValidPaymentNum) {
                throw new HttpsError(
                    "failed-precondition",
                    "가장 최근 회차의 납입만 취소할 수 있습니다.",
                );
            }

            const cancelAmount = toNumber(history[targetIdx].amount, 0);
            history[targetIdx] = {
                ...history[targetIdx],
                isCancelled: true,
                originalNum:
                    history[targetIdx].originalNum ??
                    history[targetIdx].num ??
                    history[targetIdx].paymentNumber ??
                    history[targetIdx].paymentNum ??
                    null,
                cancelledAt: admin.firestore.Timestamp.now(),
            };

            const reindexedHistory = reindexPaymentHistory(history);
            const nextSummary = getPaymentSummary(reindexedHistory);
            const classData = classSnap.data() || {};
            const planType = classData.planType || "FREE";
            const currencyField = classData.currencySettings?.field || "cash";

            tx.update(studentRef, {
                [`assets.${currencyField}`]: FieldValue.increment(cancelAmount),
            });
            tx.update(subDocRef, {
                [`activeSubscriptions.${productId}.paymentHistory`]: reindexedHistory,
                [`activeSubscriptions.${productId}.paymentCount`]: nextSummary.paymentCount,
                [`activeSubscriptions.${productId}.totalAmount`]: nextSummary.totalAmount,
                [`activeSubscriptions.${productId}.lastPaymentDate`]: nextSummary.lastPaymentDate,
            });

            stageActivityLog(tx, classId, {
                studentUid,
                type: "income",
                category: "subscription_payment_cancel",
                amount: cancelAmount,
                currency: classData.currencyUnit || classData.currencySettings?.name || "class_currency",
                description: `'${subData.productTitle || productId}' ${paymentNum}회차 납입 취소 및 환불`,
                relatedDoc: { collection: "subscriptions", id: studentUid },
                productId,
            }, { config: globalConfig, planType, serviceName: "bank" });

            return { success: true, refunded: cancelAmount };
        });
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", error.message);
    }
});

exports.deleteProductCascade = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    const { classId, productId } = data || {};
    if (!["teacher", "admin"].includes(auth.token?.role)) {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    try {
        const subsSnap = await db.collection(`classes/${classId}/subscriptions`).get();
        const batch = db.batch();

        subsSnap.docs.forEach((docSnap) => {
            batch.update(docSnap.ref, {
                [`activeSubscriptions.${productId}`]: FieldValue.delete(),
            });
        });

        batch.delete(db.doc(`classes/${classId}/subscriptionProducts/${productId}`));
        await batch.commit();

        return { success: true, affectedStudents: subsSnap.size };
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

exports.createOrUpdateProduct = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!["teacher", "admin"].includes(auth.token?.role)) {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    const { classId, productId, product } = data || {};
    const payload = {
        title: (product.title || "새 청약통장").trim(),
        description: product.description || "",
        minAmount: toNumber(product.minAmount, 1000),
        maxAmount: product.maxAmount ? toNumber(product.maxAmount) : null,
        paymentCycle: Math.max(1, toNumber(product.paymentCycle, 1)),
        targetStudents: normalizeUidList(product.targetStudents),
        hasInterest: product.hasInterest !== false,
        weeklyInterestRate: Math.max(0, toNumber(product.weeklyInterestRate, 0)),
        earlyTerminationBlocked: product.earlyTerminationBlocked === true,
        assetKey: [
            "subscriptionPassbook",
            "subscriptionRegularPayment",
            "subscriptionGoalSavings",
            "subscriptionDrawTicket",
        ].includes(product.assetKey)
            ? product.assetKey
            : "subscriptionPassbook",
        startDate: toDateOrNull(product.startDate, { isEndDate: false }),
        endDate: toDateOrNull(product.endDate, { isEndDate: true }),
        updatedAt: FieldValue.serverTimestamp(),
    };

    try {
        const ref = productId
            ? db.doc(`classes/${classId}/subscriptionProducts/${productId}`)
            : db.collection(`classes/${classId}/subscriptionProducts`).doc();
        const resolvedProductId = productId || ref.id;

        await db.runTransaction(async (tx) => {
            await tx.get(db.doc(`classes/${classId}`));
            tx.set(ref, {
                ...payload,
                ...(!productId ? { status: "active", createdAt: FieldValue.serverTimestamp() } : {}),
            }, { merge: true });
        });

        const subsSnap = await db.collection(`classes/${classId}/subscriptions`).get();
        if (!subsSnap.empty) {
            const batch = db.batch();
            let touchedDocs = 0;

            subsSnap.docs.forEach((docSnap) => {
                const activeSubscriptions = docSnap.data()?.activeSubscriptions || {};
                if (!activeSubscriptions?.[resolvedProductId]) return;

                batch.update(docSnap.ref, {
                    [`activeSubscriptions.${resolvedProductId}.productEndDate`]:
                        payload.endDate || null,
                    [`activeSubscriptions.${resolvedProductId}.productTitle`]:
                        payload.title,
                    [`activeSubscriptions.${resolvedProductId}.updatedAt`]:
                        FieldValue.serverTimestamp(),
                });
                touchedDocs += 1;
            });

            if (touchedDocs > 0) {
                await batch.commit();
            }
        }

        return { success: true, productId: ref.id };
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});
