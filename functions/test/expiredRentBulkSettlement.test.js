"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const { splitLayout, joinLayout } = require("../utils/realEstateStorageSchema");
const base = "classes/c1/real_estate/";
const desk = () => ({ id: "d1", permanentId: "p1", number: 1, isActive: true, studentId: "tenant", studentName: "김가람", ownerId: "owner", weeklyRent: 70, rentContractId: "old-rent", rentContractStatus: "active", rentTenantId: "tenant", rentStartAt: "2026-09-01", rentLastDateAt: "2026-09-07", rentPaidDays: 8, rentPaidAmount: 80, rentPaidWithheldTaxAmount: 8, rentDepositAmount: 50, rentDepositPaidAmount: 50, rentDepositReturnedAmount: 0, rentDepositDeductedAmount: 0, x: 25, y: 40, rotation: 30 });
function setup(overrides = {}, { split = true, cash = 2000, extra = [], accounts = {} } = {}) {
    const layout = { groups: [{ id: "g", desks: [{ ...desk(), ...overrides }, ...extra] }] };
    let storage = { [base + "layout"]: layout };
    if (split) { const s = splitLayout(layout); storage = Object.fromEntries([[base + "layout", s.layout], ...[...s.properties].map(([id, d]) => [base + "properties/items/" + id, d]), ...[...s.contracts].map(([id, d]) => [base + "contracts/records/" + id, d])]); }
    const h = createCallableHarness({ ...storage, "classes/c1/students/teacher": { role: "teacher" }, "classes/c1/students/tenant": { assets: { cash: 1000 } }, "classes/c1/students/owner": { assets: { cash } }, [base + "config"]: { enabled: true }, [base + "rent_payments/records/payment"]: { deskId: "d1", contractId: "old-rent", tenantId: "tenant", amount: 80, paidDays: 8 }, ...accounts }, { retryTransaction: true });
    const api = h.load("functions/src/realestate.js");
    const request = { auth: { uid: "teacher", token: { classId: "c1", role: "teacher" } }, data: { classId: "c1", deskIds: ["d1"], weeklyRent: 140, depositAmount: 100, rentStartDateKey: "2026-09-08", rentLastDateKey: "2026-09-21", settleExpiredContracts: true, clientRequestId: "bulk-request-1", previewOnly: true } };
    const call = () => api.updateRealEstateRentContractsBulk(request);
    const apply = async () => { const quote = await call(); request.data.previewOnly = false; request.data.previewHash = quote.previewHash; return call(); };
    const read = () => joinLayout(h.data.get(base + "layout"), new Map([...h.data].filter(([p]) => p.startsWith(base + "properties/items/")).map(([p, d]) => [p.split('/').at(-1), d])), new Map([...h.data].filter(([p]) => p.startsWith(base + "contracts/records/")).map(([p, d]) => [p.split('/').at(-1), d]))).groups[0].desks[0];
    return { h, request, call, apply, read };
}
test("preview is read-only and exposes exact refunds and tax adjustment", async () => {
    const { h, call } = setup(); const quote = await call();
    assert.equal(quote.canApply, true); assert.equal(quote.expiredCount, 1);
    assert.equal(quote.totals.depositRefundAmount, 50); assert.equal(quote.totals.rentRefundAmount, 10);
    assert.equal(quote.totals.taxRefundAmount, 1); assert.equal(quote.totals.ownerDebitAmount, 59);
    assert.equal(h.writes.length, 0);
});
for (const split of [false, true]) test(`atomic settlement preserves history, seat identity and refunds once (${split ? 'split' : 'legacy'})`, async () => {
    const { h, call, apply, read } = setup({}, { split }); const payment = structuredClone(h.data.get(base + "rent_payments/records/payment"));
    const result = await apply(); assert.equal(result.settledCount, 1);
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash, 1060);
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 1941);
    const next = read(); assert.notEqual(next.rentContractId, "old-rent"); assert.equal(next.rentContractStatus, "pending_payment");
    assert.equal(next.studentId, "tenant"); assert.equal(next.permanentId, "p1"); assert.equal(next.rotation, 30); assert.equal(next.x, 25);
    const archived = h.data.get(base + "contracts/records/old-rent").fields;
    assert.equal(archived.rentDepositReturnedAmount, 50); assert.equal(archived.rentPaidAmount, 80);
    assert.deepEqual(h.data.get(base + "rent_payments/records/payment"), payment);
    assert.equal(h.data.get(base + "rent_deposits/records/close_old-rent").unusedRentRefundAmount, 10);
    assert.equal(h.data.get("classes/c1/taxExpenses/realestate_recontract_tax_old-rent").amount, 1);
    const refunds = [...h.data].filter(([path]) => path.startsWith("classes/c1/students/tenant/activityLogs/")).map(([, value]) => value);
    assert.equal(refunds.reduce((sum, log) => sum + log.amount, 0), 60);
    assert.ok(refunds.every(log => log.actorUid === 'teacher' && log.contractId === 'old-rent' && log.relatedDoc.endsWith('close_old-rent')));
    const writeCount = h.writes.length; const retry = await call(); assert.equal(retry.settledCount, 1); assert.equal(h.writes.length, writeCount);
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash, 1060);
});
test("system coverage is explicit and owner cash never becomes negative", async () => {
    const { h, request, call, apply } = setup({}, { cash: 20 });
    const quote = await call(); assert.equal(quote.canApply, false); assert.equal(quote.totals.systemCoveredAmount, 39);
    assert.equal(h.writes.length, 0); request.data.allowSystemCoverage = true;
    await apply(); assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 0);
    assert.equal(h.data.get(base + "rent_deposits/records/close_old-rent").systemCoveredAmount, 39);
});
test("multiple refunds share owner balance instead of spending it twice", async () => {
    const second = { ...desk(), id: "d2", permanentId: "p2", number: 2, rentContractId: "other-rent", studentId: "other", rentTenantId: "other" };
    const { request, call, apply, h } = setup({}, { cash: 80, extra: [second], accounts: { "classes/c1/students/other": { assets: { cash: 1000 } } } });
    request.data.deskIds.push("d2"); const quote = await call(); assert.equal(quote.totals.ownerDebitAmount, 80); assert.equal(quote.totals.systemCoveredAmount, 38); assert.equal(quote.canApply, false);
    request.data.allowSystemCoverage = true; await apply(); assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 0); assert.equal(h.data.get("classes/c1/students/other").assets.cash, 1060);
});
for (const [name, overrides, reason] of [
    ["ongoing", { rentLastDateAt: "2026-09-08" }, /진행 중/],
    ["unpaid", { rentPaidAmount: 60 }, /미납/],
    ["explicit zero paid amount", { rentPaidAmount: 0 }, /미납/],
    ["invalid deposit ledger", { rentDepositReturnedAmount: 60 }, /보증금 반환/],
    ["pending payment", { rentContractStatus: "pending_payment" }, /결제 대기/],
    ["tenant changed", { studentId: "other" }, /임차인/],
    ["corrupt tax", { rentPaidWithheldTaxAmount: 1000 }, /금액이 올바르지/],
]) test(`${name} is blocked with no partial writes`, async () => {
    const { h, request, call } = setup(overrides); const quote = await call(); assert.equal(quote.canApply, false); assert.match(quote.rows[0].reason, reason);
    request.data.previewOnly = false; request.data.previewHash = quote.previewHash; await assert.rejects(call(), /처리할 수 없는/); assert.equal(h.writes.length, 0);
});
test("concurrent balance change invalidates quote without any writes", async () => {
    const { h, request, call } = setup(); const quote = await call(); h.data.get("classes/c1/students/owner").assets.cash = 1999;
    request.data.previewOnly = false; request.data.previewHash = quote.previewHash; await assert.rejects(call(), /미리보기를 다시/); assert.equal(h.writes.length, 0);
});
test("existing closure or missing tenant cannot be refunded again", async () => {
    for (const guard of ['closure', 'missing']) {
        const { h, call } = setup(); if (guard === 'closure') h.data.set(base + "rent_deposits/records/close_old-rent", { type: "recontract" }); else h.data.delete("classes/c1/students/tenant");
        const quote = await call(); assert.equal(quote.canApply, false); assert.equal(h.writes.length, 0);
    }
});
test("new contract dates cannot overlap old period", async () => { const { request, call } = setup(); request.data.rentStartDateKey = "2026-09-07"; const quote = await call(); assert.equal(quote.canApply, false); assert.match(quote.rows[0].reason, /마지막 거주일 이후/); });
test("completed request ID cannot be reused with changed conditions", async () => { const { request, apply, call } = setup(); await apply(); request.data.weeklyRent = 150; await assert.rejects(call(), /다른 계약 조건/); });
test("student cannot perform teacher bulk settlement", async () => { const { request, call, h } = setup(); request.auth = { uid: "tenant", token: { classId: "c1", role: "student" } }; await assert.rejects(call(), /권한|교사/); assert.equal(h.writes.length, 0); });
test("delegated student manager is denied bulk financial settlement", async () => { const { request, call, h } = setup(); request.auth = { uid: "tenant", token: { classId: "c1", role: "student", permissions: { realestate_admin: true } } }; await assert.rejects(call(), /담당 교사/); assert.equal(h.writes.length, 0); });
test("40 seats with individual counterparties stay below the transaction write limit", async () => {
    const extra = [], accounts = {};
    for (let i = 2; i <= 40; i++) {
        extra.push({ ...desk(), id: `d${i}`, permanentId: `p${i}`, number: i, rentContractId: `rent-${i}`, studentId: `tenant-${i}`, rentTenantId: `tenant-${i}`, ownerId: `owner-${i}` });
        accounts[`classes/c1/students/tenant-${i}`] = { assets: { cash: 1000 } };
        accounts[`classes/c1/students/owner-${i}`] = { assets: { cash: 2000 } };
    }
    const { request, apply, h } = setup({}, { extra, accounts }); request.data.deskIds = ['d1', ...extra.map(d => d.id)];
    const result = await apply(); assert.equal(result.settledCount, 40); assert.ok(h.writes.length < 500, `${h.writes.length} writes`);
});
test("41-seat settlement is rejected before reads or writes", async () => { const { request, call, h } = setup(); request.data.deskIds = Array.from({ length: 41 }, (_, i) => `d${i}`); await assert.rejects(call(), /최대 40개/); assert.equal(h.writes.length, 0); });
test("state refunds do not debit a private owner", async () => { const { apply, h } = setup({ ownerId: null }); const result = await apply(); assert.equal(result.totals.stateRefundAmount, 60); assert.equal(result.totals.systemCoveredAmount, 0); assert.equal(h.data.get("classes/c1/students/owner").assets.cash, 2000); });
test("non-numeric account cash is blocked instead of being overwritten by increment", async () => { const { h, call } = setup(); h.data.get('classes/c1/students/tenant').assets.cash = '1000'; const preview = await call(); assert.equal(preview.canApply, false); assert.equal(h.writes.length, 0); });
