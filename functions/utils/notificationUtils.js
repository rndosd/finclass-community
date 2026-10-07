const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");

const db = admin.firestore();

/**
 * [트랜잭션/배치용] 알림 준비 (Stage) 함수
 * 트랜잭션 내부에서 호출되어 작업을 예약합니다.
 * @param {object} writer - Firestore transaction 또는 writeBatch 객체
 * @param {string} classId - 클래스 ID
 * @param {object} data - 알림 데이터 (uid, title, message, type, path 등)
 * @returns {string} 생성된 알림 문서 ID
 */
const stageNotification = (writer, classId, data) => {
    const {
        uid,
        title,
        message,
        type,
        path = "", // ✨ 클릭 시 이동할 경로 (예: '/tax')
        priority = "medium",
        metadata = {},
        ...extraFields
    } = data;

    if (!classId || !uid || !title || !message || !type) {
        console.error("❌ [stageNotification] 필수 정보 누락:", {
            classId,
            ...data,
        });
        throw new Error("알림 생성에 필요한 정보가 부족합니다.");
    }

    // 새 문서 참조 생성
    const notificationRef = db
        .collection(`classes/${classId}/students/${uid}/notifications`)
        .doc();

    const payload = {
        title,
        message,
        type,
        path,
        priority,
        metadata,
        ...extraFields,
        createdAt: FieldValue.serverTimestamp(),
        isRead: false,
        readAt: null,
    };

    // 전달받은 writer(transaction/batch)에 작업 추가
    writer.set(notificationRef, payload);

    return notificationRef.id;
};

/**
 * [단일 알림 직접 생성]
 * 트랜잭션 외부에서 즉시 알림을 생성할 때 사용합니다.
 */
const createNotification = async (classId, data) => {
    try {
        const {
            uid,
            title,
            message,
            type,
            path = "", // ✨ 경로 추가
            priority = "medium",
            metadata = {},
            ...extraFields
        } = data;

        if (!classId || !uid || !title || !message || !type) {
            console.error("❌ [createNotification] 필수 정보 누락:", {
                classId,
                ...data,
            });
            return null;
        }

        const payload = {
            title,
            message,
            type,
            path,
            priority,
            metadata,
            ...extraFields,
            createdAt: FieldValue.serverTimestamp(),
            isRead: false,
            readAt: null,
        };

        const docRef = await db
            .collection(`classes/${classId}/students/${uid}/notifications`)
            .add(payload);
        console.log(`[${classId}] 알림 생성 완료: ${title} (${uid})`);
        return docRef.id;
    } catch (error) {
        console.error("❌ [createNotification] 생성 실패:", error);
        throw error;
    }
};

/**
 * [다중 사용자 알림 직접 생성]
 * 여러 명의 학생에게 동일한 소식을 뿌릴 때 사용합니다.
 */
const createNotificationsForUsers = async (classId, uids, data) => {
    const uniqueUids = [...new Set(uids)];

    // 개별 프로미스 생성
    const promises = uniqueUids.map((uid) =>
        createNotification(classId, { ...data, uid }),
    );

    try {
        await Promise.all(promises);
        console.log(
            `[${classId}] 총 ${uniqueUids.length}명에게 알림 생성 완료: ${data.title}`,
        );
    } catch (error) {
        console.error("❌ [createNotificationsForUsers] 실패:", error);
        throw error;
    }
};

/**
 * [예약 알림 생성] Cloud Tasks 활용
 * 특정 시간(예: 만기일 하루 전)에 알림을 보내도록 예약합니다.
 */
const scheduleReminder = async (
    classId,
    studentUid,
    relatedId,
    scheduleDate,
    reminderType,
    functionName,
) => {
    try {
        const { CloudTasksClient } = require("@google-cloud/tasks");
        const tasksClient = new CloudTasksClient();

        const project = admin.app().options.projectId;
        const location = "asia-northeast3"; // 한국 리전
        const queue = reminderType.includes("deposit")
            ? "deposit-reminders-v1"
            : "loan-repayment-queue";
        const queuePath = tasksClient.queuePath(project, location, queue);
        const targetUri = `https://${location}-${project}.cloudfunctions.net/${functionName}`;

        const payload = {
            classId,
            studentUid,
            [reminderType.includes("deposit") ? "savingId" : "loanId"]: relatedId,
            type: reminderType,
        };

        const task = {
            httpRequest: {
                httpMethod: "POST",
                url: targetUri,
                body: Buffer.from(JSON.stringify(payload)).toString("base64"),
                headers: { "Content-Type": "application/json" },
            },
            scheduleTime: { seconds: Math.floor(scheduleDate.getTime() / 1000) },
        };

        await tasksClient.createTask({ parent: queuePath, task });
        console.log(
            `[${relatedId}] ${reminderType} 알림 예약 완료: ${scheduleDate.toISOString()}`,
        );

        return true;
    } catch (error) {
        console.error(`❌ [scheduleReminder] 예약 실패:`, error);
        return false;
    }
};

/**
 * [권한별 알림 준비] 트랜잭션용
 * 특정 역할을 가진 사람들(교사, 은행원 등)을 찾아 알림을 준비합니다.
 */
const stageNotificationByRoles = (
    writer,
    classId,
    targetRoles,
    data,
    preloadedData = {},
) => {
    const recipients = [];

    // 1. 교사 추가
    if (targetRoles.includes("teacher")) {
        const teacherUid = preloadedData.classData?.teacherUid;
        if (teacherUid) recipients.push(teacherUid);
    }

    // 2. 각 권한별 학생 매핑
    const rolePermissions = {
        bank_admin: "bank_admin",
        police_admin: "permission_group_police",
        tax_admin: "tax_admin",
        labor_admin: "labor_admin",
        store_admin: "store_admin",
        mission_admin: "mission_admin",
        news_admin: "news_admin",
        realestate_admin: "realestate_admin",
        marketplace_admin: "marketplace_admin",
        assembly_member: "assembly_member",
    };

    for (const role of targetRoles) {
        if (role === "teacher") continue;
        const permission = rolePermissions[role];
        if (!permission) continue;

        // 트랜잭션 내에서는 반드시 preloadedData를 통해 학생 목록을 받아와야 함
        if (preloadedData.students) {
            const roleStudents = preloadedData.students
                .filter((student) => student.data()?.permissions?.[permission] === true)
                .map((student) => student.id);
            recipients.push(...roleStudents);
        } else {
            console.warn(
                `⚠️ [stageNotificationByRoles] '${role}' 역할을 위한 학생 데이터가 없습니다.`,
            );
        }
    }

    // 중복 제거 및 알림 스테이징
    const uniqueRecipients = [...new Set(recipients)];
    const notificationIds = [];

    uniqueRecipients.forEach((uid) => {
        const notifId = stageNotification(writer, classId, {
            ...data,
            uid,
        });
        notificationIds.push(notifId);
    });

    console.log(
        `[${classId}] 권한별 알림(${targetRoles.join()}) ${uniqueRecipients.length}명 예약 완료`,
    );
    return notificationIds;
};

module.exports = {
    stageNotification,
    createNotification,
    createNotificationsForUsers,
    scheduleReminder,
    stageNotificationByRoles,
};
