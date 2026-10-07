/**
 * 세금 지출 카테고리/유형 배지 및 필터 상수
 */

export const TAX_EXPENSE_CATEGORIES = {
    ALL: 'all',
    GENERAL: 'general',
    REFUND: 'refund',
    EDUCATION: 'education',
    SUPPLIES: 'supplies',
};

export const EXPENSE_CATEGORY_LABELS = {
    [TAX_EXPENSE_CATEGORIES.GENERAL]: '일반 지출',
    [TAX_EXPENSE_CATEGORIES.REFUND]: '환급',
    [TAX_EXPENSE_CATEGORIES.EDUCATION]: '교육활동',
    [TAX_EXPENSE_CATEGORIES.SUPPLIES]: '학용품',
};

export const EXPENSE_CATEGORY_COLORS = {
    [TAX_EXPENSE_CATEGORIES.GENERAL]: 'bg-slate-50 text-slate-600 border-slate-200',
    [TAX_EXPENSE_CATEGORIES.REFUND]: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    [TAX_EXPENSE_CATEGORIES.EDUCATION]: 'bg-blue-50 text-blue-600 border-blue-200',
    [TAX_EXPENSE_CATEGORIES.SUPPLIES]: 'bg-amber-50 text-amber-600 border-amber-200',
};

const EXPENSE_SOURCE_LABELS = {
    payroll: '급여 지출',
    police_reward: '경찰 상금',
    store_refund: '매점 환불',
};

const EXPENSE_SOURCE_COLORS = {
    payroll: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    police_reward: 'bg-violet-50 text-violet-700 border-violet-200',
    store_refund: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const EXPENSE_TYPE_LABELS = {
    salary: '급여 지출',
    reward: '상금 지급',
};

const EXPENSE_TYPE_COLORS = {
    salary: EXPENSE_SOURCE_COLORS.payroll,
    reward: EXPENSE_SOURCE_COLORS.police_reward,
};

export const getExpenseFilterOptions = () => ([
    { key: TAX_EXPENSE_CATEGORIES.ALL, label: '전체 카테고리' },
    { key: TAX_EXPENSE_CATEGORIES.REFUND, label: '환급' },
    { key: TAX_EXPENSE_CATEGORIES.EDUCATION, label: '교육활동' },
    { key: TAX_EXPENSE_CATEGORIES.SUPPLIES, label: '학용품' },
    { key: TAX_EXPENSE_CATEGORIES.GENERAL, label: '일반' },
]);

export const getExpenseCategoryLabel = (category) =>
    EXPENSE_CATEGORY_LABELS[category] || '일반 지출';

export const getExpenseCategoryColor = (category) =>
    EXPENSE_CATEGORY_COLORS[category] || EXPENSE_CATEGORY_COLORS[TAX_EXPENSE_CATEGORIES.GENERAL];

/**
 * 지출 문서 기준 배지 라벨 반환 (source/expenseType 우선, category 보조)
 * @param {object} expense
 * @returns {string}
 */
export const getExpenseBadgeLabel = (expense) => {
    const source = expense?.source;
    const expenseType = expense?.expenseType;
    const category = expense?.category;
    if (source && EXPENSE_SOURCE_LABELS[source]) return EXPENSE_SOURCE_LABELS[source];
    if (expenseType && EXPENSE_TYPE_LABELS[expenseType]) return EXPENSE_TYPE_LABELS[expenseType];
    return getExpenseCategoryLabel(category);
};

/**
 * 지출 문서 기준 배지 색상 반환 (source/expenseType 우선, category 보조)
 * @param {object} expense
 * @returns {string}
 */
export const getExpenseBadgeColor = (expense) => {
    const source = expense?.source;
    const expenseType = expense?.expenseType;
    const category = expense?.category;
    if (source && EXPENSE_SOURCE_COLORS[source]) return EXPENSE_SOURCE_COLORS[source];
    if (expenseType && EXPENSE_TYPE_COLORS[expenseType]) return EXPENSE_TYPE_COLORS[expenseType];
    return getExpenseCategoryColor(category);
};

