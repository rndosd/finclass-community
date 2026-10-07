const asFiniteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const round4 = (value) =>
    Math.round((asFiniteNumber(value) + Number.EPSILON) * 10000) / 10000;

const ceil4 = (value) =>
    Math.ceil((asFiniteNumber(value) - Number.EPSILON) * 10000) / 10000;

function buildStudentAutoExchangeBuyPayment({
    totalUSD,
    usdBalance,
    cashBalance,
    conversionRate,
    exchangeFeeRate,
    enabled,
}) {
    const requiredUSD = Math.max(0, round4(totalUSD));
    const availableUSD = Math.max(0, round4(usdBalance));
    const availableCash = Math.max(0, round4(cashBalance));
    const rate = asFiniteNumber(conversionRate);
    const feeRate = Math.max(0, asFiniteNumber(exchangeFeeRate));
    const usdUsed = Math.min(requiredUSD, availableUSD);
    const autoExchangeUSD = round4(requiredUSD - usdUsed);

    if (!(autoExchangeUSD > 0)) {
        return {
            canAfford: true,
            autoExchangeApplied: false,
            usdUsed,
            autoExchangeUSD: 0,
            autoExchangeSourceAmount: 0,
            autoExchangeFeeInClassCurrency: 0,
            autoExchangeNetInClassCurrency: 0,
            cashBalance: availableCash,
        };
    }

    if (!enabled || !(rate > 0) || feeRate >= 1) {
        return {
            canAfford: false,
            autoExchangeApplied: false,
            usdUsed,
            autoExchangeUSD,
            autoExchangeSourceAmount: 0,
            autoExchangeFeeInClassCurrency: 0,
            autoExchangeNetInClassCurrency: 0,
            cashBalance: availableCash,
        };
    }

    // 일반 환전과 같이 원화 입력액에서 수수료를 먼저 차감한 뒤 FIN으로 바꾼다.
    // 매수에 필요한 FIN보다 부족해지지 않도록 학급 화폐 4자리에서 올림한다.
    const sourceAmount = ceil4(autoExchangeUSD / rate / (1 - feeRate));
    const feeInClassCurrency = round4(sourceAmount * feeRate);
    const netInClassCurrency = round4(sourceAmount - feeInClassCurrency);

    return {
        canAfford: availableCash >= sourceAmount,
        autoExchangeApplied: true,
        usdUsed,
        autoExchangeUSD,
        autoExchangeSourceAmount: sourceAmount,
        autoExchangeFeeInClassCurrency: feeInClassCurrency,
        autoExchangeNetInClassCurrency: netInClassCurrency,
        cashBalance: availableCash,
    };
}

function assertExchangeConfig(conversionRate, exchangeFeeRate) {
    const rate = asFiniteNumber(conversionRate);
    const feeRate = asFiniteNumber(exchangeFeeRate);
    if (!(rate > 0) || feeRate < 0 || feeRate >= 1) {
        throw new Error("환율 또는 환전 수수료 설정을 확인해주세요.");
    }
    return { rate, feeRate };
}

function buildClassFundBuyExchangePayment({
    totalUSD,
    conversionRate,
    exchangeFeeRate,
}) {
    const { rate, feeRate } = assertExchangeConfig(
        conversionRate,
        exchangeFeeRate,
    );
    const settlementInClassCurrency = round4(totalUSD / rate);
    const sourceAmount = ceil4(totalUSD / rate / (1 - feeRate));
    const feeInClassCurrency = round4(
        sourceAmount - settlementInClassCurrency,
    );
    return {
        settlementInClassCurrency,
        sourceAmount,
        feeInClassCurrency,
        feeUSD: round4(feeInClassCurrency * rate),
    };
}

function buildClassFundSellExchangePayment({
    sourceUSD,
    conversionRate,
    exchangeFeeRate,
}) {
    const { rate, feeRate } = assertExchangeConfig(
        conversionRate,
        exchangeFeeRate,
    );
    const normalizedSourceUSD = Math.max(0, round4(sourceUSD));
    const feeUSD = round4(normalizedSourceUSD * feeRate);
    const netUSD = round4(normalizedSourceUSD - feeUSD);
    return {
        sourceUSD: normalizedSourceUSD,
        feeUSD,
        feeInClassCurrency: round4(feeUSD / rate),
        netUSD,
        netInClassCurrency: round4(netUSD / rate),
    };
}

module.exports = {
    buildClassFundBuyExchangePayment,
    buildClassFundSellExchangePayment,
    buildStudentAutoExchangeBuyPayment,
};
