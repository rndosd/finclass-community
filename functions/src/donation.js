"use strict";

const admin = require("../firebaseAdminCompat");
const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());

const { onCall, HttpsError } = require("../utils/maintenanceHttps");
const { FieldValue } = require("firebase-admin/firestore");

// ✅ 유틸리티 및 플랜 매니저 임포트
const { stageActivityLog } = require("../utils/logUtils");
const { stageTaxIncome } = require("../utils/taxIncome");
const { stageTaxExpense } = require("../utils/taxExpense");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { assertTeacherClassScope } = require("../utils/permissionScope");
const { getSpendableBankBalance } = require("../utils/bankMoney");
const { runFinancialRequest } = require("../utils/financialRequest");
const TAX_LINE_COLLECTION = "lines";

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

/** teacher만 허용(토큰 커스텀 클레임 기준) */
async function assertTeacherByToken(request) {
    const role = request.auth?.token?.role;
    if (role !== "teacher") {
        throw new HttpsError("permission-denied", "이 작업은 선생님만 가능합니다.");
    }
    const requestedClassId = request.data?.classId;
    if (!requestedClassId) {
        throw new HttpsError("invalid-argument", "학급 ID가 필요합니다.");
    }
    let classId = request.auth.token.classId;
    // Preserve approved teachers whose class claim has not been refreshed yet.
    if (!classId) {
        const profile = await db.doc(`users/${request.auth.uid}`).get();
        const user = profile.data();
        if (user?.role === "teacher" && user.status === "approved") {
            classId = user.classId;
        }
    }
    assertTeacherClassScope({ role, classId }, requestedClassId);
}

/** 숫자 파싱(필요 최소한 보정) */
function asNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

/** 클래스 문서에서 통화 단위 가져오기 */
async function getCurrencyUnitInTx(tx, classId) {
    const classRef = db.doc(`classes/${classId}`);
    const classSnap = await tx.get(classRef);
    const classData = classSnap.exists ? classSnap.data() || {} : {};
    return classData.currencyUnit || "단위";
}

/* =========================================================
 * 1) 기부하기 (학생/일반 사용자 사용)
 * =======================================================*/
exports.makeDonation = onCall({ region: "asia-northeast3" }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, amount, clientRequestId } = request.data || {};
    const nRaw = asNum(amount);
    const n = Math.floor(nRaw);

    if (!classId || !Number.isSafeInteger(n) || n <= 0) {
        throw new HttpsError("invalid-argument", "유효하지 않은 기부 금액 또는 학급 ID 입니다.");
    }

    // 🔒 전역 정책 로드
    const globalConfig = await getGlobalConfig();

    const studentRef = db.doc(`classes/${classId}/students/${uid}`);
    const donationRef = db.collection(`classes/${classId}/donations`).doc();
    const summaryRef = db.doc(`classes/${classId}/dashboardSummary/donationSummary`);

    return runFinancialRequest({
        db, classId, actorUid: uid, operation: "donation", clientRequestId,
        payload: { amount: n },
    }, async (tx) => {
        const classRef = db.doc(`classes/${classId}`);
        const [studentSnap, classSnap] = await Promise.all([
            tx.get(studentRef),
            tx.get(classRef)
        ]);

        if (!studentSnap.exists) throw new HttpsError("failed-precondition", "학생 정보를 찾을 수 없습니다.");

        const planType = classSnap.data()?.planType || "FREE";
        const student = studentSnap.data() || {};
        const currentCash = getSpendableBankBalance(student.assets);

        if (currentCash < n) throw new HttpsError("failed-precondition", "사용 가능한 현금이 부족합니다.");

        const currencyUnit = classSnap.data()?.currencyUnit || "단위";

        // 1) 잔액 차감
        tx.update(studentRef, { "assets.cash": FieldValue.increment(-n) });

        // 2) 기부 문서 생성
        tx.set(donationRef, {
            classId,
            donatorUid: uid,
            donatorName: student.name || student.displayName || null,
            amount: n,
            donatedAt: FieldValue.serverTimestamp(),
        });

        // 3) 요약(totalAmount) 증가
        tx.set(summaryRef, {
            totalAmount: FieldValue.increment(n),
            lastUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 4) 활동 로그 기록 (정책 반영)
        stageActivityLog(tx, classId, {
            studentUid: uid,
            type: "donation",
            category: "donation",
            amount: n,
            description: `기부 ${n.toLocaleString()} ${currencyUnit}`,
            relatedDoc: { collection: `classes/${classId}/donations`, id: donationRef.id },
            currency: currencyUnit,
        }, { config: globalConfig, planType, serviceName: "donation" });

        // 5) 집계 업데이트
        const statsRef = db.doc(`classes/${classId}/donationStats/${uid}`);
        tx.set(statsRef, {
            name: student.name || student.displayName || null,
            total: FieldValue.increment(n),
            count: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { success: true, message: "따뜻한 마음을 나눠주셔서 감사합니다! 기부가 완료되었습니다." };
    });
});

/* =========================================================
 * 2) 기부 내역 하드 삭제 (교사 전용)
 * =======================================================*/
exports.deleteDonation = onCall({ region: "asia-northeast3" }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    await assertTeacherByToken(request);

    const { classId, donationId } = request.data || {};
    if (!classId || !donationId) throw new HttpsError("invalid-argument", "필수 인자가 부족합니다.");

    const globalConfig = await getGlobalConfig();

    await db.runTransaction(async (tx) => {
        const donationRef = db.doc(`classes/${classId}/donations/${donationId}`);
        const classRef = db.doc(`classes/${classId}`);
        const [donationSnap, classSnap] = await Promise.all([tx.get(donationRef), tx.get(classRef)]);

        if (!donationSnap.exists) throw new HttpsError("not-found", "기부 문서를 찾을 수 없습니다.");

        const planType = classSnap.data()?.planType || "FREE";
        const d = donationSnap.data();
        const donatorUid = d.donatorUid;
        const amount = Math.floor(Number(d.amount || 0));
        const currencyUnit = classSnap.data()?.currencyUnit || "단위";

        const statsRef = db.doc(`classes/${classId}/donationStats/${donatorUid}`);
        const statsSnap = await tx.get(statsRef);

        let nextTotal = 0;
        let nextCount = 0;
        if (statsSnap.exists) {
            const s = statsSnap.data() || {};
            nextTotal = Math.max(0, Math.floor(Number(s.total || 0)) - amount);
            nextCount = Math.max(0, Math.floor(Number(s.count || 0)) - 1);
        }

        const summaryRef = db.doc(`classes/${classId}/dashboardSummary/donationSummary`);
        tx.set(summaryRef, {
            totalAmount: FieldValue.increment(-amount),
            lastUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (statsSnap.exists) {
            if (nextTotal === 0 && nextCount === 0) {
                tx.delete(statsRef);
            } else {
                tx.set(statsRef, {
                    total: nextTotal,
                    count: nextCount,
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }

        // 활동 로그 기록 (정책 반영)
        stageActivityLog(tx, classId, {
            studentUid: donatorUid,
            type: "system",
            category: "donation_deleted",
            amount: amount,
            description: `기부 기록 하드 삭제: ${amount.toLocaleString()} ${currencyUnit} (관리자: ${callerUid})`,
            relatedDoc: { collection: "donations", id: donationRef.id },
            currency: currencyUnit,
            meta: { deletedBy: callerUid, deletedAmount: amount },
        }, { config: globalConfig, planType, serviceName: "donation" });

        tx.delete(donationRef);
    });

    return { success: true, message: "기부 내역이 완전히 삭제되었습니다." };
});

/* =========================================================
 * 2-1) 기부금 잔액 0으로 보정 (교사 전용)
 * =======================================================*/
exports.adjustDonationBalanceToZero = onCall({ region: "asia-northeast3" }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    await assertTeacherByToken(request);

    const { classId, reason } = request.data || {};
    if (!classId) throw new HttpsError("invalid-argument", "학급 ID가 필요합니다.");

    const summaryRef = db.doc(`classes/${classId}/dashboardSummary/donationSummary`);
    const adjustmentRef = db.collection(`classes/${classId}/donationAdjustments`).doc();
    const globalConfig = await getGlobalConfig();

    let beforeAmount = 0;
    await db.runTransaction(async (tx) => {
        const classRef = db.doc(`classes/${classId}`);
        const [summarySnap, classSnap] = await Promise.all([tx.get(summaryRef), tx.get(classRef)]);
        const planType = classSnap.data()?.planType || "FREE";
        const currencyUnit = classSnap.data()?.currencyUnit || "단위";

        beforeAmount = Math.floor(Number(summarySnap.data()?.totalAmount || 0));
        if (beforeAmount >= 0) {
            throw new HttpsError("failed-precondition", "0보다 작은 기부금 잔액이 있을 때만 보정할 수 있습니다.");
        }

        const adjustmentAmount = Math.abs(beforeAmount);
        const cleanReason = String(reason || "기부 내역 삭제로 생긴 음수 잔액 보정").trim();

        tx.set(summaryRef, {
            totalAmount: 0,
            lastUpdatedAt: FieldValue.serverTimestamp(),
            lastBalanceAdjustedAt: FieldValue.serverTimestamp(),
            lastBalanceAdjustedByUid: callerUid,
        }, { merge: true });

        tx.set(adjustmentRef, {
            classId,
            type: "set_donation_balance_to_zero",
            beforeAmount,
            afterAmount: 0,
            adjustmentAmount,
            reason: cleanReason,
            adjustedByUid: callerUid,
            adjustedAt: FieldValue.serverTimestamp(),
        });

        stageActivityLog(tx, classId, {
            studentUid: callerUid,
            type: "system",
            category: "donation_balance_adjusted",
            amount: adjustmentAmount,
            description: `기부금 잔액 0으로 보정: ${beforeAmount.toLocaleString()} → 0 ${currencyUnit}`,
            relatedDoc: { collection: "donationAdjustments", id: adjustmentRef.id },
            currency: currencyUnit,
            meta: {
                beforeAmount,
                afterAmount: 0,
                adjustmentAmount,
                reason: cleanReason,
            },
        }, { config: globalConfig, planType, serviceName: "donation" });
    });

    return {
        success: true,
        message: "기부금 잔액을 0으로 보정했습니다.",
        beforeAmount,
        afterAmount: 0,
        adjustmentId: adjustmentRef.id,
    };
});

/* =========================================================
 * 3) 기부금 → 세금으로 이동 (교사 전용)
 * =======================================================*/
exports.transferDonationToTax = onCall({ region: "asia-northeast3" }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    await assertTeacherByToken(request);

    const { classId, amount } = request.data || {};
    const n = Math.floor(Number(amount));
    if (!classId || !Number.isFinite(n) || n <= 0) throw new HttpsError("invalid-argument", "금액 오류");

    const globalConfig = await getGlobalConfig();
    const summaryRef = db.doc(`classes/${classId}/dashboardSummary/donationSummary`);
    const transferRef = db.collection(`classes/${classId}/donationTransfers`).doc();

    await db.runTransaction(async (tx) => {
        const [sumSnap, classSnap] = await Promise.all([tx.get(summaryRef), tx.get(db.doc(`classes/${classId}`))]);
        if (!sumSnap.exists) throw new HttpsError("not-found", "기부 요약 정보 없음");

        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const prevTotal = Math.floor(Number(sumSnap.data()?.totalAmount || 0));
        if (prevTotal < n) throw new HttpsError("failed-precondition", "기부금 잔액 부족");

        const currencyUnit = classSnap.data()?.currencyUnit || "단위";

        tx.set(summaryRef, {
            totalAmount: prevTotal - n,
            movedToTaxTotal: FieldValue.increment(n),
            lastUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const taxRecordId = `donation_transfer_${transferRef.id}`;
        const taxLineId = transferRef.id;
        const taxResult = stageTaxIncome(tx, classId, {
            amount: n,
            description: `[기부금→세금] 전입: ${n.toLocaleString()} ${currencyUnit}`,
            source: "donation_transfer",
            taxType: "donation_transfer",
            studentUid: callerUid,
        }, callerUid, {
            config: globalConfig,
            planType,
            serviceName: "tax",
            classData,
            sourceKey: "donationTransfer",
            skipPeriodSettlement: true,
            customId: taxRecordId,
            aggregateMeta: {
                group: "donation_transfer",
                batchKey: transferRef.id,
                pageKey: "donation",
                actorUid: callerUid,
                actorName: request.auth?.token?.name || null,
                mode: "transfer_donation_to_tax",
            },
            detailLines: [
                {
                    id: taxLineId,
                    amount: n,
                    source: "donation_transfer",
                    taxType: "donation_transfer",
                    description: `[기부금→세금] 전입`,
                    studentUid: callerUid,
                    relatedDoc: { collection: "donationTransfers", id: transferRef.id },
                    externalId: taxLineId,
                    meta: {
                        transferId: transferRef.id,
                    },
                },
            ],
            detailCollection: TAX_LINE_COLLECTION,
        });
        const isTaxRecorded = !taxResult?.skipped && !!taxResult?.id;
        if (!isTaxRecorded) {
            throw new HttpsError("failed-precondition", "세금 수입 기록을 만들 수 없습니다.");
        }

        tx.set(transferRef, {
            amount: n,
            currencyUnit,
            movedByUid: callerUid,
            movedAt: FieldValue.serverTimestamp(),
            direction: "donation_to_tax",
            status: "completed",
            taxRecord: buildTaxRecordPointer("taxIncomes", taxRecordId, taxLineId),
            taxRecordedAt: FieldValue.serverTimestamp(),
            taxCancelled: false,
        });

        // 세금 전입 기록 (Tax 정책 반영)
        // 활동 로그 기록 (Bank 정책 반영)
        stageActivityLog(tx, classId, {
            studentUid: callerUid,
            type: "system",
            category: "donation_moved_to_tax",
            amount: n,
            description: `세금으로 이동: ${n.toLocaleString()} ${currencyUnit}`,
            taxEvent: {
                sourceKey: "donationTransfer",
                taxCategory: "fund_transfer",
                taxType: "donation_transfer",
                amount: n,
            },
            relatedDoc: { collection: "donationTransfers", id: transferRef.id },
        }, { config: globalConfig, planType, serviceName: "donation" });
    });

    return {
        success: true,
        message: "세금으로 이동되었습니다.",
        transferId: transferRef.id,
    };
});

/* =========================================================
 * 4) 기부금 사용 (교사 전용)
 * =======================================================*/
/* =========================================================
 * 3-1) 세금 -> 기부금으로 이동 (교사 전용)
 * =======================================================*/
exports.transferTaxToDonation = onCall({ region: "asia-northeast3" }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    await assertTeacherByToken(request);

    const { classId, amount } = request.data || {};
    const n = Math.floor(Number(amount));
    if (!classId || !Number.isFinite(n) || n <= 0) throw new HttpsError("invalid-argument", "금액 오류");

    const globalConfig = await getGlobalConfig();
    const donationSummaryRef = db.doc(`classes/${classId}/dashboardSummary/donationSummary`);
    const taxSummaryRef = db.doc(`classes/${classId}/dashboardSummary/taxSummary`);
    const transferRef = db.collection(`classes/${classId}/donationTransfers`).doc();

    await db.runTransaction(async (tx) => {
        const [taxSummarySnap, classSnap] = await Promise.all([
            tx.get(taxSummaryRef),
            tx.get(db.doc(`classes/${classId}`)),
        ]);

        const planType = classSnap.data()?.planType || "FREE";
        const currencyUnit = classSnap.data()?.currencyUnit || "단위";
        const taxSummary = taxSummarySnap.exists ? taxSummarySnap.data() || {} : {};
        const taxBalance =
            Math.floor(Number(taxSummary.totalIncome || 0)) -
            Math.floor(Number(taxSummary.totalExpense || 0));

        if (taxBalance < n) throw new HttpsError("failed-precondition", "세금 잔액 부족");

        tx.set(donationSummaryRef, {
            totalAmount: FieldValue.increment(n),
            movedFromTaxTotal: FieldValue.increment(n),
            lastUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const taxExpenseId = `tax_to_donation_${transferRef.id}`;
        const taxLineId = transferRef.id;
        const taxResult = stageTaxExpense(tx, classId, {
            amount: n,
            description: `[세금->기부금] 이동: ${n.toLocaleString()} ${currencyUnit}`,
            source: "tax_to_donation",
            expenseType: "tax_to_donation",
            category: "tax_to_donation",
            studentUid: callerUid,
        }, callerUid, {
            config: globalConfig,
            planType,
            serviceName: "tax",
            customId: taxExpenseId,
            aggregateMeta: {
                group: "tax_to_donation",
                batchKey: transferRef.id,
                pageKey: "donation",
                actorUid: callerUid,
                actorName: request.auth?.token?.name || null,
                mode: "transfer_tax_to_donation",
            },
            detailLines: [
                {
                    id: taxLineId,
                    amount: n,
                    source: "tax_to_donation",
                    expenseType: "tax_to_donation",
                    category: "tax_to_donation",
                    description: "[세금->기부금] 이동",
                    studentUid: callerUid,
                    relatedDoc: { collection: "donationTransfers", id: transferRef.id },
                    externalId: taxLineId,
                    meta: { transferId: transferRef.id },
                },
            ],
        });

        if (taxResult?.skipped || !taxResult?.id) {
            throw new HttpsError("failed-precondition", "세금 지출 기록을 만들 수 없습니다.");
        }

        tx.set(transferRef, {
            amount: n,
            currencyUnit,
            movedByUid: callerUid,
            movedAt: FieldValue.serverTimestamp(),
            direction: "tax_to_donation",
            status: "completed",
            taxRecord: buildTaxRecordPointer("taxExpenses", taxExpenseId, taxLineId),
            taxRecordedAt: FieldValue.serverTimestamp(),
            taxCancelled: false,
        });

        stageActivityLog(tx, classId, {
            studentUid: callerUid,
            type: "system",
            category: "tax_moved_to_donation",
            amount: n,
            description: `세금에서 기부금으로 이동: ${n.toLocaleString()} ${currencyUnit}`,
            relatedDoc: { collection: "donationTransfers", id: transferRef.id },
            currency: currencyUnit,
        }, { config: globalConfig, planType, serviceName: "donation" });
    });

    return {
        success: true,
        message: "세금에서 기부금으로 이동했습니다.",
        transferId: transferRef.id,
    };
});

exports.spendDonation = onCall({ region: "asia-northeast3" }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    await assertTeacherByToken(request);

    const { classId, amount, reason, recordAsTaxIncome, taxType } = request.data || {};
    const n = Math.floor(asNum(amount));
    const globalConfig = await getGlobalConfig();

    const summaryRef = db.doc(`classes/${classId}/dashboardSummary/donationSummary`);
    const usageCol = db.collection(`classes/${classId}/donationUsages`);

    await db.runTransaction(async (tx) => {
        const [sumSnap, classSnap] = await Promise.all([tx.get(summaryRef), tx.get(db.doc(`classes/${classId}`))]);
        const classData = classSnap.data() || {};
        const planType = classData.planType || "FREE";
        const prevTotal = Math.floor(Number(sumSnap.data()?.totalAmount || 0));

        if (prevTotal < n) throw new HttpsError("failed-precondition", "잔액 부족");

        const currencyUnit = classSnap.data()?.currencyUnit || "단위";
        const usageRef = usageCol.doc();

        tx.set(usageRef, {
            amount: n, reason, usedByUid: callerUid, usedAt: FieldValue.serverTimestamp(),
        });

        tx.set(summaryRef, {
            totalAmount: prevTotal - n,
            lastUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (recordAsTaxIncome) {
            const taxRecordId = `donation_spend_${usageRef.id}`;
            const taxLineId = usageRef.id;
            const taxResult = stageTaxIncome(tx, classId, {
                amount: n,
                description: `[기부금 지출] ${reason}`,
                source: "donation_spend",
                taxType: taxType || "donation_transfer",
                studentUid: callerUid,
            }, callerUid, {
                config: globalConfig,
                classData,
                sourceKey: "donationSpend",
                planType,
                serviceName: "payroll",
                customId: taxRecordId,
                aggregateMeta: {
                    group: "donation_spend",
                    batchKey: usageRef.id,
                    pageKey: "donation",
                    actorUid: callerUid,
                    actorName: request.auth?.token?.name || null,
                    mode: "spend_donation",
                },
                detailLines: [
                    {
                        id: taxLineId,
                        amount: n,
                        source: "donation_spend",
                        taxType: taxType || "donation_transfer",
                        description: `[기부금 지출] ${reason}`,
                        studentUid: callerUid,
                        relatedDoc: { collection: "donationUsages", id: usageRef.id },
                        externalId: taxLineId,
                        meta: {
                            usageId: usageRef.id,
                        },
                    },
                ],
                detailCollection: TAX_LINE_COLLECTION,
            });
            const isTaxRecorded = !taxResult?.skipped && !!taxResult?.id;

            if (isTaxRecorded) {
                tx.set(
                    usageRef,
                    {
                        taxRecord: buildTaxRecordPointer(
                            "taxIncomes",
                            taxRecordId,
                            taxLineId,
                        ),
                        taxRecordedAt: FieldValue.serverTimestamp(),
                        taxCancelled: false,
                    },
                    { merge: true },
                );
            }
        }

        stageActivityLog(tx, classId, {
            studentUid: callerUid,
            type: "system",
            category: recordAsTaxIncome ? "donation_spent_taxincome" : "donation_spent",
            amount: n,
            description: `기부금 사용: ${n.toLocaleString()} ${currencyUnit} (${reason})`,
            relatedDoc: { collection: `classes/${classId}/donationUsages`, id: usageRef.id },
            taxEvent: recordAsTaxIncome ? {
                sourceKey: "donationSpend",
                taxCategory: "fund_transfer",
                taxType: taxType || "donation_transfer",
                amount: n,
            } : null,
            currency: currencyUnit,
        }, { config: globalConfig, planType, serviceName: "donation" });
    });

    return { success: true, message: "기부금 사용 내역이 기록되었습니다." };
});
