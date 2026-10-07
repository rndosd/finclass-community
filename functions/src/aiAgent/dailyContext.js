"use strict";

const DAILY_CONTEXT_SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_SOURCE_REFS = 5;
const MAX_TOP_ROWS = 5;

const DOMAIN_CONFIGS = {
    store: {
        collection: "storeAnalyticsDaily",
        deepLink: "/store?view=analytics",
    },
    mission: {
        collection: "missionAnalyticsDaily",
        deepLink: "/missions",
    },
    tax: {
        collection: "taxAnalyticsDaily",
        deepLink: "/tax",
    },
    police: {
        collection: "policeAnalyticsDaily",
        deepLink: "/police",
    },
    credit: {
        collection: "creditAnalyticsDaily",
        deepLink: "/credit",
    },
    realEstate: {
        collection: "realEstateAnalyticsDaily",
        deepLink: "/realestate",
    },
};

const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const toCount = (value) => Math.max(0, Math.floor(toNumber(value, 0)));

const sumBy = (rows, selector) =>
    rows.reduce((sum, row) => sum + toNumber(selector(row), 0), 0);

const compactObject = (value) =>
    Object.fromEntries(
        Object.entries(value || {}).filter(([, fieldValue]) => fieldValue !== undefined),
    );

const formatAmount = (value) => `${Math.round(toNumber(value, 0)).toLocaleString("ko-KR")}`;

const buildSourceRefs = (rows, collection, deepLink, limit = MAX_SOURCE_REFS) =>
    rows
        .slice(0, limit)
        .map((row) => compactObject({
            kind: "dailyAggregate",
            collection,
            docId: row.id,
            date: row.date || row.id,
            deepLink,
        }));

async function readRecentDailyRows(db, classId, domain, windowDays) {
    const config = DOMAIN_CONFIGS[domain];
    if (!config) return { rows: [], error: "unknown-domain" };

    try {
        const snap = await db
            .collection(`classes/${classId}/${config.collection}`)
            .orderBy("date", "desc")
            .limit(Math.max(windowDays + 5, windowDays))
            .get();

        const rows = snap.docs
            .map((docSnap) => ({
                id: docSnap.id,
                ...(docSnap.data() || {}),
                date: docSnap.data()?.date || docSnap.id,
            }))
            .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, windowDays);

        return { rows };
    } catch (error) {
        console.warn(
            `[agentDailyContext] failed to read ${config.collection}:`,
            error?.message || error,
        );
        return { rows: [], error: error?.message || String(error) };
    }
}

const makeDomainShell = (domain, rows, error = null) => {
    const config = DOMAIN_CONFIGS[domain];
    return compactObject({
        status: error ? "unavailable" : rows.length ? "ready" : "empty",
        collection: config.collection,
        latestDate: rows[0]?.date || null,
        dayCount: rows.length,
        sourceRefs: buildSourceRefs(rows, config.collection, config.deepLink),
        error,
    });
};

const topEntries = (map, mapper, comparator) =>
    Object.entries(map || {})
        .map(([id, row]) => mapper(id, row || {}))
        .filter(Boolean)
        .sort(comparator)
        .slice(0, MAX_TOP_ROWS);

function summarizeStore(rows, error) {
    const shell = makeDomainShell("store", rows, error);
    const activeRows = rows.filter((row) => toCount(row.totals?.purchaseCount) > 0);
    const totals = {
        purchaseCount: sumBy(rows, (row) => row.totals?.purchaseCount),
        refundCount: sumBy(rows, (row) => row.totals?.refundCount),
        quantity: sumBy(rows, (row) => row.totals?.quantity),
        netAmount: sumBy(rows, (row) => row.totals?.netAmount),
        cashLikeNetAmount: sumBy(rows, (row) => row.totals?.cashLikeNetAmount),
        participantDayCount: sumBy(rows, (row) => row.totals?.participantCount),
        activeDayCount: activeRows.length,
        maxDailyParticipantCount: Math.max(
            0,
            ...rows.map((row) => toCount(row.totals?.participantCount)),
        ),
    };
    const byItem = {};
    rows.forEach((row) => {
        Object.entries(row.byItem || {}).forEach(([itemId, item]) => {
            if (!byItem[itemId]) {
                byItem[itemId] = {
                    itemId,
                    name: item.name || item.itemName || "상품",
                    quantity: 0,
                    netAmount: 0,
                    purchaseCount: 0,
                    buyerCount: 0,
                };
            }
            byItem[itemId].quantity += toCount(item.quantity);
            byItem[itemId].netAmount += toNumber(item.netAmount);
            byItem[itemId].purchaseCount += toCount(item.purchaseCount);
            byItem[itemId].buyerCount += toCount(item.buyerCount);
        });
    });

    return {
        ...shell,
        totals: compactObject(totals),
        topItemsByQuantity: topEntries(
            byItem,
            (id, item) => compactObject({
                itemId: id,
                name: item.name,
                quantity: toCount(item.quantity),
                buyerCount: toCount(item.buyerCount),
                netAmount: Math.round(toNumber(item.netAmount)),
            }),
            (a, b) =>
                b.quantity - a.quantity ||
                b.buyerCount - a.buyerCount ||
                b.netAmount - a.netAmount,
        ),
    };
}

function summarizeMission(rows, error) {
    const shell = makeDomainShell("mission", rows, error);
    const byStatus = {};
    rows.forEach((row) => {
        Object.entries(row.eventTotals?.byStatus || {}).forEach(([status, count]) => {
            byStatus[status] = toCount(byStatus[status]) + toCount(count);
        });
    });
    const totals = {
        eventCount: sumBy(rows, (row) => row.eventTotals?.eventCount),
        rewardAmount: sumBy(rows, (row) => row.eventTotals?.rewardAmount),
        normalCompletionEvents: sumBy(rows, (row) => row.eventTotals?.normalCompletionEvents),
        alwaysAttemptEvents: sumBy(rows, (row) => row.eventTotals?.alwaysAttemptEvents),
        approvedCount:
            toCount(byStatus.approved) +
            toCount(byStatus.completed) +
            toCount(byStatus["late-approved"]),
        pendingCount: toCount(byStatus.pending),
        rejectedCount: toCount(byStatus.rejected),
        canceledCount: toCount(byStatus.canceled) + toCount(byStatus.cancelled),
    };

    return {
        ...shell,
        totals: compactObject(totals),
        byStatus,
    };
}

function summarizeTax(rows, error) {
    const shell = makeDomainShell("tax", rows, error);
    const latest = rows[0] || {};
    const totals = {
        billIssuedCount: sumBy(rows, (row) => row.eventTotals?.billIssuedCount),
        billIssuedAmount: sumBy(rows, (row) => row.eventTotals?.billIssuedAmount),
        billPaidCount: sumBy(rows, (row) => row.eventTotals?.billPaidCount),
        billPaidAmount: sumBy(rows, (row) => row.eventTotals?.billPaidAmount),
        taxIncomeTotal: sumBy(rows, (row) => row.eventTotals?.taxIncomeTotal),
        taxExpenseTotal: sumBy(rows, (row) => row.eventTotals?.taxExpenseTotal),
        netTaxFlow: sumBy(rows, (row) => row.eventTotals?.netTaxFlow),
    };

    return {
        ...shell,
        totals: compactObject(totals),
        currentSnapshot: compactObject({
            date: latest.date || null,
            unpaidCount: toCount(latest.snapshot?.unpaidCount),
            unpaidAmount: Math.round(toNumber(latest.snapshot?.unpaidAmount)),
            overdueCount: toCount(latest.snapshot?.overdueCount),
            overdueAmount: Math.round(toNumber(latest.snapshot?.overdueAmount)),
        }),
    };
}

function summarizePolice(rows, error) {
    const shell = makeDomainShell("police", rows, error);
    const totals = {
        eventCount: sumBy(rows, (row) => row.eventTotals?.eventCount),
        fineCount: sumBy(rows, (row) => row.eventTotals?.fineCount),
        rewardCount: sumBy(rows, (row) => row.eventTotals?.rewardCount),
        fineAmount: sumBy(rows, (row) => row.eventTotals?.fineAmount),
        rewardAmount: sumBy(rows, (row) => row.eventTotals?.rewardAmount),
        reportCreatedCount: sumBy(rows, (row) => row.eventTotals?.reportCreatedCount),
        reflectionSubmittedCount: sumBy(rows, (row) => row.eventTotals?.reflectionSubmittedCount),
    };

    return {
        ...shell,
        totals: compactObject(totals),
        latestSnapshot: rows[0]?.snapshot || {},
    };
}

function summarizeCredit(rows, error) {
    const shell = makeDomainShell("credit", rows, error);
    const latest = rows[0] || {};
    const totals = {
        eventCount: sumBy(rows, (row) => row.eventTotals?.eventCount),
        logCount: sumBy(rows, (row) => row.eventTotals?.logCount),
        netDelta: sumBy(rows, (row) => row.eventTotals?.logDelta),
        positiveDelta: sumBy(rows, (row) => row.eventTotals?.positiveDelta),
        negativeDelta: sumBy(rows, (row) => row.eventTotals?.negativeDelta),
    };

    return {
        ...shell,
        totals: compactObject(totals),
        currentSnapshot: compactObject({
            date: latest.date || null,
            averageScore: latest.snapshot?.averageScore ?? null,
            minScore: latest.snapshot?.minScore ?? null,
            medianScore: latest.snapshot?.medianScore ?? null,
            maxScore: latest.snapshot?.maxScore ?? null,
        }),
    };
}

function summarizeRealEstate(rows, error) {
    const shell = makeDomainShell("realEstate", rows, error);
    const latest = rows[0] || {};
    const totals = {
        eventCount: sumBy(rows, (row) => row.eventTotals?.eventCount),
        purchaseAmount: sumBy(rows, (row) => row.eventTotals?.purchaseAmount),
        saleAmount: sumBy(rows, (row) => row.eventTotals?.saleAmount),
        rentAmount: sumBy(rows, (row) => row.eventTotals?.rentAmount),
        holdingTaxPaidAmount: sumBy(rows, (row) => row.eventTotals?.holdingTaxPaidAmount),
    };

    return {
        ...shell,
        totals: compactObject(totals),
        currentSnapshot: compactObject({
            date: latest.date || null,
            ownedDeskCount: toCount(latest.snapshot?.property?.ownedDeskCount),
            holdingTaxUnpaidCount: toCount(latest.snapshot?.holdingTaxUnpaidCount),
            holdingTaxOverdueCount: toCount(latest.snapshot?.holdingTaxOverdueCount),
            holdingTaxOverdueAmount: Math.round(toNumber(latest.snapshot?.holdingTaxOverdueAmount)),
        }),
    };
}

async function buildAgentDailyContext(db, classId, options = {}) {
    const windowDays = Math.min(60, Math.max(7, toCount(options.windowDays) || DEFAULT_WINDOW_DAYS));
    const generatedForDate = options.generatedForDate || null;
    const domainNames = Object.keys(DOMAIN_CONFIGS);
    const reads = await Promise.all(
        domainNames.map(async (domain) => ({
            domain,
            ...(await readRecentDailyRows(db, classId, domain, windowDays)),
        })),
    );
    const byDomain = Object.fromEntries(reads.map((entry) => [entry.domain, entry]));

    return {
        schemaVersion: DAILY_CONTEXT_SCHEMA_VERSION,
        generatedForDate,
        generatedAt: new Date().toISOString(),
        windowDays,
        source: "pageAnalyticsDaily",
        domains: {
            store: summarizeStore(byDomain.store.rows, byDomain.store.error),
            mission: summarizeMission(byDomain.mission.rows, byDomain.mission.error),
            tax: summarizeTax(byDomain.tax.rows, byDomain.tax.error),
            police: summarizePolice(byDomain.police.rows, byDomain.police.error),
            credit: summarizeCredit(byDomain.credit.rows, byDomain.credit.error),
            realEstate: summarizeRealEstate(byDomain.realEstate.rows, byDomain.realEstate.error),
        },
    };
}

function buildAgentDailyContextCards(dailyContext, options = {}) {
    const domains = dailyContext?.domains || {};
    const activeStudentCount = toCount(options.activeStudentCount);
    const cards = [];

    const store = domains.store || {};
    const storeTotals = store.totals || {};
    if (store.status === "ready") {
        const maxParticipantRate = activeStudentCount > 0 ?
            storeTotals.maxDailyParticipantCount / activeStudentCount :
            null;
        const status = storeTotals.purchaseCount <= 0 ? "attention" :
            maxParticipantRate !== null && maxParticipantRate < 0.25 ? "watch" :
                "stable";
        const purchaseCount = toCount(storeTotals.purchaseCount);
        const quantity = toCount(storeTotals.quantity);
        cards.push({
            id: "daily-store-activity",
            domain: "store",
            type: "dailyAggregateSignal",
            status,
            title: "상점 활동 흐름",
            summary:
                `최근 ${dailyContext.windowDays}일 상점 구매 ${purchaseCount}건, ` +
                `판매수량 ${quantity}개를 일일 집계로 확인했습니다.`,
            evidence: [
                `활동일 ${toCount(storeTotals.activeDayCount)}일`,
                `순소비 ${formatAmount(storeTotals.netAmount)}`,
                `최대 일별 참여 ${toCount(storeTotals.maxDailyParticipantCount)}명`,
            ],
            recommendations: [
                status === "stable" ?
                    "상점 활동은 판단 근거로 사용할 수 있는 수준입니다." :
                    "참여 학생 수와 인기 상품 구성을 함께 보고 가격이나 상품 구성을 조정할지 확인하세요.",
            ],
            deepLink: DOMAIN_CONFIGS.store.deepLink,
            sourceRefs: store.sourceRefs || [],
        });
    }

    const mission = domains.mission || {};
    const missionTotals = mission.totals || {};
    if (mission.status === "ready" && toCount(missionTotals.eventCount) > 0) {
        const rejectedCount = toCount(missionTotals.rejectedCount);
        const pendingCount = toCount(missionTotals.pendingCount);
        const eventCount = toCount(missionTotals.eventCount);
        const rewardAmount = formatAmount(missionTotals.rewardAmount);
        cards.push({
            id: "daily-mission-flow",
            domain: "missions",
            type: "dailyAggregateSignal",
            status: pendingCount >= 5 || rejectedCount >= 5 ? "watch" : "stable",
            title: "미션 참여 흐름",
            summary:
                `최근 ${dailyContext.windowDays}일 미션 이벤트 ${eventCount}건과 ` +
                `보상 ${rewardAmount}을 일일 집계로 확인했습니다.`,
            evidence: [
                `승인/완료 ${toCount(missionTotals.approvedCount)}건`,
                `대기 ${pendingCount}건`,
                `반려 ${rejectedCount}건`,
            ],
            recommendations: [
                pendingCount > 0 ?
                    "대기 건이 쌓이면 먼저 검토 묶음을 만들고, 반려가 많으면 기준 안내를 보강하세요." :
                    "참여 흐름은 보상 규모와 함께 경제 판단 근거로 사용할 수 있습니다.",
            ],
            deepLink: DOMAIN_CONFIGS.mission.deepLink,
            sourceRefs: mission.sourceRefs || [],
        });
    }

    const tax = domains.tax || {};
    const taxSnapshot = tax.currentSnapshot || {};
    if (tax.status === "ready" && toCount(taxSnapshot.overdueCount) > 0) {
        cards.push({
            id: "daily-tax-overdue",
            domain: "tax",
            type: "dailyAggregateSignal",
            status: toCount(taxSnapshot.overdueCount) >= 5 ? "attention" : "watch",
            title: "세금 연체 현황",
            summary: `가장 최근 집계일(${taxSnapshot.date || "최근"}) 기준 연체 고지서 ${toCount(taxSnapshot.overdueCount)}건이 남아 있습니다.`,
            evidence: [
                `미납 ${toCount(taxSnapshot.unpaidCount)}건`,
                `연체 금액 ${formatAmount(taxSnapshot.overdueAmount)}`,
            ],
            recommendations: [
                "연체가 반복되는 학생은 잔액, 급여, 벌금 흐름을 함께 확인해 안내나 페널티가 필요한지 판단하세요.",
            ],
            deepLink: DOMAIN_CONFIGS.tax.deepLink,
            sourceRefs: tax.sourceRefs || [],
        });
    }

    const credit = domains.credit || {};
    const creditTotals = credit.totals || {};
    const creditSnapshot = credit.currentSnapshot || {};
    if (credit.status === "ready" && toCount(creditTotals.logCount) > 0) {
        const logCount = toCount(creditTotals.logCount);
        const netDelta = formatAmount(creditTotals.netDelta);
        cards.push({
            id: "daily-credit-flow",
            domain: "credit",
            type: "dailyAggregateSignal",
            status: toNumber(creditTotals.netDelta) < 0 ? "watch" : "stable",
            title: "신용 변화 흐름",
            summary:
                `최근 ${dailyContext.windowDays}일 신용 변경 ${logCount}건, ` +
                `순변화 ${netDelta}점을 확인했습니다.`,
            evidence: [
                `평균 신용 ${creditSnapshot.averageScore ?? "없음"}`,
                `최저 신용 ${creditSnapshot.minScore ?? "없음"}`,
            ],
            recommendations: [
                toNumber(creditTotals.netDelta) < 0 ?
                    "신용 하락 사유가 특정 규칙이나 학생에게 몰렸는지 확인하세요." :
                    "신용 흐름은 생활 규칙 안정도 판단 근거로 함께 사용할 수 있습니다.",
            ],
            deepLink: DOMAIN_CONFIGS.credit.deepLink,
            sourceRefs: credit.sourceRefs || [],
        });
    }

    const realEstate = domains.realEstate || {};
    const realEstateSnapshot = realEstate.currentSnapshot || {};
    if (realEstate.status === "ready" && toCount(realEstateSnapshot.holdingTaxOverdueCount) > 0) {
        cards.push({
            id: "daily-realestate-overdue",
            domain: "realestate",
            type: "dailyAggregateSignal",
            status: "watch",
            title: "부동산 보유세 연체",
            summary: `최근 집계 기준 부동산 보유세 연체 ${toCount(realEstateSnapshot.holdingTaxOverdueCount)}건이 있습니다.`,
            evidence: [
                `보유 좌석 ${toCount(realEstateSnapshot.ownedDeskCount)}건`,
                `연체 금액 ${formatAmount(realEstateSnapshot.holdingTaxOverdueAmount)}`,
            ],
            recommendations: [
                "부동산 자산 보유 학생의 현금흐름과 세금 납부 가능성을 함께 확인하세요.",
            ],
            deepLink: DOMAIN_CONFIGS.realEstate.deepLink,
            sourceRefs: realEstate.sourceRefs || [],
        });
    }

    return cards;
}

module.exports = {
    DAILY_CONTEXT_SCHEMA_VERSION,
    buildAgentDailyContext,
    buildAgentDailyContextCards,
};
