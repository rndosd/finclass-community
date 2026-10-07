"use strict";

const CATEGORY_ACTION_LABELS = {
    incentive: "인센티브 수령",
    job_incentive: "직업 인센티브 수령",
    job_piece_rate: "건별 인센티브 수령",
    salary: "급여 수령",
    salary_deduction: "급여 차감",
    mission: "미션 보상 수령",
    mission_penalty: "미션 보상 회수",
    mission_submit: "미션 제출",
    mission_reject: "미션 반려",
    mission_reject_batch: "미션 일괄 반려",
    mission_reject_completion_batch: "미션 제출 일괄 반려",
    mission_token_conversion: "미션토큰 전환",
    transfer_in: "송금 받음",
    transfer_out: "송금 보냄",
    store: "상점 구매",
    store_purchase: "상점 구매",
    store_refund: "상점 환불",
    store_gift: "상점 선물",
    tax_payment: "세금 납부",
    tax_income: "세금 수입",
    tax_refund: "세금 환급",
    tax_expense_record: "세금 지출 기록",
    tax_expense_cancel: "세금 지출 취소",
    tax_income_cancel: "세금 수입 취소",
    tax_data_bulk_cancel: "세금 데이터 일괄 취소",
    fine: "벌금 납부",
    fine_refund: "벌금 환급",
    reward: "보상 수령",
    reward_refund: "보상 회수",
    loan: "대출",
    loan_approve: "대출 실행",
    loan_repayment: "대출 상환",
    deposit_join: "예금 가입",
    deposit_started: "예금 시작",
    deposit_return: "예금 만기 수령",
    deposit_terminate: "예금 중도 해지",
    deposit_cancel: "예금 취소",
    subscription_payment: "청약 납입",
    subscription_payment_cancel: "청약 납입 취소",
    subscription_terminate: "청약 중도 해지",
    subscription_withdraw: "청약 만기 수령",
    stock_buy: "주식 매수",
    stock_sell: "주식 매도",
    stock_fee: "주식 수수료",
    fund_subscribe: "펀드 가입",
    fund_redeem: "펀드 환매",
    fund_order_refund: "펀드 주문 환불",
    exchange_in: "환전 입금",
    exchange_out: "환전 출금",
    exchange_fee: "환전 수수료",
    currency_exchange: "환전",
    manual_income: "수동 수입",
    manual_expense: "수동 지출",
    interest: "이자 수령",
    dividend: "배당 수령",
    increment: "자산 조정",
    donation: "기부",
    donation_deleted: "기부 삭제",
    donation_moved_to_tax: "기부금 세입 전환",
    donation_spent: "기부금 사용",
    donation_spent_taxincome: "기부금 사용",
    donation_balance_adjusted: "기부금 잔액 보정",
    tax_moved_to_donation: "세금에서 기부금 이동",
    marketplace: "중고마켓 거래",
    real_estate: "부동산 거래",
    rent_income: "임대 수입",
    rent_pay: "임대료 납부",
    rent_deposit_payment: "임대 보증금 납부",
    rent_deposit_received: "임대 보증금 수령",
    rent_deposit_refund: "임대 보증금 반환",
    rent_deposit_deduction: "임대 보증금 차감",
    rent_deposit_return_pending: "임대 보증금 반환 대기",
    auction_purchase: "경매 구매",
    auction_sale: "경매 판매",
    bank_admin_edit: "은행 설정 변경",
    class_fund_usage: "학급 기금 사용",
    class_fund_daily_settlement: "학급 기금 정산",
    job_board: "직업 활동 보상",
};

const safeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeComparableText = (value) =>
    safeText(value)
        .replace(/[-.'"‘’“”()[\]{}:·]/g, "")
        .replace(/\s+/g, "")
        .toLowerCase();

const removeTrailingPunctuation = (value) =>
    safeText(value).replace(/[.!?。]+$/g, "").trim();

const removeOuterQuotes = (value) =>
    removeTrailingPunctuation(value)
        .replace(/^["'‘’“”]+/, "")
        .replace(/["'‘’“”]+$/, "")
        .trim();

const uniqueTexts = (values) => {
    const seen = new Set();
    return values.filter((value) => {
        const text = safeText(value);
        const key = normalizeComparableText(text);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const looksLikeAmountDetail = (value, logData) => {
    const text = safeText(value);
    if (!text || text.includes("%") || /\d+\s*주/.test(text)) return false;

    const digits = text.replace(/[^0-9.-]/g, "");
    const amount = Math.abs(Number(logData?.amount));
    const mentionsAmount =
        Number.isFinite(amount) && amount > 0 && Number(digits) === amount;
    const mentionsCurrency = uniqueTexts([
        logData?.currency,
        logData?.currencyUnit,
        "마로",
        "캐시",
        "FIN",
        "USD",
    ]).some((unit) => text.toLowerCase().includes(unit.toLowerCase()));

    return mentionsAmount && mentionsCurrency;
};

const splitDescriptionDetails = (rawDescription, logData) => {
    const details = [];
    let main = safeText(rawDescription).replace(/^\[POS\]\s*/i, "");

    main = main.replace(/\(([^()]*)\)/g, (match, content) => {
        const detail = safeText(content);
        if (!detail || looksLikeAmountDetail(detail, logData)) return "";
        details.push(detail);
        return "";
    });

    main = main.replace(/\[([^\]]+)\]/g, (match, content) => {
        const detail = safeText(content);
        if (!detail || /^POS$/i.test(detail)) return "";
        details.push(detail);
        return "";
    });

    return {
        main: removeTrailingPunctuation(main),
        details: uniqueTexts(details),
    };
};

const joinTitle = (action, subject) => {
    const safeAction = safeText(action);
    const safeSubject = removeOuterQuotes(subject);
    if (!safeSubject) return safeAction;
    if (!safeAction) return safeSubject;

    const actionKey = normalizeComparableText(safeAction);
    const subjectKey = normalizeComparableText(safeSubject);
    if (subjectKey === actionKey || subjectKey.startsWith(actionKey)) {
        return safeSubject;
    }

    return `${safeAction} · ${safeSubject}`;
};

const combineDetails = (title, details) => {
    const safeDetails = uniqueTexts(details).map(removeTrailingPunctuation);
    if (safeDetails.length === 0) return title;
    return `${title} (${safeDetails.join(" · ")})`;
};

const resolveTransferDescription = (logData, main, details, action) => {
    let counterpart = safeText(logData?.counterpartName);
    if (!counterpart && logData?.category === "transfer_out") {
        counterpart = safeText(main.match(/^(.+?)에게\s*송금/)?.[1]);
    }
    if (!counterpart && logData?.category === "transfer_in") {
        counterpart = safeText(main.match(/^(.+?)(?:로부터\s*입금|\s*:)/)?.[1]);
    }

    const noteKey = normalizeComparableText(logData?.note);
    const remainingDetails = details.filter(
        (detail) => normalizeComparableText(detail) !== noteKey,
    );
    return combineDetails(joinTitle(action, counterpart || main), remainingDetails);
};

const resolveStoreDescription = (main, details, action) => {
    const legacyMatch = main.match(/^(.*)\s+(\d+)\s+purchase$/i);
    const subject = legacyMatch
        ? `${safeText(legacyMatch[1])} ${Number(legacyMatch[2])}개`
        : main.replace(/\s*구매(?:\s*완료)?$/g, "").trim();
    return combineDetails(joinTitle(action, subject), details);
};

const resolveSalaryDescription = (details, action) => {
    const normalizedDetails = details.map((detail) =>
        /^\d+\s*주$/.test(detail) ? `${detail.replace(/\s/g, "")}분 급여` : detail,
    );
    return combineDetails(action, normalizedDetails);
};

const resolveArcadeDescription = (logData, main, details) => {
    const patterns = [
        {
            regex:
                /^(?:paperpick\s*slot|종이\s*뽑기)(?:\s*\d+번?|\s*\d+)?\s*:\s*(.+)$/i,
            game: "종이 뽑기",
        },
        {
            regex: /^(?:roulette\s*result|룰렛\s*결과)\s*:\s*(.+)$/i,
            game: "룰렛",
        },
        {
            regex: /^(?:scratch\s*result|스크래처\s*결과)\s*:\s*(.+)$/i,
            game: "스크래처",
        },
    ];

    for (const pattern of patterns) {
        const match = main.match(pattern.regex);
        if (!match) continue;
        const action = logData?.type === "income" ? "게임 보상 수령" : "게임 참여";
        return combineDetails(joinTitle(action, pattern.game), [
            `결과: ${removeTrailingPunctuation(match[1])}`,
            ...details,
        ]);
    }

    return combineDetails(main || "게임 활동", details);
};

const resolveSubjectBeforeAction = (main, action) => {
    if (!main || !action) return main;
    const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = main.match(new RegExp(`^(.+?)\\s*${escapedAction}$`));
    return match ? removeOuterQuotes(match[1]) : main;
};

const localizeGeneratedEnglish = (value) =>
    safeText(value)
        .replace(/\s+reward granted\b/gi, " 미션 보상 지급")
        .replace(/\s+class dividend payout\b/gi, " 학급 배당 지급")
        .replace(/\s+dividend payout\b/gi, " 배당 지급")
        .replace(/\b(\d+)\s+rank\b/gi, "$1등")
        .replace(/\s+rejected\s+(\d+)\s+attempts\b/gi, " 제출 $1건 반려");

const formatActivityLogDescription = (logData = {}) => {
    const category = safeText(logData.category).toLowerCase();
    const subCategory = safeText(logData.subCategory).toLowerCase();
    const rawDescription = localizeGeneratedEnglish(
        logData.description || logData.title || logData.reason || logData.note,
    );
    const action = CATEGORY_ACTION_LABELS[subCategory] || CATEGORY_ACTION_LABELS[category] || "";
    const { main, details } = splitDescriptionDetails(rawDescription, logData);

    if (category === "transfer_in" || category === "transfer_out") {
        return resolveTransferDescription(logData, main, details, action);
    }

    if (category === "store" || category === "store_purchase") {
        return resolveStoreDescription(main, details, action);
    }

    if (category === "salary" || category === "salary_deduction") {
        return resolveSalaryDescription(details, action);
    }

    if (category === "arcade") {
        return resolveArcadeDescription(logData, main, details);
    }

    if (category === "fine") {
        const subject = main.replace(
            /^벌금(?:\s*부과|\s*납부)?\s*[:·-]?\s*/g,
            "",
        );
        return combineDetails(joinTitle(action, subject), details);
    }

    if (category === "donation" && /^기부\s+[+-]?[\d,.]+/.test(main)) {
        return combineDetails(action, details);
    }

    if (!action) return combineDetails(main || "활동 기록", details);

    const subject = resolveSubjectBeforeAction(main, action);
    return combineDetails(joinTitle(action, subject), details);
};

module.exports = {
    CATEGORY_ACTION_LABELS,
    formatActivityLogDescription,
};
