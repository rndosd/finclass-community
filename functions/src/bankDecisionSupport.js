"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const {
    assertTeacherAdminOrDelegatedPermissionFromClaims,
} = require("../utils/permissions");
const { canUseFeature, getGlobalConfig } = require("../utils/planManager");
const { getDepositInterestWithholdingPolicy } = require("../utils/taxPolicy");
const {
    BANK_DEPOSIT_DECISION_CONTEXT_VERSION,
    buildBankDepositDecisionContext,
    readValidBankDepositContextCache,
    simulateBankDepositProduct: runBankDepositProductSimulation,
    toPublicBankDepositDecisionContext,
} = require("../utils/bankDepositDecision");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const REGION = "asia-northeast3";
const BANK_DEPOSIT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const CACHE_COLLECTION = "internalDecisionContextCache";

function cacheRef(classId) {
    return db.doc(`${CACHE_COLLECTION}/bankDeposit__${classId}`);
}

function readValidCachedContext(snapshot, nowMs) {
    if (!snapshot?.exists) return null;
    return readValidBankDepositContextCache(snapshot.data() || {}, nowMs);
}

async function buildFreshContext(classId, nowMs) {
    const classRef = db.doc(`classes/${classId}`);
    const [
        classSnapshot,
        studentsSnapshot,
        economyBaselineSnapshot,
        bankOverviewSnapshot,
        bankSettingsSnapshot,
        tierAdjustmentsSnapshot,
        globalConfig,
    ] = await Promise.all([
        classRef.get(),
        // Legacy student documents may omit role or status, so filtering after
        // the collection read preserves the same compatibility as payroll caches.
        classRef.collection("students").get(),
        classRef.collection("dashboardSummary").doc("economyBaseline").get(),
        classRef.collection("dashboardSummary").doc("bankOverviewSavings").get(),
        classRef.collection("bank").doc("settings").get(),
        classRef.collection("bankConfig").doc("tierAdjustments").get(),
        getGlobalConfig(),
    ]);

    if (!classSnapshot.exists) {
        throw new HttpsError("not-found", "학급 정보를 찾을 수 없습니다.");
    }

    const classData = classSnapshot.data() || {};
    const students = studentsSnapshot.docs.map((studentSnapshot) => (
        studentSnapshot.data() || {}
    ));
    const context = buildBankDepositDecisionContext({
        generatedAtMs: nowMs,
        classData,
        economyBaseline: economyBaselineSnapshot.exists ?
            economyBaselineSnapshot.data() || {} : {},
        bankOverviewSavings: bankOverviewSnapshot.exists ?
            bankOverviewSnapshot.data() || {} : {},
        bankSettings: bankSettingsSnapshot.exists ?
            bankSettingsSnapshot.data() || {} : {},
        tierAdjustments: tierAdjustmentsSnapshot.exists ?
            tierAdjustmentsSnapshot.data() || {} : {},
        withholdingPolicy: getDepositInterestWithholdingPolicy(classData),
        taxFeatureEnabled: canUseFeature(
            globalConfig,
            classData.planType || "FREE",
            "bank",
            "enableTax",
        ),
        students,
    });
    const expiresAtMs = nowMs + BANK_DEPOSIT_CONTEXT_TTL_MS;

    await cacheRef(classId).set({
        schemaVersion: BANK_DEPOSIT_DECISION_CONTEXT_VERSION,
        contextType: "bank.deposit_product_launch",
        classId,
        context,
        generatedAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    return {
        context,
        expiresAtMs,
        sourceReads: {
            studentDocuments: studentsSnapshot.size,
            classScopedDocuments: 5,
            cacheDocuments: 0,
            sharedPlanConfigLookup: true,
        },
    };
}

async function resolveContext(classId, { forceRefresh = false } = {}) {
    const nowMs = Date.now();
    let cacheHit = false;
    let sourceReads = {
        studentDocuments: 0,
        classScopedDocuments: 0,
        cacheDocuments: 1,
        sharedPlanConfigLookup: false,
    };
    let resolved = null;

    if (!forceRefresh) {
        const cachedSnapshot = await cacheRef(classId).get();
        resolved = readValidCachedContext(cachedSnapshot, nowMs);
        cacheHit = Boolean(resolved);
    }

    if (!resolved) {
        resolved = await buildFreshContext(classId, nowMs);
        sourceReads = {
            ...resolved.sourceReads,
            cacheDocuments: forceRefresh ? 0 : 1,
        };
    }

    return {
        ...resolved,
        cacheHit,
        sourceReads,
    };
}

function requireClassId(request) {
    const classId = String(request.data?.classId || "").trim();
    if (!classId || classId.includes("/") || classId.length > 128) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }
    return classId;
}

function requireCandidate(request) {
    const candidate = request.data?.candidate;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new HttpsError("invalid-argument", "candidate is required.");
    }
    return candidate;
}

exports.getBankDepositDecisionContext = onCall(
    {
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = requireClassId(request);
        await assertTeacherAdminOrDelegatedPermissionFromClaims(request, {
            classId,
            permissionKey: "bank_admin",
        });

        const forceRefresh = request.data?.forceRefresh === true;
        const candidate = request.data?.candidate;
        const resolved = await resolveContext(classId, { forceRefresh });

        const simulation = candidate && typeof candidate === "object" && !Array.isArray(candidate) ?
            runBankDepositProductSimulation(resolved.context, candidate) : null;

        return {
            success: true,
            classId,
            context: toPublicBankDepositDecisionContext(resolved.context),
            simulation,
            cache: {
                hit: resolved.cacheHit,
                ttlSeconds: Math.floor(BANK_DEPOSIT_CONTEXT_TTL_MS / 1000),
                expiresAtMs: resolved.expiresAtMs,
                sourceReads: resolved.sourceReads,
            },
        };
    },
);

exports.previewBankDepositProductDecision = onCall(
    {
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        const classId = requireClassId(request);
        const candidate = requireCandidate(request);
        await assertTeacherAdminOrDelegatedPermissionFromClaims(request, {
            classId,
            permissionKey: "bank_admin",
        });

        const resolved = await resolveContext(classId, {
            forceRefresh: request.data?.forceRefresh === true,
        });

        return {
            success: true,
            classId,
            simulation: runBankDepositProductSimulation(resolved.context, candidate),
            context: {
                schemaVersion: resolved.context.schemaVersion,
                generatedAtMs: resolved.context.generatedAtMs,
                currency: resolved.context.currency,
            },
            cache: {
                hit: resolved.cacheHit,
                ttlSeconds: Math.floor(BANK_DEPOSIT_CONTEXT_TTL_MS / 1000),
                expiresAtMs: resolved.expiresAtMs,
                sourceReads: resolved.sourceReads,
            },
        };
    },
);
