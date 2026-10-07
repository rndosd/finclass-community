// Bounds document reads AND empty-query reads per user-requested page.
export const MULTI_STUDENT_MAX_READS = 240;
export const MULTI_STUDENT_MAX_QUERIES = 24;
const BATCH_SIZE = 10;
const time = (row) => {
  const value = row.createdAt ?? row.timestamp;
  const millis = typeof value?.toMillis === "function" ? value.toMillis() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

export async function loadMultiStudentActivityPage({
  studentUids, queryState = null, fetchBatch, pageSize = 30,
}) {
  const uids = [...new Set(studentUids.filter(Boolean))];
  const studentStates = Object.fromEntries(uids.map(uid => {
    const previous = queryState?.studentStates?.[uid];
    return [uid, {
      buffer: [...(previous?.buffer || [])],
      lastVisible: previous?.lastVisible || null,
      exhausted: previous?.exhausted === true,
    }];
  }));
  let readsReserved = 0;
  let queries = 0;
  const activities = [];
  while (activities.length < pageSize) {
    // Every non-exhausted stream needs a head before merging. Otherwise a
    // filtered-out batch can hide a newer match behind another student's row.
    const missing = uids.filter(uid => !studentStates[uid].exhausted && !studentStates[uid].buffer.length);
    if (missing.length) {
      if (queries >= MULTI_STUDENT_MAX_QUERIES || readsReserved >= MULTI_STUDENT_MAX_READS) break;
      for (const studentUid of missing) {
        if (queries >= MULTI_STUDENT_MAX_QUERIES || readsReserved >= MULTI_STUDENT_MAX_READS) break;
        const state = studentStates[studentUid];
        const batchSize = Math.min(BATCH_SIZE, MULTI_STUDENT_MAX_READS - readsReserved);
        queries += 1;
        readsReserved += batchSize;
        const batch = await fetchBatch({ studentUid, batchSize, cursor: state.lastVisible });
        state.buffer.push(...batch.activities);
        state.lastVisible = batch.lastVisible;
        state.exhausted = batch.exhausted;
      }
      continue;
    }
    let winner = null;
    for (const uid of uids) {
      const candidate = studentStates[uid].buffer[0];
      if (candidate && (winner === null || time(candidate) > time(studentStates[winner].buffer[0]))) winner = uid;
    }
    if (winner === null) break;
    activities.push(studentStates[winner].buffer.shift());
  }
  return {
    activities,
    queryState: { studentStates },
    hasMore: Object.values(studentStates).some(state => state.buffer.length > 0 || !state.exhausted),
  };
}
