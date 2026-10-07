/**
 * 세금 수입 출처와 관련된 상수 및 동적 라벨 생성 함수를 관리하는 파일 (완성본)
 */

export const TAX_INCOME_SOURCES = {
    STORE: 'store',
    PAYROLL: 'payroll',
    STOCK_BUY: 'stock_buy',
    STOCK_SELL: 'stock_sell',
    FX_BIL_TO_USD: 'fx_bil_to_usd',
    FX_USD_TO_BIL: 'fx_usd_to_bil',
    ARCADE: 'arcade',
    REAL_ESTATE: 'real_estate',
    TAX_BILL_PAYMENT: 'tax_bill_payment',
    MANUAL: 'manual',
    MANUAL_RECORD: 'manual_record',
    SYSTEM: 'system',
    POLICE_FINE: 'police_fine',
    POLICE_FINE_REFUND: 'police_fine_refund',
    DONATION_TRANSFER: 'donation_transfer',
    DONATION_SPEND: 'donation_spend',
    TAX_TO_DONATION: 'tax_to_donation',
};

export const TAX_INCOME_COLOR_GROUPS = {
    activity: 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm',
    earning: 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm',
    transfer: 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm',
    attention: 'bg-amber-50 text-amber-700 border-amber-200 shadow-sm',
    deduction: 'bg-rose-50 text-rose-700 border-rose-200 shadow-sm',
    neutral: 'bg-slate-50 text-slate-700 border-slate-200 shadow-sm',
};

export const SOURCE_COLORS = {
    [TAX_INCOME_SOURCES.STORE]: TAX_INCOME_COLOR_GROUPS.activity,
    [TAX_INCOME_SOURCES.PAYROLL]: TAX_INCOME_COLOR_GROUPS.earning,
    [TAX_INCOME_SOURCES.STOCK_BUY]: TAX_INCOME_COLOR_GROUPS.activity,
    [TAX_INCOME_SOURCES.STOCK_SELL]: TAX_INCOME_COLOR_GROUPS.activity,
    [TAX_INCOME_SOURCES.FX_BIL_TO_USD]: TAX_INCOME_COLOR_GROUPS.transfer,
    [TAX_INCOME_SOURCES.FX_USD_TO_BIL]: TAX_INCOME_COLOR_GROUPS.transfer,
    [TAX_INCOME_SOURCES.ARCADE]: TAX_INCOME_COLOR_GROUPS.activity,
    [TAX_INCOME_SOURCES.REAL_ESTATE]: TAX_INCOME_COLOR_GROUPS.activity,
    [TAX_INCOME_SOURCES.TAX_BILL_PAYMENT]: TAX_INCOME_COLOR_GROUPS.deduction,
    [TAX_INCOME_SOURCES.MANUAL]: TAX_INCOME_COLOR_GROUPS.neutral,
    [TAX_INCOME_SOURCES.MANUAL_RECORD]: TAX_INCOME_COLOR_GROUPS.neutral,
    [TAX_INCOME_SOURCES.SYSTEM]: TAX_INCOME_COLOR_GROUPS.neutral,
    [TAX_INCOME_SOURCES.POLICE_FINE]: TAX_INCOME_COLOR_GROUPS.deduction,
    [TAX_INCOME_SOURCES.POLICE_FINE_REFUND]: TAX_INCOME_COLOR_GROUPS.earning,
    [TAX_INCOME_SOURCES.DONATION_TRANSFER]: TAX_INCOME_COLOR_GROUPS.attention,
    [TAX_INCOME_SOURCES.DONATION_SPEND]: TAX_INCOME_COLOR_GROUPS.attention,
    [TAX_INCOME_SOURCES.TAX_TO_DONATION]: TAX_INCOME_COLOR_GROUPS.attention,
};

/**
 * currencyUnit을 기반으로 동적 라벨 객체를 생성합니다.
 * @param {string} currencyUnit - 학급 화폐 단위 (예: "미르")
 * @returns {Object} 출처 키에 매핑된 라벨 객체
 */
export const getSourceLabels = (currencyUnit = '화폐') => ({
    [TAX_INCOME_SOURCES.STORE]: '상점 구매세',
    [TAX_INCOME_SOURCES.PAYROLL]: '급여 공제세',
    [TAX_INCOME_SOURCES.STOCK_BUY]: '주식 매수 수수료',
    [TAX_INCOME_SOURCES.STOCK_SELL]: '주식 매도 수수료',
    [TAX_INCOME_SOURCES.FX_BIL_TO_USD]: `환전 수수료(${currencyUnit}→달러)`,
    [TAX_INCOME_SOURCES.FX_USD_TO_BIL]: `환전 수수료(달러→${currencyUnit})`,
    [TAX_INCOME_SOURCES.ARCADE]: '오락실 수익',
    [TAX_INCOME_SOURCES.REAL_ESTATE]: '부동산 세수',
    [TAX_INCOME_SOURCES.TAX_BILL_PAYMENT]: '세금 고지 납부',
    [TAX_INCOME_SOURCES.MANUAL]: '수동 입력',
    [TAX_INCOME_SOURCES.MANUAL_RECORD]: '수동 입력',
    [TAX_INCOME_SOURCES.SYSTEM]: '기타',
    [TAX_INCOME_SOURCES.POLICE_FINE]: '경찰 벌금',
    [TAX_INCOME_SOURCES.POLICE_FINE_REFUND]: '벌금 환불',
    [TAX_INCOME_SOURCES.DONATION_TRANSFER]: '기부금',
    [TAX_INCOME_SOURCES.DONATION_SPEND]: '기부금 집행',
    [TAX_INCOME_SOURCES.TAX_TO_DONATION]: '기부금 이동',
});

const TAX_TYPE_LABELS = {
    income_tax: '급여 소득세',
    store_revenue: '상점 매출세',
    arcade_revenue: '오락실 수익',
    donation_transfer: '기부금',
    tax_to_donation: '기부금 이동',
    re_acquisition: '취득세',
    re_holding: '보유세',
    re_capital_gains: '양도소득세',
    state_rent: '국유지 임대료',
    rental_income_tax: '임대소득세',
    manual_income: '수동 입력',
};

const TAX_TYPE_COLORS = {
    income_tax: SOURCE_COLORS[TAX_INCOME_SOURCES.PAYROLL],
    store_revenue: SOURCE_COLORS[TAX_INCOME_SOURCES.STORE],
    arcade_revenue: SOURCE_COLORS[TAX_INCOME_SOURCES.ARCADE],
    donation_transfer: SOURCE_COLORS[TAX_INCOME_SOURCES.DONATION_TRANSFER],
    tax_to_donation: SOURCE_COLORS[TAX_INCOME_SOURCES.TAX_TO_DONATION],
    re_acquisition: SOURCE_COLORS[TAX_INCOME_SOURCES.REAL_ESTATE],
    re_holding: SOURCE_COLORS[TAX_INCOME_SOURCES.REAL_ESTATE],
    re_capital_gains: SOURCE_COLORS[TAX_INCOME_SOURCES.REAL_ESTATE],
    state_rent: SOURCE_COLORS[TAX_INCOME_SOURCES.REAL_ESTATE],
    rental_income_tax: SOURCE_COLORS[TAX_INCOME_SOURCES.REAL_ESTATE],
    manual_income: SOURCE_COLORS[TAX_INCOME_SOURCES.MANUAL_RECORD],
};

/**
 * currencyUnit을 기반으로 동적 필터 그룹 객체를 생성합니다.
 * @param {string} currencyUnit - 학급 화폐 단위
 * @returns {Object} 필터 그룹 객체
 */
export const getFilterGroups = (currencyUnit = '화폐') => ({
    trade_fee: {
        key: 'trade_fee',
        label: '매매 수수료',
        sources: [TAX_INCOME_SOURCES.STOCK_BUY, TAX_INCOME_SOURCES.STOCK_SELL],
    },
    fx_all: {
        key: 'fx_all',
        label: `환전 (${currencyUnit}↔달러)`,
        sources: [TAX_INCOME_SOURCES.FX_BIL_TO_USD, TAX_INCOME_SOURCES.FX_USD_TO_BIL],
    },
});

/**
 * currencyUnit을 기반으로 최종 필터 옵션 배열을 생성합니다.
 * @param {string} currencyUnit - 학급 화폐 단위
 * @returns {Array<Object>} UI에 사용할 필터 옵션 배열
 */
export const getFilterOptions = (currencyUnit = '화폐') => {
    const labels = getSourceLabels(currencyUnit);
    const groups = getFilterGroups(currencyUnit);

    return [
        { key: 'all', label: '전체' },
        { key: TAX_INCOME_SOURCES.STORE, label: labels[TAX_INCOME_SOURCES.STORE] },
        { key: TAX_INCOME_SOURCES.PAYROLL, label: labels[TAX_INCOME_SOURCES.PAYROLL] },
        { key: groups.trade_fee.key, label: groups.trade_fee.label },
        { key: groups.fx_all.key, label: groups.fx_all.label },
        { key: TAX_INCOME_SOURCES.ARCADE, label: labels[TAX_INCOME_SOURCES.ARCADE] },
        { key: TAX_INCOME_SOURCES.REAL_ESTATE, label: labels[TAX_INCOME_SOURCES.REAL_ESTATE] },
        { key: TAX_INCOME_SOURCES.POLICE_FINE, label: labels[TAX_INCOME_SOURCES.POLICE_FINE] },
        { key: TAX_INCOME_SOURCES.POLICE_FINE_REFUND, label: labels[TAX_INCOME_SOURCES.POLICE_FINE_REFUND] },
        { key: TAX_INCOME_SOURCES.DONATION_TRANSFER, label: labels[TAX_INCOME_SOURCES.DONATION_TRANSFER] },
        { key: TAX_INCOME_SOURCES.TAX_BILL_PAYMENT, label: labels[TAX_INCOME_SOURCES.TAX_BILL_PAYMENT] },
        { key: TAX_INCOME_SOURCES.MANUAL_RECORD, label: labels[TAX_INCOME_SOURCES.MANUAL_RECORD] },
    ];
};

/**
 * 출처 키에 맞는 동적 라벨을 반환합니다.
 * @param {string} source - 출처 키
 * @param {string} currencyUnit - 학급 화폐 단위
 * @returns {string} 라벨
 */
export const getSourceLabel = (source, currencyUnit = '화폐') => {
    const labels = getSourceLabels(currencyUnit);
    return labels[source] || labels[TAX_INCOME_SOURCES.SYSTEM];
};

/**
 * 출처 키에 맞는 세련된 그라데이션 색상 클래스를 반환합니다.
 * @param {string} source - 출처 키
 * @returns {string} Tailwind CSS 클래스 (그라데이션 + 테두리 + 그림자 포함)
 */
export const getSourceColor = (source) =>
    SOURCE_COLORS[source] || SOURCE_COLORS[TAX_INCOME_SOURCES.SYSTEM];

/**
 * 수입 문서 기준 배지 라벨 반환 (source 우선, taxType 보조)
 * @param {object} income
 * @param {string} currencyUnit
 * @returns {string}
 */
export const getIncomeBadgeLabel = (income, currencyUnit = '화폐') => {
    const source = income?.source;
    const taxType = income?.taxType;
    const sourceLabels = getSourceLabels(currencyUnit);
    if (source && sourceLabels[source]) return sourceLabels[source];
    if (taxType && TAX_TYPE_LABELS[taxType]) return TAX_TYPE_LABELS[taxType];
    return sourceLabels[TAX_INCOME_SOURCES.SYSTEM];
};

/**
 * 수입 문서 기준 배지 색상 반환 (source 우선, taxType 보조)
 * @param {object} income
 * @returns {string}
 */
export const getIncomeBadgeColor = (income) => {
    const source = income?.source;
    const taxType = income?.taxType;
    if (source && SOURCE_COLORS[source]) return SOURCE_COLORS[source];
    if (taxType && TAX_TYPE_COLORS[taxType]) return TAX_TYPE_COLORS[taxType];
    return SOURCE_COLORS[TAX_INCOME_SOURCES.SYSTEM];
};
