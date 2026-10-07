"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const { getSpendableBankBalance } = require("../utils/bankMoney");
const studentPath = "classes/class-a/students/student-a";
const recipientPath = "classes/class-a/students/student-b";
const quotePath = "stockMarketSummary/today_quotes_all";
const auth = { uid: "student-a", token: { role: "student", classId: "class-a" } };
const teacherAuth = { uid: "teacher-a", token: { role: "teacher", classId: "class-a" } };
const seed = () => ({
    "classes/class-a": { currencyUnit: "unit", stockJobIndex: { version: 1 } },
    [studentPath]: { name: "Student A", role: "student", assets: { cash: 100, usdBalance: 1000, stockValue: { value: 0 } } },
    [recipientPath]: { name: "Student B", role: "student", assets: { cash: 100 } },
    "classes/class-a/students/teacher-a": { name: "Teacher", role: "teacher" },
    [quotePath]: { AAPL: { current: 100 }, MSFT: { current: 50 } },
});
const transfer = (overrides = {}) => ({ auth, data: { classId: "class-a", toUid: "student-b", amount: 10, memo: "test", clientRequestId: "transfer-1", ...overrides } });
const order = (overrides = {}) => ({ auth, data: { classId: "class-a", symbol: "AAPL", quantity: 1, priceUSD: 100, ...overrides } });
const categoryCount = (h, category) => [...h.data.values()].filter((data) => data.category === category).length;

test("a retried transfer commits both balances and audit logs once, including transaction retries", async () => {
    const h = createCallableHarness(seed(), { retryTransaction: true });
    const bank = h.load("functions/src/bank.js");
    await bank.transferMoney(transfer());
    await bank.transferMoney(transfer());
    assert.equal(h.data.get(studentPath).assets.cash, 90);
    assert.equal(h.data.get(recipientPath).assets.cash, 110);
    assert.equal(categoryCount(h, "transfer_out"), 1);
    assert.equal(categoryCount(h, "transfer_in"), 1);
    await assert.rejects(bank.transferMoney(transfer({ amount: 20 })), { code: "invalid-argument" });
    await assert.rejects(bank.transferMoney(transfer({ memo: "different" })), { code: "invalid-argument" });
    assert.equal(h.data.get(studentPath).assets.cash, 90);
});

test("transfer retries return the committed result even when the sender has no remaining cash", async () => {
    const h = createCallableHarness(seed());
    const bank = h.load("functions/src/bank.js");
    await bank.transferMoney(transfer({ amount: 100 }));
    assert.equal((await bank.transferMoney(transfer({ amount: 100 }))).success, true);
    assert.equal(h.data.get(studentPath).assets.cash, 0);
});

test("legacy transfer callers work; invalid amounts and IDs fail without writes", async () => {
    const h = createCallableHarness(seed());
    const bank = h.load("functions/src/bank.js");
    for (const amount of ["abc", Infinity, -1, 0]) {
        await assert.rejects(bank.transferMoney(transfer({ amount })), { code: "invalid-argument" });
    }
    await assert.rejects(bank.transferMoney(transfer({ clientRequestId: "invalid/id" })), { code: "invalid-argument" });
    assert.equal(h.writes.length, 0);
    assert.equal((await bank.transferMoney(transfer({ clientRequestId: undefined }))).success, true);
});

test("transfers preserve auction holds, support fee-inclusive available cash, and keep recipients accessible", async () => {
    const records = seed();
    records[studentPath].assets.auctionHold = 80;
    records[studentPath].creditTier = "basic";
    records["classes/class-a/bankConfig/tierAdjustments"] = { byTier: { basic: { transferFee: 2 } } };
    const h = createCallableHarness(records);
    const bank = h.load("functions/src/bank.js");
    await assert.rejects(bank.transferMoney(transfer({ amount: 20 })), { code: "failed-precondition" });
    assert.equal(h.writes.length, 0);
    await bank.transferMoney(transfer({ amount: 18 }));
    assert.equal(h.data.get(studentPath).assets.cash, 80);
    assert.equal(h.data.get(studentPath).assets.auctionHold, 80);
    assert.equal(h.data.get(recipientPath).assets.cash, 118);
    assert.equal(getSpendableBankBalance({ cash: 100, reserved: 10, auctionHold: 20 }), 70);
    assert.equal(getSpendableBankBalance({ cash: 100, reserved: { cash: 10 }, auctionHold: 20 }), 70);
    assert.equal(getSpendableBankBalance({ credits: 100, reserved: { credits: 10 }, auctionHold: 20 }, "credits"), 90);
    assert.equal(getSpendableBankBalance(null), 0);
    assert.equal(getSpendableBankBalance(), 0);
});

test("auction settlement never makes a cash-short winner negative; funded settlements still work", async () => {
    for (const cash of [0, 80]) {
        const records = seed();
        records[studentPath].assets = { cash, auctionHold: 80 };
        records["classes/class-a/auction/item"] = { status: "active", auctionType: "open", sellerUid: "student-b", highestBidUid: "student-a", currentPrice: 80, title: "Item" };
        records["classes/class-a/auction/item/holds/student-a"] = { holdAmount: 80 };
        records["classes/class-a/auction/settings"] = { feeEnabled: false };
        const h = createCallableHarness(records);
        const auction = h.load("functions/src/auction.js");
        const request = { auth: teacherAuth, data: { classId: "class-a", itemId: "item" } };
        if (!cash) {
            await assert.rejects(auction.closeAuction(request), { code: "failed-precondition" });
            assert.equal(h.writes.length, 0);
        } else {
            await auction.closeAuction(request);
            await auction.closeAuction(request);
            assert.equal(h.data.get(studentPath).assets.cash, 0);
            assert.equal(h.data.get(recipientPath).assets.cash, 180);
        }
    }
});

test("all donation management callables reject another class before reading its records", async () => {
    const h = createCallableHarness(seed());
    const donation = h.load("functions/src/donation.js");
    for (const name of ["spendDonation", "deleteDonation", "adjustDonationBalanceToZero", "transferDonationToTax", "transferTaxToDonation"]) {
        await assert.rejects(donation[name]({ auth: teacherAuth, data: { classId: "class-b", amount: 10, donationId: "donation", reason: "test" } }), { code: "permission-denied" });
    }
    assert.equal(h.reads.length, 0);
    assert.equal(h.writes.length, 0);
});

test("own-class teachers and approved legacy profiles can spend donations; student callers cannot", async () => {
    for (const classId of ["class-a", undefined]) {
        const records = seed();
        records["classes/class-a/dashboardSummary/donationSummary"] = { totalAmount: 100 };
        records["users/teacher-a"] = { role: "teacher", status: "approved", classId: "class-a" };
        const h = createCallableHarness(records);
        const donation = h.load("functions/src/donation.js");
        const data = { classId: "class-a", amount: 30, reason: "class activity", recordAsTaxIncome: false };
        await donation.spendDonation({ auth: { uid: "teacher-a", token: { role: "teacher", classId } }, data });
        assert.equal(h.data.get("classes/class-a/dashboardSummary/donationSummary").totalAmount, 70);
        await assert.rejects(donation.spendDonation({ auth, data }), { code: "permission-denied" });
    }
});

test("buy and sell reject manipulated prices atomically but use the same server daily quotes as the UI", async () => {
    const records = seed();
    records[`${studentPath}/stockPortfolio/AAPL`] = { symbol: "AAPL", quantity: 2, averagePriceUSD: 100, totalInvestmentUSD: 200 };
    const h = createCallableHarness(records);
    const stock = h.load("functions/src/stock.js");
    await assert.rejects(stock.performStockBuy(order({ priceUSD: 1 })), { code: "failed-precondition" });
    await assert.rejects(stock.performStockSell(order({ priceUSD: 1000000 })), { code: "failed-precondition" });
    assert.equal(h.writes.length, 0);
    assert.equal((await stock.getStockBuyQuote(order({ priceUSD: 1 }))).data.priceUSD, 100);
    assert.equal((await stock.getStockSellQuote(order({ priceUSD: 1000000 }))).data.priceUSD, 100);
    assert.equal((await stock.performStockBuy(order())).debitedUSD, 100.2);
    assert.equal((await stock.performStockSell(order())).creditedUSD, 99.8);
});

test("partial and full sales revalue remaining holdings rather than subtracting sale proceeds", async () => {
    const h = createCallableHarness(seed());
    const stock = h.load("functions/src/stock.js");
    await stock.performStockBuy(order({ quantity: 2 }));
    await stock.performStockBuy(order({ symbol: "MSFT", priceUSD: 50 }));
    h.data.set(quotePath, { AAPL: { current: 120 }, MSFT: { current: 70 } });
    await stock.performStockSell(order({ priceUSD: 120 }));
    assert.equal(h.data.get(studentPath).assets.stockValue.value, 190);
    await stock.performStockSell(order({ priceUSD: 120 }));
    assert.equal(h.data.get(studentPath).assets.stockValue.value, 70);
    await stock.performStockSell(order({ symbol: "MSFT", priceUSD: 70 }));
    assert.equal(h.data.get(studentPath).assets.stockValue.value, 0);
});

test("teacher force sales still work and a missing quote for another holding does not block them", async () => {
    const records = seed();
    records[`${recipientPath}/stockPortfolio/AAPL`] = { quantity: 1, averagePriceUSD: 80, totalInvestmentUSD: 80 };
    records[`${recipientPath}/stockPortfolio/OLD`] = { quantity: 2, averagePriceUSD: 10, totalInvestmentUSD: 20 };
    const h = createCallableHarness(records);
    const stock = h.load("functions/src/stock.js");
    await assert.rejects(stock.performStockSell({ ...order({ studentUid: "student-b" }), auth }), { code: "permission-denied" });
    await stock.performStockSell({ ...order({ studentUid: "student-b" }), auth: teacherAuth });
    assert.equal(h.data.get(recipientPath).assets.usdBalance, 99.8);
    assert.equal(h.data.get(recipientPath).assets.stockValue.value, 20);
});

test("delegated fund operators can trade at server prices while non-operators and forged prices fail", async () => {
    const records = seed();
    records["classes/class-a/classFunds/fund"] = { name: "Investment", fundType: "investment", cashBalance: 1000, operatorUids: ["student-a"] };
    const h = createCallableHarness(records);
    const stock = h.load("functions/src/stock.js");
    await assert.rejects(stock.performStockBuy(order({ classFundId: "fund", priceUSD: 1 })), { code: "failed-precondition" });
    await assert.rejects(stock.performStockBuy({ ...order({ classFundId: "fund" }), auth: { uid: "student-b", token: auth.token } }), { code: "permission-denied" });
    await stock.performStockBuy(order({ classFundId: "fund" }));
    await assert.rejects(stock.performStockSell(order({ classFundId: "fund", priceUSD: 1000000 })), { code: "failed-precondition" });
    await stock.performStockSell(order({ classFundId: "fund" }));
    assert(h.data.get("classes/class-a/classFunds/fund").cashBalance < 1000);
    assert.equal(h.data.get(studentPath).assets.cash, 100);
    assert.equal([...h.data.keys()].filter((key) => key.startsWith("classes/class-a/fundUsages/")).length, 2);
});
