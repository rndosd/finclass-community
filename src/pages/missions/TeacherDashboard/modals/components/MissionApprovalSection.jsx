import React, { useMemo } from "react";
import ApprovalInbox from "../../ApprovalInbox/ApprovalInbox";

// Reuse the exact inbox mutations and interaction flow, restricted to this task.
export default function MissionApprovalSection({ mission, classId, students, approveMany, rejectMany }) {
  const missions = useMemo(() => [mission], [mission]);
  return <ApprovalInbox key={mission.id} classId={classId} students={students} missions={missions}
    scopedMissionId={mission.id} embedded approveMany={approveMany} rejectMany={rejectMany} />;
}
