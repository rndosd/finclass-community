"use strict";

function assertMissionApprovalVersions(data, missionSnap, classSnap, fail, resolvedMission = null, studentUids = []) {
    const version = (snap) => snap.exists ?
        `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
    if ((data.expectedMissionUpdateTime && data.expectedMissionUpdateTime !== version(missionSnap)) ||
        (data.expectedClassUpdateTime && data.expectedClassUpdateTime !== version(classSnap))) {
        throw fail("failed-precondition", "승인안 이후 정보가 변경되었습니다. 다시 확인해주세요.");
    }
    if (resolvedMission?.stateStorageVersion === 2) {
        const expected = data.expectedStudentStateRevisions;
        if (data.expectedMissionUpdateTime || expected) {
            if (!expected || studentUids.some((uid) => !Object.hasOwn(expected, uid) ||
                expected[uid] !== Number(resolvedMission._studentStateRevisions?.[uid] || 0))) {
                throw fail("failed-precondition", "승인안 이후 학생 상태가 변경되었습니다. 다시 확인해주세요.");
            }
        }
    }
}

module.exports = { assertMissionApprovalVersions };
