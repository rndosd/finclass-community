"use strict";

const { onDocumentWritten } = require("firebase-functions/v2/firestore");

const {
    __handleStudentMetricsWrite: handleStudentMetricsWrite,
} = require("./studentSync");
const {
    __handleMissionSummaryOnStudentWrite: handleMissionSummaryOnStudentWrite,
} = require("./NotificationSummary");
const {
    __handleRelativeEconomyDirtyFromStudent: handleRelativeEconomyDirtyFromStudent,
} = require("./adminFinanceAnalytics");
const {
    __handleStudentJobAssignmentMirror: handleStudentJobAssignmentMirror,
} = require("./jobPermissions");
const {
    __handleStudentPayrollCacheFromStudentWrite:
        handleStudentPayrollCacheFromStudentWrite,
} = require("./economyBaseline");

const studentProjectionHandlers = [
    handleStudentMetricsWrite,
    handleMissionSummaryOnStudentWrite,
    handleRelativeEconomyDirtyFromStudent,
    handleStudentJobAssignmentMirror,
    handleStudentPayrollCacheFromStudentWrite,
];

exports.syncStudentProjections = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentId}",
        region: "asia-northeast3",
        memory: "1GiB",
        cpu: 1,
        timeoutSeconds: 120,
    },
    async (event) => {
        await Promise.all(
            studentProjectionHandlers.map((handler) => handler(event)),
        );
    },
);
