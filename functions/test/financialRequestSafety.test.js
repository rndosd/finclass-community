"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");

const student = "classes/class-a/students/student-a";
const auth = { uid: "student-a", token: { role: "student", classId: "class-a" } };
const seed = () => ({
    "classes/class-a": { currencyUnit: "unit", stockJobIndex: { version: 1 } },
    [student]: { name: "Synthetic A", role: "student", assets: { cash: 100, usdBalance: 1000, stockValue: { value: 0 } } },
    "classes/class-a/students/student-b": { name: "Synthetic B", role: "student", assets: { cash: 100 } },
    "stockMarketSummary/today_quotes_all": { AAPL: { current: 100 } },
});
const request = (data) => ({ auth, data: { classId: "class-a", clientRequestId: "request-1", ...data } });
const order = (data = {}) => request({ symbol: "AAPL", quantity: 1, priceUSD: 100, ...data });
const count = (h, prefix) => [...h.data.keys()].filter((key) => key.startsWith(prefix)).length;

test("donation preserves auction holds and both supported reserved balance shapes", async () => {
    for (const reserved of [10, { cash: 10 }]) {
        const records = seed();
        Object.assign(records[student].assets, { auctionHold: 80, reserved });
        const h = createCallableHarness(records);
        const donation = h.load("functions/src/donation.js");
        await assert.rejects(donation.makeDonation(request({ amount: 11 })), { code: "failed-precondition" });
        assert.equal(h.writes.length, 0);
        await donation.makeDonation(request({ amount: 10 }));
        assert.equal(h.data.get(student).assets.cash, 90);
        assert.equal(h.data.get(student).assets.auctionHold, 80);
    }
});

test("donation retries after cash is exhausted commit one donation, summary and activity", async () => {
    const h = createCallableHarness(seed(), { retryTransaction: true });
    const donation = h.load("functions/src/donation.js");
    const req = request({ amount: 100 });
    const first = await donation.makeDonation(req);
    assert.deepEqual(await donation.makeDonation(req), structuredClone(first));
    assert.equal(h.data.get(student).assets.cash, 0);
    assert.equal(count(h, "classes/class-a/donations/"), 1);
    assert.equal(h.data.get("classes/class-a/dashboardSummary/donationSummary").totalAmount, 100);
    assert.equal(h.data.get("classes/class-a/donationStats/student-a").count, 1);
    assert.equal([...h.data.values()].filter((value) => value.category === "donation").length, 1);
    await assert.rejects(donation.makeDonation(request({ amount: 10 })), { code: "invalid-argument" });
});

test("stock buy and complete sell retries reuse the trade even after prices and holdings change", async () => {
    const h = createCallableHarness(seed(), { retryTransaction: true });
    const stock = h.load("functions/src/stock.js");
    const buy = await stock.performStockBuy(order());
    h.data.set("stockMarketSummary/today_quotes_all", { AAPL: { current: 120 } });
    assert.deepEqual(await stock.performStockBuy(order()), structuredClone(buy));
    assert.equal(h.data.get(`${student}/stockPortfolio/AAPL`).quantity, 1);
    await assert.rejects(stock.performStockBuy(order({ quantity: 2 })), { code: "invalid-argument" });
    const sellOrder = order({ priceUSD: 120 });
    const sell = await stock.performStockSell(sellOrder);
    assert.deepEqual(await stock.performStockSell(sellOrder), structuredClone(sell));
    assert.equal(count(h, `${student}/tradeHistory/`), 2);
    assert.equal([...h.data.values()].filter((value) => value.category === "stock_sell").length, 1);
});

test("fund trade retries do not duplicate fees, ledger or budget usage", async () => {
    const records = seed();
    records["classes/class-a/classFunds/fund"] = {
        name: "Fund", fundType: "investment", cashBalance: 1000, operatorUids: ["student-a"],
    };
    const h = createCallableHarness(records, { retryTransaction: true });
    const stock = h.load("functions/src/stock.js");
    const req = order({ classFundId: "fund" });
    const buy = await stock.performStockBuy(req);
    assert.deepEqual(await stock.performStockBuy(req), structuredClone(buy));
    const sell = await stock.performStockSell(req);
    assert.deepEqual(await stock.performStockSell(req), structuredClone(sell));
    assert.equal(count(h, "classes/class-a/classFunds/fund/tradeHistory/"), 2);
    assert.equal(count(h, "classes/class-a/classFunds/fund/ledger/"), 2);
    assert.equal(count(h, "classes/class-a/fundUsages/"), 2);
    assert.equal(h.data.get(student).assets.cash, 100);
    await assert.rejects(stock.performStockBuy({ ...req, auth: { uid: "student-b", token: auth.token } }), { code: "permission-denied" });
});

test("exchange preserves holds and returns one committed result on retry", async () => {
    const records = seed();
    records[student].assets.auctionHold = 80;
    const h = createCallableHarness(records, { retryTransaction: true });
    const stock = h.load("functions/src/stock.js");
    await assert.rejects(stock.performExchange(request({ direction: "BIL_TO_USD", amount: 50 })), { code: "failed-precondition" });
    assert.equal(h.writes.length, 0);
    const req = request({ direction: "BIL_TO_USD", amount: 20 });
    const first = await stock.performExchange(req);
    assert.deepEqual(await stock.performExchange(req), structuredClone(first));
    assert.equal(h.data.get(student).assets.cash, 80);
    assert.equal(count(h, `${student}/tradeHistory/`), 1);
    await assert.rejects(stock.performExchange(request({ direction: "USD_TO_BIL", amount: 20 })), { code: "invalid-argument" });
});

test("invalid request IDs and unauthenticated requests never write", async () => {
    const h = createCallableHarness(seed());
    const stock = h.load("functions/src/stock.js");
    const donation = h.load("functions/src/donation.js");
    for (const clientRequestId of ["bad/id", "", 1, "x".repeat(129)]) {
        await assert.rejects(stock.performStockBuy(order({ clientRequestId })), { code: "invalid-argument" });
        await assert.rejects(donation.makeDonation(request({ amount: 10, clientRequestId })), { code: "invalid-argument" });
    }
    await assert.rejects(donation.makeDonation({ data: request({ amount: 10 }).data }), { code: "unauthenticated" });
    assert.equal(h.writes.length, 0);
});

test("automatic exchange on a stock buy cannot consume reserved cash", async () => {
    const records = seed();
    Object.assign(records[student].assets, { usdBalance: 0, cash: 100, auctionHold: 95 });
    records["classes/class-a/config/stockMarket"] = { studentAutoExchangeBuyEnabled: true };
    const h = createCallableHarness(records);
    await assert.rejects(h.load("functions/src/stock.js").performStockBuy(order()), /잔액이 부족/);
    assert.equal(h.writes.length, 0);
});
