"use strict";

const admin = require("../firebaseAdminCompat");

// Run under the maintenance lease; rebuild from current documents rather than
// applying old trigger deltas to empty summaries.
const finalizeClass = async (classId) => {
    const db = admin.firestore();
    const students = await db.collection(`classes/${classId}/students`).get();
    const { __handleStudentMetricsWrite } = require("../src/studentSync");
    const { __handleStudentJobAssignmentMirror } = require("../src/jobPermissions");
    for (const after of students.docs) {
        const event = { params: { classId, studentId: after.id }, data: {
            before: { exists: false, data: () => undefined }, after,
        } };
        await __handleStudentMetricsWrite(event);
        await __handleStudentJobAssignmentMirror(event);
    }
    await require("./economyBaseline").rebuildEconomyBaselineCaches(classId, { source: "class_maintenance" });
    await require("./stockJobIndex").rebuildClassStockJobIndex(classId, { source: "class_maintenance" });
    await require("./bankPayrollOverviewSummary").rebuildOverviewSummaries(classId);
    await require("../src/NotificationSummary").__recomputeMissionNotificationSummary(classId);
    await require("../src/storeUsageSummary").__private.rebuildStoreCatalogSummaryDoc(classId);
    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const layout = await layoutRef.get();
    if (layout.exists && layout.data()?.storageSchemaVersion !== 3) {
        await db.doc(`classes/${classId}/real_estate/layoutView`).set(
            require("../src/realestateLayoutViewSummary").buildLayoutViewData(layout.data()),
        );
    }
    await require("./relativeEconomyProjection").markRelativeEconomyProjectionDirty({
        db, FieldValue: admin.firestore.FieldValue, classId, reason: "class_maintenance",
    });
};

module.exports = { finalizeClass };
