"use strict";
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("../firebaseAdminCompat");
const { handleStudentRosterWrite } = require("../utils/studentRosterProjection");
// Independent retry policy: do not replay the existing financial projection handlers.
exports.syncStudentRoster = onDocumentWritten({
  document: "classes/{classId}/students/{studentId}",
  region: "asia-northeast3", retry: true,
}, (event) => handleStudentRosterWrite(admin.firestore(), event));
