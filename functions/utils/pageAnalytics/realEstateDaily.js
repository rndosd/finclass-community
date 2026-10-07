"use strict";
const { readRealEstateLayout } = require("../realEstateStorage");

const {
    BACKFILL_START_DATE,
    buildBasePayload,
    ensureStudent,
    getDateWindow,
    hasAnyDocs,
    increment,
    isInWindow,
    listStudents,
    pickStudentSnapshot,
    requireDateKey,
    roundAmount,
    stringOrNull,
    timestampToMillis,
    toNumber,
} = require("./common");

const COLLECTION = "realEstateAnalyticsDaily";
const HOLDING_TAX_BILL_KIND = "realestate_holding";
const SALE_LEDGER_TYPES = new Set(["sale", "auction_sale"]);

function applyStudentDelta(byStudent, snapshot, fields) {
    const row = ensureStudent(byStudent, snapshot);
    row.eventCount += 1;
    Object.entries(fields).forEach(([key, value]) => {
        row[key] = roundAmount(toNumber(row[key]) + value);
    });
    return row;
}

function isPaidByDate(bill = {}, endDate) {
    if (!(bill.isPaid === true || bill.status === "paid")) return false;
    const paidMs = timestampToMillis(bill.paidAt);
    return Number.isFinite(paidMs) && paidMs <= endDate.getTime();
}

function readLayoutSnapshot(layoutData = {}) {
    const groups = Array.isArray(layoutData.groups) ? layoutData.groups : [];
    const byOwner = {};
    const snapshot = {
        deskCount: 0,
        ownedDeskCount: 0,
        stateDeskCount: 0,
        rentedDeskCount: 0,
        totalOfficialPrice: 0,
        totalLastPurchasePrice: 0,
    };

    groups.forEach((group) => {
        const desks = Array.isArray(group?.desks) ? group.desks : [];
        desks.forEach((desk) => {
            snapshot.deskCount += 1;
            const ownerId = stringOrNull(desk.ownerId);
            const price = roundAmount(desk.price || desk.officialPrice || 0);
            const market = roundAmount(desk.lastPurchasePrice || desk.marketPrice || desk.askingPrice || 0);
            snapshot.totalOfficialPrice += price;
            snapshot.totalLastPurchasePrice += market;
            if (ownerId) {
                snapshot.ownedDeskCount += 1;
                if (!byOwner[ownerId]) {
                    byOwner[ownerId] = {
                        uid: ownerId,
                        studentName: stringOrNull(desk.ownerName) || "학생",
                        studentNumber: null,
                        deskCount: 0,
                        officialPrice: 0,
                        lastPurchasePrice: 0,
                    };
                }
                byOwner[ownerId].deskCount += 1;
                byOwner[ownerId].officialPrice = roundAmount(byOwner[ownerId].officialPrice + price);
                byOwner[ownerId].lastPurchasePrice = roundAmount(byOwner[ownerId].lastPurchasePrice + market);
            } else {
                snapshot.stateDeskCount += 1;
            }
            if (desk.rentTenantId || desk.tenantId) snapshot.rentedDeskCount += 1;
        });
    });

    snapshot.totalOfficialPrice = roundAmount(snapshot.totalOfficialPrice);
    snapshot.totalLastPurchasePrice = roundAmount(snapshot.totalLastPurchasePrice);
    snapshot.byOwner = byOwner;
    return snapshot;
}

async function buildRealEstateDaily(db, classId, dateKey, options = {}) {
    requireDateKey(dateKey, "dateKey");
    const window = getDateWindow(dateKey);
    const classRef = db.collection("classes").doc(classId);
    const [ledgerSnap, rentSnap, layoutSnap, students] = await Promise.all([
        classRef
            .collection("real_estate/ledger/transactions")
            .where("timestamp", ">=", window.startTs)
            .where("timestamp", "<=", window.endTs)
            .get()
            .catch(() => classRef.collection("real_estate/ledger/transactions").limit(0).get()),
        classRef
            .collection("real_estate/rent_payments/records")
            .where("paidAt", ">=", window.startTs)
            .where("paidAt", "<=", window.endTs)
            .get()
            .catch(() => classRef.collection("real_estate/rent_payments/records").limit(0).get()),
        readRealEstateLayout(db, classRef.collection("real_estate").doc("layout"), undefined, { includeSaleContracts: false }),
        listStudents(classRef),
    ]);

    const byStudent = {};
    const byType = {};
    const totals = {
        eventCount: 0,
        saleCount: 0,
        saleAmount: 0,
        taxAmount: 0,
        marketAdjustmentCount: 0,
        marketAdjustmentDeskCount: 0,
        rentPaymentCount: 0,
        rentAmount: 0,
        holdingTaxIssuedCount: 0,
        holdingTaxIssuedAmount: 0,
        holdingTaxPaidCount: 0,
        holdingTaxPaidAmount: 0,
    };
    const snapshot = {
        property: layoutSnap.exists ? readLayoutSnapshot(layoutSnap.data() || {}) : readLayoutSnapshot({}),
        holdingTaxUnpaidCount: 0,
        holdingTaxUnpaidAmount: 0,
        holdingTaxOverdueCount: 0,
        holdingTaxOverdueAmount: 0,
    };
    const sourceCounts = {
        ledgerTransactions: ledgerSnap.size,
        rentPayments: rentSnap.size,
        holdingTaxBills: 0,
        layout: layoutSnap.exists ? 1 : 0,
    };
    const marketAdjustmentDeskIds = new Set();

    ledgerSnap.forEach((docSnap) => {
        const row = docSnap.data() || {};
        if (!isInWindow(row.timestamp, window)) return;
        const type = stringOrNull(row.type) || "unknown";
        const amount = roundAmount(row.amount || row.tradePrice || row.finalPrice || 0);
        const taxAmount = roundAmount(
            row.taxAmount ||
            row.taxAggregateAmount ||
            (toNumber(row.acquisitionTax) + toNumber(row.capitalGainsTax)),
        );
        totals.eventCount += 1;
        increment(byType, type, 1);

        if (type === "market_adjustment") {
            totals.marketAdjustmentCount += 1;
            const deskId = stringOrNull(row.deskId);
            if (deskId) marketAdjustmentDeskIds.add(deskId);
            return;
        }

        if (!SALE_LEDGER_TYPES.has(type)) return;

        totals.saleCount += 1;
        totals.saleAmount += amount;
        totals.taxAmount += taxAmount;

        if (row.buyerId) {
            applyStudentDelta(
                byStudent,
                pickStudentSnapshot({
                    studentUid: row.buyerId,
                    studentName: row.buyerName,
                    studentNumber: row.buyerNumber,
                }),
                { purchaseAmount: amount, purchaseTaxAmount: taxAmount },
            );
        }
        if (row.sellerId && row.sellerId !== "STATE") {
            applyStudentDelta(
                byStudent,
                pickStudentSnapshot({
                    studentUid: row.sellerId,
                    studentName: row.sellerName,
                    studentNumber: row.sellerNumber,
                }),
                { saleIncomeAmount: roundAmount(row.sellerNetIncome || amount) },
            );
        }
    });
    totals.marketAdjustmentDeskCount = marketAdjustmentDeskIds.size;

    rentSnap.forEach((docSnap) => {
        const row = docSnap.data() || {};
        if (!isInWindow(row.paidAt, window)) return;
        const amount = roundAmount(row.amount || 0);
        totals.eventCount += 1;
        totals.rentPaymentCount += 1;
        totals.rentAmount += amount;
        increment(byType, "rent_payment", 1);
        if (row.tenantId) {
            applyStudentDelta(
                byStudent,
                pickStudentSnapshot({
                    studentUid: row.tenantId,
                    studentName: row.tenantName,
                }),
                { rentPaidAmount: amount },
            );
        }
        if (row.ownerId && row.ownerId !== "STATE") {
            applyStudentDelta(
                byStudent,
                pickStudentSnapshot({
                    studentUid: row.ownerId,
                    studentName: row.ownerName,
                }),
                { rentReceivedAmount: amount },
            );
        }
    });

    for (const student of students) {
        const billSnap = await classRef
            .collection("students")
            .doc(student.uid)
            .collection("taxBills")
            .where("billKind", "==", HOLDING_TAX_BILL_KIND)
            .get()
            .catch(() => ({ forEach: () => {}, size: 0 }));
        sourceCounts.holdingTaxBills += billSnap.size || 0;
        billSnap.forEach((docSnap) => {
            const bill = docSnap.data() || {};
            const amount = roundAmount(bill.amount || bill.totalAmount || 0);
            const issuedInWindow = isInWindow(bill.issuedAt || bill.createdAt, window);
            const paidInWindow = isInWindow(bill.paidAt, window);
            if (issuedInWindow) {
                totals.eventCount += 1;
                totals.holdingTaxIssuedCount += 1;
                totals.holdingTaxIssuedAmount += amount;
                applyStudentDelta(byStudent, {
                    uid: student.uid,
                    name: bill.studentName || student.name,
                    number: student.number,
                }, { holdingTaxIssuedAmount: amount });
            }
            if (paidInWindow) {
                totals.eventCount += 1;
                totals.holdingTaxPaidCount += 1;
                totals.holdingTaxPaidAmount += amount;
                applyStudentDelta(byStudent, {
                    uid: student.uid,
                    name: bill.studentName || student.name,
                    number: student.number,
                }, { holdingTaxPaidAmount: amount });
            }

            const issuedMs = timestampToMillis(bill.issuedAt || bill.createdAt);
            if (!Number.isFinite(issuedMs) || issuedMs > window.endDate.getTime()) return;
            if (isPaidByDate(bill, window.endDate)) return;
            snapshot.holdingTaxUnpaidCount += 1;
            snapshot.holdingTaxUnpaidAmount += amount;
            const dueMs = timestampToMillis(bill.dueDate || bill.dueAt);
            if (Number.isFinite(dueMs) && dueMs < window.endDate.getTime()) {
                snapshot.holdingTaxOverdueCount += 1;
                snapshot.holdingTaxOverdueAmount += amount;
            }
        });
    }

    totals.saleAmount = roundAmount(totals.saleAmount);
    totals.taxAmount = roundAmount(totals.taxAmount);
    totals.rentAmount = roundAmount(totals.rentAmount);
    snapshot.holdingTaxUnpaidAmount = roundAmount(snapshot.holdingTaxUnpaidAmount);
    snapshot.holdingTaxOverdueAmount = roundAmount(snapshot.holdingTaxOverdueAmount);

    return {
        ...buildBasePayload({
            classId,
            dateKey,
            domain: "realEstate",
            status: totals.eventCount > 0 || snapshot.property.ownedDeskCount > 0 ? "ready" : "empty",
            generatedBy: options.source,
            sourceCollections: [
                "real_estate/ledger/transactions",
                "real_estate/rent_payments/records",
                "students/{uid}/taxBills",
                "real_estate/layout",
            ],
            sourceCounts,
            sourceRanges: {
                ledgerTransactions: {
                    field: "timestamp",
                    start: window.startDate.toISOString(),
                    end: window.endDate.toISOString(),
                },
                rentPayments: {
                    field: "paidAt",
                    start: window.startDate.toISOString(),
                    end: window.endDate.toISOString(),
                },
                holdingTaxBills: {
                    fields: ["issuedAt", "paidAt"],
                    start: window.startDate.toISOString(),
                    end: window.endDate.toISOString(),
                },
            },
        }),
        eventTotals: totals,
        byStudent,
        byType,
        snapshot,
    };
}

async function hasRealEstateActivity(db, classId, startDate = BACKFILL_START_DATE) {
    const classRef = db.collection("classes").doc(classId);
    const start = getDateWindow(startDate).startTs;
    const [ledger, rent, layout] = await Promise.all([
        hasAnyDocs(classRef.collection("real_estate/ledger/transactions"), [["timestamp", ">=", start]]).catch(() => false),
        hasAnyDocs(classRef.collection("real_estate/rent_payments/records"), [["paidAt", ">=", start]]).catch(() => false),
        readRealEstateLayout(db, classRef.collection("real_estate").doc("layout")).catch(() => ({ exists: false })),
    ]);
    if (ledger || rent) return true;
    if (layout.exists) {
        const property = readLayoutSnapshot(layout.data() || {});
        if (property.ownedDeskCount > 0) return true;
    }
    const students = await listStudents(classRef);
    for (const student of students) {
        const hasBill = await hasAnyDocs(
            classRef.collection("students").doc(student.uid).collection("taxBills"),
            [["billKind", "==", HOLDING_TAX_BILL_KIND]],
        ).catch(() => false);
        if (hasBill) return true;
    }
    return false;
}

module.exports = {
    COLLECTION,
    buildDaily: buildRealEstateDaily,
    hasActivity: hasRealEstateActivity,
};
