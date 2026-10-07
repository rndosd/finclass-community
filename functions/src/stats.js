"use strict";

const {
    onDocumentCreated,
    onDocumentDeleted,
    onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MANUAL_SYNC_DAYS = 7;
const ACTIVITY_INDEX_DOC_PATH = "system_stats/activityIndex";
const SCHOOL_DAY_ACTIVITY_WINDOW = 3;

const toSafeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getKSTTargetDate = (daysAgo = 0) => {
    const now = new Date();
    const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
    const targetDate = new Date(kstNow);

    targetDate.setUTCDate(kstNow.getUTCDate() - daysAgo);
    targetDate.setUTCHours(0, 0, 0, 0);
    return targetDate;
};

const getKSTBoundary = (daysAgo = 0) => {
    const targetDate = getKSTTargetDate(daysAgo);
    const start = admin.firestore.Timestamp.fromMillis(
        targetDate.getTime() - KST_OFFSET_MS,
    );
    const end = admin.firestore.Timestamp.fromMillis(
        targetDate.getTime() + (24 * 60 * 60 * 1000) - KST_OFFSET_MS,
    );
    const dateStr = targetDate.toISOString().split("T")[0];

    return { start, end, dateStr };
};

const getRecentSchoolDayDateStrings = (count = SCHOOL_DAY_ACTIVITY_WINDOW) => {
    const dates = [];
    let daysAgo = 0;

    while (dates.length < count) {
        const targetDate = getKSTTargetDate(daysAgo);
        const dayOfWeek = targetDate.getUTCDay();

        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            dates.push(targetDate.toISOString().split("T")[0]);
        }

        daysAgo += 1;
    }

    return dates;
};

const syncDailyStatsForBoundary = async (
    { start, end, dateStr },
    classDocs,
    type = "manual_synced",
    dbClient = db,
) => {
    const globalCountSnap = await dbClient
        .collectionGroup("activityLogs")
        .where("createdAt", ">=", start)
        .where("createdAt", "<", end)
        .count()
        .get();

    const classCountResults = await Promise.all(
        classDocs.map(async (classDoc) => {
            const classDailySnap = await dbClient
                .collectionGroup("activityLogs")
                .where("classId", "==", classDoc.id)
                .where("createdAt", ">=", start)
                .where("createdAt", "<", end)
                .count()
                .get();

            return {
                classId: classDoc.id,
                count: classDailySnap.data().count,
            };
        }),
    );

    const activeClassIds = classCountResults
        .filter(({ count }) => count > 0)
        .map(({ classId }) => classId);

    await dbClient.collection("daily_stats").doc(dateStr).set(
        {
            logCount: globalCountSnap.data().count,
            activeClassIds,
            activeClassCount: activeClassIds.length,
            date: dateStr,
            createdAt: start,
            type,
        },
        { merge: true },
    );

    return {
        dateStr,
        logCount: globalCountSnap.data().count,
        classCountResults,
    };
};

exports.countClassCreate = onDocumentCreated(
    "classes/{classId}",
    async () => db.doc("system_stats/summary").set(
        {
            totalClasses: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    ),
);

exports.countClassDelete = onDocumentDeleted(
    "classes/{classId}",
    async () => db.doc("system_stats/summary").set(
        {
            totalClasses: admin.firestore.FieldValue.increment(-1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    ),
);

exports.countStudentCreate = onDocumentCreated("users/{uid}", async (event) => {
    const userData = event.data.data();
    if (userData?.role !== "student") return null;

    return db.doc("system_stats/summary").set(
        {
            totalStudents: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
});

exports.countStudentDelete = onDocumentDeleted("users/{uid}", async (event) => {
    const userData = event.data?.data();
    if (userData?.role !== "student") return null;

    return db.doc("system_stats/summary").set(
        {
            totalStudents: admin.firestore.FieldValue.increment(-1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
});

exports.countStudentRoleChange = onDocumentUpdated(
    "users/{uid}",
    async (event) => {
        const beforeRole = event.data.before.data()?.role;
        const afterRole = event.data.after.data()?.role;

        if (beforeRole === afterRole) return null;

        let delta = 0;
        if (beforeRole === "student") delta -= 1;
        if (afterRole === "student") delta += 1;

        if (delta === 0) return null;

        return db.doc("system_stats/summary").set(
            {
                totalStudents: admin.firestore.FieldValue.increment(delta),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    },
);

const performStatsSync = async (days = MANUAL_SYNC_DAYS) => {
    const [classesSnap, studentsCountSnap] = await Promise.all([
        db.collection("classes").get(),
        db.collection("users").where("role", "==", "student").count().get(),
    ]);
    const classDocs = classesSnap.docs;
    const recentSchoolDayDateStrings = getRecentSchoolDayDateStrings();

    const recentActivityByClass = new Map(
        classDocs.map((classDoc) => [
            classDoc.id,
            {
                recent7dCount: 0,
                recent7dActiveDays: 0,
            },
        ]),
    );
    const recentSchoolDayActivityByClass = new Map(
        classDocs.map((classDoc) => [classDoc.id, 0]),
    );
    const lastActiveDateByClass = new Map();

    const summaryPromise = db.doc("system_stats/summary").set(
        {
            totalClasses: classesSnap.size,
            totalStudents: studentsCountSnap.data().count,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            lastStatsSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    );

    const dailyPromises = [];
    for (let i = 0; i < days; i += 1) {
        dailyPromises.push(
            syncDailyStatsForBoundary(getKSTBoundary(i), classDocs),
        );
    }

    const dailyResults = await Promise.all(dailyPromises);
    const recentSchoolDayDateSet = new Set(recentSchoolDayDateStrings);
    dailyResults.forEach((result) => {
        result.classCountResults.forEach(({ classId, count }) => {
            const current = recentActivityByClass.get(classId) || {
                recent7dCount: 0,
                recent7dActiveDays: 0,
            };

            current.recent7dCount += count;
            if (count > 0) {
                current.recent7dActiveDays += 1;
                if (!lastActiveDateByClass.has(classId)) {
                    lastActiveDateByClass.set(classId, result.dateStr);
                }
            }

            recentActivityByClass.set(classId, current);

            if (recentSchoolDayDateSet.has(result.dateStr)) {
                recentSchoolDayActivityByClass.set(
                    classId,
                    (recentSchoolDayActivityByClass.get(classId) || 0) + count,
                );
            }
        });
    });

    const classPromises = classDocs.map(async (classDoc) => {
        const totalSnap = await db
            .collectionGroup("activityLogs")
            .where("classId", "==", classDoc.id)
            .count()
            .get();

        const existingData = classDoc.data() || {};
        const actualCount = totalSnap.data().count;
        if (existingData.activityCount === actualCount) {
            return null;
        }

        return classDoc.ref.set(
            {
                activityCount: actualCount,
                lastStatsSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    });

    const rankedClasses = classDocs
        .map((classDoc) => {
            const classData = classDoc.data() || {};
            const recentActivity = recentActivityByClass.get(classDoc.id) || {
                recent7dCount: 0,
                recent7dActiveDays: 0,
            };
            const recent3SchoolDaysCount =
                recentSchoolDayActivityByClass.get(classDoc.id) || 0;

            return {
                classId: classDoc.id,
                className:
                    String(classData.className || "").trim() ||
                    String(classData.classDocId || "").trim() ||
                    "이름 없는 학급",
                classDocId: String(classData.classDocId || "").trim(),
                teacherName:
                    String(
                        classData.teacherName || classData.teacherDisplayName || "",
                    ).trim(),
                totalStudents: toSafeNumber(
                    classData.totalStudents ?? classData.studentCount,
                ),
                recent7dCount: recentActivity.recent7dCount,
                recent7dActiveDays: recentActivity.recent7dActiveDays,
                recent3SchoolDaysCount,
                skipActivityBasedDailyJobs: recent3SchoolDaysCount === 0,
                lastActiveDate: lastActiveDateByClass.get(classDoc.id) || null,
            };
        })
        .sort((left, right) => {
            if (right.recent7dCount !== left.recent7dCount) {
                return right.recent7dCount - left.recent7dCount;
            }
            if (right.recent7dActiveDays !== left.recent7dActiveDays) {
                return right.recent7dActiveDays - left.recent7dActiveDays;
            }
            return left.className.localeCompare(right.className, "ko-KR");
        });

    const totalLogCount7d = dailyResults.reduce(
        (sum, result) => sum + toSafeNumber(result.logCount),
        0,
    );
    const activeClassCount7d = rankedClasses.filter(
        (classItem) => classItem.recent7dCount > 0,
    ).length;
    const eligibleClassIds = rankedClasses
        .filter((classItem) => classItem.skipActivityBasedDailyJobs !== true)
        .map((classItem) => classItem.classId);
    const skippedClassIds = rankedClasses
        .filter((classItem) => classItem.skipActivityBasedDailyJobs === true)
        .map((classItem) => classItem.classId);

    const activityIndexPromise = db.doc(ACTIVITY_INDEX_DOC_PATH).set({
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        windowDays: days,
        schoolDayWindow: recentSchoolDayDateStrings.length,
        schoolDayDateStrings: recentSchoolDayDateStrings,
        totalLogCount7d,
        activeClassCount7d,
        eligibleClassIds,
        skippedClassIds,
        rankedClasses,
    });

    await Promise.all([...classPromises, summaryPromise, activityIndexPromise]);
};

exports.manualStatsSync = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 300,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Authentication is required.");
        }

        if (request.auth.token?.role !== "admin") {
            throw new HttpsError(
                "permission-denied",
                "Only admins can run stats sync.",
            );
        }

        try {
            await performStatsSync();
            return {
                success: true,
                message: "Stats sync completed successfully.",
            };
        } catch (error) {
            throw new HttpsError("internal", error.message);
        }
    },
);

exports.__private = {
    syncDailyStatsForBoundary: (boundary, classDocs, dbClient = db) =>
        syncDailyStatsForBoundary(
            boundary,
            classDocs,
            "manual_synced",
            dbClient,
        ),
};
