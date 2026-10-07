export function resolveCredentialPermissions({
  isAdmin = false,
  isTeacher = false,
  isOperator = false,
  isDesigner = false,
} = {}) {
  const hasTeacherAuthority = Boolean(isAdmin || isTeacher);
  const canOperateCredentials = hasTeacherAuthority || Boolean(isOperator);
  const canEditCredentialDefinitions = hasTeacherAuthority || Boolean(isDesigner);

  return {
    canManageCredentials: canOperateCredentials || canEditCredentialDefinitions,
    canOperateCredentials,
    canEditCredentialDefinitions,
    canDeleteCredentialDefinitions: hasTeacherAuthority,
    canManageCredentialSettings: hasTeacherAuthority,
    canIssueCredentials: canOperateCredentials,
    canReviewTitleRequests: canOperateCredentials,
  };
}

export function canOperateOnCredentialStudent({
  isAdmin = false,
  isTeacher = false,
  canOperateCredentials = false,
  actorUid = "",
  studentUid = "",
} = {}) {
  if (!canOperateCredentials || !studentUid) return false;
  return Boolean(isAdmin || isTeacher || studentUid !== actorUid);
}
