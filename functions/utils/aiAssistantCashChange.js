"use strict";

const {
    buildTeacherAnswerEnvelope,
    normalizeTeacherQuestionRoute,
} = require("./aiAssistantQuestionCapabilities");
const {
    getEvidenceBudgetForCapability,
} = require("./aiAssistantEvidenceBudget");

const CASH_CHANGE_CAPABILITY = "assets.explain_cash_change";
const CASH_CHANGE_EVIDENCE_BUDGET = getEvidenceBudgetForCapability(
    CASH_CHANGE_CAPABILITY,
);

const toFiniteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const formatMoney = (value, currencyUnit) =>
    `${Math.abs(toFiniteNumber(value)).toLocaleString("ko-KR")}${currencyUnit}`;

const normalizeSearchText = (value) =>
    String(value || "").toLowerCase().replace(/\s+/g, "").trim();

const CASH_EVENT_DIRECTION_BY_TYPE = Object.freeze({
    donation: -1,
});

const resolveRequestedCashChangeWindowDays = (message) => {
    const text = String(message || "");
    const dayMatch = text.match(/(\d{1,3})\s*일/);
    if (dayMatch) return Math.max(1, Number(dayMatch[1]));
    if (/학기|이번\s*학기/.test(text)) {
        return CASH_CHANGE_EVIDENCE_BUDGET.maxLookbackDays;
    }
    if (/두\s*달|2\s*달/.test(text)) return 60;
    if (/한\s*달|1\s*달|이번\s*달/.test(text)) return 30;
    return 7;
};

const resolveCashChangeWindowDays = (message) => Math.min(
    CASH_CHANGE_EVIDENCE_BUDGET.maxLookbackDays,
    resolveRequestedCashChangeWindowDays(message),
);

const isStudentCashChangeQuestion = (
    message,
    { hasSelectedStudent = false } = {},
) => {
    const text = normalizeSearchText(message);
    const excludedFundPatterns = [
        /공동자금|국고/,
        /(?:우리반|학급)(?:의)?(?:공동)?(?:자금|돈|현금|잔액|기부금|기금|펀드)/,
        /(?:기부금|기금|펀드)(?:에서|의)?(?:돈|현금|잔액)/,
    ];
    const excludedFund = excludedFundPatterns.some((pattern) => pattern.test(text));
    const hasCashSubject = /현금|잔액|돈|cash/.test(text);
    const hasChangeIntent = /왜|이유|원인|변화|변동|늘|줄|증가|감소|바뀌|어디갔/.test(text);
    const hasExplicitPeriod = /\d{1,3}일|한달|두달|이번달|학기/.test(text);
    const hasFollowUpIntent = /다시|봐줘|보여줘|확인|분석/.test(text);
    const isSelectedStudentFollowUp = hasSelectedStudent &&
        hasFollowUpIntent &&
        (hasCashSubject || hasExplicitPeriod);
    return !excludedFund && (
        (hasCashSubject && hasChangeIntent) || isSelectedStudentFollowUp
    );
};

const findMentionedStudentIdsByName = (message, students) => {
    const studentsByName = new Map();
    students.forEach((student) => {
        const name = normalizeSearchText(student.name);
        if (!name) return;
        const matchingStudents = studentsByName.get(name) || [];
        matchingStudents.push(student);
        studentsByName.set(name, matchingStudents);
    });

    const mentionedStudentIds = new Set();
    const messageWords = String(message || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    messageWords.forEach((messageWord) => {
        const claimedCharacters = new Set();
        [...studentsByName.entries()]
            .sort(([leftName], [rightName]) => {
                const lengthDifference = rightName.length - leftName.length;
                if (lengthDifference) return lengthDifference;
                const leftIndex = messageWord.indexOf(leftName);
                const rightIndex = messageWord.indexOf(rightName);
                const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
                const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
                return safeLeftIndex - safeRightIndex;
            })
            .forEach(([name, matchingStudents]) => {
                let startIndex = messageWord.indexOf(name);
                while (startIndex !== -1) {
                    const characterIndexes = Array.from(
                        { length: name.length },
                        (_, offset) => startIndex + offset,
                    );
                    if (characterIndexes.every((index) => !claimedCharacters.has(index))) {
                        matchingStudents.forEach(({ uid }) => mentionedStudentIds.add(uid));
                        characterIndexes.forEach((index) => claimedCharacters.add(index));
                    }
                    startIndex = messageWord.indexOf(name, startIndex + 1);
                }
            });
    });
    return mentionedStudentIds;
};

const routeStudentCashChangeQuestion = ({
    message,
    studentMessage = message,
    students = [],
    selectedStudent = null,
}) => {
    if (!isStudentCashChangeQuestion(message, {
        hasSelectedStudent: Boolean(selectedStudent),
    })) {
        return { matched: false, student: null, windowDays: null, route: null };
    }

    const mentionedStudentNumbers = new Set(
        [...String(studentMessage || "").matchAll(/(?:^|[^\d])(\d{1,3})\s*번/g)]
            .map((match) => String(Number(match[1]))),
    );
    const mentionedStudentIdsByName = findMentionedStudentIdsByName(
        studentMessage,
        students,
    );
    const mentionedStudents = students.filter((student) => {
        const studentNumber = student.studentNumber === null ||
            student.studentNumber === undefined ?
            "" : String(Number(student.studentNumber));
        return mentionedStudentIdsByName.has(student.uid) ||
            (studentNumber && mentionedStudentNumbers.has(studentNumber));
    });
    const student = mentionedStudents.length === 1 ? mentionedStudents[0] :
        mentionedStudents.length === 0 ? selectedStudent : null;
    const requestedWindowDays = resolveRequestedCashChangeWindowDays(message);
    const windowDays = resolveCashChangeWindowDays(message);
    const timeRange = {
        kind: "relative_days",
        days: windowDays,
        ...(requestedWindowDays !== windowDays ? { requestedDays: requestedWindowDays } : {}),
    };
    const proposal = {
        capability: CASH_CHANGE_CAPABILITY,
        confidence: mentionedStudents.length === 1 || selectedStudent ? 0.96 : 0.9,
        slots: {
            timeRange,
            ...(student ? { student: student.uid } : {}),
        },
        subjects: student ? [{
            type: "student",
            id: student.uid,
            label: student.name || null,
            source: mentionedStudents.length === 1 ? "message" : "selected_context",
        }] : [],
    };

    return {
        matched: true,
        student: student || null,
        windowDays,
        requestedWindowDays,
        windowAdjusted: requestedWindowDays !== windowDays,
        route: normalizeTeacherQuestionRoute(proposal),
    };
};

const normalizeRecordedCashEvent = (event = {}) => {
    if (event.activityScope === "mission_token" || event.assetType === "missionToken") {
        return null;
    }

    const normalizedCurrency = String(event.currency || "").trim().toUpperCase();
    const isCurrencyExchange = event.type === "exchange" ||
        event.category === "currency_exchange";
    if (!isCurrencyExchange && normalizedCurrency === "USD") return null;

    const explicitDeltaValue =
        event.cashDelta ?? event.adjustmentDelta ?? event.amountSigned;
    const explicitDelta = Number(explicitDeltaValue);
    const amount = Math.abs(toFiniteNumber(event.amount));
    let delta = Number.isFinite(explicitDelta) ? explicitDelta : 0;
    if (!delta && isCurrencyExchange) {
        const amountInClassCurrency = Math.abs(
            toFiniteNumber(event.amountInClassCurrency),
        );
        delta = normalizedCurrency === "USD" ?
            amountInClassCurrency : -amountInClassCurrency;
    }
    if (!delta && event.type === "expense") delta = -amount;
    if (!delta && event.type === "income") delta = amount;
    if (!delta && CASH_EVENT_DIRECTION_BY_TYPE[event.type]) {
        delta = CASH_EVENT_DIRECTION_BY_TYPE[event.type] * amount;
    }
    if (!delta) return null;

    return {
        id: String(event.id || "").trim(),
        delta,
        description: String(event.description || event.category || "현금 활동").trim(),
        category: String(event.category || "general").trim(),
        observedAt: event.createdAt || event.timestamp || null,
    };
};

const buildStudentCashChangeAnswer = ({
    answerId,
    student,
    currencyUnit = "원",
    windowDays = 7,
    windowStart,
    asOf,
    events = [],
    recordsTruncated = false,
    recordsUnavailable = false,
    requestedWindowDays = windowDays,
    eventEvidenceCachedAt = null,
    eventEvidenceCacheHit = false,
}) => {
    const normalizedEvents = events
        .map(normalizeRecordedCashEvent)
        .filter(Boolean);
    const evidenceIds = normalizedEvents.map((event) => `event-${event.id}`);
    const recordedNetChange = normalizedEvents.reduce(
        (sum, event) => sum + event.delta,
        0,
    );
    const largestDecrease = normalizedEvents
        .filter((event) => event.delta < 0)
        .sort((a, b) => a.delta - b.delta)[0] || null;
    const interpretations = [];
    if (largestDecrease) {
        interpretations.push({
            id: "largest-recorded-decrease",
            statement: `가장 큰 감소 기록은 ${largestDecrease.description} ` +
                `${formatMoney(largestDecrease.delta, currencyUnit)}입니다.`,
            evidenceIds: [`event-${largestDecrease.id}`],
        });
    }
    normalizedEvents
        .filter((event) => event.id !== largestDecrease?.id)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, Math.max(
            0,
            CASH_CHANGE_EVIDENCE_BUDGET.maxDisplayedCauses - interpretations.length,
        ))
        .forEach((event, index) => {
            const direction = event.delta < 0 ? "감소" : "증가";
            interpretations.push({
                id: `recorded-cause-${index + 1}`,
                statement: `함께 확인된 ${direction} 기록은 ${event.description} ` +
                    `${formatMoney(event.delta, currencyUnit)}입니다.`,
                evidenceIds: [`event-${event.id}`],
            });
        });
    const recordedChangeText = recordedNetChange === 0 ?
        `순증감 ${formatMoney(0, currencyUnit)}이고` :
        `${formatMoney(recordedNetChange, currencyUnit)} ` +
            `${recordedNetChange < 0 ? "감소했고" : "증가했고"}`;
    let conclusion;
    if (recordsUnavailable) {
        conclusion =
            `${student.name}의 현재 현금은 ${formatMoney(student.cash, currencyUnit)}이며, ` +
            `최근 ${windowDays}일 현금 활동 기록을 읽지 못해 증감 원인은 확인하지 못했습니다.`;
    } else if (normalizedEvents.length === 0) {
        conclusion =
            `${student.name}의 최근 ${windowDays}일 현금 관련 기록에서 확인할 수 있는 ` +
            `증감은 없고, 현재 현금은 ${formatMoney(student.cash, currencyUnit)}입니다.`;
    } else {
        conclusion = `${student.name}의 현금 관련 기록은 최근 ${windowDays}일 동안 ` +
            `${recordedChangeText}, 현재 현금은 ` +
            `${formatMoney(student.cash, currencyUnit)}입니다.`;
    }
    const unknowns = recordsUnavailable ? [
        "현금 활동 기록을 읽지 못해 현재 자료만으로는 변화 원인을 확인할 수 없습니다.",
    ] : normalizedEvents.length === 0 ? [
        "현금 활동 기록이 없어 현재 자료만으로는 변화 원인을 확정할 수 없습니다.",
    ] : [
        "활동 기록이 생략된 경제 사건이 있으면 실제 잔액 변화 전체를 설명하지 못할 수 있습니다.",
    ];

    return buildTeacherAnswerEnvelope({
        answerId,
        capability: CASH_CHANGE_CAPABILITY,
        conclusion,
        facts: [{
            id: "current-cash",
            statement: `현재 현금은 ${formatMoney(student.cash, currencyUnit)}입니다.`,
            evidenceIds: ["student-asset-state"],
        }],
        calculations: recordsUnavailable ? [] : [{
            id: "recorded-net-change",
            formula: "현금 관련 활동 기록의 증감 합계",
            result: recordedNetChange,
            unit: currencyUnit,
            evidenceIds,
        }],
        interpretations,
        unknowns,
        evidence: [{
            id: "student-asset-state",
            concept: "StudentAssetState",
            sourceType: "authority",
            observedAt: asOf,
            reference: {
                kind: "student_asset_state",
                id: student.uid,
            },
        }, ...normalizedEvents.map((event) => ({
            id: `event-${event.id}`,
            concept: "EconomicActivityRecord",
            sourceType: "supporting_record",
            observedAt: event.observedAt || asOf,
            reference: {
                kind: "student_activity_log",
                id: event.id,
            },
        }))],
        asOf,
        warnings: [
            "활동 기록은 완전한 현금 원장이 아니므로 기록 합계와 실제 잔액 변화가 다를 수 있습니다.",
            `조회 시작 시각: ${windowStart}`,
            ...(recordsTruncated ? [
                "조회 안전 한도에 따라 최근 최대 " +
                    String(CASH_CHANGE_EVIDENCE_BUDGET.maxEvidenceEvents) +
                    "건만 계산했습니다.",
            ] : []),
            ...(recordsUnavailable ? [
                "현금 활동 기록 조회에 실패해 현재 잔액만 확인했습니다.",
            ] : []),
            ...(requestedWindowDays > windowDays ? [
                `요청한 ${requestedWindowDays}일 중 근거 예산에 맞춰 최근 ` +
                    `${windowDays}일만 확인했습니다.`,
            ] : []),
            ...(eventEvidenceCacheHit && eventEvidenceCachedAt ? [
                `현금 활동 근거는 ${eventEvidenceCachedAt} 기준 캐시를 사용했습니다.`,
            ] : []),
        ],
        confidence: {
            level: recordsUnavailable || normalizedEvents.length === 0 ?
                "low" : "medium",
            score: recordsUnavailable ? 0.2 :
                normalizedEvents.length === 0 ? 0.35 : 0.68,
            reasons: recordsUnavailable ? [
                "현재 현금은 권위 상태에서 확인했습니다.",
                "현금 활동 기록 조회에 실패했습니다.",
            ] : normalizedEvents.length === 0 ? [
                "현재 현금만 권위 상태에서 확인했습니다.",
                "조회 기간의 현금 활동 기록을 찾지 못했습니다.",
            ] : [
                "현재 현금은 권위 상태에서 확인했습니다.",
                "변화 원인은 선택적으로 기록되는 활동 기록을 사용했습니다.",
            ],
        },
        nextActions: [],
    });
};

const formatStudentCashChangeAnswer = (answer = {}) => {
    const asOfDate = new Date(answer.asOf);
    const formattedAsOf = Number.isNaN(asOfDate.getTime()) ?
        String(answer.asOf || "확인 불가") :
        new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(asOfDate);
    const interpretationLines = (answer.interpretations || [])
        .map(({ statement }) => `- ${statement}`);
    const limitation = answer.unknowns?.[0] || answer.warnings?.[0] || null;
    const safetyWarningLines = (answer.warnings || [])
        .filter((warning) =>
            warning.includes("조회 안전 한도") ||
            warning.includes("근거 예산") ||
            warning.includes("기준 캐시"))
        .map((warning) => "- 조회 범위 주의: " + warning);

    return [
        answer.conclusion,
        "",
        ...interpretationLines,
        ...(limitation ? [`- 현재 자료의 한계: ${limitation}`] : []),
        ...safetyWarningLines,
        `- 기준 시각: ${formattedAsOf}`,
    ].join("\n");
};

const getSelectedStudentUid = (activeContext = {}) =>
    activeContext?.studentUid ||
    activeContext?.actionRef?.studentUid ||
    activeContext?.student?.uid ||
    null;

const normalizeListReadResult = (result, fallbackSource) => {
    const items = Array.isArray(result) ? result :
        Array.isArray(result?.items) ? result.items : [];
    const usage = Array.isArray(result) ? {
        source: fallbackSource,
        documentReads: items.length,
        cacheHit: false,
    } : {
        source: result?.usage?.source || fallbackSource,
        documentReads: Math.max(0, Number(result?.usage?.documentReads || 0)),
        cacheHit: result?.usage?.cacheHit === true,
        truncated: result?.usage?.truncated === true,
        cachedAt: result?.usage?.cachedAt || null,
    };
    return { items, usage };
};

const normalizeStudentReadResult = (result, fallbackStudent) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        return {
            student: fallbackStudent,
            usage: null,
        };
    }
    if (result.student || result.usage) {
        return {
            student: result.student || fallbackStudent,
            usage: {
                source: result.usage?.source || "student_asset_state",
                documentReads: Math.max(0, Number(result.usage?.documentReads || 0)),
                cacheHit: result.usage?.cacheHit === true,
                truncated: result.usage?.truncated === true,
                cachedAt: result.usage?.cachedAt || null,
            },
        };
    }
    return { student: result, usage: null };
};

const buildEvidenceUsage = (sources = []) => {
    const validSources = sources.filter(Boolean);
    const documentReads = validSources.reduce(
        (total, source) => total + Math.max(0, Number(source.documentReads || 0)),
        0,
    );
    return {
        capability: CASH_CHANGE_CAPABILITY,
        evidenceTier: CASH_CHANGE_EVIDENCE_BUDGET.evidenceTier,
        documentReads,
        modelCalls: 0,
        cacheHits: validSources
            .filter(({ cacheHit }) => cacheHit)
            .map(({ source }) => source),
        sources: validSources,
        withinBudget:
            documentReads <= CASH_CHANGE_EVIDENCE_BUDGET.maxTotalDocumentReads,
        budget: structuredClone(CASH_CHANGE_EVIDENCE_BUDGET),
    };
};

const getSelectedStudentFromContext = (activeContext, selectedStudentUid) => {
    const student = activeContext?.student;
    if (!selectedStudentUid || student?.uid !== selectedStudentUid || !student?.name) {
        return null;
    }
    return {
        uid: selectedStudentUid,
        name: student.name,
        studentNumber: student.studentNumber ?? null,
    };
};

const isSelectedStudentContextFollowUp = (message) => {
    const text = normalizeSearchText(message).replace(/[?!.,~]/g, "");
    if (!text || /\d{1,3}\s*번/.test(text)) return false;
    const period = "(?:최근)?(?:\\d{1,3}일|한달|두달|이번달|이번학기|학기)";
    const cashTopic = "(?:현금|잔액|돈)(?:이|은|만|을)?";
    const followUpAction = "(?:다시)?(?:봐줘|보여줘|확인해줘|분석해줘|" +
        "알려줘|말해줘|봐|확인|분석)(?:요)?";
    const changeQuestion = "왜(?:줄었어|늘었어|변했어)(?:요)?";
    const periodOnlyPattern = new RegExp(
        `^${period}(?:로|동안)?(?:${cashTopic})?(?:${followUpAction})?$`,
    );
    const cashOnlyPattern = new RegExp(
        `^${cashTopic}(?:${followUpAction}|${changeQuestion})$`,
    );
    const pronounPattern = new RegExp(
        `^(?:이학생|그학생|얘|이아이)(?:의|은|는|이|가)?` +
        `(?:${period}(?:로|동안)?)?${cashTopic}` +
        `(?:${followUpAction}|${changeQuestion})$`,
    );
    return periodOnlyPattern.test(text) ||
        cashOnlyPattern.test(text) ||
        pronounPattern.test(text);
};

const answerStudentCashChangeQuestion = async ({
    classId,
    message,
    activeContext = null,
    classData = {},
    readStudents,
    readStudentRoster = readStudents,
    readStudentState = null,
    readCashEvents,
    onReadError = () => {},
    now = () => new Date(),
}) => {
    const selectedStudentUid = getSelectedStudentUid(activeContext || {});
    const pendingCashChangeQuestion =
        activeContext?.pendingCapability === CASH_CHANGE_CAPABILITY ?
            String(activeContext.pendingQuestion || "").trim() :
            "";
    const routingMessage = pendingCashChangeQuestion ?
        `${message} ${pendingCashChangeQuestion}` :
        message;
    if (!isStudentCashChangeQuestion(routingMessage, {
        hasSelectedStudent: Boolean(selectedStudentUid),
    })) return null;

    const currencyField = String(
        classData?.currencySettings?.field || "cash",
    ).trim() || "cash";
    const contextStudent = getSelectedStudentFromContext(
        activeContext,
        selectedStudentUid,
    );
    const canUseSelectedContextWithoutRoster = Boolean(contextStudent) &&
        !pendingCashChangeQuestion &&
        isSelectedStudentContextFollowUp(routingMessage);
    const canClarifyBeforeRoster = !selectedStudentUid &&
        !pendingCashChangeQuestion &&
        /^(?:(?:왜|요즘|최근)\s*)?(?:현금|잔액|돈)/
            .test(normalizeSearchText(routingMessage));
    let students = [];
    let rosterUsage = null;
    if (canUseSelectedContextWithoutRoster) {
        students = [contextStudent];
    } else if (!canClarifyBeforeRoster) {
        if (typeof readStudentRoster !== "function") {
            throw new TypeError("readStudentRoster is required");
        }
        const rosterResult = normalizeListReadResult(
            await readStudentRoster({
                classId,
                currencyField,
                limit: CASH_CHANGE_EVIDENCE_BUDGET.maxRosterDocuments + 1,
            }),
            "student_identity_roster",
        );
        students = rosterResult.items;
        rosterUsage = rosterResult.usage;
    }
    const selectedStudent = selectedStudentUid ?
        students.find(({ uid }) => uid === selectedStudentUid) || contextStudent :
        null;
    const routing = routeStudentCashChangeQuestion({
        message: routingMessage,
        studentMessage: pendingCashChangeQuestion ? message : routingMessage,
        students,
        selectedStudent,
    });

    if (routing.route.status !== "ready" || !routing.student) {
        const clarificationContent = rosterUsage?.truncated ?
            "학급 명단 조회 한도 때문에 학생을 확정하지 못했습니다. " +
                "학생 선택 화면에서 대상을 선택한 뒤 다시 질문해주세요." :
            routing.route.clarificationQuestion;
        return {
            content: clarificationContent,
            provider: "local-question-capability",
            questionCapability: CASH_CHANGE_CAPABILITY,
            route: routing.route,
            answerEnvelope: null,
            evidenceUsage: buildEvidenceUsage([rosterUsage]),
        };
    }

    const stateResult = typeof readStudentState === "function" ?
        normalizeStudentReadResult(await readStudentState({
            classId,
            studentUid: routing.student.uid,
            currencyField,
        }), routing.student) :
        normalizeStudentReadResult(routing.student, routing.student);
    const resolvedStudent = {
        ...routing.student,
        ...(stateResult.student || {}),
    };

    const asOfDate = now();
    const windowStart = new Date(
        asOfDate.getTime() - routing.windowDays * 24 * 60 * 60 * 1000,
    );
    let events = [];
    let eventUsage = null;
    let recordsUnavailable = false;
    try {
        const eventsResult = normalizeListReadResult(await readCashEvents({
            classId,
            studentUid: resolvedStudent.uid,
            currencyField,
            windowStart,
            windowDays: routing.windowDays,
            limit: CASH_CHANGE_EVIDENCE_BUDGET.maxEventDocuments,
        }), "student_cash_events");
        events = eventsResult.items;
        eventUsage = eventsResult.usage;
    } catch (error) {
        recordsUnavailable = true;
        onReadError(error);
    }
    const currencyUnit = String(
        classData?.currencyUnit || classData?.currencySettings?.name || "원",
    ).trim() || "원";
    const recordsTruncated = events.length >
        CASH_CHANGE_EVIDENCE_BUDGET.maxEvidenceEvents;
    const answerEnvelope = buildStudentCashChangeAnswer({
        answerId: `q502-${resolvedStudent.uid}-${asOfDate.getTime()}`,
        student: resolvedStudent,
        currencyUnit,
        windowDays: routing.windowDays,
        windowStart: windowStart.toISOString(),
        asOf: asOfDate.toISOString(),
        events: events.slice(0, CASH_CHANGE_EVIDENCE_BUDGET.maxEvidenceEvents),
        recordsTruncated,
        recordsUnavailable,
        requestedWindowDays: routing.requestedWindowDays,
        eventEvidenceCachedAt: eventUsage?.cachedAt || null,
        eventEvidenceCacheHit: eventUsage?.cacheHit === true,
    });

    return {
        content: formatStudentCashChangeAnswer(answerEnvelope),
        provider: "local-question-capability",
        questionCapability: CASH_CHANGE_CAPABILITY,
        route: routing.route,
        answerEnvelope,
        recordsTruncated,
        recordsUnavailable,
        evidenceUsage: buildEvidenceUsage([
            rosterUsage,
            stateResult.usage,
            eventUsage,
        ]),
        timestamp: asOfDate.toISOString(),
    };
};

module.exports = {
    answerStudentCashChangeQuestion,
    buildStudentCashChangeAnswer,
    formatStudentCashChangeAnswer,
    routeStudentCashChangeQuestion,
};
