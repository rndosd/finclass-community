"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { hasPermission } = require("../utils/permissions");
const { stageTaxIncome } = require("../utils/taxIncome");
const { stageActivityLog } = require("../utils/logUtils");
const { getGlobalConfig } = require("../utils/planManager");
const {
  normalizeAntiSnipingSeconds,
  resolveAuctionBidDeadline,
} = require("../utils/auctionAntiSniping");
const { selectSealedAuctionWinner } = require("../utils/sealedAuction");

const db = admin.firestore();
const { FieldValue } = admin.firestore;
const TAX_LINE_COLLECTION = "lines";

const buildTaxRecordPointer = (collection, id, lineId) => ({
  collection,
  id,
  lineCollection: TAX_LINE_COLLECTION,
  lineId,
  detailStorage: "inline",
  aggregated: true,
});

const corsOptions = String(process.env.UPLOAD_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);

function assertAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAuctionType(value) {
  return value === "sealed" ? "sealed" : "open";
}

const MAX_AUCTION_DURATION_MINUTES = 60 * 24 * 30;
const AUCTION_ITEM_ICON_KEYS = new Set([
  "auto",
  "marketplaceSnackBundle",
  "marketplaceSquishyPlush",
  "marketplaceCollectibles",
  "marketplaceUsedStationery",
  "marketplaceHandmade",
  "marketplaceService",
  "stationery",
  "gift",
]);

function normalizeAuctionItemIcon(value) {
  const itemIcon = String(value || "auto").trim();
  return AUCTION_ITEM_ICON_KEYS.has(itemIcon) ? itemIcon : "auto";
}

function normalizeAuctionDurationMinutes(data = {}) {
  const hasStructuredDuration =
    data.durationDays !== undefined ||
    data.durationHours !== undefined ||
    data.durationMinutesPart !== undefined;

  if (hasStructuredDuration) {
    const days = clamp(
      Math.floor(safeNumber(data.durationDays, 0)),
      0,
      30,
    );
    const hours = clamp(
      Math.floor(safeNumber(data.durationHours, 0)),
      0,
      23,
    );
    const minutesPart = clamp(
      Math.floor(safeNumber(data.durationMinutesPart, 0)),
      0,
      59,
    );

    return clamp(
      days * 24 * 60 + hours * 60 + minutesPart,
      1,
      MAX_AUCTION_DURATION_MINUTES,
    );
  }

  return clamp(
    Math.floor(safeNumber(data.minutes, 60)),
    1,
    MAX_AUCTION_DURATION_MINUTES,
  );
}

function splitDurationMinutes(totalMinutes) {
  const safeTotal = clamp(
    Math.floor(safeNumber(totalMinutes, 0)),
    1,
    MAX_AUCTION_DURATION_MINUTES,
  );
  const days = Math.floor(safeTotal / (24 * 60));
  const remainingAfterDays = safeTotal % (24 * 60);
  const hours = Math.floor(remainingAfterDays / 60);
  const minutes = remainingAfterDays % 60;

  return { days, hours, minutes };
}

function buildAuctionTiming(durationMinutes, startMs = Date.now()) {
  const safeDurationMinutes = clamp(
    Math.floor(safeNumber(durationMinutes, 60)),
    1,
    MAX_AUCTION_DURATION_MINUTES,
  );
  const safeStartMs = Math.max(0, Math.floor(safeNumber(startMs, Date.now())));

  return {
    timerStartedAt: admin.firestore.Timestamp.fromMillis(safeStartMs),
    endAt: admin.firestore.Timestamp.fromMillis(
      safeStartMs + safeDurationMinutes * 60 * 1000,
    ),
  };
}

function toTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getAuctionTimerStartMs(item = {}) {
  const timerStartedAtMs = toTimestampMillis(item.timerStartedAt);
  if (timerStartedAtMs > 0) return timerStartedAtMs;

  const approvedAtMs = toTimestampMillis(item.approvedAt);
  return approvedAtMs > 0 ? approvedAtMs : 0;
}

function getAuctionEndAtMs(item = {}) {
  const explicitEndAtMs = toTimestampMillis(item.endAt);
  if (explicitEndAtMs > 0) return explicitEndAtMs;

  const durationMinutes = Math.floor(safeNumber(item.durationMinutes, 0));
  const timerStartMs = getAuctionTimerStartMs(item);

  if (timerStartMs > 0 && durationMinutes > 0) {
    return timerStartMs + durationMinutes * 60 * 1000;
  }

  return 0;
}

function isManagerRole(role) {
  return role === "teacher" || role === "admin";
}

function rethrowCallableError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  throw new HttpsError(
    "internal",
    fallbackMessage || "처리 중 내부 오류가 발생했습니다.",
  );
}

async function assertClassAccess(request, classId) {
  assertAuth(request);
  if (!classId) {
    throw new HttpsError("invalid-argument", "classId가 필요합니다.");
  }

  const role = request.auth.token?.role || "";
  if (role === "admin") return;

  const tokenClassId = request.auth.token?.classId;
  if (tokenClassId) {
    if (tokenClassId !== classId) {
      throw new HttpsError(
        "permission-denied",
        "다른 학급 데이터에는 접근할 수 없습니다.",
      );
    }
    return;
  }

  const studentRef = db.doc(`classes/${classId}/students/${request.auth.uid}`);
  const studentSnap = await studentRef.get();
  if (!studentSnap.exists) {
    throw new HttpsError("permission-denied", "학급 학생 정보가 없습니다.");
  }
}

async function settleAuction({
  classId,
  itemId,
  force = false,
  requesterRole = "system",
}) {
  const globalConfig = await getGlobalConfig();
  const itemRef = db.doc(`classes/${classId}/auction/${itemId}`);
  const settingsRef = db.doc(`classes/${classId}/auction/settings`);
  const classRef = db.doc(`classes/${classId}`);

  await db.runTransaction(async (tx) => {
    const [itemSnap, settingsSnap, classSnap] = await Promise.all([
      tx.get(itemRef),
      tx.get(settingsRef),
      tx.get(classRef),
    ]);

    if (!itemSnap.exists) {
      throw new HttpsError("not-found", "경매 아이템이 없습니다.");
    }

    const item = itemSnap.data();
    if (item.status !== "active") return;
    const auctionType = normalizeAuctionType(item.auctionType);

    if (!isManagerRole(requesterRole)) {
      throw new HttpsError(
        "permission-denied",
        "교사/관리자만 경매 정산을 수행할 수 있습니다.",
      );
    }

    const nowMs = Date.now();
    const endAtMs = getAuctionEndAtMs(item);
    if (!force && nowMs < endAtMs) {
      throw new HttpsError(
        "failed-precondition",
        "아직 마감 시간이 지나지 않았습니다.",
      );
    }

    let sealedBids = [];
    let sealedStudentSnaps = [];
    let sealedHoldSnaps = [];
    let winningBid = null;
    if (auctionType === "sealed") {
      const sealedBidQuery = db.collection(
        `classes/${classId}/auction/${itemId}/bids`,
      );
      const sealedBidSnap = await tx.get(sealedBidQuery);
      sealedBids = sealedBidSnap.docs.map((bidDoc) => ({
        id: bidDoc.id,
        ...bidDoc.data(),
      }));
      winningBid = selectSealedAuctionWinner(sealedBids);

      const sealedStudentRefs = sealedBids.map((bid) => db.doc(
        `classes/${classId}/students/${bid.bidderUid}`,
      ));
      const sealedHoldRefs = sealedBids.map((bid) => db.doc(
        `classes/${classId}/auction/${itemId}/holds/${bid.bidderUid}`,
      ));
      [sealedStudentSnaps, sealedHoldSnaps] = await Promise.all([
        Promise.all(sealedStudentRefs.map((ref) => tx.get(ref))),
        Promise.all(sealedHoldRefs.map((ref) => tx.get(ref))),
      ]);
    }

    const highestUid = auctionType === "sealed"
      ? winningBid?.bidderUid || null
      : item.highestBidUid;
    const highestBidName = auctionType === "sealed"
      ? winningBid?.bidderName || null
      : item.highestBidName || null;
    const sellerUid = item.sellerUid;
    const sellerFeeRate = settingsSnap.exists
      ? clamp(safeNumber(settingsSnap.data().sellerFeeRate, 5), 0, 100)
      : 5;
    const feeEnabled = settingsSnap.exists
      ? !!settingsSnap.data().feeEnabled
      : true;
    const classData = classSnap.exists ? classSnap.data() || {} : {};
    const logContext = {
      config: globalConfig,
      planType: classData.planType || "FREE",
      serviceName: "store",
    };

    if (!highestUid) {
      if (auctionType === "sealed") {
        sealedBids.forEach((bid, index) => {
          const studentSnap = sealedStudentSnaps[index];
          const holdSnap = sealedHoldSnaps[index];
          const holdAmount = holdSnap.exists
            ? safeNumber(holdSnap.data().holdAmount, 0)
            : 0;
          if (holdAmount > 0 && studentSnap.exists) {
            tx.update(studentSnap.ref, {
              "assets.auctionHold": FieldValue.increment(-holdAmount),
            });
          }
          if (holdSnap.exists) tx.delete(holdSnap.ref);
        });
      }
      tx.update(itemRef, {
        status: "ended",
        finalPrice: 0,
        endedAt: FieldValue.serverTimestamp(),
        finalFeeRate: feeEnabled ? sellerFeeRate : 0,
        finalFeeAmount: 0,
        finalSellerNet: 0,
      });
      return;
    }

    const finalPrice = clamp(
      safeNumber(
        auctionType === "sealed" ? winningBid?.amount : item.currentPrice,
        0,
      ),
      0,
      1_000_000_000,
    );
    const feeAmount = feeEnabled
      ? Math.round((finalPrice * sellerFeeRate) / 100)
      : 0;
    const sellerNet = finalPrice - feeAmount;

    const winnerRef = db.doc(`classes/${classId}/students/${highestUid}`);
    const sellerRef = db.doc(`classes/${classId}/students/${sellerUid}`);
    const winnerHoldRef = db.doc(
      `classes/${classId}/auction/${itemId}/holds/${highestUid}`,
    );

    const [winnerSnap, sellerSnap, winnerHoldSnap] = await Promise.all([
      tx.get(winnerRef),
      tx.get(sellerRef),
      tx.get(winnerHoldRef),
    ]);

    if (!winnerSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "낙찰자 학생 문서가 없습니다.",
      );
    }
    if (!sellerSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "판매자 학생 문서가 없습니다.",
      );
    }

    const winnerHold = winnerHoldSnap.exists
      ? safeNumber(winnerHoldSnap.data().holdAmount, 0)
      : 0;
    if (winnerHold < finalPrice) {
      throw new HttpsError(
        "failed-precondition",
        "보류금이 부족하여 정산할 수 없습니다.",
      );
    }
    if (safeNumber(winnerSnap.data().assets?.cash, 0) < finalPrice) {
      throw new HttpsError(
        "failed-precondition",
        "낙찰자의 현금 잔액이 부족하여 정산할 수 없습니다.",
      );
    }

    if (auctionType === "sealed") {
      sealedBids.forEach((bid, index) => {
        const studentSnap = sealedStudentSnaps[index];
        const holdSnap = sealedHoldSnaps[index];
        const holdAmount = holdSnap.exists
          ? safeNumber(holdSnap.data().holdAmount, 0)
          : 0;
        if (!studentSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "입찰자 학생 문서가 없어 정산할 수 없습니다.",
          );
        }

        const studentUpdates = {
          "assets.auctionHold": FieldValue.increment(-holdAmount),
        };
        if (bid.bidderUid === highestUid) {
          studentUpdates["assets.cash"] = FieldValue.increment(-finalPrice);
        }
        tx.update(studentSnap.ref, studentUpdates);
        if (holdSnap.exists) tx.delete(holdSnap.ref);
      });
    } else {
      tx.update(winnerRef, {
        "assets.auctionHold": FieldValue.increment(-winnerHold),
        "assets.cash": FieldValue.increment(-finalPrice),
      });
      tx.delete(winnerHoldRef);
    }
    tx.update(sellerRef, {
      "assets.cash": FieldValue.increment(sellerNet),
    });

    const transactionLogRef = db
      .collection(`classes/${classId}/marketplace_transactions`)
      .doc();
    const taxRecordId = `auction_fee_${itemId}`;
    const taxLineId = `${itemId}_fee`;
    let isTaxRecorded = false;

    if (feeAmount > 0) {
      const taxResult = stageTaxIncome(
        tx,
        classId,
        {
          amount: feeAmount,
          description: `경매 수수료 - ${item.title || itemId}`,
          source: "auction_fee",
          taxType: "auction_fee",
          studentUid: highestUid,
          studentName: highestBidName,
        },
        sellerUid || "system",
        {
          ...logContext,
          classData,
          sourceKey: "auctionFee",
          customId: taxRecordId,
          aggregateMeta: {
            group: "auction_fee",
            batchKey: itemId,
            pageKey: "auction",
            actorUid: sellerUid || "system",
            actorName: item.sellerName || null,
            mode: "close_auction",
          },
          detailLines: [
            {
              id: taxLineId,
              amount: feeAmount,
              source: "auction_fee",
              taxType: "auction_fee",
              description: `경매 수수료 - ${item.title || itemId}`,
              studentUid: highestUid,
              studentName: highestBidName,
              relatedDoc: {
                collection: "marketplace_transactions",
                id: transactionLogRef.id,
              },
              externalId: taxLineId,
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

    tx.set(transactionLogRef, {
      type: "auction_settlement",
      itemId,
      itemTitle: item.title || null,
      sellerId: sellerUid,
      sellerName: item.sellerName || null,
      buyerId: highestUid,
      buyerName: highestBidName,
      price: finalPrice,
      feeEnabled: !!feeEnabled,
      feeRate: feeEnabled ? sellerFeeRate : 0,
      feeAmount,
      sellerNet,
      currencyField: "cash",
      status: "completed",
      ...(isTaxRecorded
        ? {
            taxRecord: buildTaxRecordPointer("taxIncomes", taxRecordId, taxLineId),
            taxRecordedAt: FieldValue.serverTimestamp(),
            taxCancelled: false,
          }
        : {}),
      completedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });

    stageActivityLog(
      tx,
      classId,
      {
        studentUid: highestUid,
        type: "expense",
        category: "marketplace",
        subCategory: "auction_purchase",
        amount: finalPrice,
        description: `'${item.title || itemId}' 경매 낙찰`,
        relatedDoc: {
          collection: "marketplace_transactions",
          id: transactionLogRef.id,
        },
      },
      logContext,
    );

    if (sellerUid) {
      stageActivityLog(
        tx,
        classId,
        {
          studentUid: sellerUid,
          type: "income",
          category: "marketplace",
          subCategory: "auction_sale",
          amount: sellerNet,
          description:
            feeAmount > 0
              ? `'${item.title || itemId}' 경매 판매 (낙찰가 ${finalPrice}, 수수료 ${feeAmount}, 실수령 ${sellerNet})`
              : `'${item.title || itemId}' 경매 판매 (낙찰가 ${finalPrice})`,
          relatedDoc: {
            collection: "marketplace_transactions",
            id: transactionLogRef.id,
          },
          taxEvent: feeAmount > 0 ? {
            sourceKey: "auctionFee",
            taxCategory: "fee",
            taxType: "auction_fee",
            amount: feeAmount,
          } : null,
        },
        logContext,
      );
    }

    tx.update(itemRef, {
      status: "ended",
      endedAt: FieldValue.serverTimestamp(),
      finalPrice,
      finalFeeRate: feeEnabled ? sellerFeeRate : 0,
      finalFeeAmount: feeAmount,
      finalSellerNet: sellerNet,
      winnerUid: highestUid,
      winnerName: highestBidName,
    });
  });
}

exports.createAuctionItem = onCall(
  { timeoutSeconds: 30, cors: corsOptions },
  async (request) => {
    const {
      classId,
      title,
      description,
      itemIcon,
      auctionType,
      startPrice,
      bidStep,
      minutes,
      durationDays,
      durationHours,
      durationMinutesPart,
    } = request.data || {};

    try {
      assertAuth(request);

    await assertClassAccess(request, classId);

    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      throw new HttpsError("invalid-argument", "제목은 필수입니다.");
    }

    const normalizedDescription = String(description || "").trim();
    const normalizedItemIcon = normalizeAuctionItemIcon(itemIcon);
    const normalizedAuctionType = normalizeAuctionType(auctionType);
    const normalizedStartPrice = clamp(
      safeNumber(startPrice, 0),
      1,
      1_000_000_000,
    );
    const normalizedBidStep = clamp(safeNumber(bidStep, 0), 1, 1_000_000_000);
    const normalizedMinutes = normalizeAuctionDurationMinutes({
      minutes,
      durationDays,
      durationHours,
      durationMinutesPart,
    });
    const durationParts = splitDurationMinutes(normalizedMinutes);

    const sellerUid = request.auth.uid;
    const requesterRole = request.auth.token?.role || "";
    const sellerRef = db.doc(`classes/${classId}/students/${sellerUid}`);
    const settingsRef = db.doc(`classes/${classId}/auction/settings`);
    const approvalSettingsRef = db.doc(
      `classes/${classId}/marketplace_settings/approval`,
    );
    const [hasMarketplaceAdmin, sellerSnap, settingsSnap, approvalSettingsSnap] =
      await Promise.all([
        hasPermission(sellerUid, classId, "marketplace_admin"),
        sellerRef.get(),
        settingsRef.get(),
        approvalSettingsRef.get(),
      ]);
    const autoApproveEnabled =
      approvalSettingsSnap.exists &&
      approvalSettingsSnap.data()?.autoApproveEnabled === true;
    const shouldAutoApprove =
      isManagerRole(requesterRole) ||
      hasMarketplaceAdmin ||
      autoApproveEnabled;
    const sellerName = sellerSnap.exists
      ? sellerSnap.data().name || sellerSnap.data().displayName || "이름없음"
      : "이름없음";
    const antiSnipingSeconds = normalizeAntiSnipingSeconds(
      settingsSnap.exists ? settingsSnap.data()?.antiSnipingSeconds : undefined,
    );

    const auctionTiming = shouldAutoApprove
      ? buildAuctionTiming(normalizedMinutes)
      : null;
    const itemRef = db.collection(`classes/${classId}/auction`).doc();

    await itemRef.set({
      title: normalizedTitle,
      description: normalizedDescription,
      itemIcon: normalizedItemIcon,
      sellerUid,
      sellerName,
      startPrice: normalizedStartPrice,
      bidStep: normalizedBidStep,
      currentPrice: 0,
      highestBidUid: null,
      highestBidName: null,
      auctionType: normalizedAuctionType,
      auctionVersion: normalizedAuctionType === "sealed" ? "v2" : "v1",
      status: shouldAutoApprove ? "active" : "pending",
      approved: shouldAutoApprove,
      approvedAt: shouldAutoApprove ? FieldValue.serverTimestamp() : null,
      approvedBy: shouldAutoApprove
        ? isManagerRole(requesterRole) || hasMarketplaceAdmin
          ? sellerUid
          : "system_auto"
        : null,
      timerStartedAt: auctionTiming ? auctionTiming.timerStartedAt : null,
      rejectedAt: null,
      rejectedBy: null,
      rejectedReason: null,
      durationMinutes: normalizedMinutes,
      durationDays: durationParts.days,
      durationHours: durationParts.hours,
      durationMinutesPart: durationParts.minutes,
      endAt: auctionTiming ? auctionTiming.endAt : null,
      antiSnipingSeconds: shouldAutoApprove && normalizedAuctionType === "open"
        ? antiSnipingSeconds
        : 0,
      bidCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      itemId: itemRef.id,
      status: shouldAutoApprove ? "active" : "pending",
    };
    } catch (error) {
      console.error("[createAuctionItem] failed", {
        classId: classId || null,
        sellerUid: request.auth?.uid || null,
        requesterRole: request.auth?.token?.role || null,
        titleLength: String(title || "").trim().length,
        hasDescription: String(description || "").trim().length > 0,
        startPrice: startPrice ?? null,
        bidStep: bidStep ?? null,
        minutes: minutes ?? null,
        durationDays: durationDays ?? null,
        durationHours: durationHours ?? null,
        durationMinutesPart: durationMinutesPart ?? null,
        errorCode: error?.code || null,
        errorMessage: error?.message || String(error),
        stack: error?.stack || null,
      });
      rethrowCallableError(
        error,
        "경매 출품 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      );
    }
  },
);

exports.approveAuctionItem = onCall(
  { timeoutSeconds: 30, cors: corsOptions },
  async (request) => {
    assertAuth(request);
    const {
      classId,
      itemId,
      approved = true,
      reason = "",
    } = request.data || {};

    if (!classId || !itemId) {
      throw new HttpsError(
        "invalid-argument",
        "classId와 itemId가 필요합니다.",
      );
    }

    const role = request.auth.token?.role || "";
    const canManage =
      isManagerRole(role) ||
      (await hasPermission(request.auth.uid, classId, "marketplace_admin"));
    if (!canManage) {
      throw new HttpsError(
        "permission-denied",
        "교사/관리자만 승인 또는 반려할 수 있습니다.",
      );
    }

    await assertClassAccess(request, classId);

    const itemRef = db.doc(`classes/${classId}/auction/${itemId}`);
    const settingsRef = db.doc(`classes/${classId}/auction/settings`);
    const [itemSnap, settingsSnap] = await Promise.all([
      itemRef.get(),
      settingsRef.get(),
    ]);

    if (!itemSnap.exists) {
      throw new HttpsError("not-found", "경매 아이템을 찾을 수 없습니다.");
    }

    const item = itemSnap.data() || {};
    const itemStatus = String(item.status || "");

    if (approved) {
      if (itemStatus === "ended") {
        throw new HttpsError(
          "failed-precondition",
          "종료된 경매는 승인할 수 없습니다.",
        );
      }

      const durationMinutes = clamp(
        safeNumber(item.durationMinutes, 60),
        1,
        60 * 24 * 30,
      );
      const auctionTiming = buildAuctionTiming(durationMinutes);
      const antiSnipingSeconds = normalizeAntiSnipingSeconds(
        settingsSnap.exists ? settingsSnap.data()?.antiSnipingSeconds : undefined,
      );
      const approvedAntiSnipingSeconds = normalizeAuctionType(item.auctionType) === "sealed"
        ? 0
        : antiSnipingSeconds;

      await itemRef.update({
        approved: true,
        status: "active",
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: request.auth.uid,
        timerStartedAt: auctionTiming.timerStartedAt,
        rejectedAt: null,
        rejectedBy: null,
        rejectedReason: null,
        endAt: auctionTiming.endAt,
        antiSnipingSeconds: approvedAntiSnipingSeconds,
      });

      return { success: true, message: "경매가 승인되었습니다." };
    }

    if (itemStatus !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "승인 대기 경매만 반려할 수 있습니다.",
      );
    }

    await itemRef.update({
      approved: false,
      status: "rejected",
      timerStartedAt: null,
      endAt: null,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectedBy: request.auth.uid,
      rejectedReason: String(reason || "").trim() || null,
    });

    return { success: true, message: "경매가 반려되었습니다." };
  },
);

exports.placeAuctionBid = onCall(
  { timeoutSeconds: 30, cors: corsOptions },
  async (request) => {
    assertAuth(request);
    const { classId, itemId, amount } = request.data || {};
    if (!classId || !itemId) {
      throw new HttpsError(
        "invalid-argument",
        "classId와 itemId가 필요합니다.",
      );
    }

    await assertClassAccess(request, classId);

    const bidderUid = request.auth.uid;
    const bidAmount = clamp(safeNumber(amount, 0), 1, 1_000_000_000);

    const itemRef = db.doc(`classes/${classId}/auction/${itemId}`);
    const settingsRef = db.doc(`classes/${classId}/auction/settings`);
    const bidderRef = db.doc(`classes/${classId}/students/${bidderUid}`);
    const myHoldRef = db.doc(
      `classes/${classId}/auction/${itemId}/holds/${bidderUid}`,
    );
    const bidsCol = db.collection(`classes/${classId}/auction/${itemId}/bids`);
    const mySealedBidRef = bidsCol.doc(bidderUid);

    const bidResult = await db.runTransaction(async (tx) => {
      const [itemSnap, bidderSnap, settingsSnap, myHoldSnap, mySealedBidSnap] =
        await Promise.all([
          tx.get(itemRef),
          tx.get(bidderRef),
          tx.get(settingsRef),
          tx.get(myHoldRef),
          tx.get(mySealedBidRef),
        ]);

      if (!itemSnap.exists) {
        throw new HttpsError("not-found", "경매 아이템이 없습니다.");
      }
      if (!bidderSnap.exists) {
        throw new HttpsError("failed-precondition", "학생 문서가 없습니다.");
      }

      const item = itemSnap.data();
      const auctionType = normalizeAuctionType(item.auctionType);
      if (item.status !== "active") {
        throw new HttpsError(
          "failed-precondition",
          "진행 중인 경매가 아닙니다.",
        );
      }
      if (item.sellerUid === bidderUid) {
        throw new HttpsError(
          "failed-precondition",
          "본인이 출품한 경매에는 입찰할 수 없습니다.",
        );
      }

      if (auctionType === "sealed" && mySealedBidSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "블라인드 경매는 한 번만 입찰할 수 있습니다.",
        );
      }

      if (auctionType === "open" && item.highestBidUid === bidderUid) {
        throw new HttpsError(
          "failed-precondition",
          "현재 최고입찰자는 다른 사람의 입찰 이후에만 다시 입찰할 수 있습니다.",
        );
      }

      const bidAcceptedAtMs = Date.now();
      const endAtMs = getAuctionEndAtMs(item);
      if (bidAcceptedAtMs >= endAtMs) {
        throw new HttpsError("failed-precondition", "이미 마감된 경매입니다.");
      }

      const startPrice = safeNumber(item.startPrice, 1);
      const bidStepAmount = safeNumber(item.bidStep, 1);
      const currentPrice = safeNumber(item.currentPrice, 0);
      const minBid = auctionType === "sealed"
        ? startPrice
        : currentPrice > 0 ? currentPrice + bidStepAmount : startPrice;
      if (bidAmount < minBid) {
        throw new HttpsError(
          "invalid-argument",
          `최소 입찰 금액은 ${minBid}입니다.`,
        );
      }

      const prevMyHold = myHoldSnap.exists
        ? safeNumber(myHoldSnap.data().holdAmount, 0)
        : 0;
      if (auctionType === "sealed" && prevMyHold > 0) {
        throw new HttpsError(
          "failed-precondition",
          "이미 블라인드 입찰이 접수되었습니다.",
        );
      }
      if (bidAmount < prevMyHold) {
        throw new HttpsError(
          "invalid-argument",
          "기존 입찰보다 낮은 금액으로는 변경할 수 없습니다.",
        );
      }

      const deltaHold = bidAmount - prevMyHold;
      const bidder = bidderSnap.data();
      const cash = safeNumber(bidder.assets?.cash, 0);
      const auctionHold = safeNumber(bidder.assets?.auctionHold, 0);
      const available = cash - auctionHold;
      if (deltaHold > available) {
        throw new HttpsError(
          "failed-precondition",
          "사용 가능한 금액이 부족합니다.",
        );
      }

      const prevHighestUid = item.highestBidUid;
      if (
        auctionType === "open" &&
        prevHighestUid &&
        prevHighestUid !== bidderUid
      ) {
        const prevHoldRef = db.doc(
          `classes/${classId}/auction/${itemId}/holds/${prevHighestUid}`,
        );
        const prevStudentRef = db.doc(
          `classes/${classId}/students/${prevHighestUid}`,
        );
        const [prevHoldSnap, prevStudentSnap] = await Promise.all([
          tx.get(prevHoldRef),
          tx.get(prevStudentRef),
        ]);

        if (prevHoldSnap.exists && prevStudentSnap.exists) {
          const prevHoldAmount = safeNumber(prevHoldSnap.data().holdAmount, 0);
          if (prevHoldAmount > 0) {
            tx.update(prevStudentRef, {
              "assets.auctionHold": FieldValue.increment(-prevHoldAmount),
            });
          }
          tx.delete(prevHoldRef);
        }
      }

      if (!settingsSnap.exists) {
        tx.set(
          settingsRef,
          {
            sellerFeeRate: 5,
            feeEnabled: true,
            antiSnipingSeconds: 30,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (deltaHold > 0) {
        tx.update(bidderRef, {
          "assets.auctionHold": FieldValue.increment(deltaHold),
        });
      }

      tx.set(
        myHoldRef,
        {
          holdAmount: bidAmount,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const bidDocRef = auctionType === "sealed" ? mySealedBidRef : bidsCol.doc();
      const bidderName = bidder.name || bidder.displayName || "이름없음";
      if (auctionType === "sealed") {
        const bidSequence = Math.max(0, Math.floor(safeNumber(item.bidCount, 0))) + 1;
        tx.create(bidDocRef, {
          bidderUid,
          bidderName,
          amount: bidAmount,
          sequence: bidSequence,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(itemRef, {
          bidCount: bidSequence,
          lastBidAt: FieldValue.serverTimestamp(),
        });

        return {
          sealed: true,
          extended: false,
          extensionSeconds: 0,
          endAtMs,
        };
      }

      const antiSnipingSeconds = normalizeAntiSnipingSeconds(
        item.antiSnipingSeconds ??
          (settingsSnap.exists
            ? settingsSnap.data()?.antiSnipingSeconds
            : undefined),
      );
      const deadline = resolveAuctionBidDeadline({
        nowMs: bidAcceptedAtMs,
        currentEndAtMs: endAtMs,
        antiSnipingSeconds,
      });
      tx.set(bidDocRef, {
        bidderUid,
        bidderName,
        amount: bidAmount,
        createdAt: FieldValue.serverTimestamp(),
      });

      const itemUpdates = {
        currentPrice: bidAmount,
        highestBidUid: bidderUid,
        highestBidName: bidderName,
        bidCount: FieldValue.increment(1),
        lastBidAt: FieldValue.serverTimestamp(),
        antiSnipingSeconds,
      };
      if (deadline.extended) {
        itemUpdates.endAt = admin.firestore.Timestamp.fromMillis(
          deadline.endAtMs,
        );
        itemUpdates.lastExtendedAt = FieldValue.serverTimestamp();
      }
      tx.update(itemRef, itemUpdates);

      return {
        extended: deadline.extended,
        extensionSeconds: deadline.extensionSeconds,
        endAtMs: deadline.endAtMs,
      };
    });

    return { success: true, ...bidResult };
  },
);

exports.closeAuction = onCall(
  { timeoutSeconds: 30, cors: corsOptions },
  async (request) => {
    assertAuth(request);
    const { classId, itemId, force = false } = request.data || {};
    if (!classId || !itemId) {
      throw new HttpsError(
        "invalid-argument",
        "classId와 itemId가 필요합니다.",
      );
    }

    await assertClassAccess(request, classId);

    const requesterRole = request.auth.token?.role || "";
    if (!isManagerRole(requesterRole)) {
      throw new HttpsError(
        "permission-denied",
        "교사/관리자만 경매 정산을 수행할 수 있습니다.",
      );
    }

    await settleAuction({
      classId,
      itemId,
      force: !!force,
      requesterRole,
    });

    return { success: true };
  },
);
