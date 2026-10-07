function toTime(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function compareStudentIdentity(left, right) {
  return (
    String(left?.studentNumber || "").localeCompare(
      String(right?.studentNumber || ""),
      "ko",
      { numeric: true },
    ) ||
    String(left?.studentName || "").localeCompare(
      String(right?.studentName || ""),
      "ko",
    )
  );
}

export function buildStudentCertificateOverviewRows(
  roster = [],
  recordsByStudent = {},
  now = Date.now(),
) {
  return roster
    .filter((student) => student?.uid)
    .map((student) => {
      const records = Array.isArray(recordsByStudent?.[student.uid])
        ? recordsByStudent[student.uid]
        : [];
      const activeRecords = records.filter((item) => !item?.isRevoked);
      const expiredCount = activeRecords.filter((item) => {
        const expiresAt = toTime(item?.expiresAt);
        return expiresAt !== null && expiresAt < now;
      }).length;

      return {
        uid: student.uid,
        studentName:
          student.name || student.displayName || student.uid || "이름 없음",
        studentNumber: student.studentNumber || "",
        ownedCount: activeRecords.length,
        validCount: Math.max(0, activeRecords.length - expiredCount),
        expiredCount,
        revokedCount: records.length - activeRecords.length,
      };
    })
    .sort(compareStudentIdentity);
}

