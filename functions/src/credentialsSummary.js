"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

const {
    assertTeacherOrAdminFromClaims,
    assertTeacherAdminOrCredentialsAdminFromClaims,
} = require("../utils/permissions");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const REGION = "asia-northeast3";
const OWNED_TITLE_DOCUMENT_PATH =
    "classes/{classId}/students/{studentUid}/ownedTitles/{ownedTitleId}";
const TITLE_REQUEST_DOCUMENT_PATH =
    "classes/{classId}/titleRequests/{requestId}";
const CREDENTIAL_TEACHER_SUMMARY_DOC_ID = "teacherTitles";
const RECENT_REVIEWED_REQUEST_LIMIT = 20;
const WRITE_BATCH_SIZE = 400;
const FIRESTORE_IN_QUERY_LIMIT = 10;

function normalizeText(value, fallback = "") {
    const text = String(value || "").trim();
    return text || fallback;
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    if (typeof value.seconds === "number") {
        return value.seconds * 1000;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getEventData(docSnapshot) {
    return docSnapshot?.exists ? docSnapshot.data() || {} : null;
}

function cloneStringArray(value) {
    return Array.isArray(value)
        ? value
            .map((item) => normalizeText(item))
            .filter(Boolean)
        : [];
}

function clonePositiveCountMap(value) {
    if (!value || typeof value !== "object") return {};

    return Object.entries(value).reduce((accumulator, [key, count]) => {
        const normalizedKey = normalizeText(key);
        const normalizedCount = Math.max(0, Number(count || 0));
        if (!normalizedKey || normalizedCount <= 0) return accumulator;
        accumulator[normalizedKey] = normalizedCount;
        return accumulator;
    }, {});
}

function getStudentFallback(student = {}) {
    return {
        studentName:
            student?.name ||
            student?.displayName ||
            student?.studentName ||
            "Student",
        studentNumber: student?.studentNumber || "",
    };
}

function createEmptyStudentTitleStat() {
    return {
        ownedTitleIds: [],
        ownedCount: 0,
        equippedTitleNames: [],
        pendingRequestCount: 0,
        pendingRequestPreview: [],
        extraPendingRequestCount: 0,
    };
}

function cloneStudentTitleStat(value = {}) {
    return {
        ownedTitleIds: cloneStringArray(value?.ownedTitleIds),
        ownedCount: Math.max(0, Number(value?.ownedCount || 0)),
        equippedTitleNames: cloneStringArray(value?.equippedTitleNames),
        pendingRequestCount: Math.max(0, Number(value?.pendingRequestCount || 0)),
        pendingRequestPreview: cloneStringArray(value?.pendingRequestPreview),
        extraPendingRequestCount: Math.max(
            0,
            Number(value?.extraPendingRequestCount || 0),
        ),
    };
}

function ensureStudentTitleStat(studentTitleStats, studentUid) {
    if (!studentUid) return createEmptyStudentTitleStat();
    if (!studentTitleStats[studentUid]) {
        studentTitleStats[studentUid] = createEmptyStudentTitleStat();
    }
    return studentTitleStats[studentUid];
}

function sortPendingRequests(left, right) {
    return (
        toMillis(right?.requestedAt || right?.updatedAt) -
            toMillis(left?.requestedAt || left?.updatedAt) ||
        String(left?.studentName || "").localeCompare(
            String(right?.studentName || ""),
            "ko",
        )
    );
}

function sortReviewedRequests(left, right) {
    return (
        toMillis(right?.reviewedAt || right?.updatedAt || right?.requestedAt) -
            toMillis(left?.reviewedAt || left?.updatedAt || left?.requestedAt) ||
        String(left?.studentName || "").localeCompare(
            String(right?.studentName || ""),
            "ko",
        )
    );
}

function getCredentialTeacherSummaryRef(classId) {
    return db.doc(
        `classes/${classId}/credentialSummary/${CREDENTIAL_TEACHER_SUMMARY_DOC_ID}`,
    );
}

function normalizeRequestRecord(record = {}, rosterMap = new Map()) {
    const studentUid = normalizeText(record?.studentUid);
    const fallbackStudent = rosterMap.get(studentUid) || null;
    const fallback = getStudentFallback(fallbackStudent);

    return {
        id: normalizeText(record?.id || record?.requestId),
        requestId: normalizeText(record?.requestId || record?.id),
        definitionDeleted: Boolean(record?.definitionDeleted),
        studentUid,
        studentName: normalizeText(
            record?.studentName || fallback.studentName,
            "Student",
        ),
        studentNumber: normalizeText(
            record?.studentNumber || fallback.studentNumber,
        ),
        titleId: normalizeText(record?.titleId),
        titleName: normalizeText(record?.titleName),
        acquisitionCondition: normalizeText(record?.acquisitionCondition),
        status: normalizeText(record?.status, "pending"),
        requestMessage: normalizeText(record?.requestMessage),
        reviewMessage: normalizeText(record?.reviewMessage),
        reviewedByUid: normalizeText(record?.reviewedByUid),
        reviewedByName: normalizeText(record?.reviewedByName),
        category: normalizeText(record?.category),
        gradeId: normalizeText(record?.gradeId),
        rarity: normalizeText(record?.rarity, "common"),
        requestedAt: record?.requestedAt || null,
        reviewedAt: record?.reviewedAt || null,
        updatedAt: record?.updatedAt || null,
    };
}

function normalizeOwnedTitleRecord(record = {}, ownedId = "") {
    return {
        id: normalizeText(record?.id || ownedId),
        titleId: normalizeText(record?.titleId || ownedId),
        titleName: normalizeText(record?.titleName),
        equipped: Boolean(record?.equipped),
        equippedOrder: Number.isFinite(Number(record?.equippedOrder))
            ? Number(record?.equippedOrder)
            : null,
        isRevoked: Boolean(record?.isRevoked),
        obtainedAt: record?.obtainedAt || null,
        createdAt: record?.createdAt || null,
    };
}

function buildOwnedTitleStateFromRecords(records = []) {
    const activeRecords = records
        .map((record) => normalizeOwnedTitleRecord(record, record?.id))
        .filter((item) => item.titleId && !item.isRevoked);

    const ownedTitleIds = [...new Set(activeRecords.map((item) => item.titleId))]
        .sort((left, right) => String(left).localeCompare(String(right), "ko"));

    const equippedTitleNames = activeRecords
        .filter((item) => item.equipped)
        .sort(
            (left, right) =>
                Number(left?.equippedOrder ?? Number.MAX_SAFE_INTEGER) -
                    Number(right?.equippedOrder ?? Number.MAX_SAFE_INTEGER) ||
                toMillis(left?.obtainedAt || left?.createdAt) -
                    toMillis(right?.obtainedAt || right?.createdAt),
        )
        .map((item) => normalizeText(item?.titleName))
        .filter(Boolean);

    return {
        ownedTitleIds,
        ownedCount: activeRecords.length,
        equippedTitleNames,
    };
}

function buildCredentialTeacherRequestSlice(requestDocs = [], rosterMap = new Map()) {
    const requestCountByDefinition = {};
    const pendingRequests = [];
    const reviewedRequests = [];
    const pendingTitlesByStudent = {};

    requestDocs.forEach((requestDoc) => {
        const request = normalizeRequestRecord(requestDoc, rosterMap);
        if (!request.requestId || request.definitionDeleted) return;

        if (request.titleId) {
            requestCountByDefinition[request.titleId] =
                Number(requestCountByDefinition[request.titleId] || 0) + 1;
        }

        if (request.status === "pending") {
            if (!pendingTitlesByStudent[request.studentUid]) {
                pendingTitlesByStudent[request.studentUid] = [];
            }
            if (request.titleName) {
                pendingTitlesByStudent[request.studentUid].push(request.titleName);
            }
            pendingRequests.push(request);
            return;
        }

        reviewedRequests.push(request);
    });

    const pendingStatsByStudent = Object.entries(pendingTitlesByStudent).reduce(
        (accumulator, [studentUid, titleNames]) => {
            accumulator[studentUid] = {
                pendingRequestCount: titleNames.length,
                pendingRequestPreview: titleNames.slice(0, 2),
                extraPendingRequestCount: Math.max(0, titleNames.length - 2),
            };
            return accumulator;
        },
        {},
    );

    return {
        requestCountByDefinition,
        pendingRequests: pendingRequests.sort(sortPendingRequests),
        recentReviewedRequests: reviewedRequests
            .sort(sortReviewedRequests)
            .slice(0, RECENT_REVIEWED_REQUEST_LIMIT),
        pendingStatsByStudent,
    };
}

function cloneCredentialTeacherSummary(summary = {}) {
    const studentTitleStats = Object.entries(summary?.studentTitleStats || {}).reduce(
        (accumulator, [studentUid, stat]) => {
            const normalizedStudentUid = normalizeText(studentUid);
            if (!normalizedStudentUid) return accumulator;
            accumulator[normalizedStudentUid] = cloneStudentTitleStat(stat);
            return accumulator;
        },
        {},
    );

    return {
        summaryVersion: 2,
        studentTitleStats,
        ownedTitleCountByDefinition: clonePositiveCountMap(
            summary?.ownedTitleCountByDefinition,
        ),
        requestCountByDefinition: clonePositiveCountMap(
            summary?.requestCountByDefinition,
        ),
        pendingRequests: Array.isArray(summary?.pendingRequests)
            ? summary.pendingRequests.map((item) => normalizeRequestRecord(item))
            : [],
        recentReviewedRequests: Array.isArray(summary?.recentReviewedRequests)
            ? summary.recentReviewedRequests.map((item) => normalizeRequestRecord(item))
            : [],
    };
}

function chunkArray(items = [], size = FIRESTORE_IN_QUERY_LIMIT) {
    const chunks = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function commitOperationsInChunks(operations = [], batchSize = WRITE_BATCH_SIZE) {
    const validOperations = operations.filter(Boolean);

    for (let index = 0; index < validOperations.length; index += batchSize) {
        const batch = db.batch();
        const currentBatch = validOperations.slice(index, index + batchSize);

        currentBatch.forEach((operation) => {
            if (operation.type === "set") {
                batch.set(operation.ref, operation.data, operation.options || {});
                return;
            }
            if (operation.type === "update") {
                batch.update(operation.ref, operation.data);
                return;
            }
            if (operation.type === "delete") {
                batch.delete(operation.ref);
            }
        });

        await batch.commit();
    }
}

async function loadClassRoster(classId) {
    const snapshot = await db.collection(`classes/${classId}/students`).get();

    return snapshot.docs
        .map((studentDoc) => ({
            uid: studentDoc.id,
            ...(studentDoc.data() || {}),
        }))
        .filter((student) => student?.uid)
        .sort((left, right) => {
            const leftNumber = Number(left?.studentNumber ?? Number.MAX_SAFE_INTEGER);
            const rightNumber = Number(right?.studentNumber ?? Number.MAX_SAFE_INTEGER);
            return leftNumber - rightNumber;
        });
}

async function buildCredentialTeacherSummaryFromRaw(classId, roster = []) {
    const rosterList = Array.isArray(roster)
        ? roster.filter((student) => student?.uid)
        : [];
    const rosterMap = new Map(rosterList.map((student) => [student.uid, student]));
    const studentTitleStats = {};
    const ownedTitleCountByDefinition = {};

    rosterList.forEach((student) => {
        studentTitleStats[student.uid] = createEmptyStudentTitleStat();
    });

    const [ownedTitleSnapshots, requestSnapshot] = await Promise.all([
        Promise.all(
            rosterList.map((student) =>
                db
                    .collection(`classes/${classId}/students/${student.uid}/ownedTitles`)
                    .get()
                    .then((snapshot) => ({
                        studentUid: student.uid,
                        docs: snapshot.docs,
                    })),
            ),
        ),
        db.collection(`classes/${classId}/titleRequests`).get(),
    ]);

    ownedTitleSnapshots.forEach(({ studentUid, docs }) => {
        const ownedState = buildOwnedTitleStateFromRecords(
            docs.map((ownedDoc) => ({
                id: ownedDoc.id,
                ...(ownedDoc.data() || {}),
            })),
        );

        ownedState.ownedTitleIds.forEach((titleId) => {
            ownedTitleCountByDefinition[titleId] =
                Number(ownedTitleCountByDefinition[titleId] || 0) + 1;
        });

        const studentStat = ensureStudentTitleStat(studentTitleStats, studentUid);
        studentStat.ownedTitleIds = ownedState.ownedTitleIds;
        studentStat.ownedCount = ownedState.ownedCount;
        studentStat.equippedTitleNames = ownedState.equippedTitleNames;
    });

    const requestSlice = buildCredentialTeacherRequestSlice(
        requestSnapshot.docs.map((requestDoc) => ({
            id: requestDoc.id,
            ...(requestDoc.data() || {}),
        })),
        rosterMap,
    );

    Object.entries(requestSlice.pendingStatsByStudent).forEach(
        ([studentUid, pendingStat]) => {
            const studentStat = ensureStudentTitleStat(studentTitleStats, studentUid);
            studentStat.pendingRequestCount = pendingStat.pendingRequestCount;
            studentStat.pendingRequestPreview = pendingStat.pendingRequestPreview;
            studentStat.extraPendingRequestCount =
                pendingStat.extraPendingRequestCount;
        },
    );

    return {
        summaryVersion: 2,
        studentTitleStats,
        ownedTitleCountByDefinition,
        requestCountByDefinition: requestSlice.requestCountByDefinition,
        pendingRequests: requestSlice.pendingRequests,
        recentReviewedRequests: requestSlice.recentReviewedRequests,
    };
}

async function writeCredentialTeacherSummary(classId, summary) {
    await getCredentialTeacherSummaryRef(classId).set(
        {
            ...summary,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );

    return summary;
}

async function rebuildCredentialTeacherSummaryDoc(classId) {
    const roster = await loadClassRoster(classId);
    const summary = await buildCredentialTeacherSummaryFromRaw(classId, roster);
    await writeCredentialTeacherSummary(classId, summary);
    return summary;
}

async function loadCredentialTeacherSummary(
    classId,
    { rebuildIfMissing = false } = {},
) {
    const snapshot = await getCredentialTeacherSummaryRef(classId).get();

    if (snapshot.exists) {
        return cloneCredentialTeacherSummary(snapshot.data() || {});
    }

    if (!rebuildIfMissing) {
        return null;
    }

    return rebuildCredentialTeacherSummaryDoc(classId);
}

function buildOwnedTitleSummaryPatch(summary, studentUid, ownedState) {
    const nextSummary = cloneCredentialTeacherSummary(summary);
    const patch = {
        summaryVersion: 2,
        updatedAt: FieldValue.serverTimestamp(),
        [`studentTitleStats.${studentUid}.ownedTitleIds`]: ownedState.ownedTitleIds,
        [`studentTitleStats.${studentUid}.ownedCount`]: ownedState.ownedCount,
        [`studentTitleStats.${studentUid}.equippedTitleNames`]:
            ownedState.equippedTitleNames,
    };

    const previousStudentStat = cloneStudentTitleStat(
        nextSummary.studentTitleStats?.[studentUid],
    );
    const previousOwnedTitleIds = new Set(previousStudentStat.ownedTitleIds);
    const nextOwnedTitleIds = new Set(ownedState.ownedTitleIds);
    const touchedTitleIds = new Set([
        ...previousOwnedTitleIds,
        ...nextOwnedTitleIds,
    ]);

    touchedTitleIds.forEach((titleId) => {
        const currentCount = Number(
            nextSummary.ownedTitleCountByDefinition?.[titleId] || 0,
        );
        const nextCount =
            currentCount +
            (nextOwnedTitleIds.has(titleId) ? 1 : 0) -
            (previousOwnedTitleIds.has(titleId) ? 1 : 0);

        patch[`ownedTitleCountByDefinition.${titleId}`] =
            nextCount > 0 ? nextCount : FieldValue.delete();
    });

    return patch;
}

function buildRequestSummaryPatch(summary, requestSlice) {
    const nextSummary = cloneCredentialTeacherSummary(summary);
    const patch = {
        summaryVersion: 2,
        updatedAt: FieldValue.serverTimestamp(),
        requestCountByDefinition: requestSlice.requestCountByDefinition,
        pendingRequests: requestSlice.pendingRequests,
        recentReviewedRequests: requestSlice.recentReviewedRequests,
    };

    const allStudentUids = new Set([
        ...Object.keys(nextSummary.studentTitleStats || {}),
        ...Object.keys(requestSlice.pendingStatsByStudent || {}),
    ]);

    allStudentUids.forEach((studentUid) => {
        const nextPendingStat =
            requestSlice.pendingStatsByStudent?.[studentUid] || {
                pendingRequestCount: 0,
                pendingRequestPreview: [],
                extraPendingRequestCount: 0,
            };

        patch[`studentTitleStats.${studentUid}.pendingRequestCount`] =
            nextPendingStat.pendingRequestCount;
        patch[`studentTitleStats.${studentUid}.pendingRequestPreview`] =
            nextPendingStat.pendingRequestPreview;
        patch[`studentTitleStats.${studentUid}.extraPendingRequestCount`] =
            nextPendingStat.extraPendingRequestCount;

        if (!nextSummary.studentTitleStats?.[studentUid]) {
            patch[`studentTitleStats.${studentUid}.ownedTitleIds`] = [];
            patch[`studentTitleStats.${studentUid}.ownedCount`] = 0;
            patch[`studentTitleStats.${studentUid}.equippedTitleNames`] = [];
        }
    });

    return patch;
}

async function loadImpactedTitleRequests(classId, titleIds = []) {
    const normalizedTitleIds = [...new Set(
        titleIds.map((titleId) => normalizeText(titleId)).filter(Boolean),
    )];

    if (!normalizedTitleIds.length) return [];

    const requests = [];
    const seenRequestIds = new Set();

    for (const chunk of chunkArray(normalizedTitleIds)) {
        const snapshot = await db
            .collection(`classes/${classId}/titleRequests`)
            .where("titleId", "in", chunk)
            .get();

        snapshot.docs.forEach((requestDoc) => {
            if (seenRequestIds.has(requestDoc.id)) return;
            seenRequestIds.add(requestDoc.id);
            requests.push({
                id: requestDoc.id,
                ref: requestDoc.ref,
                ...(requestDoc.data() || {}),
            });
        });
    }

    return requests;
}

function getImpactedStudentUidsFromSummary(summary, titleIds = []) {
    const normalizedTitleIdSet = new Set(
        titleIds.map((titleId) => normalizeText(titleId)).filter(Boolean),
    );
    if (!normalizedTitleIdSet.size) return [];

    return Object.entries(summary?.studentTitleStats || {})
        .filter(([, studentStat]) =>
            cloneStringArray(studentStat?.ownedTitleIds).some((titleId) =>
                normalizedTitleIdSet.has(titleId),
            ),
        )
        .map(([studentUid]) => studentUid)
        .filter(Boolean);
}

async function loadImpactedOwnedTitles(
    classId,
    titleIds = [],
    { summary = null, allowRebuild = true } = {},
) {
    const normalizedTitleIds = [...new Set(
        titleIds.map((titleId) => normalizeText(titleId)).filter(Boolean),
    )];
    if (!normalizedTitleIds.length) {
        return {
            impactedOwnedTitles: [],
            summary: summary || null,
        };
    }

    const nextSummary =
        summary || await loadCredentialTeacherSummary(classId, { rebuildIfMissing: true });
    const expectedOwnedTitleCount = normalizedTitleIds.reduce(
        (count, titleId) =>
            count + Number(nextSummary?.ownedTitleCountByDefinition?.[titleId] || 0),
        0,
    );
    const impactedStudentUids = getImpactedStudentUidsFromSummary(
        nextSummary,
        normalizedTitleIds,
    );

    if (!impactedStudentUids.length) {
        if (expectedOwnedTitleCount > 0 && allowRebuild) {
            const rebuiltSummary = await rebuildCredentialTeacherSummaryDoc(classId);
            return loadImpactedOwnedTitles(classId, normalizedTitleIds, {
                summary: rebuiltSummary,
                allowRebuild: false,
            });
        }

        return {
            impactedOwnedTitles: [],
            summary: nextSummary,
        };
    }

    const normalizedTitleIdSet = new Set(normalizedTitleIds);
    const impactedOwnedTitleGroups = await Promise.all(
        impactedStudentUids.map(async (studentUid) => {
            const snapshot = await db
                .collection(`classes/${classId}/students/${studentUid}/ownedTitles`)
                .get();

            return snapshot.docs
                .map((ownedTitleDoc) => ({
                    id: ownedTitleDoc.id,
                    studentUid,
                    ref: ownedTitleDoc.ref,
                    ...(ownedTitleDoc.data() || {}),
                }))
                .filter((item) => {
                    if (item?.isRevoked) return false;
                    const titleId = normalizeText(item?.titleId || item?.id);
                    return normalizedTitleIdSet.has(titleId);
                });
        }),
    );

    const impactedOwnedTitles = impactedOwnedTitleGroups.flat();
    if (allowRebuild && expectedOwnedTitleCount > impactedOwnedTitles.length) {
        const rebuiltSummary = await rebuildCredentialTeacherSummaryDoc(classId);
        return loadImpactedOwnedTitles(classId, normalizedTitleIds, {
            summary: rebuiltSummary,
            allowRebuild: false,
        });
    }

    return {
        impactedOwnedTitles,
        summary: nextSummary,
    };
}

function getOwnedTitleSummaryFingerprint(record = {}, ownedTitleId = "") {
    const normalized = normalizeOwnedTitleRecord(record, ownedTitleId);
    return [
        normalized.titleId,
        normalized.titleName,
        normalized.isRevoked ? "1" : "0",
        normalized.equipped ? "1" : "0",
        normalized.equippedOrder ?? "",
        toMillis(normalized.obtainedAt),
        toMillis(normalized.createdAt),
    ].join("::");
}

function getRequestSummaryFingerprint(record = {}) {
    const normalized = normalizeRequestRecord(record);
    return [
        normalized.requestId,
        normalized.definitionDeleted ? "1" : "0",
        normalized.studentUid,
        normalized.studentName,
        normalized.studentNumber,
        normalized.titleId,
        normalized.titleName,
        normalized.acquisitionCondition,
        normalized.status,
        normalized.requestMessage,
        normalized.reviewMessage,
        normalized.reviewedByUid,
        normalized.reviewedByName,
        normalized.category,
        normalized.gradeId,
        normalized.rarity,
        toMillis(normalized.requestedAt),
        toMillis(normalized.reviewedAt),
        toMillis(normalized.updatedAt),
    ].join("::");
}

async function syncCredentialTeacherOwnedTitleSummary(classId, studentUid) {
    if (!classId || !studentUid) return;

    const summary = await loadCredentialTeacherSummary(classId, {
        rebuildIfMissing: true,
    });
    const snapshot = await db
        .collection(`classes/${classId}/students/${studentUid}/ownedTitles`)
        .get();
    const ownedState = buildOwnedTitleStateFromRecords(
        snapshot.docs.map((ownedDoc) => ({
            id: ownedDoc.id,
            ...(ownedDoc.data() || {}),
        })),
    );
    const patch = buildOwnedTitleSummaryPatch(summary, studentUid, ownedState);

    await getCredentialTeacherSummaryRef(classId).set(patch, { merge: true });
}

async function syncCredentialTeacherTitleRequestSummaryLegacy(classId, summary) {
    const requestSnapshot = await db.collection(`classes/${classId}/titleRequests`).get();
    const requestSlice = buildCredentialTeacherRequestSlice(
        requestSnapshot.docs.map((requestDoc) => ({
            id: requestDoc.id,
            ...(requestDoc.data() || {}),
        })),
    );
    const patch = buildRequestSummaryPatch(summary, requestSlice);

    await getCredentialTeacherSummaryRef(classId).set(patch, { merge: true });
}

async function syncCredentialTeacherTitleRequestSummary(
    classId,
    beforeData = null,
    afterData = null,
) {
    if (!classId) return;

    const summary = await loadCredentialTeacherSummary(classId, {
        rebuildIfMissing: true,
    });
    const affectedTitleIds = [...new Set([
        normalizeText(beforeData?.titleId),
        normalizeText(afterData?.titleId),
    ].filter(Boolean))];
    const requestsRef = db.collection(`classes/${classId}/titleRequests`);

    try {
        const reviewedQuery = requestsRef
            .where("status", "in", ["approved", "rejected"]);
        const [pendingSnapshot, recentReviewedSnapshot, reviewedCountSnapshot] =
            await Promise.all([
                requestsRef.where("status", "==", "pending").get(),
                reviewedQuery
                    .orderBy("reviewedAt", "desc")
                    .limit(RECENT_REVIEWED_REQUEST_LIMIT)
                    .get(),
                reviewedQuery.count().get(),
            ]);

        const reviewedCount = Number(reviewedCountSnapshot.data()?.count || 0);
        const expectedRecentCount = Math.min(
            reviewedCount,
            RECENT_REVIEWED_REQUEST_LIMIT,
        );
        if (recentReviewedSnapshot.size < expectedRecentCount) {
            throw new Error("reviewed title request timestamps are incomplete");
        }

        const affectedDefinitionSnapshots = await Promise.all(
            affectedTitleIds.map((titleId) => requestsRef
                .where("titleId", "==", titleId)
                .select("definitionDeleted")
                .get()),
        );
        const requestCountByDefinition = {
            ...summary.requestCountByDefinition,
        };
        affectedTitleIds.forEach((titleId, index) => {
            const count = affectedDefinitionSnapshots[index].docs.reduce(
                (total, docSnap) =>
                    total + Number(docSnap.data()?.definitionDeleted !== true),
                0,
            );
            if (count > 0) requestCountByDefinition[titleId] = count;
            else delete requestCountByDefinition[titleId];
        });

        const requestSlice = buildCredentialTeacherRequestSlice([
            ...pendingSnapshot.docs,
            ...recentReviewedSnapshot.docs,
        ].map((requestDoc) => ({
            id: requestDoc.id,
            ...(requestDoc.data() || {}),
        })));
        requestSlice.requestCountByDefinition = requestCountByDefinition;
        const patch = buildRequestSummaryPatch(summary, requestSlice);

        await getCredentialTeacherSummaryRef(classId).set(patch, { merge: true });
    } catch (error) {
        console.warn(
            `[credentialsSummary] bounded request summary unavailable; using full rebuild classId=${classId}`,
            error?.message || error,
        );
        await syncCredentialTeacherTitleRequestSummaryLegacy(classId, summary);
    }
}

exports.syncCredentialTeacherOwnedTitleSummary = onDocumentWritten(
    {
        document: OWNED_TITLE_DOCUMENT_PATH,
        region: REGION,
        memory: "512MiB",
    },
    async (event) => {
        const { classId, studentUid, ownedTitleId } = event.params;
        if (!classId || !studentUid || !ownedTitleId) return;

        const beforeData = getEventData(event.data?.before);
        const afterData = getEventData(event.data?.after);
        if (
            getOwnedTitleSummaryFingerprint(beforeData, ownedTitleId) ===
            getOwnedTitleSummaryFingerprint(afterData, ownedTitleId)
        ) {
            return;
        }

        await syncCredentialTeacherOwnedTitleSummary(classId, studentUid);
    },
);

exports.syncCredentialTeacherTitleRequestSummary = onDocumentWritten(
    {
        document: TITLE_REQUEST_DOCUMENT_PATH,
        region: REGION,
        memory: "512MiB",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;

        const beforeData = getEventData(event.data?.before);
        const afterData = getEventData(event.data?.after);
        if (
            getRequestSummaryFingerprint(beforeData) ===
            getRequestSummaryFingerprint(afterData)
        ) {
            return;
        }

        await syncCredentialTeacherTitleRequestSummary(
            classId,
            beforeData,
            afterData,
        );
    },
);

exports.rebuildCredentialTeacherSummary = onCall(
    {
        region: REGION,
        memory: "1GiB",
        timeoutSeconds: 120,
    },
    async (request) => {
        const classId = normalizeText(request.data?.classId);
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        await assertTeacherAdminOrCredentialsAdminFromClaims(request, {
            classId,
        });

        const summary = await rebuildCredentialTeacherSummaryDoc(classId);
        return {
            success: true,
            classId,
            summary,
        };
    },
);

exports.deleteTitleDefinitionsWithCleanup = onCall(
    {
        region: REGION,
        memory: "1GiB",
        timeoutSeconds: 120,
    },
    async (request) => {
        const classId = normalizeText(request.data?.classId);
        const titleIds = [...new Set(
            (Array.isArray(request.data?.titleIds) ? request.data.titleIds : [])
                .map((titleId) => normalizeText(titleId))
                .filter(Boolean),
        )];

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }
        if (!titleIds.length) {
            throw new HttpsError("invalid-argument", "titleIds is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const actorUid = normalizeText(request.auth?.uid);
        const actorName = normalizeText(request.data?.actorName) || actorUid || "teacher";
        const summary = await loadCredentialTeacherSummary(classId, {
            rebuildIfMissing: true,
        });
        const [impactedRequests, impactedOwnedTitleResult] = await Promise.all([
            loadImpactedTitleRequests(classId, titleIds),
            loadImpactedOwnedTitles(classId, titleIds, {
                summary,
                allowRebuild: true,
            }),
        ]);
        const impactedOwnedTitles = impactedOwnedTitleResult.impactedOwnedTitles;

        const operations = [];

        titleIds.forEach((titleId) => {
            operations.push({
                type: "update",
                ref: db.doc(`classes/${classId}/titles/${titleId}`),
                data: {
                    isDeleted: true,
                    isActive: false,
                    isVisible: false,
                    deletedAt: FieldValue.serverTimestamp(),
                    deletedByUid: actorUid,
                    deletedByName: actorName,
                    updatedAt: FieldValue.serverTimestamp(),
                    updatedByUid: actorUid,
                    updatedByName: actorName,
                },
            });
        });

        impactedOwnedTitles.forEach((item) => {
            operations.push({
                type: "update",
                ref: item.ref,
                data: {
                    isRevoked: true,
                    revokedAt: FieldValue.serverTimestamp(),
                    revokedByUid: actorUid,
                    revokedByName: actorName,
                    revokeReason: "Title definition deleted during cleanup.",
                    equipped: false,
                    updatedAt: FieldValue.serverTimestamp(),
                },
            });
        });

        impactedRequests.forEach((item) => {
            const requestUpdate = {
                definitionDeleted: true,
                status:
                    normalizeText(item.status, "pending") === "pending"
                        ? "rejected"
                        : normalizeText(item.status, "rejected"),
                reviewedAt: FieldValue.serverTimestamp(),
                reviewedByUid: actorUid,
                reviewedByName: actorName,
                reviewMessage: "Title definition deleted during cleanup.",
                updatedAt: FieldValue.serverTimestamp(),
            };

            operations.push({
                type: "update",
                ref: item.ref,
                data: requestUpdate,
            });

            if (item.studentUid && item.titleId) {
                operations.push({
                    type: "set",
                    ref: db.doc(
                        `classes/${classId}/students/${item.studentUid}/titleRequests/${item.titleId}`,
                    ),
                    data: requestUpdate,
                    options: { merge: true },
                });
            }
        });

        await commitOperationsInChunks(operations);
        const nextSummary = await rebuildCredentialTeacherSummaryDoc(classId);

        return {
            success: true,
            classId,
            summary: nextSummary,
            deletedDefinitionCount: titleIds.length,
            impactedOwnedTitleCount: impactedOwnedTitles.length,
            impactedRequestCount: impactedRequests.length,
        };
    },
);
