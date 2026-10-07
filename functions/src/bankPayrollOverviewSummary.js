"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
    rebuildBankOverviewSummaries,
    rebuildPayrollOverviewSummary,
    rebuildOverviewSummaries,
    updateBankOverviewSummariesForWrite,
    updatePayrollOverviewSummaryForWrite,
    updateStudentPayrollSummaryForWrite,
} = require("../utils/bankPayrollOverviewSummary");

const REGION = "asia-northeast3";
const SAVING_DOCUMENT_PATH =
    "classes/{classId}/students/{studentUid}/savings/{docId}";
const LOAN_DOCUMENT_PATH =
    "classes/{classId}/students/{studentUid}/loans/{docId}";
const PAYSLIP_DOCUMENT_PATH =
    "classes/{classId}/students/{studentUid}/paySlips/{docId}";

function getEventData(docSnapshot) {
    return docSnapshot?.exists ? docSnapshot.data() || {} : null;
}

exports.syncBankSavingsOverviewSummary = onDocumentWritten(
    {
        document: SAVING_DOCUMENT_PATH,
        region: REGION,
    },
    async (event) => {
        const { classId, studentUid, docId } = event.params;
        if (!classId || !studentUid || !docId) return;

        await updateBankOverviewSummariesForWrite({
            classId,
            kind: "savings",
            docId,
            studentUid,
            beforeData: getEventData(event.data?.before),
            afterData: getEventData(event.data?.after),
        });
    },
);

exports.syncBankLoansOverviewSummary = onDocumentWritten(
    {
        document: LOAN_DOCUMENT_PATH,
        region: REGION,
    },
    async (event) => {
        const { classId, studentUid, docId } = event.params;
        if (!classId || !studentUid || !docId) return;

        await updateBankOverviewSummariesForWrite({
            classId,
            kind: "loans",
            docId,
            studentUid,
            beforeData: getEventData(event.data?.before),
            afterData: getEventData(event.data?.after),
        });
    },
);

exports.syncPayrollOverviewSummary = onDocumentWritten(
    {
        document: PAYSLIP_DOCUMENT_PATH,
        region: REGION,
    },
    async (event) => {
        const { classId, studentUid, docId } = event.params;
        if (!classId || !studentUid || !docId) return;

        const beforeData = getEventData(event.data?.before);
        const afterData = getEventData(event.data?.after);

        // Keep the existing class-level payroll summary as the primary path.
        // Student-level summary is an optimization for bonus flows and must not
        // block the main payroll screen if it fails.
        await updatePayrollOverviewSummaryForWrite({
            classId,
            docId,
            studentUid,
            beforeData,
            afterData,
        });

        try {
            await updateStudentPayrollSummaryForWrite({
                classId,
                studentUid,
                docId,
                beforeData,
                afterData,
            });
        } catch (error) {
            console.error("[syncPayrollOverviewSummary] student payroll summary update failed:", {
                classId,
                studentUid,
                docId,
                message: error?.message || String(error),
                stack: error?.stack || null,
            });
        }
    },
);

exports.rebuildBankOverviewSummariesForClass = onCall(
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

        const result = await rebuildBankOverviewSummaries(classId);
        return {
            success: true,
            classId,
            ...result,
        };
    },
);

exports.rebuildPayrollOverviewSummaryForClass = onCall(
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

        const result = await rebuildPayrollOverviewSummary(classId);
        return {
            success: true,
            classId,
            ...result,
        };
    },
);

exports.rebuildOverviewSummariesForClass = onCall(
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

        const result = await rebuildOverviewSummaries(classId);
        return {
            success: true,
            classId,
            ...result,
        };
    },
);
