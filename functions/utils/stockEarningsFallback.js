"use strict";

const normalizeNumber = (value) => {
    if (value == null || value === "" || value === "None") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const calculatePercentChange = (currentValue, previousValue) => {
    const current = normalizeNumber(currentValue);
    const previous = normalizeNumber(previousValue);
    if (current == null || previous == null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
};

const normalizeCurrency = (value) => {
    const currency = String(value || "USD").trim().toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
};

function normalizeAlphaVantageIncomeStatement(payload, symbol) {
    const providerMessage = String(
        payload?.Information || payload?.Note || payload?.["Error Message"] || "",
    ).trim();
    if (providerMessage) {
        throw new Error(`Alpha Vantage income statement unavailable: ${providerMessage}`);
    }

    const quarterlyReports = Array.isArray(payload?.quarterlyReports)
        ? payload.quarterlyReports
        : [];
    const annualReports = Array.isArray(payload?.annualReports)
        ? payload.annualReports
        : [];
    const periodType = quarterlyReports.length > 0 ? "quarterly" : "annual";
    const sourceReports = periodType === "quarterly" ? quarterlyReports : annualReports;

    const allPeriods = sourceReports
        .map((report) => {
            const period = String(report?.fiscalDateEnding || "").trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;

            const currency = normalizeCurrency(report?.reportedCurrency);
            const revenueAmount = normalizeNumber(report?.totalRevenue);
            const netIncomeAmount = normalizeNumber(report?.netIncome);
            const operatingIncomeAmount = normalizeNumber(report?.operatingIncome);
            const actualEPS =
                normalizeNumber(report?.dilutedEPS) ?? normalizeNumber(report?.basicEPS);

            if (
                revenueAmount == null &&
                netIncomeAmount == null &&
                operatingIncomeAmount == null &&
                actualEPS == null
            ) {
                return null;
            }

            return {
                period,
                year: Number(period.slice(0, 4)),
                quarter: periodType === "quarterly"
                    ? Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1
                    : null,
                fiscalPeriod: periodType === "quarterly" ? null : "FY",
                frame: null,
                label: periodType === "quarterly"
                    ? `${period.slice(0, 4)}년 분기 실적`
                    : `${period.slice(0, 4)}년 연간 실적`,
                periodType,
                reportedCurrency: currency,
                actualEPS,
                estimateEPS: null,
                surpriseEPS: null,
                surprisePercent: null,
                revenueAmount,
                netIncomeAmount,
                operatingIncomeAmount,
                revenueUSD: currency === "USD" ? revenueAmount : null,
                netIncomeUSD: currency === "USD" ? netIncomeAmount : null,
                operatingIncomeUSD: currency === "USD" ? operatingIncomeAmount : null,
                grossIncomeUSD: null,
                unitScale: 1,
                filedAt: null,
                form: "ALPHA_VANTAGE_INCOME_STATEMENT",
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.period.localeCompare(left.period));

    const latest = allPeriods[0] || null;
    const comparison = latest
        ? allPeriods.find((period) =>
            period.year === latest.year - 1 &&
            (periodType === "annual" || period.period.slice(5) === latest.period.slice(5)),
        )
        : null;
    if (latest) {
        latest.revenueYoYPercent = calculatePercentChange(
            latest.revenueAmount,
            comparison?.revenueAmount,
        );
        latest.netIncomeYoYPercent = calculatePercentChange(
            latest.netIncomeAmount,
            comparison?.netIncomeAmount,
        );
    }

    return {
        symbol: String(symbol || payload?.symbol || "").trim().toUpperCase(),
        periodType,
        periods: allPeriods.slice(0, 4),
        latestPeriod: latest,
        reportedCurrency: latest?.reportedCurrency || null,
        source: "alphavantage",
    };
}

module.exports = {
    normalizeAlphaVantageIncomeStatement,
};
