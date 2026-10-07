"use strict";

const admin = require("../firebaseAdminCompat");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
    hasJobApplicationRoundContributionChanged,
} = require("../utils/summaryProjectionGuards");

const db = admin.firestore();
const REGION = "asia-northeast3";
const JOB_APPLICATION_PATH = "classes/{classId}/jobApplications/{applicationId}";
const MAX_BATCH_OPERATIONS = 450;

function getEventData(docSnapshot) {
    return docSnapshot?.exists ? docSnapshot.data() || {} : null;
}

function normalizeRoundId(value) {
    return String(value || "").trim();
}

function emptyCounts() {
    return {
        applicationCount: 0,
        submittedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
    };
}

function applyStatusCount(counts, status) {
    if (status === "submitted") counts.submittedCount += 1;
    if (status === "approved") counts.approvedCount += 1;
    if (status === "rejected") counts.rejectedCount += 1;
}

async function computeRoundCounts(classId, roundId) {
    if (!classId || !roundId) return emptyCounts();

    const applicationsQuery = db
        .collection(`classes/${classId}/jobApplications`)
        .where("roundId", "==", roundId);
    const [allSnap, submittedSnap, approvedSnap, rejectedSnap] = await Promise.all([
        applicationsQuery.count().get(),
        applicationsQuery.where("status", "==", "submitted").count().get(),
        applicationsQuery.where("status", "==", "approved").count().get(),
        applicationsQuery.where("status", "==", "rejected").count().get(),
    ]);

    return {
        applicationCount: Number(allSnap.data()?.count || 0),
        submittedCount: Number(submittedSnap.data()?.count || 0),
        approvedCount: Number(approvedSnap.data()?.count || 0),
        rejectedCount: Number(rejectedSnap.data()?.count || 0),
    };
}

async function syncRoundCountsForRound(classId, roundId) {
    if (!classId || !roundId) return null;

    const roundRef = db.doc(`classes/${classId}/jobRecruitmentRounds/${roundId}`);
    const roundSnap = await roundRef.get();
    if (!roundSnap.exists) return null;

    const counts = await computeRoundCounts(classId, roundId);
    await roundRef.set({
        ...counts,
        statsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return counts;
}

exports.syncJobRecruitmentRoundCounts = onDocumentWritten(
    {
        document: JOB_APPLICATION_PATH,
        region: REGION,
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;

        const beforeData = getEventData(event.data?.before);
        const afterData = getEventData(event.data?.after);
        if (!hasJobApplicationRoundContributionChanged(beforeData, afterData)) {
            return;
        }

        const affectedRoundIds = [
            normalizeRoundId(beforeData?.roundId),
            normalizeRoundId(afterData?.roundId),
        ].filter(Boolean);

        const uniqueRoundIds = [...new Set(affectedRoundIds)];
        await Promise.all(uniqueRoundIds.map((roundId) =>
            syncRoundCountsForRound(classId, roundId)));
    },
);

exports.rebuildJobRecruitmentRoundCounts = onCall(
    {
        region: REGION,
        memory: "512MiB",
        timeoutSeconds: 120,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const [roundsSnap, applicationsSnap] = await Promise.all([
            db.collection(`classes/${classId}/jobRecruitmentRounds`).get(),
            db.collection(`classes/${classId}/jobApplications`).get(),
        ]);

        const countsByRoundId = new Map();
        roundsSnap.forEach((docSnap) => {
            countsByRoundId.set(docSnap.id, emptyCounts());
        });

        applicationsSnap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const roundId = normalizeRoundId(data.roundId);
            if (!roundId || !countsByRoundId.has(roundId)) return;

            const counts = countsByRoundId.get(roundId);
            counts.applicationCount += 1;
            applyStatusCount(counts, String(data.status || "").trim());
        });

        let batch = db.batch();
        let opCount = 0;
        let updatedRoundCount = 0;

        for (const [roundId, counts] of countsByRoundId.entries()) {
            const roundRef = db.doc(`classes/${classId}/jobRecruitmentRounds/${roundId}`);
            batch.set(roundRef, {
                ...counts,
                statsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            opCount += 1;
            updatedRoundCount += 1;

            if (opCount >= MAX_BATCH_OPERATIONS) {
                await batch.commit();
                batch = db.batch();
                opCount = 0;
            }
        }

        if (opCount > 0) {
            await batch.commit();
        }

        return {
            success: true,
            classId,
            roundCount: roundsSnap.size,
            applicationCount: applicationsSnap.size,
            updatedRoundCount,
        };
    },
);
