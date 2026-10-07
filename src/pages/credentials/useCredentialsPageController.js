import { useClassStudents } from "../../hooks/user/useClassStudents";
import { appConfirm } from "../../utils/appDialogs";
import { buildResolvedTitleReveal, getCertificateStageMeta, normalizeCertificateStageList } from "./credentialPresentation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CREDENTIALS_PREVIEW_MODE_IDS,
  getCredentialsPreviewModeStorageKey,
  readStoredCredentialsPreviewMode,
} from "./credentialPreviewMode";
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";
import useDragSelection from "../../hooks/useDragSelection";
import { MAX_REPRESENTATIVE_TITLES, DEFAULT_TITLE_GRADES, DEFAULT_CERTIFICATE_GRADES, CERTIFICATE_NO_STAGE_ID, CERTIFICATE_NO_STAGE_OPTION, DEFAULT_TITLE_COLLECTION_STAGES, toMillis, toDateValue, parsePositiveInteger, formatDexNumber, normalizeTitleCategoryList, getTitleCategoryMeta, getTitleCategoryLabel, getTitleDefinitionSortOrder, compareTitleDefinitions, getTitleEquippedOrder, compareOwnedTitlePriority, sortEquippedTitleRecords, buildTitleCategoryChipItems, normalizeSnapshot, normalizeGradeList, getGradeMeta, buildGradeOptions, commitWriteOperations, getTitleRevealMeta, buildStudentLabel, getTitleSurfaceTheme, normalizeTitleRevealConfig, deriveLegacyTitleRevealMode } from "./CredentialsPage.parts";
import { normalizeTitleCollectionStageAccentColor } from "./titleCollectionStageTones";
import {
  getTitleCollectionSelectedVisualStage,
  getTitleCollectionVisualStage,
} from "./titleCollectionStageVisuals";
import {
  CREDENTIAL_TEACHER_RECENT_REVIEW_LIMIT,
  cloneCredentialTeacherSummary,
  getCredentialTeacherSummaryRef,
  normalizeCredentialTeacherSummary,
  requestCredentialTeacherSummaryRebuild,
} from "./credentialTeacherSummary";
import {
  buildCredentialTitleRequestId,
  buildStudentOwnedTitlePreferencePatch,
  buildStudentTitlePreferencePayload,
  buildStudentTitleRequestPayload,
  resolveCredentialTitleRequestForReview,
} from "./credentialStudentWriteContract";
import { buildStudentCertificateOverviewRows } from "./credentialCertificateOverview";
import {
  canOperateOnCredentialStudent,
  resolveCredentialPermissions,
} from "./credentialPermissionPolicy";

const CREDENTIALS_TAB_IDS = new Set(["titles", "certificates"]);

function getCredentialsTabStorageKey(classId, uid) {
  return `finclass:credentials:active-tab:${classId || "default"}:${uid || "default"}`;
}

function readStoredCredentialsTab(classId, uid) {
  if (typeof window === "undefined") return "titles";

  try {
    const storedTab = window.localStorage.getItem(
      getCredentialsTabStorageKey(classId, uid),
    );
    return CREDENTIALS_TAB_IDS.has(storedTab) ? storedTab : "titles";
  } catch {
    return "titles";
  }
}

export function useCredentialsPageController() {
  const {
    userData,
    classId,
    isAdmin,
    isTeacher,
    hasPermission,
    studentList: identityRoster = []
  } = useUser();
  const {
    showFeedback
  } = useFeedback();
  const isCredentialsOperator = hasPermission("credentials_admin");
  const isCredentialsDesigner = hasPermission("credentials_designer");
  const {
    canManageCredentials,
    canOperateCredentials,
    canEditCredentialDefinitions,
    canDeleteCredentialDefinitions,
    canManageCredentialSettings,
    canIssueCredentials,
    canReviewTitleRequests,
  } = resolveCredentialPermissions({
    isAdmin,
    isTeacher,
    isOperator: isCredentialsOperator,
    isDesigner: isCredentialsDesigner,
  });
  const { data: detailedRoster = [] } = useClassStudents(classId, {
    enabled: !!classId && canOperateCredentials,
  });
  const studentList = canOperateCredentials ? detailedRoster : identityRoster;
  const roster = useMemo(() => {
    if (!Array.isArray(studentList)) return [];
    return [...studentList].sort((a, b) => {
      const aNumber = Number(a?.studentNumber ?? Number.MAX_SAFE_INTEGER);
      const bNumber = Number(b?.studentNumber ?? Number.MAX_SAFE_INTEGER);
      return aNumber - bNumber;
    });
  }, [studentList]);
  // Student metadata stays live; listener targets depend only on membership.
  const rosterUidKey = JSON.stringify([...new Set(roster.map(student => student?.uid).filter(Boolean))].sort());
  const rosterUids = useMemo(() => JSON.parse(rosterUidKey), [rosterUidKey]);
  const hasRoster = rosterUids.length > 0;
  const credentialAccessKey = JSON.stringify([
    classId || "", userData?.uid || "", Boolean(isAdmin), Boolean(isTeacher), canOperateCredentials,
  ]);
  const credentialAccessRef = useRef({ key: credentialAccessKey });
  const credentialsTabStorageKey = getCredentialsTabStorageKey(classId, userData?.uid);
  const [activeTab, setActiveTabState] = useState(() =>
    readStoredCredentialsTab(classId, userData?.uid),
  );
  const setActiveTab = useCallback(
    (nextTab) => {
      const resolvedTab = CREDENTIALS_TAB_IDS.has(nextTab) ? nextTab : "titles";
      setActiveTabState(resolvedTab);

      try {
        window.localStorage.setItem(credentialsTabStorageKey, resolvedTab);
      } catch {
        // Keeping the in-page selection is sufficient when storage is unavailable.
      }
    },
    [credentialsTabStorageKey],
  );
  const credentialsPreviewModeStorageKey = getCredentialsPreviewModeStorageKey(
    classId,
    userData?.uid,
    canManageCredentials ? "teacher" : "student",
  );
  const [previewMode, setPreviewModeState] = useState(() =>
    readStoredCredentialsPreviewMode(
      classId,
      userData?.uid,
      canManageCredentials ? "teacher" : "student",
    ),
  );
  const setPreviewMode = useCallback(
    (nextMode) => {
      const resolvedMode = CREDENTIALS_PREVIEW_MODE_IDS.has(nextMode)
        ? nextMode
        : "student";
      setPreviewModeState(resolvedMode);

      try {
        window.localStorage.setItem(credentialsPreviewModeStorageKey, resolvedMode);
      } catch {
        // Keeping the in-page selection is sufficient when storage is unavailable.
      }
    },
    [credentialsPreviewModeStorageKey],
  );
  const [selectedStudentUid, setSelectedStudentUid] = useState("");
  const [titleDefinitions, setTitleDefinitions] = useState([]);
  const [certificateDefinitions, setCertificateDefinitions] = useState([]);
  const [ownedTitles, setOwnedTitles] = useState([]);
  const [ownedCertificates, setOwnedCertificates] = useState([]);
  const [titleRequests, setTitleRequests] = useState([]);
  const [studentTitleRequests, setStudentTitleRequests] = useState([]);
  const [credentialSettings, setCredentialSettings] = useState(null);
  const [titleLoading, setTitleLoading] = useState(true);
  const [certificateLoading, setCertificateLoading] = useState(true);
  const [ownedTitlesLoading, setOwnedTitlesLoading] = useState(true);
  const [teacherTitleSummaryLoading, setTeacherTitleSummaryLoading] = useState(true);
  const [ownedCertificatesLoading, setOwnedCertificatesLoading] = useState(true);
  const [titleRequestsLoading, setTitleRequestsLoading] = useState(true);
  const [credentialSettingsLoading, setCredentialSettingsLoading] = useState(true);
  const [, setStudentTitleRequestsLoading] = useState(true);
  const [selectedPendingRequestIds, setSelectedPendingRequestIds] = useState([]);
  const [selectedStudentIssueUids, setSelectedStudentIssueUids] = useState([]);
  const [teacherTitleDetailModalOpen, setTeacherTitleDetailModalOpen] = useState(false);
  const [teacherCertificateDetailModalOpen, setTeacherCertificateDetailModalOpen] = useState(false);
  const [teacherTitleIssuePickerModalOpen, setTeacherTitleIssuePickerModalOpen] = useState(false);
  const [titleCatalogModalOpen, setTitleCatalogModalOpen] = useState(false);
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [certificateModalOpen, setCertificateModalOpen] = useState(false);
  const [gradeSettingsModalOpen, setGradeSettingsModalOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);
  const [editingCertificate, setEditingCertificate] = useState(null);
  const [requestingTitleEntry, setRequestingTitleEntry] = useState(null);
  const [titleReviewModalState, setTitleReviewModalState] = useState({
    open: false,
    mode: "approve",
    items: []
  });
  const [titleRevocationModalItem, setTitleRevocationModalItem] = useState(null);
  const [issuingTitle, setIssuingTitle] = useState(null);
  const [issuingCertificate, setIssuingCertificate] = useState(null);
  const [issueSelectedUids, setIssueSelectedUids] = useState([]);
  const [issueSourceType, setIssueSourceType] = useState("manual");
  const [issueSourceRefId, setIssueSourceRefId] = useState("");
  const [issueExpiresAt, setIssueExpiresAt] = useState("");
  const [submissionKey, setSubmissionKey] = useState("");
  const [studentDexSearch, setStudentDexSearch] = useState("");
  const [studentDexFilter, setStudentDexFilter] = useState("all");
  const [studentDexCategoryFilter, setStudentDexCategoryFilter] = useState("all");
  const [studentCertificateCategoryFilter, setStudentCertificateCategoryFilter] = useState("all");
  const [teacherIssueCategoryFilter, setTeacherIssueCategoryFilter] = useState("all");
  const [titlePreference, setTitlePreference] = useState(null);
  const [teacherTitleSummary, setTeacherTitleSummary] = useState(null);
  const [teacherCertificateRecordsByStudent, setTeacherCertificateRecordsByStudent] = useState({});
  const [teacherCertificateOverviewLoading, setTeacherCertificateOverviewLoading] = useState(true);
  const teacherTitleSummaryRebuildPromiseRef = useRef(null);
  const ownedTitlesCacheRef = useRef(new Map());
  const studentTitleRequestsCacheRef = useRef(new Map());
  const titlePreferenceCacheRef = useRef(new Map());
  useEffect(() => {
    setActiveTabState(readStoredCredentialsTab(classId, userData?.uid));
  }, [classId, userData?.uid]);
  useEffect(() => {
    setPreviewModeState(
      readStoredCredentialsPreviewMode(
        classId,
        userData?.uid,
        canManageCredentials ? "teacher" : "student",
      ),
    );
  }, [canManageCredentials, classId, userData?.uid]);
  useEffect(() => {
    const scope = { key: credentialAccessKey };
    credentialAccessRef.current = scope;
    teacherTitleSummaryRebuildPromiseRef.current = null;
    return () => {
      if (credentialAccessRef.current === scope) {
        credentialAccessRef.current = null;
        teacherTitleSummaryRebuildPromiseRef.current = null;
      }
    };
  }, [credentialAccessKey]);
  useEffect(() => {
    if (!canManageCredentials) setPreviewModeState("student");
  }, [canManageCredentials]);
  useEffect(() => {
    if (!canManageCredentials) {
      setSelectedStudentUid("");
      return;
    }
    if (!roster.length) {
      setSelectedStudentUid("");
      return;
    }
    if (!selectedStudentUid || !roster.some((student) => student.uid === selectedStudentUid)) {
      setSelectedStudentUid(roster[0].uid);
    }
  }, [canManageCredentials, roster, selectedStudentUid]);
  useEffect(() => {
    if (!canManageCredentials || activeTab !== "titles" || previewMode !== "teacher") {
      setTeacherTitleDetailModalOpen(false);
      setTeacherTitleIssuePickerModalOpen(false);
    }
  }, [activeTab, canManageCredentials, previewMode]);
  useEffect(() => {
    if (!canManageCredentials || activeTab !== "certificates" || previewMode !== "teacher") {
      setTeacherCertificateDetailModalOpen(false);
    }
  }, [activeTab, canManageCredentials, previewMode]);
  useEffect(() => {
    const rosterUidSet = new Set(roster.map((student) => student.uid));
    setSelectedStudentIssueUids((prev) => prev.filter((uid) => rosterUidSet.has(uid)));
  }, [roster]);
  const isOwnStudentPreview =
    canManageCredentials &&
    previewMode === "student" &&
    !isAdmin &&
    !isTeacher &&
    Boolean(userData?.uid);
  const activeStudentUid = canManageCredentials
    ? isOwnStudentPreview
      ? userData?.uid || ""
      : canOperateCredentials ? selectedStudentUid : ""
    : userData?.uid || "";
  const activeStudent = useMemo(() => {
    if (!canManageCredentials) {
      return userData || null;
    }
    if (isOwnStudentPreview) {
      return (
        roster.find((student) => student.uid === userData?.uid) ||
        userData ||
        null
      );
    }
    return roster.find((student) => student.uid === selectedStudentUid) || null;
  }, [
    canManageCredentials,
    isOwnStudentPreview,
    roster,
    selectedStudentUid,
    userData,
  ]);
  const titleTabActive = activeTab === "titles";
  const certificateTabActive = activeTab === "certificates";
  const teacherTitleViewActive = canManageCredentials && titleTabActive && previewMode === "teacher";
  const teacherCertificateViewActive = canManageCredentials && certificateTabActive && previewMode === "teacher";
  const teacherTitleDetailActive =
    canOperateCredentials && teacherTitleViewActive && teacherTitleDetailModalOpen;
  const teacherTitleSummaryActive =
    canOperateCredentials && (teacherTitleViewActive || titleCatalogModalOpen);
  const certificateDefinitionsActive =
    certificateTabActive ||
    certificateModalOpen ||
    gradeSettingsModalOpen ||
    Boolean(editingCertificate) ||
    Boolean(issuingCertificate);
  const titleStudentDataActive =
    titleTabActive && (!teacherTitleViewActive || teacherTitleDetailActive);
  const titleStudentDataTargetKey =
    classId && activeStudentUid ? `${classId}:${activeStudentUid}` : "";
  const clearTeacherTitleSummaryState = useCallback(() => {
    setTeacherTitleSummary(null);
    setTitleRequests([]);
    setTeacherTitleSummaryLoading(false);
    setTitleRequestsLoading(false);
  }, []);
  const applyTeacherTitleSummaryState = useCallback((nextSummary) => {
    const normalizedSummary = nextSummary
      ? normalizeCredentialTeacherSummary(nextSummary)
      : null;
    if (!normalizedSummary) {
      clearTeacherTitleSummaryState();
      return;
    }
    setTeacherTitleSummary(normalizedSummary);
    setTitleRequests([
      ...(normalizedSummary.pendingRequests || []),
      ...(normalizedSummary.recentReviewedRequests || []),
    ]);
    setTeacherTitleSummaryLoading(false);
    setTitleRequestsLoading(false);
  }, [clearTeacherTitleSummaryState]);
  const ensureTeacherTitleSummaryStat = (summary, studentUid) => {
    if (!studentUid) {
      return {
        ownedTitleIds: [],
        ownedCount: 0,
        equippedTitleNames: [],
        pendingRequestCount: 0,
        pendingRequestPreview: [],
        extraPendingRequestCount: 0,
      };
    }
    if (!summary.studentTitleStats?.[studentUid]) {
      summary.studentTitleStats = {
        ...(summary.studentTitleStats || {}),
        [studentUid]: {
          ownedTitleIds: [],
          ownedCount: 0,
          equippedTitleNames: [],
          pendingRequestCount: 0,
          pendingRequestPreview: [],
          extraPendingRequestCount: 0,
        },
      };
    }
    return summary.studentTitleStats[studentUid];
  };
  const sortTeacherSummaryPendingRequests = (left, right) =>
    toMillis(right?.requestedAt || right?.updatedAt) -
      toMillis(left?.requestedAt || left?.updatedAt) ||
    String(left?.studentName || "").localeCompare(String(right?.studentName || ""), "ko");
  const sortTeacherSummaryReviewedRequests = (left, right) =>
    toMillis(right?.reviewedAt || right?.updatedAt || right?.requestedAt) -
      toMillis(left?.reviewedAt || left?.updatedAt || left?.requestedAt) ||
    String(left?.studentName || "").localeCompare(String(right?.studentName || ""), "ko");
  const setTeacherSummaryCountValue = (map, key, nextValue) => {
    if (!key) return;
    const resolvedValue = Math.max(0, Number(nextValue || 0));
    if (resolvedValue > 0) {
      map[key] = resolvedValue;
      return;
    }
    delete map[key];
  };
  const rebuildTeacherSummaryPendingPreview = (summary, studentUid) => {
    const studentStat = ensureTeacherTitleSummaryStat(summary, studentUid);
    const pendingTitles = (summary.pendingRequests || [])
      .filter((item) => item?.studentUid === studentUid && item?.status === "pending")
      .map((item) => String(item?.titleName || "").trim())
      .filter(Boolean);
    studentStat.pendingRequestCount = pendingTitles.length;
    studentStat.pendingRequestPreview = pendingTitles.slice(0, 2);
    studentStat.extraPendingRequestCount = Math.max(0, pendingTitles.length - 2);
  };
  const upsertTeacherSummaryPendingRequest = (summary, requestRecord) => {
    if (!requestRecord?.requestId) return;
    const nextPendingRequests = [
      ...(summary.pendingRequests || []).filter(
        (item) => item?.requestId !== requestRecord.requestId,
      ),
      {
        ...requestRecord,
        id: requestRecord.requestId,
        status: "pending",
      },
    ].sort(sortTeacherSummaryPendingRequests);
    const requestCountByDefinition = {
      ...(summary.requestCountByDefinition || {}),
    };
    const alreadyKnown = [...(summary.pendingRequests || []), ...(summary.recentReviewedRequests || [])]
      .some((item) => item?.requestId === requestRecord.requestId);
    if (!alreadyKnown && requestRecord?.titleId) {
      requestCountByDefinition[requestRecord.titleId] =
        Number(requestCountByDefinition[requestRecord.titleId] || 0) + 1;
    }
    summary.pendingRequests = nextPendingRequests;
    summary.recentReviewedRequests = (summary.recentReviewedRequests || []).filter(
      (item) => item?.requestId !== requestRecord.requestId,
    );
    summary.requestCountByDefinition = requestCountByDefinition;
    rebuildTeacherSummaryPendingPreview(summary, requestRecord.studentUid);
  };
  const markTeacherSummaryRequestReviewed = (summary, requestRecord) => {
    if (!requestRecord?.requestId) return;
    summary.pendingRequests = (summary.pendingRequests || []).filter(
      (item) => item?.requestId !== requestRecord.requestId,
    );
    summary.recentReviewedRequests = [
      {
        ...requestRecord,
        id: requestRecord.requestId,
      },
      ...(summary.recentReviewedRequests || []).filter(
        (item) => item?.requestId !== requestRecord.requestId,
      ),
    ]
      .sort(sortTeacherSummaryReviewedRequests)
      .slice(0, CREDENTIAL_TEACHER_RECENT_REVIEW_LIMIT);
    rebuildTeacherSummaryPendingPreview(summary, requestRecord.studentUid);
  };
  const applyTeacherSummaryOwnedTitleChange = (
    summary,
    {
      studentUid,
      titleId,
      titleName = "",
      ownedCountDelta = 0,
      nextEquippedTitleNames = null,
    },
  ) => {
    const studentStat = ensureTeacherTitleSummaryStat(summary, studentUid);
    if (!studentUid) return;
    if (!titleId) {
      if (Array.isArray(nextEquippedTitleNames)) {
        studentStat.equippedTitleNames = nextEquippedTitleNames
          .map((item) => String(item || "").trim())
          .filter(Boolean);
      }
      return;
    }
    summary.ownedTitleCountByDefinition = {
      ...(summary.ownedTitleCountByDefinition || {}),
    };
    const ownedTitleIds = new Set(studentStat.ownedTitleIds || []);
    const nextOwnedCount = Math.max(
      0,
      Number(studentStat.ownedCount || 0) + Number(ownedCountDelta || 0),
    );

    if (ownedCountDelta > 0) {
      ownedTitleIds.add(titleId);
      setTeacherSummaryCountValue(
        summary.ownedTitleCountByDefinition,
        titleId,
        Number(summary.ownedTitleCountByDefinition?.[titleId] || 0) + 1,
      );
    } else if (ownedCountDelta < 0) {
      ownedTitleIds.delete(titleId);
      setTeacherSummaryCountValue(
        summary.ownedTitleCountByDefinition,
        titleId,
        Number(summary.ownedTitleCountByDefinition?.[titleId] || 0) - 1,
      );
    }

    studentStat.ownedTitleIds = [...ownedTitleIds].sort((left, right) =>
      String(left).localeCompare(String(right), "ko"),
    );
    studentStat.ownedCount = nextOwnedCount;

    if (Array.isArray(nextEquippedTitleNames)) {
      studentStat.equippedTitleNames = nextEquippedTitleNames
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      return;
    }

    if (ownedCountDelta < 0 && titleName) {
      studentStat.equippedTitleNames = (studentStat.equippedTitleNames || []).filter(
        (item) => String(item || "").trim() !== String(titleName || "").trim(),
      );
    }
  };
  const rebuildTeacherTitleSummaryFromServer = useCallback(async (shouldApply = () => true) => {
    if (!classId || !canOperateCredentials) return null;
    const requestAccessScope = credentialAccessRef.current;
    if (requestAccessScope?.key !== credentialAccessKey) return null;
    if (!teacherTitleSummaryRebuildPromiseRef.current) {
      const pending = requestCredentialTeacherSummaryRebuild(classId).finally(() => {
        if (teacherTitleSummaryRebuildPromiseRef.current === pending) {
          teacherTitleSummaryRebuildPromiseRef.current = null;
        }
      });
      teacherTitleSummaryRebuildPromiseRef.current = pending;
    }
    const nextSummary = await teacherTitleSummaryRebuildPromiseRef.current;
    if (credentialAccessRef.current !== requestAccessScope || !shouldApply()) return null;
    if (!nextSummary) {
      clearTeacherTitleSummaryState();
      return null;
    }
    applyTeacherTitleSummaryState(nextSummary);
    return nextSummary;
  }, [applyTeacherTitleSummaryState, canOperateCredentials, classId, credentialAccessKey, clearTeacherTitleSummaryState]);
  const refreshTeacherTitleOverview = async (mutator = null) => {
    if (!classId) return;
    try {
      if (typeof mutator === "function" && teacherTitleSummary) {
        const optimisticSummary = cloneCredentialTeacherSummary(
          teacherTitleSummary,
          roster,
        );
        applyTeacherTitleSummaryState(
          mutator(optimisticSummary) || optimisticSummary,
        );
      }

      // The teacher summary is a server-owned projection. Credential operators
      // may request an authoritative rebuild; ordinary students rely on the
      // owned-title/title-request triggers instead of attempting a forbidden
      // client write to credentialSummary/teacherTitles.
      if (!canOperateCredentials || !roster.length) return;
      await rebuildTeacherTitleSummaryFromServer();
    } catch (error) {
      console.error("[CredentialsPage] teacher title summary rebuild error:", error);
      showFeedback(
        "칭호 전체 현황 집계를 다시 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "warning",
      );
    }
  };
  const applyGrantResultsToTeacherSummary = (summary, grantResults = []) => {
    summary.ownedTitleCountByDefinition = {
      ...(summary.ownedTitleCountByDefinition || {}),
    };
    summary.requestCountByDefinition = {
      ...(summary.requestCountByDefinition || {}),
    };
    grantResults
      .filter(Boolean)
      .forEach((result) => {
        if (Number(result?.grantedOwnedCountDelta || 0) > 0) {
          applyTeacherSummaryOwnedTitleChange(summary, {
            studentUid: result.studentUid,
            titleId: result.titleId,
            titleName: result.titleName,
            ownedCountDelta: result.grantedOwnedCountDelta,
          });
        }
        if (result?.requestReviewRecord) {
          markTeacherSummaryRequestReviewed(summary, result.requestReviewRecord);
        }
      });
    return summary;
  };
  useEffect(() => {
    if (!classId) {
      setTitleDefinitions([]);
      setTitleLoading(false);
      return undefined;
    }
    setTitleLoading(true);
    return onSnapshot(collection(db, "classes", classId, "titles"), (snapshot) => {
      const nextItems = normalizeSnapshot(snapshot).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
      setTitleDefinitions(nextItems);
      setTitleLoading(false);
    }, (error) => {
      console.error("[CredentialsPage] titles subscribe error:", error);
      setTitleDefinitions([]);
      setTitleLoading(false);
    });
  }, [classId]);
  useEffect(() => {
    if (!classId) {
      setCredentialSettings(null);
      setCredentialSettingsLoading(false);
      return undefined;
    }
    setCredentialSettingsLoading(true);
    return onSnapshot(doc(db, "classes", classId, "settings", "credentials"), (snapshot) => {
      setCredentialSettings(snapshot.exists() ? snapshot.data() : null);
      setCredentialSettingsLoading(false);
    }, (error) => {
      console.error("[CredentialsPage] credential settings subscribe error:", error);
      setCredentialSettings(null);
      setCredentialSettingsLoading(false);
    });
  }, [classId]);
  useEffect(() => {
    if (!classId || !certificateDefinitionsActive) {
      setCertificateDefinitions([]);
      setCertificateLoading(false);
      return undefined;
    }
    setCertificateLoading(true);
    return onSnapshot(collection(db, "classes", classId, "certificates"), (snapshot) => {
      const nextItems = normalizeSnapshot(snapshot).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
      setCertificateDefinitions(nextItems);
      setCertificateLoading(false);
    }, (error) => {
      console.error("[CredentialsPage] certificates subscribe error:", error);
      setCertificateDefinitions([]);
      setCertificateLoading(false);
    });
  }, [certificateDefinitionsActive, classId]);
  useEffect(() => {
    if (!titleStudentDataTargetKey) {
      setOwnedTitles([]);
      setStudentTitleRequests([]);
      setTitlePreference(null);
      setOwnedTitlesLoading(false);
      setStudentTitleRequestsLoading(false);
      return;
    }

    const hasOwnedTitlesCache = ownedTitlesCacheRef.current.has(titleStudentDataTargetKey);
    const hasStudentTitleRequestsCache =
      studentTitleRequestsCacheRef.current.has(titleStudentDataTargetKey);
    const hasTitlePreferenceCache =
      titlePreferenceCacheRef.current.has(titleStudentDataTargetKey);

    setOwnedTitles(
      hasOwnedTitlesCache
        ? ownedTitlesCacheRef.current.get(titleStudentDataTargetKey)
        : [],
    );
    setStudentTitleRequests(
      hasStudentTitleRequestsCache
        ? studentTitleRequestsCacheRef.current.get(titleStudentDataTargetKey)
        : [],
    );
    setTitlePreference(
      hasTitlePreferenceCache
        ? titlePreferenceCacheRef.current.get(titleStudentDataTargetKey)
        : null,
    );
    setOwnedTitlesLoading(titleStudentDataActive && !hasOwnedTitlesCache);
    setStudentTitleRequestsLoading(
      titleStudentDataActive && !hasStudentTitleRequestsCache,
    );
  }, [titleStudentDataActive, titleStudentDataTargetKey]);
  useEffect(() => {
    if (!classId || !activeStudentUid || !titleStudentDataActive) {
      return undefined;
    }
    return onSnapshot(collection(db, "classes", classId, "students", activeStudentUid, "ownedTitles"), (snapshot) => {
      const nextItems = normalizeSnapshot(snapshot).sort((a, b) => Number(Boolean(a.isRevoked)) - Number(Boolean(b.isRevoked)) || compareOwnedTitlePriority(a, b));
      ownedTitlesCacheRef.current.set(titleStudentDataTargetKey, nextItems);
      setOwnedTitles(nextItems);
      setOwnedTitlesLoading(false);
    }, (error) => {
      console.error("[CredentialsPage] owned titles subscribe error:", error);
      setOwnedTitles(
        ownedTitlesCacheRef.current.has(titleStudentDataTargetKey)
          ? ownedTitlesCacheRef.current.get(titleStudentDataTargetKey)
          : [],
      );
      setOwnedTitlesLoading(false);
    });
  }, [activeStudentUid, classId, titleStudentDataActive, titleStudentDataTargetKey]);
  useEffect(() => {
    if (!classId || !teacherTitleSummaryActive || !hasRoster) {
      clearTeacherTitleSummaryState();
      return undefined;
    }
    let isSummaryCancelled = false;
    let rebuildRequested = false;
    setTeacherTitleSummary(null);
    setTitleRequests([]);
    setTeacherTitleSummaryLoading(true);
    setTitleRequestsLoading(true);
    const summaryUnsubscribe = onSnapshot(getCredentialTeacherSummaryRef(db, classId), (snapshot) => {
      if (isSummaryCancelled) return;
      if (!snapshot.exists()) {
        setTeacherTitleSummary(null);
        setTitleRequests([]);
        if (!rebuildRequested) {
          rebuildRequested = true;
          void rebuildTeacherTitleSummaryFromServer(() => !isSummaryCancelled).catch((error) => {
            console.error("[CredentialsPage] teacher title summary initial rebuild error:", error);
            if (isSummaryCancelled) return;
            clearTeacherTitleSummaryState();
            showFeedback(
              "칭호 전체 현황 집계를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
              "warning",
            );
          });
        }
        return;
      }
      applyTeacherTitleSummaryState(snapshot.data() || {});
    }, (error) => {
      if (isSummaryCancelled) return;
      console.error("[CredentialsPage] teacher title summary subscribe error:", error);
      clearTeacherTitleSummaryState();
    });
    return () => {
      isSummaryCancelled = true;
      summaryUnsubscribe();
    };
  }, [
    applyTeacherTitleSummaryState,
    classId,
    clearTeacherTitleSummaryState,
    rebuildTeacherTitleSummaryFromServer,
    credentialAccessKey,
    hasRoster,
    showFeedback,
    teacherTitleSummaryActive,
  ]);
  useEffect(() => {
    if (!classId || !activeStudentUid || !certificateTabActive) {
      setOwnedCertificates([]);
      setOwnedCertificatesLoading(false);
      return undefined;
    }
    setOwnedCertificatesLoading(true);
    return onSnapshot(collection(db, "classes", classId, "students", activeStudentUid, "ownedCertificates"), (snapshot) => {
      const nextItems = normalizeSnapshot(snapshot).sort((a, b) => Number(Boolean(a.isRevoked)) - Number(Boolean(b.isRevoked)) || toMillis(b.issuedAt) - toMillis(a.issuedAt));
      setOwnedCertificates(nextItems);
      setOwnedCertificatesLoading(false);
    }, (error) => {
      console.error("[CredentialsPage] owned certificates subscribe error:", error);
      setOwnedCertificates([]);
      setOwnedCertificatesLoading(false);
    });
  }, [activeStudentUid, certificateTabActive, classId]);
  useEffect(() => {
    if (!classId || !canOperateCredentials || !teacherCertificateViewActive || !rosterUids.length) {
      setTeacherCertificateRecordsByStudent({});
      setTeacherCertificateOverviewLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadedStudentUids = new Set();
    setTeacherCertificateOverviewLoading(true);
    setTeacherCertificateRecordsByStudent({});

    const markLoaded = (studentUid, records) => {
      if (cancelled) return;
      loadedStudentUids.add(studentUid);
      setTeacherCertificateRecordsByStudent((current) => ({
        ...current,
        [studentUid]: records,
      }));
      if (loadedStudentUids.size === rosterUids.length) {
        setTeacherCertificateOverviewLoading(false);
      }
    };

    const unsubscribes = rosterUids.map((studentUid) =>
      onSnapshot(
        collection(
          db,
          "classes",
          classId,
          "students",
          studentUid,
          "ownedCertificates",
        ),
        (snapshot) => markLoaded(studentUid, normalizeSnapshot(snapshot)),
        (error) => {
          console.error(
            "[CredentialsPage] teacher certificate overview subscribe error:",
            error,
          );
          markLoaded(studentUid, []);
        },
      ),
    );

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [canOperateCredentials, classId, credentialAccessKey, rosterUids, teacherCertificateViewActive]);
  useEffect(() => {
    if (!classId || !activeStudentUid || !titleStudentDataActive) {
      return undefined;
    }
    return onSnapshot(collection(db, "classes", classId, "students", activeStudentUid, "titleRequests"), (snapshot) => {
      const nextItems = normalizeSnapshot(snapshot).sort((a, b) => toMillis(b.updatedAt || b.requestedAt) - toMillis(a.updatedAt || a.requestedAt));
      studentTitleRequestsCacheRef.current.set(titleStudentDataTargetKey, nextItems);
      setStudentTitleRequests(nextItems);
      setStudentTitleRequestsLoading(false);
    }, (error) => {
      console.error("[CredentialsPage] student title requests subscribe error:", error);
      setStudentTitleRequests(
        studentTitleRequestsCacheRef.current.has(titleStudentDataTargetKey)
          ? studentTitleRequestsCacheRef.current.get(titleStudentDataTargetKey)
          : [],
      );
      setStudentTitleRequestsLoading(false);
    });
  }, [activeStudentUid, classId, titleStudentDataActive, titleStudentDataTargetKey]);
  useEffect(() => {
    if (!classId || !activeStudentUid || !titleStudentDataActive) {
      return undefined;
    }
    return onSnapshot(doc(db, "classes", classId, "students", activeStudentUid, "titlePreferences", "selection"), (snapshot) => {
      const nextTitlePreference = snapshot.exists() ? snapshot.data() : null;
      titlePreferenceCacheRef.current.set(
        titleStudentDataTargetKey,
        nextTitlePreference,
      );
      setTitlePreference(nextTitlePreference);
    }, (error) => {
      console.error("[CredentialsPage] title preference subscribe error:", error);
      setTitlePreference(
        titlePreferenceCacheRef.current.has(titleStudentDataTargetKey)
          ? titlePreferenceCacheRef.current.get(titleStudentDataTargetKey)
          : null,
      );
    });
  }, [activeStudentUid, classId, titleStudentDataActive, titleStudentDataTargetKey]);
  const titleGrades = useMemo(() => normalizeGradeList(credentialSettings?.titleGrades, DEFAULT_TITLE_GRADES), [credentialSettings]);
  const certificateGrades = useMemo(() => normalizeCertificateStageList(credentialSettings?.certificateGrades), [credentialSettings]);
  const titleCategories = useMemo(() => {
    const rawCategories = Array.isArray(credentialSettings?.titleCategories) ? credentialSettings.titleCategories : [];
    const categoriesFromDefinitions = titleDefinitions.map((item) => item?.category);
    return normalizeTitleCategoryList(rawCategories, categoriesFromDefinitions);
  }, [credentialSettings, titleDefinitions]);
  const certificateCategories = useMemo(() => {
    const rawCategories = Array.isArray(credentialSettings?.certificateCategories) ? credentialSettings.certificateCategories : [];
    const categoriesFromDefinitions = certificateDefinitions.map((item) => item?.category);
    return normalizeTitleCategoryList(rawCategories, categoriesFromDefinitions);
  }, [credentialSettings, certificateDefinitions]);
  const defaultTitleGradeId = titleGrades[0]?.id || DEFAULT_TITLE_GRADES[0].id;
  const legacyDefaultCertificateGradeId = certificateGrades[0]?.id || DEFAULT_CERTIFICATE_GRADES[0].id;
  const defaultCertificateGradeId = CERTIFICATE_NO_STAGE_ID;
  const titleGradeOptions = useMemo(() => buildGradeOptions(titleGrades), [titleGrades]);
  const certificateGradeOptions = useMemo(() => [
    CERTIFICATE_NO_STAGE_OPTION,
    ...buildGradeOptions(certificateGrades).filter(
      (item) => item.value !== CERTIFICATE_NO_STAGE_ID,
    ),
  ], [certificateGrades]);
  const resolvedTitleDefinitions = useMemo(() => titleDefinitions.map((item) => {
    const grade = getGradeMeta(titleGrades, item.gradeId || item.rarity || defaultTitleGradeId, defaultTitleGradeId);
    const categoryMeta = getTitleCategoryMeta(
      titleCategories,
      item.categoryId || item.category,
    );
    const revealFields = buildResolvedTitleReveal(item);
    return {
      ...item,
      categoryId: categoryMeta.id,
      category: categoryMeta.label,
      categoryLabel: categoryMeta.label,
      categoryIconKey: categoryMeta.iconKey,
      categoryColorKey: categoryMeta.colorKey,
      revealConfig: revealFields.revealConfig,
      revealMode: revealFields.revealMode,
      gradeId: grade.id,
      gradeLabel: grade.label,
      gradeTone: grade.tone,
      gradeOrder: Number(grade.order) || Number.MAX_SAFE_INTEGER,
      templateId: item.templateId || "license",
      displayOrder: getTitleDefinitionSortOrder(item)
    };
  }).filter((item) => !item.isDeleted).sort(compareTitleDefinitions).map((item, index) => ({
    ...item,
    displayOrder: item.displayOrder ?? index + 1
  })), [defaultTitleGradeId, titleCategories, titleDefinitions, titleGrades]);
  const resolvedCertificateDefinitions = useMemo(() => certificateDefinitions.map((item) => {
    const grade = getCertificateStageMeta(
      certificateGrades,
      item.gradeId || item.level,
      legacyDefaultCertificateGradeId,
    );
    const categoryMeta = getTitleCategoryMeta(
      certificateCategories,
      item.categoryId || item.category,
    );
    return {
      ...item,
      categoryId: categoryMeta.id,
      category: categoryMeta.label,
      categoryLabel: categoryMeta.label,
      categoryIconKey: categoryMeta.iconKey,
      categoryColorKey: categoryMeta.colorKey,
      gradeId: grade.id,
      gradeLabel: grade.label,
      gradeTone: grade.tone,
      acquisitionCondition: item.acquisitionCondition || item.condition || "",
      gradeOrder: Number(grade.order) || Number.MAX_SAFE_INTEGER,
      displayOrder: getTitleDefinitionSortOrder(item)
    };
  }).filter((item) => !item.isDeleted).sort(compareTitleDefinitions).map((item, index) => ({
    ...item,
    displayOrder: item.displayOrder ?? index + 1
  })), [certificateCategories, certificateDefinitions, certificateGrades, legacyDefaultCertificateGradeId]);
  const nextTitleDisplayOrder = useMemo(() => resolvedTitleDefinitions.reduce((maxValue, item) => Math.max(maxValue, parsePositiveInteger(item.displayOrder) || 0), 0) + 1, [resolvedTitleDefinitions]);
  const nextCertificateDisplayOrder = useMemo(() => resolvedCertificateDefinitions.reduce((maxValue, item) => Math.max(maxValue, parsePositiveInteger(item.displayOrder) || 0), 0) + 1, [resolvedCertificateDefinitions]);
  const titleMap = useMemo(() => new Map(resolvedTitleDefinitions.map((item) => [item.id, item])), [resolvedTitleDefinitions]);
  const certificateMap = useMemo(() => new Map(resolvedCertificateDefinitions.map((item) => [item.id, item])), [resolvedCertificateDefinitions]);
  const rosterMap = useMemo(
    () => new Map(roster.map((student) => [student.uid, student])),
    [roster],
  );
  const resolvedTitleRequests = useMemo(() => titleRequests.map((item) => {
    const definition = titleMap.get(item.titleId) || null;
    const canonicalRequest = resolveCredentialTitleRequestForReview({
      request: item,
      titleDefinition: definition,
      student: rosterMap.get(item.studentUid) || null,
    });
    const grade = getGradeMeta(titleGrades, canonicalRequest.gradeId || canonicalRequest.rarity || defaultTitleGradeId, defaultTitleGradeId);
    return {
      ...canonicalRequest,
      gradeId: grade.id,
      gradeLabel: grade.label,
      gradeTone: grade.tone,
      requestMessage: item.requestMessage || "",
      reviewMessage: item.reviewMessage || ""
    };
  }).filter((item) => !item.definitionDeleted), [defaultTitleGradeId, rosterMap, titleGrades, titleMap, titleRequests]);
  const resolvedStudentTitleRequests = useMemo(() => studentTitleRequests.map((item) => {
    const definition = titleMap.get(item.titleId) || null;
    const canonicalRequest = resolveCredentialTitleRequestForReview({
      request: item,
      titleDefinition: definition,
      student: rosterMap.get(item.studentUid) || (
        activeStudent?.uid === item.studentUid ? activeStudent : null
      ),
    });
    const grade = getGradeMeta(titleGrades, canonicalRequest.gradeId || canonicalRequest.rarity || defaultTitleGradeId, defaultTitleGradeId);
    return {
      ...canonicalRequest,
      gradeId: grade.id,
      gradeLabel: grade.label,
      gradeTone: grade.tone,
      requestMessage: item.requestMessage || "",
      reviewMessage: item.reviewMessage || ""
    };
  }).filter((item) => !item.definitionDeleted), [activeStudent, defaultTitleGradeId, rosterMap, studentTitleRequests, titleGrades, titleMap]);
  const resolvedOwnedTitles = useMemo(() => ownedTitles.map((owned) => {
    const definition = titleMap.get(owned.titleId) || null;
    const grade = getGradeMeta(titleGrades, definition?.gradeId || owned.gradeId || owned.rarity || defaultTitleGradeId, defaultTitleGradeId);
    const categoryMeta = getTitleCategoryMeta(
      titleCategories,
      definition?.categoryId || definition?.category || owned.categoryId || owned.category,
    );
    const revealFields = buildResolvedTitleReveal(definition, owned);
    return {
      ownedId: owned.id,
      definitionId: owned.titleId || owned.id,
      name: definition?.name || owned.titleName || "이름 없는 칭호",
      description: definition?.description || owned.description || "",
      acquisitionCondition: definition?.acquisitionCondition || owned.acquisitionCondition || "",
      categoryId: categoryMeta.id,
      category: categoryMeta.label,
      categoryLabel: categoryMeta.label,
      categoryIconKey: categoryMeta.iconKey,
      categoryColorKey: categoryMeta.colorKey,
      revealConfig: revealFields.revealConfig,
      revealMode: revealFields.revealMode,
      gradeId: grade.id,
      gradeLabel: grade.label,
      gradeTone: grade.tone,
      rarity: definition?.rarity || owned.rarity || "common",
      sourceType: owned.sourceType || definition?.sourceType || "manual",
      version: definition?.version || owned.version || 2,
      icon: definition?.icon || owned.icon || "none",
      familyId: definition?.familyId || owned.familyId || "plaque",
      paletteId: definition?.paletteId || owned.paletteId || "sky",
      trimPaletteId:
        definition?.trimPaletteId || owned.trimPaletteId || "match",
      ornamentSetId:
        definition?.ornamentSetId || owned.ornamentSetId || "none",
      fontStyleId:
        definition?.fontStyleId || owned.fontStyleId || "basic",
      textScale:
        definition?.textScale ?? owned.textScale ?? 100,
      textOffsetY:
        definition?.textOffsetY ?? owned.textOffsetY ?? 0,
      textColorMode:
        definition?.textColorMode || owned.textColorMode || "auto",
      customTextColor:
        definition?.customTextColor || owned.customTextColor || "",
      customFrameColor:
        definition?.customFrameColor || owned.customFrameColor || "",
      customBannerColor:
        definition?.customBannerColor || owned.customBannerColor || "",
      customTrimColor:
        definition?.customTrimColor || owned.customTrimColor || "",
      topDecoId: definition?.topDecoId || owned.topDecoId || "none",
      sideDecoId: definition?.sideDecoId || owned.sideDecoId || "none",
      bottomDecoId: definition?.bottomDecoId || owned.bottomDecoId || "none",
      patternId: definition?.patternId || owned.patternId || "none",
      effectId: definition?.effectId || owned.effectId || "none",
      sourceRefId: owned.sourceRefId || "",
      obtainedAt: owned.obtainedAt || owned.createdAt || null,
      equipped: Boolean(owned.equipped),
      equippedOrder: getTitleEquippedOrder(owned),
      isRevoked: Boolean(owned.isRevoked),
      revokedAt: owned.revokedAt || null,
      revokedByUid: owned.revokedByUid || "",
      revokedByName: owned.revokedByName || "",
      revokeReason: owned.revokeReason || "",
      restoredAt: owned.restoredAt || null,
      restoredByUid: owned.restoredByUid || "",
      restoredByName: owned.restoredByName || "",
      missingDefinition: !definition
    };
  }), [defaultTitleGradeId, ownedTitles, titleCategories, titleGrades, titleMap]);
  const activeResolvedOwnedTitles = useMemo(() => resolvedOwnedTitles.filter((item) => !item.isRevoked).sort(compareOwnedTitlePriority), [resolvedOwnedTitles]);
  const revokedResolvedOwnedTitles = useMemo(() => resolvedOwnedTitles.filter((item) => item.isRevoked), [resolvedOwnedTitles]);
  const resolvedOwnedCertificates = useMemo(() => ownedCertificates.map((owned) => {
    const definition =
      certificateMap.get(owned.certificateId) ||
      certificateDefinitions.find((item) => item.id === owned.certificateId) ||
      null;
    const grade = getCertificateStageMeta(
      certificateGrades,
      definition?.gradeId || owned.gradeId || definition?.level || owned.level,
      legacyDefaultCertificateGradeId,
    );
    const categoryMeta = getTitleCategoryMeta(
      certificateCategories,
      definition?.categoryId || definition?.category || owned.categoryId || owned.category,
    );
    return {
      ownedId: owned.id,
      definitionId: owned.certificateId || owned.id,
      name: definition?.name || owned.certificateName || owned.name || "이름 없는 자격증",
      description: definition?.description || owned.description || "",
      acquisitionCondition: definition?.acquisitionCondition || owned.acquisitionCondition || owned.condition || "",
      categoryId: categoryMeta.id,
      category: categoryMeta.label,
      categoryLabel: categoryMeta.label,
      categoryIconKey: categoryMeta.iconKey,
      categoryColorKey: categoryMeta.colorKey,
      gradeId: grade.id,
      gradeLabel: grade.label,
      gradeTone: grade.tone,
      level: definition?.level || owned.level || grade.id || "basic",
      templateId: definition?.templateId || owned.templateId || "license",
      issueMethod: definition?.issueMethod || owned.issueMethod || "manual",
      issuedAt: owned.issuedAt || owned.createdAt || null,
      issuedByUid: owned.issuedByUid || "",
      issuedByName: owned.issuedByName || "",
      expiresAt: owned.expiresAt || null,
      isRevoked: Boolean(owned.isRevoked),
      missingDefinition: !definition,
      displayOrder: definition?.displayOrder || null
    };
  }), [certificateCategories, certificateDefinitions, certificateGrades, certificateMap, legacyDefaultCertificateGradeId, ownedCertificates]);
  const studentCertificateOverviewRows = useMemo(
    () =>
      buildStudentCertificateOverviewRows(
        roster,
        teacherCertificateRecordsByStudent,
      ),
    [roster, teacherCertificateRecordsByStudent],
  );
  const normalizedTeacherTitleSummary = useMemo(() => normalizeCredentialTeacherSummary(teacherTitleSummary || {}, roster), [roster, teacherTitleSummary]);
  const teacherStudentTitleStats = useMemo(
    () => normalizedTeacherTitleSummary.studentTitleStats || {},
    [normalizedTeacherTitleSummary],
  );
  const ownedTitleCountByDefinition = normalizedTeacherTitleSummary.ownedTitleCountByDefinition || {};
  const requestCountByDefinition = normalizedTeacherTitleSummary.requestCountByDefinition || {};
  const visibleTitleDefinitions = useMemo(() => resolvedTitleDefinitions.filter((item) => item.isVisible !== false), [resolvedTitleDefinitions]);
  const visibleCertificateDefinitions = useMemo(() => resolvedCertificateDefinitions.filter((item) => item.isActive !== false && item.isVisible !== false), [resolvedCertificateDefinitions]);
  const ownedTitleIds = useMemo(() => new Set(activeResolvedOwnedTitles.map((item) => item.definitionId).filter(Boolean)), [activeResolvedOwnedTitles]);
  const ownedCertificateIds = useMemo(() => new Set(resolvedOwnedCertificates.filter((item) => !item.isRevoked).map((item) => item.definitionId).filter(Boolean)), [resolvedOwnedCertificates]);
  const lockedTitles = useMemo(() => visibleTitleDefinitions.filter((item) => !ownedTitleIds.has(item.id)), [ownedTitleIds, visibleTitleDefinitions]);
  const lockedCertificates = useMemo(() => visibleCertificateDefinitions.filter((item) => !ownedCertificateIds.has(item.id)), [ownedCertificateIds, visibleCertificateDefinitions]);
  const activeStudentLabel = buildStudentLabel(activeStudent);
  const issuerName =
    userData?.name || userData?.teacherDisplayName || userData?.uid || "교사";
  const canUseStudentSelfService =
    !!userData?.uid && activeStudentUid === userData.uid;
  const canOperateOnStudentUid = useCallback(
    (studentUid) => canOperateOnCredentialStudent({
      isAdmin,
      isTeacher,
      canOperateCredentials: canIssueCredentials,
      actorUid: userData?.uid,
      studentUid,
    }),
    [canIssueCredentials, isAdmin, isTeacher, userData?.uid],
  );
  const canOperateOnActiveStudent = canOperateOnStudentUid(activeStudentUid);
  const issuableRoster = useMemo(
    () => roster.filter((student) => canOperateOnStudentUid(student?.uid)),
    [canOperateOnStudentUid, roster],
  );
  const canEquipTitle = canUseStudentSelfService;
  const canManageRepresentativeTitles =
    canManageCredentials || (!!userData?.uid && activeStudentUid === userData.uid);
  const isTitleCollectionPublic =
    String(userData?.titleCollectionVisibility || "public").trim() !== "private";
  const equippedTitles = useMemo(() => sortEquippedTitleRecords(activeResolvedOwnedTitles), [activeResolvedOwnedTitles]);
  const equippedTitle = equippedTitles[0] || null;
  const representativeCount = equippedTitles.length;
  const selectedNextTargetId = String(titlePreference?.nextTargetTitleId || "").trim();
  const selectedNextTargetDefinition = selectedNextTargetId ? lockedTitles.find((item) => item.id === selectedNextTargetId) || null : null;
  const nextLockedTitleCandidate = selectedNextTargetDefinition || lockedTitles[0] || null;
  const nextLockedTitleReveal = nextLockedTitleCandidate ? getTitleRevealMeta(nextLockedTitleCandidate) : null;
  const titleHeroItem = equippedTitle || (nextLockedTitleCandidate ? {
    ...nextLockedTitleCandidate,
    name: nextLockedTitleReveal?.displayName || "다음 목표",
    description:
      nextLockedTitleReveal?.displayHint ||
      "조건을 달성하면 교사에게 요청해 등록할 수 있습니다."
  } : null) || {
    name: "대표 칭호를 등록해 보세요",
    description:
      "칭호를 하나 이상 획득하면 대표 칭호로 설정해 홈 화면과 계정 화면에 표시할 수 있습니다.",
    gradeId: defaultTitleGradeId,
    gradeLabel: titleGrades[0]?.label || "기초",
    gradeTone: titleGrades[0]?.tone || "slate",
    rarity: "rare",
    sourceType: "manual"
  };
  const titleHeroTheme = getTitleSurfaceTheme(titleHeroItem);
  const titleHeroRevealMeta = getTitleRevealMeta(titleHeroItem);
  const ownedTitleMap = useMemo(() => new Map(activeResolvedOwnedTitles.filter((item) => item.definitionId || item.ownedId).map((item) => [item.definitionId || item.ownedId, item])), [activeResolvedOwnedTitles]);
  const studentTitleRequestMap = useMemo(() => new Map(resolvedStudentTitleRequests.map((item) => [item.titleId || item.id, item]).filter(([key]) => Boolean(key))), [resolvedStudentTitleRequests]);
  const selectedStudentTitleRequests = useMemo(() => resolvedTitleRequests.filter((item) => activeStudentUid ? item.studentUid === activeStudentUid : true), [activeStudentUid, resolvedTitleRequests]);
  const selectedStudentPendingRequests = useMemo(() => selectedStudentTitleRequests.filter((item) => (item.status || "pending") === "pending"), [selectedStudentTitleRequests]);
  const selectedStudentReviewedRequests = useMemo(() => selectedStudentTitleRequests.filter((item) => (item.status || "pending") !== "pending"), [selectedStudentTitleRequests]);
  const selectedPendingRequestItems = useMemo(() => selectedStudentPendingRequests.filter((item) => selectedPendingRequestIds.includes(item.requestId)), [selectedPendingRequestIds, selectedStudentPendingRequests]);
  const selectedStudentActiveOwnedTitles = useMemo(() => activeResolvedOwnedTitles, [activeResolvedOwnedTitles]);
  const selectedStudentRevokedOwnedTitles = useMemo(() => revokedResolvedOwnedTitles, [revokedResolvedOwnedTitles]);
  useEffect(() => {
    setSelectedPendingRequestIds((prev) => prev.filter((requestId) => selectedStudentPendingRequests.some((item) => item.requestId === requestId)));
  }, [selectedStudentPendingRequests]);
  const titleCollectionStages = useMemo(() => {
    const rawStages = Array.isArray(credentialSettings?.titleCollectionStages)
      ? credentialSettings.titleCollectionStages
      : [];

    const normalizedStages = rawStages
      .map((item, index) => ({
        id: item?.id || `stage-${index + 1}`,
        label: String(item?.label || "").trim(),
        minRate: Math.max(
          0,
          Math.min(100, Number(item?.minRate ?? item?.threshold ?? 0) || 0),
        ),
        tone: item?.tone || "slate",
        accentColor: normalizeTitleCollectionStageAccentColor(
          item?.accentColor || item?.color,
        ),
        emblemStage: Math.max(
          0,
          Math.min(12, Math.round(Number(item?.emblemStage ?? item?.visualStage) || 0)),
        ) || null,
        order: Number(item?.order) || index + 1,
      }))
      .filter((item) => item.label);

    return normalizedStages.length
      ? normalizedStages.sort(
          (left, right) =>
            left.minRate - right.minRate || left.order - right.order,
        )
      : DEFAULT_TITLE_COLLECTION_STAGES;
  }, [credentialSettings]);
  const studentTitleOverviewRows = useMemo(() => roster.map((student) => {
    const studentStat = teacherStudentTitleStats[student.uid] || {};
    const canonicalPendingRequests = resolvedTitleRequests
      .filter(
        (item) =>
          item.studentUid === student.uid &&
          (item.status || "pending") === "pending",
      )
      .sort(
        (left, right) =>
          toMillis(right?.requestedAt || right?.updatedAt) -
          toMillis(left?.requestedAt || left?.updatedAt),
      );
    const pendingRequestPreview = canonicalPendingRequests
      .map((item) => String(item.titleName || "").trim())
      .filter(Boolean)
      .slice(0, 2);
    const pendingRequestCount = canonicalPendingRequests.length;
    const extraPendingRequestCount = Math.max(
      0,
      Number(
        studentStat.extraPendingRequestCount ||
        Math.max(pendingRequestCount - pendingRequestPreview.length, 0),
      ),
    );
    const ownedDefinitionIds = new Set(
      Array.isArray(studentStat.ownedTitleIds)
        ? studentStat.ownedTitleIds.filter(Boolean)
        : [],
    );
    const dexDefinitions = resolvedTitleDefinitions.filter((item) => item.isVisible !== false || ownedDefinitionIds.has(item.id));
    const dexTotal = dexDefinitions.length;
    const dexOwnedCount = dexDefinitions.filter((item) => ownedDefinitionIds.has(item.id)).length;
    const titleCollectionRate = dexTotal ? Math.round(dexOwnedCount / dexTotal * 100) : 0;
    const titleCollectionStage = [...titleCollectionStages]
      .reverse()
      .find((item) => titleCollectionRate >= item.minRate) || {
      label: "미등록",
      tone: "slate",
      minRate: 0
    };
    return {
      uid: student.uid,
      studentName: student.name || student.displayName || "학생",
      studentNumber: student.studentNumber || "",
      ownedCount: Number(studentStat.ownedCount || 0),
      dexOwnedCount,
      dexTotal,
      titleCollectionRate,
      titleCollectionStageLabel: titleCollectionStage.label,
      titleCollectionStageTone: titleCollectionStage.tone,
      titleCollectionStageColor: titleCollectionStage.accentColor || "",
      equippedTitleName: Array.isArray(studentStat.equippedTitleNames)
        ? studentStat.equippedTitleNames.join(", ")
        : "",
      ownedPreview: [],
      extraOwnedCount: 0,
      pendingRequestCount,
      pendingRequestPreview,
      extraPendingRequestCount
    };
  }), [resolvedTitleDefinitions, resolvedTitleRequests, roster, teacherStudentTitleStats, titleCollectionStages]);
  const selectedStudentIssueList = useMemo(() => roster.filter((student) => selectedStudentIssueUids.includes(student.uid)), [roster, selectedStudentIssueUids]);
  const studentDexDefinitions = useMemo(() => resolvedTitleDefinitions.filter((item) => item.isVisible !== false || ownedTitleIds.has(item.id)), [ownedTitleIds, resolvedTitleDefinitions]);
  const studentDexDefinitionIds = useMemo(() => new Set(studentDexDefinitions.map((item) => item.id)), [studentDexDefinitions]);
  const orphanOwnedTitles = useMemo(() => activeResolvedOwnedTitles.filter((item) => item.definitionId && !studentDexDefinitionIds.has(item.definitionId)), [activeResolvedOwnedTitles, studentDexDefinitionIds]);
  const titleDexEntries = useMemo(() => {
    const definedEntries = studentDexDefinitions.map((definition, index) => {
      const owned = ownedTitleMap.get(definition.id) || null;
      const request = studentTitleRequestMap.get(definition.id) || null;
      const categoryMeta = getTitleCategoryMeta(
        titleCategories,
        owned?.categoryId || definition.categoryId || owned?.category || definition.category,
      );
      const revealFields = buildResolvedTitleReveal(owned, definition);
      return {
        id: definition.id,
        definitionId: definition.id,
        dexNumber: index + 1,
        name: owned?.name || definition.name || "이름 없는 칭호",
        description: owned?.description || definition.description || "",
        categoryId: categoryMeta.id,
        category: categoryMeta.label,
        categoryLabel: categoryMeta.label,
        categoryIconKey: categoryMeta.iconKey,
        categoryColorKey: categoryMeta.colorKey,
        acquisitionCondition: definition.acquisitionCondition || owned?.acquisitionCondition || "",
        revealConfig: revealFields.revealConfig,
        revealMode: revealFields.revealMode,
        gradeId: owned?.gradeId || definition.gradeId || defaultTitleGradeId,
        gradeLabel: owned?.gradeLabel || definition.gradeLabel || titleGrades[0]?.label || "湲곗큹",
        gradeTone: owned?.gradeTone || definition.gradeTone || titleGrades[0]?.tone || "slate",
        rarity: owned?.rarity || definition.rarity || "common",
        sourceType: owned?.sourceType || definition.sourceType || "manual",
        version: owned?.version || definition.version || 2,
        icon: owned?.icon || definition.icon || "none",
        familyId: owned?.familyId || definition.familyId || "plaque",
        paletteId: owned?.paletteId || definition.paletteId || "sky",
        trimPaletteId:
          owned?.trimPaletteId || definition.trimPaletteId || "match",
        ornamentSetId:
          owned?.ornamentSetId || definition.ornamentSetId || "none",
        fontStyleId:
          owned?.fontStyleId || definition.fontStyleId || "basic",
        textScale:
          owned?.textScale ?? definition.textScale ?? 100,
        textOffsetY:
          owned?.textOffsetY ?? definition.textOffsetY ?? 0,
        textColorMode:
          owned?.textColorMode || definition.textColorMode || "auto",
        customTextColor:
          owned?.customTextColor || definition.customTextColor || "",
        customFrameColor:
          owned?.customFrameColor || definition.customFrameColor || "",
        customBannerColor:
          owned?.customBannerColor || definition.customBannerColor || "",
        customTrimColor:
          owned?.customTrimColor || definition.customTrimColor || "",
        topDecoId: owned?.topDecoId || definition.topDecoId || "none",
        sideDecoId: owned?.sideDecoId || definition.sideDecoId || "none",
        bottomDecoId: owned?.bottomDecoId || definition.bottomDecoId || "none",
        patternId: owned?.patternId || definition.patternId || "none",
        effectId: owned?.effectId || definition.effectId || "none",
        obtainedAt: owned?.obtainedAt || null,
        equipped: Boolean(owned?.equipped),
        equippedOrder: owned?.equippedOrder || null,
        ownedId: owned?.ownedId || "",
        missingDefinition: Boolean(owned?.missingDefinition),
        allowStudentRequest: definition.allowStudentRequest !== false,
        requestStatus: request?.status || "",
        requestId: request?.requestId || request?.id || "",
        requestUpdatedAt: request?.updatedAt || request?.requestedAt || null,
        reviewMessage: request?.reviewMessage || "",
        locked: !owned
      };
    });
    const orphanEntries = orphanOwnedTitles.map((item, index) => ({
      ...item,
      id: item.definitionId || item.ownedId,
      dexNumber: studentDexDefinitions.length + index + 1,
      locked: false,
      categoryLabel: item.categoryLabel || getTitleCategoryLabel(item.category),
      description:
        item.description ||
        "현재 정의 정보는 없지만, 이미 등록된 칭호 기록은 보존되어 있습니다."
    }));
    return [...definedEntries, ...orphanEntries];
  }, [defaultTitleGradeId, orphanOwnedTitles, ownedTitleMap, studentDexDefinitions, studentTitleRequestMap, titleCategories, titleGrades]);
  const activeOwnedCertificates = useMemo(
    () =>
      resolvedOwnedCertificates
        .filter((item) => !item.isRevoked)
        .sort(
          (left, right) =>
            (parsePositiveInteger(left.displayOrder) ?? Number.MAX_SAFE_INTEGER) -
              (parsePositiveInteger(right.displayOrder) ?? Number.MAX_SAFE_INTEGER) ||
            String(left?.name || "").localeCompare(String(right?.name || ""), "ko") ||
            toMillis(right.issuedAt) - toMillis(left.issuedAt),
        ),
    [resolvedOwnedCertificates],
  );
  const expiredCertificateCount = activeOwnedCertificates.filter((item) => {
    const expiresAt = toDateValue(item.expiresAt);
    return expiresAt ? expiresAt.getTime() < Date.now() : false;
  }).length;
  const titleCollectionTotal = visibleTitleDefinitions.length;
  const certificateCollectionTotal = visibleCertificateDefinitions.length;
  const studentDexTotal = studentDexDefinitions.length;
  const studentDexOwnedCount = studentDexDefinitions.filter((item) => ownedTitleIds.has(item.id)).length;
  const studentDexLockedCount = Math.max(studentDexTotal - studentDexOwnedCount, 0);
  const titleCollectionRate = studentDexTotal ? Math.round(studentDexOwnedCount / studentDexTotal * 100) : 0;
  const titleCollectionStage =
    [...titleCollectionStages]
      .reverse()
      .find((item) => titleCollectionRate >= item.minRate) || {
      label: "미등록",
      tone: "slate",
      minRate: 0,
    };
  const unlockedTitleCollectionEmblemStage = getTitleCollectionVisualStage(
    titleCollectionRate,
    titleCollectionStages,
  );
  const selectedTitleCollectionEmblemStage =
    getTitleCollectionSelectedVisualStage(
      userData?.titleCollectionEmblemStage,
      unlockedTitleCollectionEmblemStage,
    );
  const latestOwnedTitle = useMemo(() => [...activeResolvedOwnedTitles].sort((a, b) => toMillis(b.obtainedAt) - toMillis(a.obtainedAt))[0] || null, [activeResolvedOwnedTitles]);
  const nextLockedTitle = titleDexEntries.find((item) => item.locked) || null;
  const selectedNextTarget = selectedNextTargetId ? titleDexEntries.find((item) => item.definitionId === selectedNextTargetId && item.locked) || null : null;
  const nextTargetTitle = selectedNextTarget || nextLockedTitle;
  const representativeTitleItem = useMemo(() => {
    if (!equippedTitle) {
      return null;
    }

    const matchedEntry =
      titleDexEntries.find(
        (item) =>
          (equippedTitle.ownedId && item.ownedId === equippedTitle.ownedId) ||
          (equippedTitle.definitionId &&
            item.definitionId === equippedTitle.definitionId),
      ) || null;

    if (!matchedEntry) {
      const revealMeta = getTitleRevealMeta(equippedTitle);
      return {
        ...equippedTitle,
        name: equippedTitle.name || revealMeta.displayName || "",
        description:
          equippedTitle.description || revealMeta.displayHint || "",
        categoryLabel:
          equippedTitle.categoryLabel ||
          getTitleCategoryLabel(equippedTitle.category),
        gradeLabel: equippedTitle.gradeLabel || titleGrades[0]?.label || "",
        gradeTone: equippedTitle.gradeTone || titleGrades[0]?.tone || "slate",
      };
    }

    const revealMeta = getTitleRevealMeta(matchedEntry);

    return {
      ...matchedEntry,
      ...equippedTitle,
      name:
        matchedEntry.name ||
        equippedTitle.name ||
        revealMeta.displayName ||
        "",
      description:
        matchedEntry.description || equippedTitle.description || "",
      categoryLabel:
        matchedEntry.categoryLabel ||
        equippedTitle.categoryLabel ||
        getTitleCategoryLabel(matchedEntry.category || equippedTitle.category),
      gradeLabel:
        matchedEntry.gradeLabel || equippedTitle.gradeLabel || titleGrades[0]?.label || "",
      gradeTone:
        matchedEntry.gradeTone || equippedTitle.gradeTone || titleGrades[0]?.tone || "slate",
    };
  }, [equippedTitle, titleDexEntries, titleGrades]);
  const nextTitleCollectionStage =
    titleCollectionStages.find((item) => item.minRate > titleCollectionRate) ||
    null;
  const titlesUntilNextStage = nextTitleCollectionStage && studentDexTotal
    ? Math.max(
        0,
        Math.ceil(studentDexTotal * (nextTitleCollectionStage.minRate / 100)) -
          studentDexOwnedCount,
      )
    : 0;
  const titleHeroItemResolved = representativeTitleItem || null;
  const titleHeroThemeResolved = titleHeroItemResolved
    ? getTitleSurfaceTheme(titleHeroItemResolved)
    : titleHeroTheme;
  const titleHeroRevealMetaResolved = titleHeroItemResolved
    ? getTitleRevealMeta(titleHeroItemResolved)
    : titleHeroRevealMeta;
  const requestableDexCount = useMemo(() => titleDexEntries.filter((item) => item.locked && item.allowStudentRequest !== false).length, [titleDexEntries]);
  const studentDexCategoryItems = useMemo(() => buildTitleCategoryChipItems(titleDexEntries, titleCategories), [titleCategories, titleDexEntries]);
  const studentCertificateCategoryItems = useMemo(
    () =>
      buildTitleCategoryChipItems(
        [...activeOwnedCertificates, ...lockedCertificates],
        certificateCategories,
      ),
    [activeOwnedCertificates, certificateCategories, lockedCertificates],
  );
  const teacherCertificateCategoryItems = useMemo(
    () =>
      buildTitleCategoryChipItems(
        resolvedCertificateDefinitions,
        certificateCategories,
      ),
    [certificateCategories, resolvedCertificateDefinitions],
  );
  const teacherIssueCategoryItems = useMemo(() => buildTitleCategoryChipItems(resolvedTitleDefinitions, titleCategories), [resolvedTitleDefinitions, titleCategories]);
  const filteredActiveOwnedCertificates = useMemo(
    () =>
      activeOwnedCertificates.filter((item) =>
        studentCertificateCategoryFilter === "all"
          ? true
          : String(item.categoryId || "") === studentCertificateCategoryFilter,
      ),
    [activeOwnedCertificates, studentCertificateCategoryFilter],
  );
  const filteredLockedCertificates = useMemo(
    () =>
      lockedCertificates.filter((item) =>
        studentCertificateCategoryFilter === "all"
          ? true
          : String(item.categoryId || "") === studentCertificateCategoryFilter,
      ),
    [lockedCertificates, studentCertificateCategoryFilter],
  );
  const filteredTitleDexEntries = useMemo(() => {
    const keyword = String(studentDexSearch || "").trim().toLowerCase();
    return titleDexEntries.filter((entry) => {
      if (studentDexFilter === "owned" && entry.locked) return false;
      if (studentDexFilter === "locked" && !entry.locked) return false;
      if (studentDexFilter === "requestable" && (!entry.locked || entry.allowStudentRequest === false)) {
        return false;
      }
      if (studentDexCategoryFilter !== "all" && String(entry.categoryId || "") !== studentDexCategoryFilter) {
        return false;
      }
      if (!keyword) return true;
      const revealMeta = getTitleRevealMeta(entry);
      const searchText = [entry.name, revealMeta.displayName, revealMeta.displayHint, entry.acquisitionCondition, entry.gradeLabel, formatDexNumber(entry.dexNumber)].filter(Boolean).join(" ").toLowerCase();
      return searchText.includes(keyword);
    }).sort((a, b) => {
      const aIsSelectedTarget = a.definitionId === selectedNextTargetId;
      const bIsSelectedTarget = b.definitionId === selectedNextTargetId;

      if (aIsSelectedTarget !== bIsSelectedTarget) {
        return Number(bIsSelectedTarget) - Number(aIsSelectedTarget);
      }

      return 0;
    });
  }, [selectedNextTargetId, studentDexCategoryFilter, studentDexFilter, studentDexSearch, titleDexEntries]);
  const teacherIssueItems = useMemo(() => resolvedTitleDefinitions.filter((item) => {
    if (teacherIssueCategoryFilter !== "all" && String(item.categoryId || "") !== teacherIssueCategoryFilter) {
      return false;
    }
    return true;
  }), [resolvedTitleDefinitions, teacherIssueCategoryFilter]);
  useEffect(() => {
    if (!studentDexCategoryItems.some((item) => item.id === studentDexCategoryFilter)) {
      setStudentDexCategoryFilter("all");
    }
  }, [studentDexCategoryFilter, studentDexCategoryItems]);
  useEffect(() => {
    if (!teacherIssueCategoryItems.some((item) => item.id === teacherIssueCategoryFilter)) {
      setTeacherIssueCategoryFilter("all");
    }
  }, [teacherIssueCategoryFilter, teacherIssueCategoryItems]);
  const resetIssueState = () => {
    setIssueSelectedUids(activeStudentUid ? [activeStudentUid] : []);
    setIssueSourceType("manual");
    setIssueSourceRefId("");
    setIssueExpiresAt("");
  };
  const openTitleCatalogCreate = () => {
    setEditingTitle(null);
    setTitleModalOpen(true);
  };
  const openTitleCatalogEdit = (item) => {
    setEditingTitle(item);
    setTitleModalOpen(true);
  };
  const openTitleRequestModal = (entry) => {
    setRequestingTitleEntry(entry);
  };
  const closeTitleRequestModal = () => {
    setRequestingTitleEntry(null);
  };
  const openTitleReviewModal = (mode, items) => {
    const nextItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!nextItems.length) return;
    setTitleReviewModalState({
      open: true,
      mode,
      items: nextItems
    });
  };
  const closeTitleReviewModal = () => {
    setTitleReviewModalState({
      open: false,
      mode: "approve",
      items: []
    });
  };
  const clearSelectedPendingRequests = () => {
    setSelectedPendingRequestIds([]);
  };
  const clearSelectedStudentIssues = () => {
    setSelectedStudentIssueUids([]);
  };
  const setStudentIssueSelection = useCallback((studentUid, shouldSelect) => {
    if (shouldSelect && !canOperateOnStudentUid(studentUid)) return;
    setSelectedStudentIssueUids((prev) => shouldSelect ? prev.includes(studentUid) ? prev : [...prev, studentUid] : prev.filter((uid) => uid !== studentUid));
  }, [canOperateOnStudentUid]);
  const toggleAllStudentIssueSelection = () => {
    const eligibleRows = studentTitleOverviewRows.filter((row) =>
      canOperateOnStudentUid(row.uid),
    );
    if (eligibleRows.length && selectedStudentIssueUids.length === eligibleRows.length) {
      clearSelectedStudentIssues();
      return;
    }
    setSelectedStudentIssueUids(eligibleRows.map((row) => row.uid));
  };
  const selectStudentIssue = useCallback((studentUid) => {
    setStudentIssueSelection(studentUid, true);
  }, [setStudentIssueSelection]);
  const deselectStudentIssue = useCallback((studentUid) => {
    setStudentIssueSelection(studentUid, false);
  }, [setStudentIssueSelection]);
  const { startDrag: startStudentIssueDragSelection, enterDrag: enterStudentIssueDragSelection } = useDragSelection({
    isSelected: (studentUid) => selectedStudentIssueUids.includes(studentUid),
    onSelect: selectStudentIssue,
    onDeselect: deselectStudentIssue
  });
  const handleStudentIssueSelectionMouseDown = useCallback((studentUid, isSelected) => {
    startStudentIssueDragSelection(studentUid, { selected: isSelected });
  }, [startStudentIssueDragSelection]);
  const handleStudentIssueSelectionMouseEnter = useCallback((studentUid) => {
    enterStudentIssueDragSelection(studentUid);
  }, [enterStudentIssueDragSelection]);
  const openTeacherTitleIssuePicker = (studentUids = selectedStudentIssueUids) => {
    const nextUids = Array.isArray(studentUids)
      ? studentUids.filter(canOperateOnStudentUid)
      : [];
    if (!nextUids.length) {
      showFeedback("지급할 학생을 먼저 선택해 주세요.", "warning");
      return;
    }
    setSelectedStudentIssueUids(nextUids);
    setTeacherTitleIssuePickerModalOpen(true);
  };
  const closeTeacherTitleIssuePicker = () => {
    setTeacherTitleIssuePickerModalOpen(false);
    setTeacherIssueCategoryFilter("all");
  };
  const openTeacherTitleDetailModal = (studentUid) => {
    if (!studentUid) return;
    setSelectedStudentUid(studentUid);
    setTeacherTitleDetailModalOpen(true);
  };
  const openTeacherCertificateDetailModal = (studentUid) => {
    if (!studentUid) return;
    setSelectedStudentUid(studentUid);
    setTeacherCertificateDetailModalOpen(true);
  };
  const closeTeacherCertificateDetailModal = () => {
    setTeacherCertificateDetailModalOpen(false);
  };
  const closeTeacherTitleDetailModal = () => {
    clearSelectedPendingRequests();
    setTeacherTitleDetailModalOpen(false);
  };
  const togglePendingRequestSelection = (requestId) => {
    setSelectedPendingRequestIds((prev) => prev.includes(requestId) ? prev.filter((item) => item !== requestId) : [...prev, requestId]);
  };
  const toggleAllPendingRequests = () => {
    if (selectedStudentPendingRequests.length && selectedPendingRequestItems.length === selectedStudentPendingRequests.length) {
      clearSelectedPendingRequests();
      return;
    }
    setSelectedPendingRequestIds(selectedStudentPendingRequests.map((item) => item.requestId));
  };
  const openTitleRevocationModal = (item) => {
    setTitleRevocationModalItem(item);
  };
  const closeTitleRevocationModal = () => {
    setTitleRevocationModalItem(null);
  };
  const openCertificateIssue = (item) => {
    if (!canIssueCredentials) {
      showFeedback("자격증을 발급할 권한이 없습니다.", "error");
      return;
    }
    setIssuingCertificate(item);
    setIssuingTitle(null);
    setIssueSelectedUids(activeStudentUid ? [activeStudentUid] : []);
    setIssueSourceType("manual");
    setIssueSourceRefId("");
    setIssueExpiresAt("");
  };
  const closeIssueModal = () => {
    setIssuingTitle(null);
    setIssuingCertificate(null);
    resetIssueState();
  };
  const findPendingTitleRequest = ({
    studentUid,
    titleId,
    requestItem = null
  }) => {
    if (!studentUid || !titleId) return null;
    if (
      requestItem?.studentUid === studentUid &&
      requestItem?.titleId === titleId &&
      (requestItem.status || "pending") === "pending"
    ) {
      return requestItem;
    }
    return resolvedTitleRequests.find((item) => item.studentUid === studentUid && item.titleId === titleId && (item.status || "pending") === "pending") || null;
  };
  const grantTitleToStudent = async ({
    title,
    studentUid,
    sourceType = "manual",
    sourceRefId = null,
    requestItem = null,
    reviewMessage = ""
  }) => {
    const linkedRequestItem = findPendingTitleRequest({
      studentUid,
      titleId: title?.id,
      requestItem
    });
    const ownedRef = doc(db, "classes", classId, "students", studentUid, "ownedTitles", title.id);
    const existingSnapshot = await getDoc(ownedRef);
    const existingData = existingSnapshot.exists() ? existingSnapshot.data() : null;
    const isRestoring = Boolean(existingData?.isRevoked);
    const revealFields = buildResolvedTitleReveal(title, existingData);
    const payload = {
      titleId: title.id,
      titleName: title.name || "",
      description: title.description || "",
      category: String(title.category || "").trim(),
      sourceType: sourceType || title.sourceType || "manual",
      sourceRefId: sourceRefId || linkedRequestItem?.requestId || null,
      acquisitionCondition: title.acquisitionCondition || "",
      revealConfig: revealFields.revealConfig,
      revealMode: revealFields.revealMode,
      gradeId: title.gradeId || title.rarity || defaultTitleGradeId,
      rarity: title.rarity || "common",
      version: title.version || 3,
      icon: title.icon || "none",
      familyId: title.familyId || "plaque",
      paletteId: title.paletteId || "sky",
      trimPaletteId: title.trimPaletteId || "match",
      ornamentSetId: title.ornamentSetId || "none",
      fontStyleId: title.fontStyleId || "basic",
      textScale: title.textScale ?? 100,
      textOffsetY: title.textOffsetY ?? 0,
      textColorMode: title.textColorMode || "auto",
      customTextColor: title.customTextColor || "",
      customFrameColor: title.customFrameColor || "",
      customBannerColor: title.customBannerColor || "",
      customTrimColor: title.customTrimColor || "",
      topDecoId: title.topDecoId || "none",
      sideDecoId: title.sideDecoId || "none",
      bottomDecoId: title.bottomDecoId || "none",
      patternId: title.patternId || "none",
      effectId: title.effectId || "none",
      updatedAt: serverTimestamp(),
      issuedByUid: userData.uid,
      issuedByName: issuerName,
      isRevoked: false,
      revokedAt: null,
      revokedByUid: "",
      revokedByName: "",
      revokeReason: "",
      restoredAt: isRestoring ? serverTimestamp() : existingData?.restoredAt || null,
      restoredByUid: isRestoring ? userData.uid : existingData?.restoredByUid || "",
      restoredByName: isRestoring ? issuerName : existingData?.restoredByName || ""
    };
    const batch = writeBatch(db);
    if (existingSnapshot.exists()) {
      batch.set(ownedRef, payload, { merge: true });
    } else {
      batch.set(ownedRef, {
        ...payload,
        equipped: false,
        obtainedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    }
    if (linkedRequestItem) {
      batch.set(doc(db, "classes", classId, "titleRequests", linkedRequestItem.requestId), {
        status: "approved",
        approvedAt: serverTimestamp(),
        rejectedAt: null,
        reviewedAt: serverTimestamp(),
        reviewedByUid: userData.uid,
        reviewedByName: issuerName,
        reviewMessage: reviewMessage || "",
        updatedAt: serverTimestamp()
      }, {
        merge: true
      });
      batch.set(doc(db, "classes", classId, "students", linkedRequestItem.studentUid, "titleRequests", linkedRequestItem.titleId), {
        status: "approved",
        approvedAt: serverTimestamp(),
        rejectedAt: null,
        reviewedAt: serverTimestamp(),
        reviewedByUid: userData.uid,
        reviewedByName: issuerName,
        reviewMessage: reviewMessage || "",
        updatedAt: serverTimestamp()
      }, {
        merge: true
      });
    }
    await batch.commit();
    return {
      studentUid,
      titleId: title.id,
      titleName: title.name || "",
      grantedOwnedCountDelta:
        !existingSnapshot.exists() || existingData?.isRevoked ? 1 : 0,
      requestReviewRecord: linkedRequestItem
        ? {
            ...linkedRequestItem,
            id: linkedRequestItem.requestId,
            status: "approved",
            approvedAt: new Date(),
            rejectedAt: null,
            reviewedAt: new Date(),
            reviewedByUid: userData.uid,
            reviewedByName: issuerName,
            reviewMessage: reviewMessage || "",
            updatedAt: new Date(),
          }
        : null,
    };
  };
  const saveDefinition = async (type, form) => {
    if (!classId || !userData?.uid) {
      showFeedback("학급 또는 사용자 정보를 찾을 수 없습니다.", "error");
      return;
    }
    if (!canEditCredentialDefinitions) {
      showFeedback("칭호·자격증 정의를 수정할 권한이 없습니다.", "error");
      return;
    }
    if (!form.name) {
      showFeedback(
        type === "title"
          ? "칭호명을 입력해 주세요."
          : "자격증명을 입력해 주세요.",
        "warning",
      );
      return;
    }
    const isTitle = type === "title";
    const editingItem = isTitle ? editingTitle : editingCertificate;
    const collectionName = isTitle ? "titles" : "certificates";
    const normalizedForm = {
      ...form,
      name: String(form.name || "").trim(),
      description: isTitle ? String(editingItem?.description || form.description || "").trim() : String(form.description || "").trim(),
      acquisitionCondition: String(form.acquisitionCondition || "").trim(),
      category: String(form.category || "").trim(),
      categoryId: String(form.categoryId || "").trim(),
      templateId: String(form.templateId || "license").trim(),
      icon: String(form.icon || "").trim(),
      version: Number(form.version) >= 3 ? 3 : 2,
      trimPaletteId: String(form.trimPaletteId || "match").trim(),
      ornamentSetId: String(form.ornamentSetId || "none").trim(),
      fontStyleId: String(form.fontStyleId || "basic").trim(),
      textScale: Number(form.textScale) || 100,
      textOffsetY: Number(form.textOffsetY) || 0,
      textColorMode: String(form.textColorMode || "auto").trim(),
      customTextColor: String(form.customTextColor || "").trim(),
      customFrameColor: String(form.customFrameColor || "").trim(),
      customBannerColor: String(form.customBannerColor || "").trim(),
      customTrimColor: String(form.customTrimColor || "").trim(),
      topDecoId: String(form.topDecoId || "none").trim(),
      sideDecoId: String(form.sideDecoId || "none").trim(),
      bottomDecoId: String(form.bottomDecoId || "none").trim(),
      patternId: String(form.patternId || "none").trim(),
      effectId: String(form.effectId || "none").trim()
    };
    const normalizedRevealConfig = isTitle
      ? normalizeTitleRevealConfig(
          normalizedForm.revealConfig,
          normalizedForm.revealMode || editingItem?.revealMode || "condition_only",
        )
      : null;
    const titleCategoryMeta = isTitle
      ? getTitleCategoryMeta(
          titleCategories,
          normalizedForm.categoryId || normalizedForm.category,
        )
      : null;
    const certificateCategoryMeta = !isTitle
      ? getTitleCategoryMeta(
          certificateCategories,
          normalizedForm.categoryId || normalizedForm.category,
        )
      : null;
    const titleGradeMeta = isTitle
      ? getGradeMeta(
          titleGrades,
          normalizedForm.gradeId || normalizedForm.rarity,
          defaultTitleGradeId,
        )
      : null;
    const certificateGradeMeta = !isTitle
      ? getCertificateStageMeta(
          certificateGrades,
          normalizedForm.gradeId || normalizedForm.level,
          legacyDefaultCertificateGradeId,
        )
      : null;
    const payload = isTitle ? {
      name: normalizedForm.name,
      description: normalizedForm.description,
      acquisitionCondition: normalizedForm.acquisitionCondition,
      categoryId: titleCategoryMeta?.id || "",
      category: titleCategoryMeta?.label || String(normalizedForm.category || "").trim(),
      gradeId: titleGradeMeta?.id || defaultTitleGradeId,
      rarity: titleGradeMeta?.id || defaultTitleGradeId,
      version: normalizedForm.version || 3,
      icon: normalizedForm.icon || "none",
      familyId: normalizedForm.familyId || "plaque",
      paletteId: normalizedForm.paletteId || "sky",
      trimPaletteId: normalizedForm.trimPaletteId || "match",
      ornamentSetId: normalizedForm.ornamentSetId || "none",
      fontStyleId: normalizedForm.fontStyleId || "basic",
      textScale: normalizedForm.textScale ?? 100,
      textOffsetY: normalizedForm.textOffsetY ?? 0,
      textColorMode: normalizedForm.textColorMode || "auto",
      customTextColor: normalizedForm.customTextColor || "",
      displayOrder: parsePositiveInteger(editingItem?.displayOrder) || nextTitleDisplayOrder,
      revealConfig: normalizedRevealConfig,
      revealMode: deriveLegacyTitleRevealMode(normalizedRevealConfig),
      sourceType: normalizedForm.sourceType || "manual",
      allowStudentRequest: normalizedForm.allowStudentRequest !== false,
      isVisible: normalizedForm.isVisible !== false,
      isActive: true,
      updatedAt: serverTimestamp(),
      updatedByUid: userData.uid,
      updatedByName: issuerName
    } : {
      name: normalizedForm.name,
      description: normalizedForm.description,
      categoryId: certificateCategoryMeta?.id || "",
      category: certificateCategoryMeta?.label || String(normalizedForm.category || "").trim(),
      gradeId: certificateGradeMeta?.id || defaultCertificateGradeId,
      level: certificateGradeMeta?.id || defaultCertificateGradeId,
      acquisitionCondition: normalizedForm.acquisitionCondition || "",
      templateId: normalizedForm.templateId || "license",
      displayOrder: parsePositiveInteger(editingItem?.displayOrder) || nextCertificateDisplayOrder,
      issueMethod: normalizedForm.issueMethod || "manual",
      expiresEnabled: Boolean(normalizedForm.expiresEnabled),
      isVisible: normalizedForm.isVisible !== false,
      isActive: normalizedForm.isActive !== false,
      updatedAt: serverTimestamp(),
      updatedByUid: userData.uid,
      updatedByName: issuerName
    };
    setSubmissionKey(`${type}-definition`);
    try {
      if (editingItem?.id) {
        await updateDoc(doc(db, "classes", classId, collectionName, editingItem.id), payload);
      } else {
        await addDoc(collection(db, "classes", classId, collectionName), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: userData.uid,
          createdByName: issuerName
        });
      }
      showFeedback(
        isTitle ? "칭호 정의를 저장했습니다." : "자격증 정의를 저장했습니다.",
        "success",
      );
      setTitleModalOpen(false);
      setCertificateModalOpen(false);
      setEditingTitle(null);
      setEditingCertificate(null);
    } catch (error) {
      console.error("[CredentialsPage] save definition error:", error);
      showFeedback(
        `저장 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`,
        "error",
      );
    } finally {
      setSubmissionKey("");
    }
  };
  const issueTitle = async () => {
    if (!classId || !userData?.uid || !issuingTitle) return;
    const eligibleUids = issueSelectedUids.filter(canOperateOnStudentUid);
    if (!eligibleUids.length) {
      showFeedback("지급할 학생을 선택해 주세요.", "warning");
      return;
    }
    setSubmissionKey("title-issue");
    try {
      const grantResults = await Promise.all(eligibleUids.map((uid) =>
        grantTitleToStudent({
          title: issuingTitle,
          studentUid: uid,
          sourceType: issueSourceType || "manual",
          sourceRefId: issueSourceRefId || null
        }),
      ));
      await refreshTeacherTitleOverview((summary) =>
        applyGrantResultsToTeacherSummary(summary, grantResults),
      );
      showFeedback(`${eligibleUids.length}명에게 칭호를 지급했습니다.`, "success");
      closeIssueModal();
    } catch (error) {
      console.error("[CredentialsPage] issue title error:", error);
      showFeedback("칭호 지급 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const issueTitleToSelectedStudents = async (title) => {
    if (!classId || !userData?.uid || !title) return;
    const eligibleUids = selectedStudentIssueUids.filter(canOperateOnStudentUid);
    if (!eligibleUids.length) {
      showFeedback("지급할 학생을 먼저 선택해 주세요.", "warning");
      return;
    }
    setSubmissionKey(`quick-title-issue-${title.id}`);
    try {
      const grantResults = await Promise.all(
        eligibleUids.map((uid) =>
          grantTitleToStudent({
            title,
            studentUid: uid,
            sourceType: "manual"
          }),
        ),
      );
      await refreshTeacherTitleOverview((summary) =>
        applyGrantResultsToTeacherSummary(summary, grantResults),
      );
      showFeedback(
        `${eligibleUids.length}명에게 ${title.name} 칭호를 지급했습니다.`,
        "success",
      );
      setTeacherTitleIssuePickerModalOpen(false);
      clearSelectedStudentIssues();
    } catch (error) {
      console.error("[CredentialsPage] quick title issue error:", error);
      showFeedback("칭호 지급 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const issueTitlesToSelectedStudents = async (titles) => {
    if (!classId || !userData?.uid) return;
    const nextTitles = Array.isArray(titles) ? titles.filter(Boolean) : [];
    if (!nextTitles.length) {
      showFeedback("지급할 칭호를 먼저 선택해 주세요.", "warning");
      return;
    }
    const eligibleUids = selectedStudentIssueUids.filter(canOperateOnStudentUid);
    if (!eligibleUids.length) {
      showFeedback("지급할 학생을 먼저 선택해 주세요.", "warning");
      return;
    }
    setSubmissionKey("quick-title-issue-bulk");
    try {
      const grantResults = await Promise.all(
        eligibleUids.flatMap((uid) =>
          nextTitles.map((title) =>
            grantTitleToStudent({
              title,
              studentUid: uid,
              sourceType: "manual",
            }),
          ),
        ),
      );
      await refreshTeacherTitleOverview((summary) =>
        applyGrantResultsToTeacherSummary(summary, grantResults),
      );
      showFeedback(
        `${eligibleUids.length}명에게 ${nextTitles.length}개의 칭호를 지급했습니다.`,
        "success",
      );
      setTeacherTitleIssuePickerModalOpen(false);
      clearSelectedStudentIssues();
    } catch (error) {
      console.error("[CredentialsPage] bulk title issue error:", error);
      showFeedback("칭호 일괄 지급 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const issueRequestedTitle = async (requestItem) => {
    if (!classId || !userData?.uid || !requestItem) return;
    const title = titleMap.get(requestItem.titleId);
    if (!title) {
      showFeedback("요청한 칭호 정의를 찾을 수 없습니다. 칭호 정의를 먼저 확인해 주세요.", "warning");
      return;
    }
    setSubmissionKey(`issue-requested-title-${requestItem.requestId}`);
    try {
      const grantResult = await grantTitleToStudent({
        title,
        studentUid: requestItem.studentUid,
        sourceType: "claim_request",
        sourceRefId: requestItem.requestId,
        requestItem
      });
      await refreshTeacherTitleOverview((summary) =>
        applyGrantResultsToTeacherSummary(summary, [grantResult]),
      );
      showFeedback(`${requestItem.studentName || "학생"}에게 ${requestItem.titleName || title.name} 칭호를 지급했습니다.`, "success");
      clearSelectedPendingRequests();
    } catch (error) {
      console.error("[CredentialsPage] issue requested title error:", error);
      showFeedback("요청한 칭호를 바로 지급하지 못했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const issueRequestedTitles = async (items) => {
    if (!classId || !userData?.uid) return;
    const nextItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!nextItems.length) return;
    const invalidRequest = nextItems.find((item) => !titleMap.get(item.titleId));
    if (invalidRequest) {
      showFeedback("요청한 칭호 정의 중 일부를 찾을 수 없습니다. 칭호 정의를 먼저 확인해 주세요.", "warning");
      return;
    }
    setSubmissionKey("issue-requested-title-bulk");
    try {
      const grantResults = await Promise.all(
        nextItems.map((requestItem) =>
          grantTitleToStudent({
            title: titleMap.get(requestItem.titleId),
            studentUid: requestItem.studentUid,
            sourceType: "claim_request",
            sourceRefId: requestItem.requestId,
            requestItem
          }),
        ),
      );
      await refreshTeacherTitleOverview((summary) =>
        applyGrantResultsToTeacherSummary(summary, grantResults),
      );
      showFeedback(`${nextItems.length}건의 요청 칭호를 바로 지급했습니다.`, "success");
      clearSelectedPendingRequests();
    } catch (error) {
      console.error("[CredentialsPage] issue requested titles error:", error);
      showFeedback("선택한 요청 칭호를 바로 지급하지 못했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const issueCertificate = async () => {
    if (!classId || !userData?.uid || !issuingCertificate || !canIssueCredentials) return;
    const eligibleUids = issueSelectedUids.filter(canOperateOnStudentUid);
    if (!eligibleUids.length) {
      showFeedback("발급할 학생을 선택해 주세요.", "warning");
      return;
    }
    const resolvedExpiresAt = issueExpiresAt
      ? new Date(`${issueExpiresAt}T23:59:59`)
      : null;
    if (issuingCertificate.expiresEnabled && !resolvedExpiresAt) {
      showFeedback("유효기간을 사용하는 자격증은 만료일을 입력해 주세요.", "warning");
      return;
    }
    setSubmissionKey("certificate-issue");
    try {
      const targetRecords = await Promise.all(
        eligibleUids.map(async (uid) => {
          const ownedRef = doc(
            db,
            "classes",
            classId,
            "students",
            uid,
            "ownedCertificates",
            issuingCertificate.id,
          );
          return {
            ownedRef,
            existingSnapshot: await getDoc(ownedRef),
          };
        }),
      );
      const batch = writeBatch(db);
      targetRecords.forEach(({ ownedRef, existingSnapshot }) => {
        const payload = {
          certificateId: issuingCertificate.id,
          certificateName: issuingCertificate.name || "",
          description: issuingCertificate.description || "",
          categoryId: issuingCertificate.categoryId || "",
          category: issuingCertificate.categoryLabel || issuingCertificate.category || "",
          gradeId: issuingCertificate.gradeId || issuingCertificate.level || defaultCertificateGradeId,
          acquisitionCondition: issuingCertificate.acquisitionCondition || "",
          templateId: issuingCertificate.templateId || "license",
          issueMethod: issuingCertificate.issueMethod || "manual",
          issuedAt: serverTimestamp(),
          issuedByUid: userData.uid,
          issuedByName: issuerName,
          isRevoked: false,
          revokedAt: null,
          expiresAt: issuingCertificate.expiresEnabled && resolvedExpiresAt ? resolvedExpiresAt : null,
          updatedAt: serverTimestamp()
        };
        if (existingSnapshot.exists()) {
          batch.set(ownedRef, payload, { merge: true });
        } else {
          batch.set(ownedRef, {
            ...payload,
            createdAt: serverTimestamp()
          });
        }
      });
      await batch.commit();
      showFeedback(`${issueSelectedUids.length}명에게 자격증을 발급했습니다.`, "success");
      closeIssueModal();
    } catch (error) {
      console.error("[CredentialsPage] issue certificate error:", error);
      showFeedback("자격증 발급 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const requestTitleClaim = async (entry) => {
    if (
      !classId ||
      !activeStudentUid ||
      !userData?.uid ||
      !canUseStudentSelfService
    ) {
      return;
    }
    if (!entry?.definitionId || !entry?.locked) return;
    if (entry?.allowStudentRequest === false) return;
    openTitleRequestModal(entry);
  };
  const submitTitleClaimRequest = async ({
    entry,
    requestMessage
  }) => {
    if (
      !classId ||
      !activeStudentUid ||
      !userData?.uid ||
      !canUseStudentSelfService
    ) {
      return;
    }
    if (!entry?.definitionId || !entry?.locked) return;
    const requestId = buildCredentialTitleRequestId(
      activeStudentUid,
      entry.definitionId,
    );
    const studentName =
      activeStudent?.name || activeStudent?.displayName || userData?.name || "학생";
    const studentNumber = activeStudent?.studentNumber || "";
    const titleDefinition = titleMap.get(entry.definitionId);
    setSubmissionKey(`request-title-${entry.definitionId}`);
    try {
      const requestCategoryMeta = getTitleCategoryMeta(
        titleCategories,
        titleDefinition?.categoryId || titleDefinition?.category || entry.categoryId || entry.category,
      );
      const requestRevealFields = buildResolvedTitleReveal(titleDefinition, entry);
      const payload = buildStudentTitleRequestPayload({
        studentUid: activeStudentUid,
        studentName,
        studentNumber,
        titleId: entry.definitionId,
        titleDefinition,
        entry,
        categoryMeta: requestCategoryMeta,
        revealFields: requestRevealFields,
        defaultTitleGradeId,
        requestMessage,
        timestamp: serverTimestamp(),
      });
      const batch = writeBatch(db);
      batch.set(doc(db, "classes", classId, "titleRequests", requestId), payload, {
        merge: true
      });
      batch.set(doc(db, "classes", classId, "students", activeStudentUid, "titleRequests", entry.definitionId), payload, {
        merge: true
      });
      await batch.commit();
      await refreshTeacherTitleOverview((summary) => {
        upsertTeacherSummaryPendingRequest(summary, {
          requestId,
          id: requestId,
          definitionDeleted: false,
          studentUid: activeStudentUid,
          studentName,
          studentNumber,
          titleId: entry.definitionId,
          titleName: titleDefinition?.name || "",
          acquisitionCondition:
            entry.acquisitionCondition ||
            titleDefinition?.acquisitionCondition ||
            "",
          status: "pending",
          requestMessage: String(requestMessage || "").trim(),
          reviewMessage: "",
          reviewedByUid: "",
          reviewedByName: "",
          category: requestCategoryMeta.label,
          gradeId:
            titleDefinition?.gradeId ||
            entry.gradeId ||
            entry.rarity ||
            defaultTitleGradeId,
          rarity: entry.rarity || titleDefinition?.rarity || "common",
          requestedAt: new Date(),
          reviewedAt: null,
          updatedAt: new Date(),
        });
        return summary;
      });
      showFeedback("교사에게 칭호 지급 요청을 보냈습니다.", "success");
      closeTitleRequestModal();
    } catch (error) {
      console.error("[CredentialsPage] request title claim error:", error);
      showFeedback("칭호 요청 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const setTitleCollectionVisibility = async (nextIsPublic) => {
    if (!classId || !userData?.uid || !canUseStudentSelfService) return false;
    setSubmissionKey("title-collection-visibility");
    try {
      await setDoc(
        doc(db, "classes", classId, "students", userData.uid),
        {
          titleCollectionVisibility: nextIsPublic ? "public" : "private",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      showFeedback(
        nextIsPublic
          ? "내 칭호 도감을 친구들이 볼 수 있게 했습니다."
          : "내 칭호 도감을 비공개로 전환했습니다.",
        "success",
      );
      return true;
    } catch (error) {
      console.error("[CredentialsPage] update title collection visibility error:", error);
      showFeedback("도감 공개 설정을 저장하지 못했습니다.", "error");
      return false;
    } finally {
      setSubmissionKey("");
    }
  };
  const setTitleCollectionEmblemStage = async (nextStage) => {
    if (!classId || !userData?.uid || !canUseStudentSelfService) return false;

    const normalizedStage = Math.round(Number(nextStage) || 0);
    if (
      normalizedStage < 1 ||
      normalizedStage > unlockedTitleCollectionEmblemStage
    ) {
      showFeedback("아직 해금하지 않은 엠블럼입니다.", "warning");
      return false;
    }

    setSubmissionKey("title-collection-emblem");
    try {
      await setDoc(
        doc(db, "classes", classId, "students", userData.uid),
        {
          titleCollectionEmblemStage: normalizedStage,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      showFeedback(`엠블럼 ${normalizedStage}번을 적용했습니다.`, "success");
      return true;
    } catch (error) {
      console.error("[CredentialsPage] update title collection emblem error:", error);
      showFeedback("엠블럼 선택을 저장하지 못했습니다.", "error");
      return false;
    } finally {
      setSubmissionKey("");
    }
  };
  const legacyEquipTitle = async (item) => {
    if (!classId || !activeStudentUid || !canManageRepresentativeTitles) return;
    const currentEquippedTitles = sortEquippedTitleRecords(activeResolvedOwnedTitles);
    const isAlreadyEquipped = currentEquippedTitles.some((ownedItem) => ownedItem.ownedId === item.ownedId);
    if (!isAlreadyEquipped && currentEquippedTitles.length >= MAX_REPRESENTATIVE_TITLES) {
      showFeedback(
        `대표 칭호는 최대 ${MAX_REPRESENTATIVE_TITLES}개까지 표시할 수 있습니다.`,
        "warning",
      );
      return;
    }
    setSubmissionKey(`equip-${item.ownedId}`);
    try {
      const nextEquippedTitles = isAlreadyEquipped ? currentEquippedTitles.filter((ownedItem) => ownedItem.ownedId !== item.ownedId) : [...currentEquippedTitles, item];
      const nextEquippedMap = new Map(nextEquippedTitles.map((ownedItem, index) => [ownedItem.ownedId, {
        equipped: true,
        equippedOrder: index + 1
      }]));
      const batch = writeBatch(db);
      activeResolvedOwnedTitles.forEach((ownedItem) => {
        const nextState = nextEquippedMap.get(ownedItem.ownedId) || null;
        batch.set(
          doc(
            db,
            "classes",
            classId,
            "students",
            activeStudentUid,
            "ownedTitles",
            ownedItem.ownedId,
          ),
          buildStudentOwnedTitlePreferencePatch({
            equipped: Boolean(nextState),
            equippedOrder: nextState?.equippedOrder,
            timestamp: serverTimestamp(),
          }),
          { merge: true },
        );
      });
      await batch.commit();
      showFeedback("대표 칭호를 등록했습니다.", "success");
    } catch (error) {
      console.error("[CredentialsPage] equip title error:", error);
      showFeedback("대표 칭호 등록 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  void legacyEquipTitle;
  const equipTitle = async (item) => {
    if (!classId || !activeStudentUid || !canManageRepresentativeTitles) return;
    const currentEquippedTitles = sortEquippedTitleRecords(activeResolvedOwnedTitles);
    const isAlreadyEquipped = currentEquippedTitles.some((ownedItem) => ownedItem.ownedId === item.ownedId);
    if (!isAlreadyEquipped && currentEquippedTitles.length >= MAX_REPRESENTATIVE_TITLES) {
      showFeedback(
        `대표 칭호는 최대 ${MAX_REPRESENTATIVE_TITLES}개까지 표시할 수 있습니다.`,
        "warning",
      );
      return;
    }
    setSubmissionKey(`equip-${item.ownedId}`);
    try {
      const nextEquippedTitles = isAlreadyEquipped ? currentEquippedTitles.filter((ownedItem) => ownedItem.ownedId !== item.ownedId) : [...currentEquippedTitles, item];
      const nextEquippedMap = new Map(nextEquippedTitles.map((ownedItem, index) => [ownedItem.ownedId, {
        equipped: true,
        equippedOrder: index + 1
      }]));
      const batch = writeBatch(db);
      activeResolvedOwnedTitles.forEach((ownedItem) => {
        const nextState = nextEquippedMap.get(ownedItem.ownedId) || null;
        batch.set(
          doc(
            db,
            "classes",
            classId,
            "students",
            activeStudentUid,
            "ownedTitles",
            ownedItem.ownedId,
          ),
          buildStudentOwnedTitlePreferencePatch({
            equipped: Boolean(nextState),
            equippedOrder: nextState?.equippedOrder,
            timestamp: serverTimestamp(),
          }),
          { merge: true },
        );
      });
      await batch.commit();
      await refreshTeacherTitleOverview((summary) => {
        applyTeacherSummaryOwnedTitleChange(summary, {
          studentUid: activeStudentUid,
          titleId: item.definitionId || item.titleId || item.id,
          titleName: item.name || item.titleName || "",
          ownedCountDelta: 0,
          nextEquippedTitleNames: nextEquippedTitles.map(
            (ownedItem) => ownedItem.name || ownedItem.titleName || "",
          ),
        });
        return summary;
      });
      showFeedback(
        isAlreadyEquipped
          ? "대표 칭호에서 제거했습니다."
          : `대표 칭호 ${nextEquippedTitles.length}번 슬롯에 추가했습니다.`,
        "success",
      );
    } catch (error) {
      console.error("[CredentialsPage] equip title error:", error);
      showFeedback("대표 칭호를 변경하는 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const updateRepresentativeTitles = async (items, mode = "set") => {
    if (!classId || !activeStudentUid || !canManageRepresentativeTitles) return;
    const nextItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!nextItems.length) {
      showFeedback("대표 명패로 반영할 칭호를 선택해 주세요.", "warning");
      return;
    }
    const selectedIds = new Set(nextItems.map((item) => item.ownedId).filter(Boolean));
    const currentEquippedTitles = sortEquippedTitleRecords(activeResolvedOwnedTitles);
    let nextEquippedTitles = [];

    if (mode === "unset") {
      nextEquippedTitles = currentEquippedTitles.filter(
        (ownedItem) => !selectedIds.has(ownedItem.ownedId),
      );
    } else {
      nextEquippedTitles = sortEquippedTitleRecords(activeResolvedOwnedTitles).filter(
        (ownedItem) => selectedIds.has(ownedItem.ownedId),
      );
    }

    if (nextEquippedTitles.length > MAX_REPRESENTATIVE_TITLES) {
      showFeedback(
        `대표 칭호는 최대 ${MAX_REPRESENTATIVE_TITLES}개까지 설정할 수 있습니다.`,
        "warning",
      );
      return;
    }

    setSubmissionKey(
      mode === "unset" ? "equip-selected-clear" : "equip-selected-set",
    );
    try {
      const nextEquippedMap = new Map(
        nextEquippedTitles.map((ownedItem, index) => [
          ownedItem.ownedId,
          { equipped: true, equippedOrder: index + 1 },
        ]),
      );
      const batch = writeBatch(db);
      activeResolvedOwnedTitles.forEach((ownedItem) => {
        const nextState = nextEquippedMap.get(ownedItem.ownedId) || null;
        batch.set(
          doc(
            db,
            "classes",
            classId,
            "students",
            activeStudentUid,
            "ownedTitles",
            ownedItem.ownedId,
          ),
          buildStudentOwnedTitlePreferencePatch({
            equipped: Boolean(nextState),
            equippedOrder: nextState?.equippedOrder,
            timestamp: serverTimestamp(),
          }),
          { merge: true },
        );
      });
      await batch.commit();
      await refreshTeacherTitleOverview((summary) => {
        applyTeacherSummaryOwnedTitleChange(summary, {
          studentUid: activeStudentUid,
          titleId: nextItems[0]?.definitionId || nextItems[0]?.titleId || nextItems[0]?.id,
          titleName: nextItems[0]?.name || nextItems[0]?.titleName || "",
          ownedCountDelta: 0,
          nextEquippedTitleNames: nextEquippedTitles.map(
            (ownedItem) => ownedItem.name || ownedItem.titleName || "",
          ),
        });
        return summary;
      });
      showFeedback(
        mode === "unset"
          ? "선택한 대표 명패를 해제했습니다."
          : `대표 명패 ${nextEquippedTitles.length}개를 설정했습니다.`,
        "success",
      );
    } catch (error) {
      console.error("[CredentialsPage] update representative titles error:", error);
      showFeedback("대표 명패를 변경하는 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const setNextTarget = async (item) => {
    if (!classId || !activeStudentUid || !canEquipTitle || !item?.definitionId || !item?.locked) {
      return;
    }
    setSubmissionKey(`next-target-${item.definitionId}`);
    try {
      await setDoc(
        doc(
          db,
          "classes",
          classId,
          "students",
          activeStudentUid,
          "titlePreferences",
          "selection",
        ),
        buildStudentTitlePreferencePayload({
          titleId: item.definitionId,
          timestamp: serverTimestamp(),
        }),
        { merge: true },
      );
      showFeedback("다음 목표 칭호를 설정했습니다.", "success");
    } catch (error) {
      console.error("[CredentialsPage] set next target error:", error);
      showFeedback("다음 목표를 설정하는 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const revokeTitle = async (item) => {
    if (!classId || !activeStudentUid || !canOperateOnActiveStudent) return;
    openTitleRevocationModal(item);
  };
  const submitTitleRevocation = async ({
    item,
    revokeReason
  }) => {
    if (!classId || !activeStudentUid || !canOperateOnActiveStudent || !item?.ownedId) return;
    const isRestore = Boolean(item.isRevoked);
    setSubmissionKey(`title-revoke-${item.ownedId}`);
    try {
      await updateDoc(doc(db, "classes", classId, "students", activeStudentUid, "ownedTitles", item.ownedId), {
        isRevoked: !isRestore,
        revokedAt: isRestore ? null : serverTimestamp(),
        revokedByUid: isRestore ? "" : userData.uid,
        revokedByName: isRestore ? "" : issuerName,
        revokeReason: isRestore ? "" : String(revokeReason || "").trim(),
        restoredAt: isRestore ? serverTimestamp() : null,
        restoredByUid: isRestore ? userData.uid : "",
        restoredByName: isRestore ? issuerName : "",
        equipped: isRestore ? Boolean(item.equipped) : false,
        equippedOrder: isRestore ? item.equippedOrder || null : null,
        updatedAt: serverTimestamp()
      });
      await refreshTeacherTitleOverview((summary) => {
        applyTeacherSummaryOwnedTitleChange(summary, {
          studentUid: activeStudentUid,
          titleId: item.definitionId || item.titleId,
          titleName: item.name || item.titleName || "",
          ownedCountDelta: isRestore ? 1 : -1,
          nextEquippedTitleNames: isRestore
            ? null
            : (ensureTeacherTitleSummaryStat(summary, activeStudentUid).equippedTitleNames || []).filter(
                (titleName) =>
                  String(titleName || "").trim() !==
                  String(item.name || item.titleName || "").trim(),
              ),
        });
        return summary;
      });
      showFeedback(isRestore ? "칭호를 복구했습니다." : "칭호를 회수했습니다.", "success");
      closeTitleRevocationModal();
    } catch (error) {
      console.error("[CredentialsPage] revoke title error:", error);
      showFeedback("칭호 상태 변경 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const revokeTitlesBulk = async (items) => {
    if (!classId || !activeStudentUid || !canOperateOnActiveStudent) return;
    const nextItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!nextItems.length) {
      showFeedback("회수할 칭호를 선택해 주세요.", "warning");
      return;
    }
    setSubmissionKey("title-revoke-bulk");
    try {
      const batch = writeBatch(db);
      nextItems.forEach((item) => {
        if (!item?.ownedId) return;
        batch.set(
          doc(db, "classes", classId, "students", activeStudentUid, "ownedTitles", item.ownedId),
          {
            isRevoked: true,
            revokedAt: serverTimestamp(),
            revokedByUid: userData.uid,
            revokedByName: issuerName,
            revokeReason: "",
            restoredAt: null,
            restoredByUid: "",
            restoredByName: "",
            equipped: false,
            equippedOrder: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
      await batch.commit();
      await refreshTeacherTitleOverview((summary) => {
        nextItems.forEach((ownedItem) => {
          applyTeacherSummaryOwnedTitleChange(summary, {
            studentUid: activeStudentUid,
            titleId: ownedItem.definitionId || ownedItem.titleId,
            titleName: ownedItem.name || ownedItem.titleName || "",
            ownedCountDelta: -1,
          });
        });
        return summary;
      });
      showFeedback(`${nextItems.length}개의 칭호를 회수했습니다.`, "success");
    } catch (error) {
      console.error("[CredentialsPage] bulk revoke title error:", error);
      showFeedback("칭호 일괄 회수 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const toggleCertificateRevocation = async (item) => {
    if (!classId || !activeStudentUid || !canOperateOnActiveStudent) return;
    const actionLabel = item.isRevoked ? "복구" : "회수";
    if (!(await appConfirm(`'${item.name}' 자격증을 ${actionLabel}할까요?`))) return;
    setSubmissionKey(`toggle-certificate-${item.ownedId}`);
    try {
      await updateDoc(doc(db, "classes", classId, "students", activeStudentUid, "ownedCertificates", item.ownedId), {
        isRevoked: !item.isRevoked,
        revokedAt: item.isRevoked ? null : serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showFeedback(
        item.isRevoked ? "자격증을 복구했습니다." : "자격증을 회수했습니다.",
        "success",
      );
    } catch (error) {
      console.error("[CredentialsPage] toggle certificate error:", error);
      showFeedback("자격증 상태 변경 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmissionKey("");
    }
  };
  const approveTitleRequest = async (requestItem) => {
    if (!requestItem) return;
    openTitleReviewModal("approve", [requestItem]);
  };
  const rejectTitleRequest = async (requestItem) => {
    if (!requestItem) return;
    openTitleReviewModal("reject", [requestItem]);
  };
  const submitTitleReview = async ({
    mode,
    items,
    reviewMessage
  }) => {
    if (!classId || !canReviewTitleRequests || !Array.isArray(items) || !items.length) return;
    if (items.some((item) => !canOperateOnStudentUid(item?.studentUid))) {
      showFeedback("자신의 칭호 요청은 직접 처리할 수 없습니다.", "warning");
      return;
    }
    const normalizedReviewMessage = String(reviewMessage || "").trim();
    const isApprove = mode === "approve";
    const submissionId = isApprove ? "approve-title-request-bulk" : "reject-title-request-bulk";
    if (!isApprove && !normalizedReviewMessage) {
      showFeedback("반려 사유를 입력해 주세요.", "warning");
      return;
    }
    if (isApprove) {
      const invalidRequest = items.find((item) => !titleMap.get(item.titleId));
      if (invalidRequest) {
        showFeedback(
          "정의가 없는 칭호 요청이 포함되어 있습니다. 먼저 칭호 정의를 확인해 주세요.",
          "warning",
        );
        return;
      }
    }
    setSubmissionKey(submissionId);
    try {
      if (isApprove) {
        const grantResults = await Promise.all(
          items.map((requestItem) =>
            grantTitleToStudent({
              title: titleMap.get(requestItem.titleId),
              studentUid: requestItem.studentUid,
              sourceType: "claim_request",
              sourceRefId: requestItem.requestId,
              requestItem,
              reviewMessage: normalizedReviewMessage
            }),
          ),
        );
        await refreshTeacherTitleOverview((summary) =>
          applyGrantResultsToTeacherSummary(summary, grantResults),
        );
      } else {
        await Promise.all(items.map(async (requestItem) => {
          const payload = {
            status: "rejected",
            approvedAt: null,
            rejectedAt: serverTimestamp(),
            reviewedAt: serverTimestamp(),
            reviewedByUid: userData.uid,
            reviewedByName: issuerName,
            reviewMessage: normalizedReviewMessage,
            updatedAt: serverTimestamp()
          };
          const batch = writeBatch(db);
          batch.set(doc(db, "classes", classId, "titleRequests", requestItem.requestId), payload, {
            merge: true
          });
          batch.set(doc(db, "classes", classId, "students", requestItem.studentUid, "titleRequests", requestItem.titleId), payload, {
            merge: true
          });
          await batch.commit();
        }));
        await refreshTeacherTitleOverview((summary) => {
          items.forEach((requestItem) => {
            markTeacherSummaryRequestReviewed(summary, {
              ...requestItem,
              id: requestItem.requestId,
              status: "rejected",
              approvedAt: null,
              rejectedAt: new Date(),
              reviewedAt: new Date(),
              reviewedByUid: userData.uid,
              reviewedByName: issuerName,
              reviewMessage: normalizedReviewMessage,
              updatedAt: new Date(),
            });
          });
          return summary;
        });
      }
      showFeedback(
        isApprove
          ? `${items.length}건의 칭호 요청을 승인했습니다.`
          : `${items.length}건의 칭호 요청을 반려했습니다.`,
        "success",
      );
      clearSelectedPendingRequests();
      closeTitleReviewModal();
    } catch (error) {
      console.error(isApprove ? "[CredentialsPage] approve title request error:" : "[CredentialsPage] reject title request error:", error);
      showFeedback(
        isApprove
          ? "칭호 요청 승인 중 오류가 발생했습니다."
          : "칭호 요청 반려 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setSubmissionKey("");
    }
  };
  const saveGradeSettings = async ({
    titleGrades: nextTitleGrades,
    titleCategories: nextTitleCategories = titleCategories,
    titleCollectionStages: nextTitleCollectionStages = titleCollectionStages,
    certificateGrades: nextCertificateGrades,
    certificateCategories: nextCertificateCategories = certificateCategories
  }) => {
    if (!canManageCredentialSettings) {
      showFeedback("등급·카테고리 설정은 선생님만 변경할 수 있습니다.", "error");
      return false;
    }
    if (!classId || !userData?.uid) {
      showFeedback("학급 또는 사용자 정보를 찾을 수 없습니다.", "error");
      return false;
    }
    setSubmissionKey("grade-settings");
    try {
      const normalizedNextTitleCategories = normalizeTitleCategoryList(
        nextTitleCategories.filter((item) => !item?.isFallback),
      );
      const normalizedCurrentTitleCategories = normalizeTitleCategoryList(
        titleCategories,
        titleDefinitions.map((item) => item?.category),
      );
      const normalizedNextCertificateCategories = normalizeTitleCategoryList(
        nextCertificateCategories.filter((item) => !item?.isFallback),
      );
      const normalizedCurrentCertificateCategories = normalizeTitleCategoryList(
        certificateCategories,
        certificateDefinitions.map((item) => item?.category),
      );
      const nextCategoryById = new Map(
        normalizedNextTitleCategories.map((item) => [item.id, item]),
      );
      const nextCertificateCategoryById = new Map(
        normalizedNextCertificateCategories.map((item) => [item.id, item]),
      );
      const normalizedNextCertificateStages = normalizeCertificateStageList(
        nextCertificateGrades ?? certificateGrades,
      );
      const nextCertificateStageIds = new Set(
        normalizedNextCertificateStages.map((item) => item.id),
      );
      await setDoc(doc(db, "classes", classId, "settings", "credentials"), {
        titleGrades: normalizeGradeList(nextTitleGrades || titleGrades, DEFAULT_TITLE_GRADES),
        certificateGrades: normalizedNextCertificateStages,
        titleCategories: normalizedNextTitleCategories,
        certificateCategories: normalizedNextCertificateCategories,
        titleCollectionStages: (nextTitleCollectionStages || []).map((item, index) => ({
          id: item?.id || `stage-${index + 1}`,
          label: String(item?.label || "").trim() || `도감 단계 ${index + 1}`,
          minRate: Math.max(0, Math.min(100, Number(item?.minRate ?? item?.threshold ?? 0) || 0)),
          tone: item?.tone || "slate",
          accentColor: normalizeTitleCollectionStageAccentColor(
            item?.accentColor || item?.color,
          ),
          emblemStage: Math.max(
            0,
            Math.min(12, Math.round(Number(item?.emblemStage ?? item?.visualStage) || 0)),
          ) || null,
          order: Number(item?.order) || index + 1
        })),
        updatedAt: serverTimestamp(),
        updatedByUid: userData.uid,
        updatedByName: issuerName
      }, {
        merge: true
      });
      showFeedback("칭호 등급과 자격증 단계 설정을 저장했습니다.", "success");
      const titleCategorySyncOperations = titleDefinitions
        .filter((item) => !item?.isDeleted)
        .map((item) => {
          const currentCategoryMeta = getTitleCategoryMeta(
            normalizedCurrentTitleCategories,
            item?.categoryId || item?.category,
          );
          const nextCategoryMeta = nextCategoryById.get(currentCategoryMeta.id);

          if (!nextCategoryMeta) return null;

          if (
            String(item?.categoryId || "").trim() === nextCategoryMeta.id &&
            String(item?.category || "").trim() === nextCategoryMeta.label
          ) {
            return null;
          }

          return {
            type: "update",
            ref: doc(db, "classes", classId, "titles", item.id),
            data: {
              categoryId: nextCategoryMeta.id,
              category: nextCategoryMeta.label,
              updatedAt: serverTimestamp(),
              updatedByUid: userData.uid,
              updatedByName: issuerName,
            },
          };
        })
        .filter(Boolean);

      const certificateCategorySyncOperations = certificateDefinitions
        .filter((item) => !item?.isDeleted)
        .map((item) => {
          const currentCategoryMeta = getTitleCategoryMeta(
            normalizedCurrentCertificateCategories,
            item?.categoryId || item?.category,
          );
          const nextCategoryMeta = nextCertificateCategoryById.get(currentCategoryMeta.id);

          if (!nextCategoryMeta) return null;

          if (
            String(item?.categoryId || "").trim() === nextCategoryMeta.id &&
            String(item?.category || "").trim() === nextCategoryMeta.label
          ) {
            return null;
          }

          return {
            type: "update",
            ref: doc(db, "classes", classId, "certificates", item.id),
            data: {
              categoryId: nextCategoryMeta.id,
              category: nextCategoryMeta.label,
              updatedAt: serverTimestamp(),
              updatedByUid: userData.uid,
              updatedByName: issuerName,
            },
          };
        })
        .filter(Boolean);

      const certificateStageSyncOperations = certificateDefinitions
        .filter((item) => !item?.isDeleted)
        .map((item) => {
          const currentStageId = String(item?.gradeId || item?.level || "").trim();
          if (
            !currentStageId ||
            currentStageId === CERTIFICATE_NO_STAGE_ID ||
            nextCertificateStageIds.has(currentStageId)
          ) {
            return null;
          }

          return {
            type: "update",
            ref: doc(db, "classes", classId, "certificates", item.id),
            data: {
              gradeId: CERTIFICATE_NO_STAGE_ID,
              level: CERTIFICATE_NO_STAGE_ID,
              updatedAt: serverTimestamp(),
              updatedByUid: userData.uid,
              updatedByName: issuerName,
            },
          };
        })
        .filter(Boolean);

      const categorySyncOperations = [
        ...titleCategorySyncOperations,
        ...certificateCategorySyncOperations,
        ...certificateStageSyncOperations,
      ];

      if (categorySyncOperations.length) {
        await commitWriteOperations(categorySyncOperations);
      }
      setGradeSettingsModalOpen(false);
      return true;
    } catch (error) {
      console.error("[CredentialsPage] save grade settings error:", error);
      showFeedback("등급·단계 설정 저장 중 오류가 발생했습니다.", "error");
      return false;
    } finally {
      setSubmissionKey("");
    }
  };
  return {
    classId,
    canManageCredentials,
    canOperateCredentials,
    canEditCredentialDefinitions,
    canDeleteCredentialDefinitions,
    canManageCredentialSettings,
    canIssueCredentials,
    canReviewTitleRequests,
    roster,
    issuableRoster,
    activeTab,
    setActiveTab,
    previewMode,
    setPreviewMode,
    titleRequests,
    titleLoading,
    certificateLoading,
    ownedTitlesLoading,
    teacherTitleSummaryLoading,
    ownedCertificatesLoading,
    teacherCertificateOverviewLoading,
    titleRequestsLoading,
    credentialSettingsLoading,
    ownedTitleCountByDefinition,
    requestCountByDefinition,
    selectedPendingRequestIds,
    selectedStudentIssueUids,
    teacherTitleDetailModalOpen,
    teacherCertificateDetailModalOpen,
    teacherTitleIssuePickerModalOpen,
    titleCatalogModalOpen,
    setTitleCatalogModalOpen,
    titleModalOpen,
    setTitleModalOpen,
    certificateModalOpen,
    setCertificateModalOpen,
    gradeSettingsModalOpen,
    setGradeSettingsModalOpen,
    editingTitle,
    setEditingTitle,
    editingCertificate,
    setEditingCertificate,
    requestingTitleEntry,
    titleReviewModalState,
    titleRevocationModalItem,
    issuingTitle,
    issuingCertificate,
    issueSelectedUids,
    setIssueSelectedUids,
    issueSourceType,
    setIssueSourceType,
    issueSourceRefId,
    setIssueSourceRefId,
    issueExpiresAt,
    setIssueExpiresAt,
    submissionKey,
    studentDexSearch,
    setStudentDexSearch,
    studentDexFilter,
    setStudentDexFilter,
    studentDexCategoryFilter,
    setStudentDexCategoryFilter,
    studentCertificateCategoryFilter,
    setStudentCertificateCategoryFilter,
    teacherIssueCategoryFilter,
    setTeacherIssueCategoryFilter,
    titleGrades,
    titleCategories,
    certificateCategories,
    certificateGrades,
    titleGradeOptions,
    certificateGradeOptions,
    resolvedTitleDefinitions,
    resolvedCertificateDefinitions,
    resolvedOwnedCertificates,
    lockedCertificates,
    activeStudentLabel,
    canUseStudentSelfService,
    canEquipTitle,
    canManageRepresentativeTitles,
    canOperateOnActiveStudent,
    isTitleCollectionPublic,
    representativeCount,
    equippedTitles,
    selectedNextTargetId,
    titleHeroItem: titleHeroItemResolved,
    titleHeroTheme: titleHeroThemeResolved,
    titleHeroRevealMeta: titleHeroRevealMetaResolved,
    studentTitleRequestMap,
    resolvedTitleRequests,
    selectedStudentPendingRequests,
    selectedStudentReviewedRequests,
    selectedPendingRequestItems,
    selectedStudentActiveOwnedTitles,
    selectedStudentRevokedOwnedTitles,
    studentTitleOverviewRows,
    studentCertificateOverviewRows,
    selectedStudentIssueList,
    titleDexEntries,
    activeOwnedCertificates,
    filteredActiveOwnedCertificates,
    filteredLockedCertificates,
    expiredCertificateCount,
    titleCollectionTotal,
    certificateCollectionTotal,
    studentDexTotal,
    studentDexOwnedCount,
    studentDexLockedCount,
    titleCollectionRate,
    titleCollectionStages,
    titleCollectionStage,
    unlockedTitleCollectionEmblemStage,
    selectedTitleCollectionEmblemStage,
    nextTitleCollectionStage,
    titlesUntilNextStage,
    latestOwnedTitle,
    nextTargetTitle,
    requestableDexCount,
    studentDexCategoryItems,
    studentCertificateCategoryItems,
    teacherCertificateCategoryItems,
    teacherIssueCategoryItems,
    filteredTitleDexEntries,
    teacherIssueItems,
    refreshTeacherTitleOverview,
    openTitleCatalogCreate,
    openTitleCatalogEdit,
    closeTitleRequestModal,
    openTitleReviewModal,
    closeTitleReviewModal,
    clearSelectedPendingRequests,
    clearSelectedStudentIssues,
    setStudentIssueSelection,
    toggleAllStudentIssueSelection,
    handleStudentIssueSelectionMouseDown,
    handleStudentIssueSelectionMouseEnter,
    openTeacherTitleIssuePicker,
    closeTeacherTitleIssuePicker,
    openTeacherTitleDetailModal,
    closeTeacherTitleDetailModal,
    openTeacherCertificateDetailModal,
    closeTeacherCertificateDetailModal,
    togglePendingRequestSelection,
    toggleAllPendingRequests,
    closeTitleRevocationModal,
    openCertificateIssue,
    closeIssueModal,
    saveDefinition,
    issueTitle,
    issueTitleToSelectedStudents,
    issueTitlesToSelectedStudents,
    issueRequestedTitle,
    issueRequestedTitles,
    issueCertificate,
    requestTitleClaim,
    submitTitleClaimRequest,
    setTitleCollectionVisibility,
    setTitleCollectionEmblemStage,
    equipTitle,
    updateRepresentativeTitles,
    setNextTarget,
    revokeTitle,
    revokeTitlesBulk,
    submitTitleRevocation,
    toggleCertificateRevocation,
    approveTitleRequest,
    rejectTitleRequest,
    submitTitleReview,
    saveGradeSettings
  };
}
