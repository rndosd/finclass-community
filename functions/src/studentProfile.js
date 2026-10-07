"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall } = require("firebase-functions/v2/https");
const { createStudentNameUpdater } = require("../utils/studentName");
const { stageActivityLog } = require("../utils/logUtils");

exports.updateStudentName = onCall({ region: "asia-northeast3" }, createStudentNameUpdater({
    db: admin.firestore(), stageActivityLog,
}));
