"use strict";

// Include missing mission parents with surviving submission subcollections.
// Class-scoped collection queries need no collection-group index and never
// read another class's student records.
async function getStudentMissionSubmissions(missionsRef, studentUid) {
    const docs = [];
    const missions = await missionsRef.listDocuments();
    for (let offset = 0; offset < missions.length; offset += 8) {
        const snapshots = await Promise.all(missions.slice(offset, offset + 8).map((missionRef) =>
            missionRef.collection("submissions").where("studentUid", "==", studentUid).get()));
        snapshots.forEach((snapshot) => docs.push(...snapshot.docs));
    }
    return docs;
}

module.exports = { getStudentMissionSubmissions };
