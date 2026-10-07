"use strict";

const GOOGLE_TEACHER_REGISTRATION_ACTION = Object.freeze({
    CREATE: "create",
    COMPLETE: "complete",
    ALREADY_REGISTERED: "already_registered",
    REJECT_ROLE_CONFLICT: "reject_role_conflict",
});

const resolveExistingGoogleTeacherRegistration = (existingUser) => {
    if (!existingUser) {
        return GOOGLE_TEACHER_REGISTRATION_ACTION.CREATE;
    }

    const role = String(existingUser.role || "").trim().toLowerCase();
    if ((role && role !== "teacher") || (!role && existingUser.classId)) {
        return GOOGLE_TEACHER_REGISTRATION_ACTION.REJECT_ROLE_CONFLICT;
    }

    if (
        role === "teacher" &&
        existingUser.status === "approved" &&
        existingUser.classId
    ) {
        return GOOGLE_TEACHER_REGISTRATION_ACTION.ALREADY_REGISTERED;
    }

    return GOOGLE_TEACHER_REGISTRATION_ACTION.COMPLETE;
};

module.exports = {
    GOOGLE_TEACHER_REGISTRATION_ACTION,
    resolveExistingGoogleTeacherRegistration,
};
