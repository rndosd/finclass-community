/** Firestore Timestamp | Date | ISO -> Date */
function toDate(tsOrDate) {
    if (!tsOrDate) return null;
    if (typeof tsOrDate.toDate === "function") return tsOrDate.toDate();
    if (typeof tsOrDate.seconds === "number") {
        const nanos = typeof tsOrDate.nanoseconds === "number" ? tsOrDate.nanoseconds : 0;
        return new Date(tsOrDate.seconds * 1000 + Math.floor(nanos / 1000000));
    }
    if (typeof tsOrDate._seconds === "number") {
        const nanos = typeof tsOrDate._nanoseconds === "number" ? tsOrDate._nanoseconds : 0;
        return new Date(tsOrDate._seconds * 1000 + Math.floor(nanos / 1000000));
    }
    if (tsOrDate instanceof Date) return tsOrDate;
    const d = new Date(tsOrDate);
    return isNaN(d.getTime()) ? null : d;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value) => String(value).padStart(2, "0");

function formatDateKeyInKST(date = new Date()) {
    const d = toDate(date);
    if (!d) return "";

    const kstDate = new Date(d.getTime() + KST_OFFSET_MS);
    return [
        kstDate.getUTCFullYear(),
        pad2(kstDate.getUTCMonth() + 1),
        pad2(kstDate.getUTCDate()),
    ].join("-");
}

function parseDateKeyAsKST(value, options = {}) {
    const match = String(value || "").trim().match(DATE_KEY_RE);
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const startMs = Date.UTC(year, monthIndex, day) - KST_OFFSET_MS;

    return new Date(startMs + (options.endOfDay ? ONE_DAY_MS - 1 : 0));
}

/** * [백엔드용] KST 자정으로 정규화
 * 서버 환경(UTC)에서도 한국 시간 기준 00:00:00을 정확히 리턴합니다.
 */
function startOfDayInKST(date = new Date()) {
    const d = toDate(date);
    if (!d) return null;

    const kstDate = new Date(d.getTime() + KST_OFFSET_MS);
    const year = kstDate.getUTCFullYear();
    const month = kstDate.getUTCMonth();
    const day = kstDate.getUTCDate();

    return new Date(Date.UTC(year, month, day, 0) - KST_OFFSET_MS);
}

function endOfDayInKST(date = new Date()) {
    const start = startOfDayInKST(date);
    if (!start) return null;
    return new Date(start.getTime() + ONE_DAY_MS - 1);
}

/** * [백엔드용] KST 달력 일수 더하기
 */
function addCalendarDaysInKST(date, days) {
    const base = startOfDayInKST(date);
    if (!base) return null;

    const out = new Date(base.getTime());
    out.setUTCDate(out.getUTCDate() + (Number(days) || 0));
    return out;
}

/** 예금 만기일 계산 (표현용, 확인은 직접 계산 권장) */
function calculateMaturityDate(saving) {
    const priority = [
        "expectedMaturityDate",
        "actualMaturityDate",
        "maturityDate",
    ];
    for (const f of priority) {
        const v = toDate(saving?.[f]);
        if (v) return startOfDayInKST(v);
    }

    const start = toDate(saving?.startedAt) || toDate(saving?.processedAt) || toDate(saving?.appliedAt);
    const days = Number(saving?.days || 0);
    if (start && days > 0) {
        return addCalendarDaysInKST(start, days);
    }
    return null;
}

/** 대출 상환 예정일 계산 (표현용, 확인은 직접 계산 권장) */
function calculateRepaymentDate(loan) {
    const priority = [
        "expectedRepaymentDate",
        "actualRepaymentDate",
        "repaymentDate",
    ];
    for (const f of priority) {
        const v = toDate(loan?.[f]);
        if (v) return startOfDayInKST(v);
    }

    const start = toDate(loan?.startedAt) || toDate(loan?.processedAt) || toDate(loan?.appliedAt);
    const days = Number(loan?.days || 0);
    if (start && days > 0) {
        return addCalendarDaysInKST(start, days);
    }
    return null;
}

function getElapsedLoanDays(loan, now = new Date()) {
    const startDate =
        toDate(loan?.startedAt) ||
        toDate(loan?.processedAt) ||
        toDate(loan?.appliedAt);
    const startDay = startOfDayInKST(startDate);
    const today = startOfDayInKST(now);

    if (!startDay || !today) return 0;

    const diffMs = today.getTime() - startDay.getTime();
    if (diffMs <= 0) return 0;

    return Math.floor(diffMs / ONE_DAY_MS);
}

function resolveLoanPenaltyBaseDate(loan) {
    const repaymentDate = calculateRepaymentDate(loan);
    const penaltyBaseDate = toDate(loan?.penaltyBaseDate);
    const effectiveBaseDate =
        repaymentDate && penaltyBaseDate ?
            (penaltyBaseDate.getTime() > repaymentDate.getTime() ?
                penaltyBaseDate :
                repaymentDate) :
            penaltyBaseDate || repaymentDate;

    return effectiveBaseDate ? startOfDayInKST(effectiveBaseDate) : null;
}

function getLoanOverdueDays(loan, now = new Date()) {
    const baseDate = resolveLoanPenaltyBaseDate(loan);
    const today = startOfDayInKST(now);

    if (!baseDate || !today) return 0;

    const diffMs = today.getTime() - baseDate.getTime();
    if (diffMs <= 0) return 0;

    return Math.floor(diffMs / ONE_DAY_MS);
}

function hasLoanOverduePenalty(loan, now = new Date()) {
    return getLoanOverdueDays(loan, now) > 0;
}

/** 예금 만기 도래 여부 (KST 자정 비교) */
function isClaimableByMaturity(saving, now = new Date()) {
    const maturity = calculateMaturityDate(saving);
    if (!maturity) return false;
    const nowKST0 = startOfDayInKST(now);
    const maturityKST0 = startOfDayInKST(maturity);
    return nowKST0.getTime() >= maturityKST0.getTime();
}

/** 대출 상환일 도래 여부 */
function isDueForRepayment(loan, now = new Date()) {
    const repay = calculateRepaymentDate(loan);
    if (!repay) return false;
    const nowKST0 = startOfDayInKST(now);
    const repayKST0 = startOfDayInKST(repay);
    return nowKST0.getTime() >= repayKST0.getTime();
}

/** 이자 계산 (확정값 우선) */
function calculateFinalInterest(saving) {
    if (
        saving.finalInterestPaid !== undefined &&
    saving.finalInterestPaid !== null
    ) {
        return Number(saving.finalInterestPaid);
    }
    return Number(saving.interestCalculatedOnRequest || 0);
}

module.exports = {
    toDate,
    formatDateKeyInKST,
    parseDateKeyAsKST,
    startOfDayInKST,
    endOfDayInKST,
    addCalendarDaysInKST,
    calculateMaturityDate,
    calculateRepaymentDate,
    getElapsedLoanDays,
    resolveLoanPenaltyBaseDate,
    getLoanOverdueDays,
    hasLoanOverduePenalty,
    isClaimableByMaturity,
    isDueForRepayment,
    calculateFinalInterest,
};
