"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onCallWithMaintenance } = require("../utils/maintenanceRequestHttps");
const admin = require("../firebaseAdminCompat");

const db = admin.firestore();
const { createMaintenanceDb } = require("../utils/maintenanceDb");
const { runFinancialRequest } = require("../utils/financialRequest");
const purchaseDb = createMaintenanceDb(db);
const FieldValue = admin.firestore.FieldValue;

const {
    asDate,
    getAvailable,
    incReserved,
    incCash,
    getMinNextBid,
} = require("../utils/marketplaceUtils");
const { stageActivityLog } = require("../utils/logUtils");
const { getGlobalConfig } = require("../utils/planManager");
const { stageTaxIncome } = require("../utils/taxIncome");
const { getAuthContext, hasPermission } = require("../utils/permissions");

const corsOptions = String(process.env.UPLOAD_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);

const MARKETPLACE_DEFAULT_FEE_RATE = 5;
const TAX_LINE_COLLECTION = "lines";

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

function safeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeWholeAmount(value) {
    return Math.max(0, Math.trunc(safeNumber(value, 0)));
}

function normalizeMarketplaceStock(value) {
    const num = safeNumber(value, 1);
    return Math.max(0, Math.trunc(num));
}

function shouldNotifyMarketplaceSeller(userData = {}) {
    const role = String(userData?.role || "");
    if (role === "teacher" || role === "admin") {
        return false;
    }

    return userData?.permissions?.marketplace_admin !== true;
}

exports.purchaseMarketplaceItem = onCallWithMaintenance(
    { cors: corsOptions, region: "asia-northeast3" },
    async (request) => {
        const { data, auth } = request;
        if (!auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { itemId, classId, clientRequestId } = data || {};
        if (!itemId || !classId) {
            throw new HttpsError("invalid-argument", "필수 매개변수가 누락되었습니다.");
        }

        const globalConfig = await getGlobalConfig();

        try {
            return await runFinancialRequest({
                db: purchaseDb,
                classId,
                actorUid: auth.uid,
                operation: "marketplacePurchase",
                clientRequestId,
                payload: { itemId },
            }, async (tx) => {
                const classRef = db.collection("classes").doc(classId);
                const itemRef = classRef.collection("marketplace").doc(itemId);
                const feeSettingsRef = classRef
                    .collection("marketplace_settings")
                    .doc("seller_fee");

                const [itemSnap, classSnap, feeSettingsSnap] = await Promise.all([
                    tx.get(itemRef),
                    tx.get(classRef),
                    tx.get(feeSettingsRef),
                ]);

                if (!itemSnap.exists) {
                    throw new HttpsError("not-found", "해당 물건을 찾을 수 없습니다.");
                }

                const item = itemSnap.data();
                const classData = classSnap.data() || {};
                const planType = classData.planType || "FREE";
                const logContext = {
                    config: globalConfig,
                    planType,
                    serviceName: "store",
                };

                if (item.status !== "active") {
                    throw new HttpsError("failed-precondition", "이미 판매 완료된 물건입니다.");
                }
                if (!item.approved) {
                    throw new HttpsError("failed-precondition", "승인되지 않은 물건입니다.");
                }
                if (item.sellerId === auth.uid) {
                    throw new HttpsError("failed-precondition", "본인 물건은 구매할 수 없습니다.");
                }
                if (item.type !== "sale") {
                    throw new HttpsError("failed-precondition", "경매 물건은 즉시 구매할 수 없습니다.");
                }

                const [buyerSnap, sellerSnap] = await Promise.all([
                    tx.get(classRef.collection("students").doc(auth.uid)),
                    tx.get(classRef.collection("students").doc(item.sellerId)),
                ]);

                if (!buyerSnap.exists) {
                    throw new HttpsError("not-found", "구매자 정보를 찾을 수 없습니다.");
                }
                if (!sellerSnap.exists) {
                    throw new HttpsError("not-found", "판매자 정보를 찾을 수 없습니다.");
                }

                const currencyField = classData.currencySettings?.field || "cash";
                const buyerData = buyerSnap.data() || {};
                const sellerData = sellerSnap.data() || {};
                const buyerAssets = buyerData.assets || {};
                const price = normalizeWholeAmount(
                    clamp(safeNumber(item.price, 0), 0, 1_000_000_000),
                );
                const stock = normalizeMarketplaceStock(item.stock);
                if (stock <= 0) {
                    throw new HttpsError("failed-precondition", "재고가 부족합니다.");
                }
                const remainingStock = Math.max(0, stock - 1);
                const isFinalSale = remainingStock <= 0;

                const configuredFeeRate = feeSettingsSnap.exists
                    ? safeNumber(
                        feeSettingsSnap.data()?.sellerFeeRate,
                        MARKETPLACE_DEFAULT_FEE_RATE,
                    )
                    : MARKETPLACE_DEFAULT_FEE_RATE;
                const sellerFeeRate = clamp(configuredFeeRate, 0, 100);
                const feeEnabled = feeSettingsSnap.exists
                    ? !!feeSettingsSnap.data()?.feeEnabled
                    : true;
                const feeAmount = feeEnabled
                    ? Math.round((price * sellerFeeRate) / 100)
                    : 0;
                const sellerNet = Math.max(0, price - feeAmount);
                const shouldFlagSellerSaleAlert = shouldNotifyMarketplaceSeller(sellerData);

                if (!feeSettingsSnap.exists) {
                    tx.set(
                        feeSettingsRef,
                        {
                            sellerFeeRate: MARKETPLACE_DEFAULT_FEE_RATE,
                            feeEnabled: true,
                            updatedAt: FieldValue.serverTimestamp(),
                            updatedBy: { uid: "system", name: "system" },
                        },
                        { merge: true },
                    );
                }

                const available = getAvailable(buyerAssets, currencyField);
                if (available < price) {
                    throw new HttpsError(
                        "failed-precondition",
                        `잔액이 부족합니다. (필요: ${price}, 가용: ${available})`,
                    );
                }

                incCash(
                    tx,
                    classRef.collection("students").doc(auth.uid),
                    currencyField,
                    -price,
                );
                incCash(
                    tx,
                    classRef.collection("students").doc(item.sellerId),
                    currencyField,
                    +sellerNet,
                );

                const itemUpdate = {
                    price,
                    stock: remainingStock,
                    soldQuantity: FieldValue.increment(1),
                    lastBuyerId: auth.uid,
                    lastBuyerName: buyerData.name || null,
                    lastSoldAt: FieldValue.serverTimestamp(),
                    lastFeeRate: feeEnabled ? sellerFeeRate : 0,
                    lastFeeAmount: feeAmount,
                    lastSellerNet: sellerNet,
                };

                if (isFinalSale) {
                    Object.assign(itemUpdate, {
                        status: "sold",
                        buyerId: auth.uid,
                        buyerName: buyerData.name || null,
                        soldAt: FieldValue.serverTimestamp(),
                        sellerSaleAlertPending: shouldFlagSellerSaleAlert,
                        sellerSaleAlertSeenAt: null,
                        finalFeeRate: feeEnabled ? sellerFeeRate : 0,
                        finalFeeAmount: feeAmount,
                        finalSellerNet: sellerNet,
                    });
                }

                tx.update(itemRef, itemUpdate);

                const logRef = classRef.collection("marketplace_transactions").doc();
                const feeTaxId = `marketplace_fee_${itemId}_${logRef.id}`;
                const feeLineId = `${itemId}_${logRef.id}_fee`;
                let isTaxRecorded = false;

                if (feeAmount > 0) {
                    const taxResult = stageTaxIncome(
                        tx,
                        classId,
                        {
                            amount: feeAmount,
                            description: `마켓 수수료 - ${item.title || itemId}`,
                            source: "marketplace_fee",
                            taxType: "marketplace_fee",
                            studentUid: auth.uid,
                            studentName: buyerData.name || null,
                        },
                        auth.uid,
                        {
                            ...logContext,
                            classData,
                            sourceKey: "marketplaceFee",
                            customId: feeTaxId,
                            aggregateMeta: {
                                group: "marketplace_fee",
                                batchKey: itemId,
                                pageKey: "marketplace",
                                actorUid: auth.uid,
                                actorName: buyerData.name || null,
                                mode: "purchase_marketplace_item",
                            },
                            detailLines: [
                                {
                                    id: feeLineId,
                                    amount: feeAmount,
                                    source: "marketplace_fee",
                                    taxType: "marketplace_fee",
                                    description: `마켓 수수료 - ${item.title || itemId}`,
                                    studentUid: auth.uid,
                                    studentName: buyerData.name || null,
                                    relatedDoc: {
                                        collection: "marketplace_transactions",
                                        id: logRef.id,
                                    },
                                    externalId: feeLineId,
                                    meta: {
                                        itemId,
                                    },
                                },
                            ],
                            detailCollection: TAX_LINE_COLLECTION,
                        },
                    );
                    isTaxRecorded = !taxResult?.skipped && !!taxResult?.id;
                }

                tx.set(logRef, {
                    type: "purchase",
                    itemId,
                    itemTitle: item.title,
                    sellerId: item.sellerId,
                    sellerName: item.sellerName,
                    buyerId: auth.uid,
                    buyerName: buyerData.name || null,
                    price,
                    quantity: 1,
                    remainingStock,
                    feeEnabled: !!feeEnabled,
                    feeRate: feeEnabled ? sellerFeeRate : 0,
                    feeAmount,
                    sellerNet,
                    currencyField,
                    status: "completed",
                    ...(isTaxRecorded
                        ? {
                            taxRecord: buildTaxRecordPointer("taxIncomes", feeTaxId, feeLineId),
                            taxRecordedAt: FieldValue.serverTimestamp(),
                            taxCancelled: false,
                        }
                        : {}),
                    completedAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                });

                stageActivityLog(tx, classId, {
                    studentUid: auth.uid,
                    type: "expense",
                    category: "marketplace",
                    subCategory: "purchase",
                    amount: price,
                    description: `'${item.title}' 상품 구매`,
                    relatedDoc: { collection: "marketplace_transactions", id: logRef.id },
                }, logContext);

                stageActivityLog(tx, classId, {
                    studentUid: item.sellerId,
                    type: "income",
                    category: "marketplace",
                    subCategory: "sale",
                    amount: sellerNet,
                    description: feeAmount > 0
                        ? `'${item.title}' 상품 판매 (판매가 ${price}, 수수료 ${feeAmount}, 실수령액 ${sellerNet})`
                        : `'${item.title}' 상품 판매 (판매가 ${price})`,
                    relatedDoc: { collection: "marketplace_transactions", id: logRef.id },
                    taxEvent: feeAmount > 0 ? {
                        sourceKey: "marketplaceFee",
                        taxCategory: "fee",
                        taxType: "marketplace_fee",
                        amount: feeAmount,
                    } : null,
                }, logContext);

                return {
                    success: true,
                    message: "구매가 완료되었습니다.",
                    transactionId: logRef.id,
                };
            });
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            console.error("purchaseMarketplaceItem error:", error);
            throw new HttpsError("internal", "구매 처리 중 오류가 발생했습니다.");
        }
    },
);

exports.markMarketplaceSaleAlertsSeen = onCall(
    { cors: corsOptions, region: "asia-northeast3" },
    async (request) => {
        const caller = getAuthContext(request);
        const { classId } = request.data || {};

        if (!caller?.uid) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId가 필요합니다.");
        }
        if (caller.classId && caller.classId !== classId) {
            throw new HttpsError("permission-denied", "다른 학급 데이터에는 접근할 수 없습니다.");
        }

        const sellerRef = db.collection("classes").doc(classId).collection("students").doc(caller.uid);
        const sellerSnap = await sellerRef.get();
        if (!sellerSnap.exists) {
            return { success: true, clearedCount: 0 };
        }

        const sellerData = sellerSnap.data() || {};
        if (!shouldNotifyMarketplaceSeller(sellerData)) {
            return { success: true, clearedCount: 0 };
        }

        const sellerItemsSnap = await db
            .collection("classes")
            .doc(classId)
            .collection("marketplace")
            .where("sellerId", "==", caller.uid)
            .get();

        const pendingDocs = sellerItemsSnap.docs.filter((docSnap) => {
            const item = docSnap.data() || {};
            return item.status === "sold" && item.sellerSaleAlertPending === true;
        });

        for (let index = 0; index < pendingDocs.length; index += 400) {
            const batch = db.batch();
            pendingDocs.slice(index, index + 400).forEach((docSnap) => {
                batch.update(docSnap.ref, {
                    sellerSaleAlertPending: false,
                    sellerSaleAlertSeenAt: FieldValue.serverTimestamp(),
                });
            });
            await batch.commit();
        }

        return { success: true, clearedCount: pendingDocs.length };
    },
);

exports.bidMarketplaceAuction = onCall({ cors: corsOptions }, async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { itemId, classId, bidAmount } = data || {};
    if (!itemId || !classId || !bidAmount) {
        throw new HttpsError("invalid-argument", "필수 매개변수가 누락되었습니다.");
    }
    if (auth.token.classId !== classId) {
        throw new HttpsError("permission-denied", "같은 반에서만 입찰할 수 있습니다.");
    }

    return await db.runTransaction(async (tx) => {
        const itemRef = db.collection("classes").doc(classId).collection("marketplace").doc(itemId);
        const classRef = db.collection("classes").doc(classId);
        const bidderRef = classRef.collection("students").doc(auth.uid);

        const [itemSnap, classSnap, bidderSnap] = await Promise.all([
            tx.get(itemRef),
            tx.get(classRef),
            tx.get(bidderRef),
        ]);

        if (!itemSnap.exists) throw new HttpsError("not-found", "경매 물건을 찾을 수 없습니다.");
        if (!bidderSnap.exists) throw new HttpsError("not-found", "입찰자 정보를 찾을 수 없습니다.");

        const item = itemSnap.data();
        if (item.type !== "auction") throw new HttpsError("failed-precondition", "경매 물건이 아닙니다.");
        if (!item.approved) throw new HttpsError("failed-precondition", "승인되지 않은 경매입니다.");
        if (item.sellerId === auth.uid) throw new HttpsError("failed-precondition", "본인 경매에는 입찰할 수 없습니다.");
        const end = asDate(item.endDate);
        if (end && end < new Date()) throw new HttpsError("failed-precondition", "이미 종료된 경매입니다.");

        const currencyField = classSnap.data()?.currencySettings?.field || "cash";
        const minNext = getMinNextBid(item.startPrice, item.currentHighestBid, !!item.isBlindAuction);
        const amountNum = Number(bidAmount);
        if (!item.isBlindAuction && amountNum < Number(minNext)) {
            throw new HttpsError("failed-precondition", `최소 입찰가는 ${minNext}입니다.`);
        }
        if (item.isBlindAuction && amountNum < Number(item.startPrice || 0)) {
            throw new HttpsError("failed-precondition", "시작가 이상으로 입찰해야 합니다.");
        }

        const bidder = bidderSnap.data();
        const available = getAvailable(bidder.assets, currencyField);
        if (available < amountNum) {
            throw new HttpsError("failed-precondition", `잔액 부족: 필요 ${amountNum}, 가용 ${available}`);
        }

        const nowTs = admin.firestore.Timestamp.now();
        const newBid = {
            bidderId: auth.uid,
            bidderName: bidder.name || "이름없음",
            amount: amountNum,
            isBlind: !!item.isBlindAuction,
            timestamp: nowTs,
        };

        if (!item.isBlindAuction) {
            const prevTopAmount = Number(item.currentHighestBid || 0);
            const prevTopBidderId = item.currentHighestBidderId || null;

            incReserved(tx, bidderRef, +amountNum);

            if (prevTopBidderId && prevTopAmount > 0) {
                const prevRef = classRef.collection("students").doc(prevTopBidderId);
                incReserved(tx, prevRef, -prevTopAmount);
            }

            tx.update(itemRef, {
                currentHighestBid: amountNum,
                currentHighestBidderId: auth.uid,
                bids: FieldValue.arrayUnion(newBid),
            });
        } else {
            const already = (item.bids || []).find((bid) => bid.bidderId === auth.uid);
            if (already) {
                throw new HttpsError("failed-precondition", "블라인드 경매는 1번만 입찰할 수 있습니다.");
            }

            incReserved(tx, bidderRef, +amountNum);
            tx.update(itemRef, { bids: FieldValue.arrayUnion(newBid) });
        }

        const bidLogRef = classRef.collection("auction_bids").doc();
        tx.set(bidLogRef, {
            itemId,
            itemTitle: item.title,
            bidderId: auth.uid,
            bidderName: bidder.name,
            amount: amountNum,
            isBlind: !!item.isBlindAuction,
            timestamp: FieldValue.serverTimestamp(),
        });

        return { success: true, message: "입찰이 완료되었습니다." };
    });
});

exports.approveMarketplaceItem = onCall({ cors: corsOptions }, async (request) => {
    const { data } = request;
    const { itemId, classId, approved = true, reason = "" } = data || {};
    if (!itemId || !classId) {
        throw new HttpsError("invalid-argument", "필수 매개변수가 누락되었습니다.");
    }

    const caller = getAuthContext(request);
    const callerRole = caller.role || "";
    const isTeacherOrAdmin = callerRole === "teacher" || callerRole === "admin";
    const hasMarketplaceAdmin = await hasPermission(
        caller.uid,
        classId,
        "marketplace_admin",
    );

    if (callerRole === "teacher" && caller.classId && caller.classId !== classId) {
        throw new HttpsError("permission-denied", "다른 학급 데이터에는 접근할 수 없습니다.");
    }

    if (!isTeacherOrAdmin && !hasMarketplaceAdmin) {
        throw new HttpsError(
            "permission-denied",
            "교사 또는 중고마켓 관리자만 승인/반려할 수 있습니다.",
        );
    }

    try {
        const itemRef = db.collection("classes").doc(classId).collection("marketplace").doc(itemId);
        const itemSnap = await itemRef.get();

        if (!itemSnap.exists) {
            throw new HttpsError("not-found", "해당 물건을 찾을 수 없습니다.");
        }

        const itemData = itemSnap.data() || {};
        const normalizedPrice = normalizeWholeAmount(itemData.price);
        const normalizedStock = Math.max(1, normalizeMarketplaceStock(itemData.stock));

        if (approved) {
            await itemRef.update({
                price: normalizedPrice,
                stock: normalizedStock,
                initialStock: Math.max(
                    normalizedStock,
                    normalizeMarketplaceStock(itemData.initialStock),
                ),
                approved: true,
                status: "active",
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: caller.uid,
                rejectedAt: null,
                rejectedBy: null,
                rejectedReason: null,
            });
            return { success: true, message: "물건을 승인했습니다." };
        }

        await itemRef.update({
            price: normalizedPrice,
            stock: normalizedStock,
            approved: false,
            status: "rejected",
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: caller.uid,
            rejectedReason: reason || null,
        });
        return { success: true, message: "물건을 반려했습니다." };
    } catch (error) {
        console.error("approveMarketplaceItem error:", error);
        throw new HttpsError("internal", "승인/반려 처리 중 오류가 발생했습니다.");
    }
});
