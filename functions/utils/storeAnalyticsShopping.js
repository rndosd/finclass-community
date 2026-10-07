"use strict";

// A once-daily operational snapshot. Existing financial/refund aggregates stay intact.
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const currencyKey = (value) => {
    const key = String(value || "cash").trim().toLowerCase();
    return ["cash", "money", "class", "default"].includes(key) ? "cash" : key;
};
const empty = () => ({ amount: 0, quantity: 0, lineCount: 0 });
const add = (target, row) => {
    target.amount = money(target.amount + number(row.totalAmount));
    target.quantity += Math.max(1, Math.floor(number(row.quantity)));
    target.lineCount += 1;
};

function buildShoppingSnapshot(rows = []) {
    const byCurrency = {};
    const byItem = {};
    const byStudent = {};
    const gifts = { ...empty(), byCurrency: {} };
    const classFund = { ...empty(), byCurrency: {} };
    const seen = new Set();
    let excludedCount = 0;
    for (const row of rows) {
        if (!["completed", "redeemed"].includes(row.status)) continue;
        if (row.id && seen.has(row.id)) continue;
        if (row.id) seen.add(row.id);
        const gift = row.isGift === true || row.transactionType === "gift";
        const fund = row.paymentSourceType === "classFund";
        const recordedType = String(row.currencyType || "").trim();
        const recordedField = String(row.currencyField || "").trim();
        // Historical records must carry their own currency evidence. Never infer
        // paid spending from today's item or silently label unknown money as cash.
        if (!gift && ((!recordedType && !recordedField) ||
            (recordedType && recordedField && currencyKey(recordedType) !== currencyKey(recordedField)))) {
            excludedCount += 1;
            continue;
        }
        const currency = currencyKey(recordedType || recordedField);
        const unit = String(row.currencyUnit || "");
        if (gift || fund) {
            const target = gift ? gifts : classFund;
            // A gift has a notional item value, but no student expenditure.
            add(target, { ...row, totalAmount: gift ? 0 : row.totalAmount });
            target.byCurrency[currency] ||= { ...empty(), unit };
            add(target.byCurrency[currency], { ...row, totalAmount: gift ? 0 : row.totalAmount });
            continue;
        }
        if (!(number(row.totalAmount) > 0) || !row.studentUid || !row.itemId) {
            excludedCount += 1;
            continue;
        }
        byCurrency[currency] ||= { ...empty(), unit };
        add(byCurrency[currency], row);
        byItem[row.itemId] ||= {
            name: row.itemName || "상품", quantity: 0, lineCount: 0, byCurrency: {},
        };
        const item = byItem[row.itemId];
        item.quantity += Math.max(1, Math.floor(number(row.quantity)));
        item.lineCount += 1;
        item.byCurrency[currency] ||= { ...empty(), unit };
        add(item.byCurrency[currency], row);
        byStudent[row.studentUid] ||= {
            name: row.studentName || "학생", studentNumber: row.studentNumber ?? null,
            quantity: 0, lineCount: 0, byCurrency: {},
        };
        const student = byStudent[row.studentUid];
        student.quantity += Math.max(1, Math.floor(number(row.quantity)));
        student.lineCount += 1;
        student.byCurrency[currency] ||= { ...empty(), unit };
        add(student.byCurrency[currency], row);
    }
    return {
        version: 1, status: "ready", byCurrency, byItem, byStudent, gifts, classFund,
        quantity: Object.values(byItem).reduce((sum, row) => sum + row.quantity, 0),
        participantCount: Object.keys(byStudent).length, excludedCount,
    };
}

function buildPriceItemMetadata(itemMap) {
    const result = {};
    itemMap.forEach((item, id) => {
        result[id] = {
            name: item.name || "상품", currencyType: currencyKey(item.currencyType),
            currencyUnit: String(item.currencyUnit || "").trim(),
            isActive: item.isActive !== false, saleStatus: item.saleStatus || null,
        };
    });
    return result;
}

function buildCapturedPrices(itemMap) {
    return Object.fromEntries(Array.from(itemMap.entries())
        .filter(([, item]) => Number.isFinite(item.price) && item.price > 0)
        .map(([id, item]) => [id, money(item.price)]));
}

module.exports = { buildShoppingSnapshot, buildPriceItemMetadata, buildCapturedPrices };
