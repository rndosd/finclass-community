export function getCaseClassLabel(casePost) {
  return casePost?.classLabel || casePost?.roleLabel || "학급 정보 없음";
}

export function getCaseTeacherLabel(casePost) {
  if (casePost?.teacherNamePublic === false) {
    return null;
  }

  return casePost?.authorName || null;
}

export function getCaseAuthorSummary(casePost) {
  const classLabel = getCaseClassLabel(casePost);
  const teacherLabel = getCaseTeacherLabel(casePost);

  return teacherLabel ? `${classLabel} · ${teacherLabel}` : classLabel;
}
