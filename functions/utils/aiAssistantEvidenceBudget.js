"use strict";

const AI_ASSISTANT_SERVER_POLICY = Object.freeze({
    allowLegacyChat: false,
    requestWindowMs: 60_000,
    userRequestsPerWindow: 20,
    classRequestsPerWindow: 60,
    rateLimitBackend: "firestore_transaction",
    rateLimitTransactionMaxAttempts: 1,
    rateLimitMaxDocumentReads: 2,
    rateLimitMaxDocumentWrites: 2,
});

const CASH_CHANGE_EVIDENCE_BUDGET = Object.freeze({
    approvedForExecution: true,
    evidenceTier: "related_events",
    maxLookbackDays: 120,
    maxRosterDocuments: 120,
    maxEventDocuments: 201,
    maxEvidenceEvents: 200,
    maxDisplayedCauses: 5,
    maxTotalDocumentReads: 326,
    maxTotalDocumentWrites: 2,
    rosterCacheTtlMs: 60_000,
    eventCacheTtlMs: 30_000,
    maxModelCalls: 0,
    maxModelInputCharacters: 0,
    overflowBehavior: "partial_or_clarify",
});

const UNAPPROVED_EVIDENCE_BUDGET = Object.freeze({
    approvedForExecution: false,
    evidenceTier: "unavailable",
    maxLookbackDays: 0,
    maxRosterDocuments: 0,
    maxEventDocuments: 0,
    maxEvidenceEvents: 0,
    maxDisplayedCauses: 0,
    maxTotalDocumentReads: 0,
    maxTotalDocumentWrites: 0,
    rosterCacheTtlMs: 0,
    eventCacheTtlMs: 0,
    maxModelCalls: 0,
    maxModelInputCharacters: 0,
    overflowBehavior: "unsupported_until_budget_approved",
});

const EVIDENCE_BUDGETS_BY_CAPABILITY = Object.freeze({
    "assets.explain_cash_change": CASH_CHANGE_EVIDENCE_BUDGET,
});

const getEvidenceBudgetForCapability = (capability) => structuredClone(
    EVIDENCE_BUDGETS_BY_CAPABILITY[capability] || UNAPPROVED_EVIDENCE_BUDGET,
);

const normalizeRequestWindow = ({ state, nowMs, windowMs }) => {
    const startedAtMs = Number(state?.windowStartedAtMs);
    const count = Math.max(0, Math.floor(Number(state?.count || 0)));
    if (!Number.isFinite(startedAtMs) ||
        nowMs < startedAtMs ||
        nowMs - startedAtMs >= windowMs) {
        return { windowStartedAtMs: nowMs, count: 0 };
    }
    return { windowStartedAtMs: startedAtMs, count };
};

const evaluateAssistantRequestBudget = ({
    userState,
    classState,
    nowMs = Date.now(),
    policy = AI_ASSISTANT_SERVER_POLICY,
} = {}) => {
    const windowMs = Math.max(1, Number(policy.requestWindowMs || 1));
    const userLimit = Math.max(1, Number(policy.userRequestsPerWindow || 1));
    const classLimit = Math.max(1, Number(policy.classRequestsPerWindow || 1));
    const userWindow = normalizeRequestWindow({
        state: userState,
        nowMs,
        windowMs,
    });
    const classWindow = normalizeRequestWindow({
        state: classState,
        nowMs,
        windowMs,
    });

    if (userWindow.count >= userLimit) {
        return {
            allowed: false,
            scope: "user",
            retryAfterMs: Math.max(
                1,
                windowMs - (nowMs - userWindow.windowStartedAtMs),
            ),
        };
    }
    if (classWindow.count >= classLimit) {
        return {
            allowed: false,
            scope: "class",
            retryAfterMs: Math.max(
                1,
                windowMs - (nowMs - classWindow.windowStartedAtMs),
            ),
        };
    }

    const nextUserState = {
        ...userWindow,
        count: userWindow.count + 1,
    };
    const nextClassState = {
        ...classWindow,
        count: classWindow.count + 1,
    };
    return {
        allowed: true,
        scope: null,
        nextUserState,
        nextClassState,
        userRemaining: userLimit - nextUserState.count,
        classRemaining: classLimit - nextClassState.count,
        retryAfterMs: 0,
    };
};

const createAssistantRequestLimiter = ({
    now = () => Date.now(),
    windowMs = AI_ASSISTANT_SERVER_POLICY.requestWindowMs,
    userRequestsPerWindow = AI_ASSISTANT_SERVER_POLICY.userRequestsPerWindow,
    classRequestsPerWindow = AI_ASSISTANT_SERVER_POLICY.classRequestsPerWindow,
} = {}) => {
    const counters = new Map();

    const getWindow = (key, nowMs) => {
        const current = counters.get(key);
        if (!current || nowMs - current.startedAtMs >= windowMs) {
            return { startedAtMs: nowMs, count: 0 };
        }
        return current;
    };

    const consume = ({ classId, userId }) => {
        const nowMs = now();
        const userKey = `user:${userId}`;
        const classKey = `class:${classId}`;
        const userWindow = getWindow(userKey, nowMs);
        const classWindow = getWindow(classKey, nowMs);

        if (userWindow.count >= userRequestsPerWindow) {
            return {
                allowed: false,
                scope: "user",
                retryAfterMs: Math.max(1, windowMs - (nowMs - userWindow.startedAtMs)),
            };
        }
        if (classWindow.count >= classRequestsPerWindow) {
            return {
                allowed: false,
                scope: "class",
                retryAfterMs: Math.max(1, windowMs - (nowMs - classWindow.startedAtMs)),
            };
        }

        counters.set(userKey, { ...userWindow, count: userWindow.count + 1 });
        counters.set(classKey, { ...classWindow, count: classWindow.count + 1 });
        return {
            allowed: true,
            scope: null,
            userRemaining: userRequestsPerWindow - userWindow.count - 1,
            classRemaining: classRequestsPerWindow - classWindow.count - 1,
            retryAfterMs: 0,
        };
    };

    return { consume };
};

const createTtlReadCache = ({
    ttlMs,
    maxEntries = 100,
    now = () => Date.now(),
} = {}) => {
    const entries = new Map();
    const pendingLoads = new Map();

    const removeExpired = (nowMs) => {
        entries.forEach((entry, key) => {
            if (nowMs - entry.cachedAtMs >= ttlMs) entries.delete(key);
        });
    };

    const store = (key, value, cachedAtMs) => {
        removeExpired(cachedAtMs);
        while (entries.size >= maxEntries) {
            entries.delete(entries.keys().next().value);
        }
        entries.set(key, { value, cachedAtMs });
    };

    const readThrough = async (key, loader) => {
        const nowMs = now();
        const cached = entries.get(key);
        if (cached && nowMs - cached.cachedAtMs < ttlMs) {
            return {
                value: cached.value,
                cacheHit: true,
                cachedAtMs: cached.cachedAtMs,
            };
        }

        if (pendingLoads.has(key)) {
            const pending = await pendingLoads.get(key);
            return { ...pending, cacheHit: true };
        }

        const pending = (async () => {
            const value = await loader();
            const cachedAtMs = now();
            store(key, value, cachedAtMs);
            return { value, cacheHit: false, cachedAtMs };
        })();
        pendingLoads.set(key, pending);
        try {
            return await pending;
        } finally {
            pendingLoads.delete(key);
        }
    };

    return { readThrough };
};

module.exports = {
    AI_ASSISTANT_SERVER_POLICY,
    createAssistantRequestLimiter,
    createTtlReadCache,
    evaluateAssistantRequestBudget,
    getEvidenceBudgetForCapability,
};
