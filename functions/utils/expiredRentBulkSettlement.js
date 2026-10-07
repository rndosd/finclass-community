"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const { fingerprint, splitLayout } = require("./realEstateStorageSchema");
const { startOfDayInKST, parseDateKeyAsKST, formatDateKeyInKST } = require("./dateUtils");
const { calculateUnusedPrepaidRent } = require("./rentContractPolicy");

// This path settles expired contracts only. It never collects unpaid rent or
// deducts it from a deposit, and it stages every write after every read/check.
async function runExpiredRentBulkReset({ db, request, actorCtx, deskIds, deps }) {
    if (!actorCtx.isTeacher && !actorCtx.isAdmin) {
        throw new HttpsError("permission-denied", "만료 계약 일괄 정산은 담당 교사만 처리할 수 있습니다.");
    }
    if (deskIds.length > 40) {
        throw new HttpsError("invalid-argument", "정산 후 계약 설정은 한 번에 최대 40개 자리까지 가능합니다.");
    }
    const input = request.data;
    const previewOnly = input.previewOnly === true;
    const allowSystemCoverage = input.allowSystemCoverage === true;
    const clientRequestId = String(input.clientRequestId || "");
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(clientRequestId)) {
        throw new HttpsError("invalid-argument", "정산 요청 식별자가 필요합니다. 미리보기를 다시 확인해 주세요.");
    }
    const weeklyRent = Number(input.weeklyRent);
    const depositAmount = Number(input.depositAmount ?? 0);
    if (!Number.isSafeInteger(weeklyRent) || weeklyRent <= 0 ||
        !Number.isSafeInteger(depositAmount) || depositAmount < 0) {
        throw new HttpsError("invalid-argument", "주 임대료는 1 이상, 보증금은 0 이상의 정수여야 합니다.");
    }
    const start = startOfDayInKST(parseDateKeyAsKST(input.rentStartDateKey));
    const last = startOfDayInKST(parseDateKeyAsKST(input.rentLastDateKey));
    const today = startOfDayInKST(new Date());
    if (!start || !last || last < start || last < today) {
        throw new HttpsError("invalid-argument", "새 계약 기간을 확인해 주세요. 종료일은 시작일 및 오늘보다 빠를 수 없습니다.");
    }
    const classId = input.classId;
    const payload = { weeklyRent, depositAmount, rentStartDateKey: formatDateKeyInKST(start), rentLastDateKey: formatDateKeyInKST(last) };
    const requestHash = fingerprint({ classId, actorUid: actorCtx.uid, deskIds: [...deskIds].sort(), payload, allowSystemCoverage });
    const operationRef = db.doc(`classes/${classId}/real_estate/rent_bulk_operations/records/${fingerprint({ actorUid: actorCtx.uid, clientRequestId })}`);
    const globalConfig = await deps.getGlobalConfig();

    return deps.runRealEstateTransaction(db, async (transaction) => {
        const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
        const [layoutSnap, configSnap, actorSnap, operationSnap] = await Promise.all([
            deps.readRealEstateLayout(db, layoutRef, transaction),
            transaction.get(db.doc(`classes/${classId}/real_estate/config`)),
            transaction.get(db.doc(`classes/${classId}/students/${actorCtx.uid}`)),
            transaction.get(operationRef),
        ]);
        if (!layoutSnap.exists) throw new HttpsError("not-found", "교실 배치 정보를 찾을 수 없습니다.");
        if (!actorCtx.isAdmin && !actorSnap.exists) throw new HttpsError("permission-denied", "같은 학급 구성원만 처리할 수 있습니다.");
        if (operationSnap.exists) {
            if (operationSnap.data().requestHash !== requestHash) {
                throw new HttpsError("already-exists", "같은 요청 식별자로 다른 계약 조건을 적용할 수 없습니다.");
            }
            if (!previewOnly) return operationSnap.data().result;
            throw new HttpsError("already-exists", "이미 완료된 요청입니다. 화면을 새로고침해 주세요.");
        }
        const config = configSnap.data() || {};
        if (config.enabled === false) throw new HttpsError("failed-precondition", "부동산 시스템이 비활성화 상태입니다.");
        const groups = layoutSnap.data().groups || [];
        const allDesks = groups.flatMap((g) => g.desks || []);
        const contractCounts = new Map();
        const closeKeyCounts = new Map();
        for (const desk of allDesks) {
            if (desk.rentContractId) {
                contractCounts.set(desk.rentContractId, (contractCounts.get(desk.rentContractId) || 0) + 1);
                const key = deps.toSafeId(desk.rentContractId);
                closeKeyCounts.set(key, (closeKeyCounts.get(key) || 0) + 1);
            }
        }
        const targets = deskIds.map((id) => {
            const matches = allDesks.filter((d) => d.id === id);
            if (matches.length !== 1) throw new HttpsError("not-found", "선택한 자리 정보가 변경되었습니다. 다시 확인해 주세요.");
            return matches[0];
        }).sort((a, b) => a.id.localeCompare(b.id));
        const rows = targets.map((desk) => ({
            deskId: desk.id, deskLabel: deps.getResolvedDeskLabel(desk), contractId: desk.rentContractId || null,
            depositRefundAmount: 0, rentRefundAmount: 0, taxRefundAmount: 0, unpaidRentAmount: 0,
            ownerDebitAmount: 0, systemCoveredAmount: 0, stateRefundAmount: 0, canApply: true, reason: "새 계약 설정", expired: false,
        }));
        const block = (row, reason) => { row.canApply = false; row.reason = reason; };
        const participants = new Map();
        const closeRefs = new Map();
        const nextDesks = new Map();
        const oldSettledDesks = new Map();

        for (let i = 0; i < targets.length; i++) {
            const desk = targets[i], row = rows[i];
            if (desk.isActive === false || !desk.studentId) { block(row, "현재 학생이 배정된 활성 자리만 처리할 수 있습니다."); continue; }
            let targetForUpdate = desk;
            if (desk.rentContractId) {
                const contract = deps.buildRentContractContext(desk);
                const moneyFields = ["rentPaidAmount", "rentPaidWithheldTaxAmount", "rentDepositPaidAmount", "rentDepositReturnedAmount", "rentDepositDeductedAmount"];
                if (moneyFields.some((key) => Object.prototype.hasOwnProperty.call(desk, key) &&
                    (!Number.isSafeInteger(Number(desk[key])) || Number(desk[key]) < 0))) {
                    block(row, "기존 납부·환급 금액이 올바르지 않아 개별 확인이 필요합니다."); continue;
                }
                // Explicit zero is unpaid. Only genuinely absent legacy amounts
                // may use the existing paid-day fallback.
                if (Object.prototype.hasOwnProperty.call(desk, "rentPaidAmount")) contract.paidAmount = Number(desk.rentPaidAmount);
                if (!contract.hasConfiguredContract || contract.totalContractDays <= 0) { block(row, "기존 계약의 기간·임차인 정보를 개별 확인해 주세요."); continue; }
                if (contract.contractLastDate >= today) { block(row, "진행 중이거나 아직 만료되지 않은 계약입니다."); continue; }
                if (deps.getRentContractLifecycleStatus(desk) !== "active") { block(row, "결제 대기 계약은 개별 계약 화면에서 확인해 주세요."); continue; }
                if (contractCounts.get(desk.rentContractId) !== 1) { block(row, "계약 식별자가 여러 자리에 연결되어 있어 개별 확인이 필요합니다."); continue; }
                if (closeKeyCounts.get(deps.toSafeId(desk.rentContractId)) !== 1) { block(row, "정산 식별자가 다른 계약과 겹쳐 개별 확인이 필요합니다."); continue; }
                if (start <= contract.contractLastDate) { block(row, "새 계약 시작일은 기존 계약의 마지막 거주일 이후여야 합니다."); continue; }
                row.expired = true;
                const accrued = deps.calculateRentAmountFromDays(deps.getDeskWeeklyRentAmount(desk), contract.totalContractDays);
                row.unpaidRentAmount = Math.max(0, accrued - contract.paidAmount);
                if (row.unpaidRentAmount > 0) { block(row, "미납 임대료를 먼저 납부해야 합니다. 자동 징수·보증금 차감은 하지 않습니다."); continue; }
                const deposit = deps.getRentDepositSnapshot(desk);
                if (deposit.returnedAmount + deposit.deductedAmount > deposit.paidAmount) {
                    block(row, "보증금 반환·차감 기록이 납부액보다 커 개별 확인이 필요합니다."); continue;
                }
                row.depositRefundAmount = deposit.outstandingAmount;
                row.rentRefundAmount = calculateUnusedPrepaidRent({
                    weeklyRent: deps.getDeskWeeklyRentAmount(desk), paidDays: Math.max(contract.paidDays, contract.totalContractDays),
                    paidAmount: contract.paidAmount, accruedDays: contract.totalContractDays,
                });
                const ownerUid = String(desk.ownerId || "");
                const tenantUid = String(desk.rentTenantId || "");
                if (deps.isClassFundOwnedDesk(desk)) { block(row, "기금 소유 자리의 정산은 개별 확인이 필요합니다."); continue; }
                if (ownerUid === tenantUid) { block(row, "임대인과 임차인이 같아 개별 확인이 필요합니다."); continue; }
                const paidTax = Object.prototype.hasOwnProperty.call(desk, "rentPaidWithheldTaxAmount")
                    ? Math.max(0, deps.toWholeNumber(desk.rentPaidWithheldTaxAmount))
                    : deps.buildRealEstateRentIncomeTaxSnapshot({ grossAmount: contract.paidAmount, config }).withheldAmount;
                row.taxRefundAmount = ownerUid && contract.paidAmount > 0
                    ? Math.min(paidTax, Math.floor(paidTax * row.rentRefundAmount / contract.paidAmount)) : 0;
                if (![accrued, contract.paidAmount, paidTax, row.depositRefundAmount, row.rentRefundAmount, row.taxRefundAmount, deposit.returnedAmount + deposit.outstandingAmount]
                    .every((value) => Number.isSafeInteger(value) && value >= 0) || row.taxRefundAmount > row.rentRefundAmount ||
                    paidTax > contract.paidAmount || !Number.isSafeInteger(row.depositRefundAmount + row.rentRefundAmount)) {
                    block(row, "기존 납부·환급 금액이 올바르지 않아 개별 확인이 필요합니다."); continue;
                }
                for (const uid of [tenantUid, ownerUid].filter(Boolean)) {
                    if (!participants.has(uid)) participants.set(uid, { ref: db.doc(`classes/${classId}/students/${uid}`) });
                }
                closeRefs.set(desk.id, db.doc(`classes/${classId}/real_estate/rent_deposits/records/close_${deps.toSafeId(desk.rentContractId)}`));
                const settled = {
                    ...desk, rentClosedAt: deps.FieldValue.serverTimestamp(),
                    rentDepositReturnedAmount: deposit.returnedAmount + deposit.outstandingAmount,
                    rentDepositReturnedAt: deps.FieldValue.serverTimestamp(), rentDepositStatus: "returned",
                    rentDepositSettlementReason: "교사 만료 계약 일괄 정산 후 재계약",
                };
                oldSettledDesks.set(desk.id, settled);
                targetForUpdate = deps.clearDeskRentContract(desk, 0);
                row.reason = "만료 계약 정산 후 새 계약 설정";
            }
            try {
                nextDesks.set(desk.id, await deps.buildUpdatedRentContractDesk({
                    transaction, classId, config, targetDesk: targetForUpdate, actorUid: actorCtx.uid,
                    canManageClass: true, payload,
                }));
            } catch (error) {
                if (!(error instanceof HttpsError)) throw error;
                block(row, error.message);
            }
        }

        // Read all accounts and deterministic settlement guards before any write.
        await Promise.all([...participants.values()].map(async (p) => { p.snap = await transaction.get(p.ref); }));
        const closeSnaps = new Map(await Promise.all([...closeRefs].map(async ([id, ref]) => [id, await transaction.get(ref)])));
        const availableCash = new Map([...participants].map(([uid, p]) => [uid, Math.max(0, Number(p.snap.data()?.assets?.cash || 0))]));
        for (let i = 0; i < targets.length; i++) {
            const desk = targets[i], row = rows[i];
            if (!row.canApply || !row.expired) continue;
            if (closeSnaps.get(desk.id)?.exists) { block(row, "이 계약의 종료·정산 기록이 이미 있습니다. 개별 확인 후 다시 시도해 주세요."); continue; }
            const ownerUid = String(desk.ownerId || ""), tenantUid = String(desk.rentTenantId || "");
            if (!participants.get(tenantUid)?.snap.exists || (ownerUid && !participants.get(ownerUid)?.snap.exists)) {
                block(row, "임대 당사자의 학생 기록을 찾을 수 없습니다."); continue;
            }
            if ([tenantUid, ownerUid].filter(Boolean).some((uid) => {
                const cash = participants.get(uid).snap.data()?.assets?.cash ?? 0;
                return typeof cash !== "number" || !Number.isFinite(cash) || Math.abs(cash) > Number.MAX_SAFE_INTEGER;
            })) { block(row, "임대 당사자의 잔액 정보가 올바르지 않아 개별 확인이 필요합니다."); continue; }
            const totalRefund = row.depositRefundAmount + row.rentRefundAmount;
            if (ownerUid) {
                const cash = availableCash.get(ownerUid);
                if (!Number.isFinite(cash)) { block(row, "임대인의 잔액 정보를 확인해 주세요."); continue; }
                const ownerDue = row.depositRefundAmount + row.rentRefundAmount - row.taxRefundAmount;
                row.ownerDebitAmount = Math.min(cash, ownerDue);
                row.systemCoveredAmount = ownerDue - row.ownerDebitAmount;
                availableCash.set(ownerUid, cash - row.ownerDebitAmount);
                if (row.systemCoveredAmount > 0 && !allowSystemCoverage) block(row, "임대인 잔액이 부족합니다. 시스템 보전 금액을 확인하고 별도로 허용해 주세요.");
            } else row.stateRefundAmount = totalRefund;
        }
        const totals = rows.reduce((out, row) => {
            for (const key of Object.keys(out)) out[key] += row[key];
            return out;
        }, { depositRefundAmount: 0, rentRefundAmount: 0, taxRefundAmount: 0, unpaidRentAmount: 0, ownerDebitAmount: 0, systemCoveredAmount: 0, stateRefundAmount: 0 });
        if (!Object.values(totals).every(Number.isSafeInteger)) throw new HttpsError("failed-precondition", "정산 합계가 처리 가능한 금액 범위를 넘습니다. 개별 확인해 주세요.");
        const projectedDeltas = new Map();
        rows.forEach((row, index) => {
            if (!row.canApply || !row.expired) return;
            const target = targets[index], tenantUid = String(target.rentTenantId), ownerUid = String(target.ownerId || "");
            projectedDeltas.set(tenantUid, (projectedDeltas.get(tenantUid) || 0) + row.depositRefundAmount + row.rentRefundAmount);
            if (ownerUid) projectedDeltas.set(ownerUid, (projectedDeltas.get(ownerUid) || 0) - row.ownerDebitAmount);
        });
        for (const [uid, delta] of projectedDeltas) {
            const nextCash = (participants.get(uid).snap.data()?.assets?.cash ?? 0) + delta;
            if (!Number.isFinite(nextCash) || Math.abs(nextCash) > Number.MAX_SAFE_INTEGER) throw new HttpsError("failed-precondition", "정산 후 잔액이 처리 가능한 금액 범위를 넘습니다.");
        }
        const previewHash = fingerprint({
            requestHash, today: formatDateKeyInKST(today), config, targets, rows,
            participants: [...participants].map(([uid, p]) => ({ uid, exists: p.snap.exists, cash: p.snap.data()?.assets?.cash ?? 0 })),
        });
        const preview = { previewOnly: true, previewHash, rows, totals, targetCount: rows.length, expiredCount: rows.filter((r) => r.expired).length, blockedCount: rows.filter((r) => !r.canApply).length, canApply: rows.every((r) => r.canApply) };
        if (previewOnly) return preview;
        if (input.previewHash !== previewHash) throw new HttpsError("aborted", "정산 대상·금액이 변경되었습니다. 미리보기를 다시 확인해 주세요.");
        if (!preview.canApply) throw new HttpsError("failed-precondition", "처리할 수 없는 자리가 포함되어 있습니다. 미리보기에서 해당 자리를 확인해 주세요.");

        const logContext = { config: globalConfig, planType: "FREE", serviceName: "realestate" };
        const balances = new Map();
        const addBalance = (uid, amount) => balances.set(uid, (balances.get(uid) || 0) + amount);
        for (let i = 0; i < targets.length; i++) {
            const desk = targets[i], row = rows[i];
            if (!row.expired) continue;
            const tenantUid = String(desk.rentTenantId), ownerUid = String(desk.ownerId || "");
            addBalance(tenantUid, row.depositRefundAmount + row.rentRefundAmount);
            if (ownerUid) addBalance(ownerUid, -row.ownerDebitAmount);
            const settlementRef = closeRefs.get(desk.id);
            const archive = splitLayout({ groups: [{ id: "archive", desks: [{ ...oldSettledDesks.get(desk.id), rentReplacementContractId: nextDesks.get(desk.id).rentContractId }] }] }).contracts.get(desk.rentContractId);
            transaction.set(db.doc(`classes/${classId}/real_estate/contracts/records/${desk.rentContractId}`), archive);
            transaction.set(settlementRef, {
                type: "recontract", source: "expired_rent_bulk_reset", contractId: desk.rentContractId,
                replacementContractId: nextDesks.get(desk.id).rentContractId, deskId: desk.id,
                tenantId: tenantUid, ownerId: ownerUid || "STATE", depositRefundAmount: row.depositRefundAmount,
                unusedRentRefundAmount: row.rentRefundAmount, taxRefundAmount: row.taxRefundAmount,
                ownerDebitAmount: row.ownerDebitAmount, systemCoveredAmount: row.systemCoveredAmount + row.stateRefundAmount,
                forcedByTeacher: row.systemCoveredAmount > 0, clientRequestId,
                createdAt: deps.FieldValue.serverTimestamp(), createdBy: actorCtx.uid,
            });
            for (const [amount, subCategory, description] of [
                [row.depositRefundAmount, "rent_deposit_refund", "임대 보증금 반환"],
                [row.rentRefundAmount, "rent_refund", "재계약 미사용 선납 임대료 반환"],
            ]) {
                if (amount > 0) deps.stageActivityLog(transaction, classId, {
                    studentUid: tenantUid, type: "income", category: "real_estate", subCategory,
                    amount, description: `${row.deskLabel} ${description}`, currency: "class_currency",
                    source: "expired_rent_bulk_reset", actorUid: actorCtx.uid, relatedDoc: settlementRef.path,
                    contractId: desk.rentContractId, clientRequestId,
                }, { ...logContext, customId: `${settlementRef.id}_${subCategory}` });
            }
            if (row.ownerDebitAmount > 0) deps.stageActivityLog(transaction, classId, {
                studentUid: ownerUid, type: "expense", category: "real_estate", subCategory: "rent_recontract_refund",
                amount: row.ownerDebitAmount, description: `${row.deskLabel} 재계약 정산 반환`, currency: "class_currency",
                source: "expired_rent_bulk_reset", actorUid: actorCtx.uid, relatedDoc: settlementRef.path,
                contractId: desk.rentContractId, clientRequestId,
            }, { ...logContext, customId: `${settlementRef.id}_owner_refund` });
            if (row.taxRefundAmount > 0) deps.stageTaxExpense(transaction, classId, {
                amount: row.taxRefundAmount, expenseType: "rental_income_tax_refund", category: "tax_refund",
                description: `${row.deskLabel} 재계약 임대소득세 환급 조정`, studentUid: ownerUid,
                studentName: desk.ownerName || null, source: "real_estate_recontract",
            }, actorCtx.uid, { ...logContext, customId: `realestate_recontract_tax_${deps.toSafeId(desk.rentContractId)}`, skipFeatureGate: true });
        }
        for (const [uid, amount] of balances) {
            if (amount !== 0) transaction.update(participants.get(uid).ref, { "assets.cash": deps.FieldValue.increment(amount) });
        }
        deps.stageRealEstateLayout(transaction, layoutRef, {
            groups: groups.map((group) => ({ ...group, desks: (group.desks || []).map((desk) => nextDesks.get(desk.id) || desk) })),
            updatedAt: deps.FieldValue.serverTimestamp(),
        });
        const result = { success: true, updatedCount: rows.length, settledCount: preview.expiredCount, totals,
            updatedDeskLabels: rows.map((r) => r.deskLabel), message: `${preview.expiredCount}개 만료 계약을 정산하고 ${rows.length}개 자리에 새 계약을 설정했습니다.` };
        transaction.create(operationRef, { requestHash, clientRequestId, createdBy: actorCtx.uid, source: "expired_rent_bulk_reset", result, createdAt: deps.FieldValue.serverTimestamp() });
        return result;
    });
}

module.exports = { runExpiredRentBulkReset };
