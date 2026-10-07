"use strict";
const { isDeepStrictEqual } = require("node:util");
const ROSTER_SCHEMA_VERSION = 1;
function buildStudentRoster(studentId, data) {
  if (!data) return null;
  const result = { uid: studentId, schemaVersion: ROSTER_SCHEMA_VERSION };
  for (const field of ["name", "displayName", "studentName", "nickname", "role"]) {
    if (typeof data[field] === "string") result[field] = data[field];
  }
  // Preserve missing-number query behavior of the existing ordered roster.
  if (typeof data.studentNumber === "string" || typeof data.studentNumber === "number")
    result.studentNumber = data.studentNumber;
  return result;
}
const sameRoster = (left, right) => isDeepStrictEqual(left, right);
async function reconcileStudentRoster(db, classId, studentId, { requireActive = false } = {}) {
  const studentRef = db.doc('classes/' + classId + '/students/' + studentId);
  const rosterRef = db.doc('classes/' + classId + '/studentRoster/' + studentId);
  return db.runTransaction(async (tx) => {
    // Only activated classes receive ongoing projection writes. Backfill opts in explicitly.
    if (requireActive) {
      const classroom = await tx.get(db.doc("classes/" + classId));
      if (!classroom.exists || classroom.data().studentRosterVersion !== ROSTER_SCHEMA_VERSION) return false;
    }
    const [student, roster] = await Promise.all([tx.get(studentRef), tx.get(rosterRef)]);
    // Read current state, never replay stale event data into the projection.
    const expected = buildStudentRoster(studentId, student.exists ? student.data() : null);
    const actual = roster.exists ? roster.data() : null;
    if (sameRoster(actual, expected)) return false;
    if (expected) tx.set(rosterRef, expected);
    else tx.delete(rosterRef);
    return true;
  });
}
async function handleStudentRosterWrite(db, event) {
  if (!event.data) return false;
  const { classId, studentId } = event.params;
  const before = buildStudentRoster(studentId, event.data.before.exists ? event.data.before.data() : null);
  const after = buildStudentRoster(studentId, event.data.after.exists ? event.data.after.data() : null);
  // Balance, permissions, tier and payroll changes do not read or write the roster.
  if (sameRoster(before, after)) return false;
  return reconcileStudentRoster(db, classId, studentId, { requireActive: true });
}
module.exports = { ROSTER_SCHEMA_VERSION, buildStudentRoster, sameRoster, reconcileStudentRoster, handleStudentRosterWrite };
