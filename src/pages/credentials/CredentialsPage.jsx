import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Send } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Alert, BulkActionFloatingBar, PageHeader, Tabs } from "../../components/ui";
import IssueModal from "./components/IssueModal";
import TeacherTitleIssuePickerModal from "./components/TeacherTitleIssuePickerModal";
import TitleClaimRequestModal from "./components/TitleClaimRequestModal";
import DefinitionModal from "./components/DefinitionModal";
import GradeSettingsModal from "./components/GradeSettingsModal";
import CertificateGradeSettingsModal from "./components/CertificateGradeSettingsModal";
import TitleRequestReviewModal from "./components/TitleRequestReviewModal";
import TitleRevocationModal from "./components/TitleRevocationModal";
import TeacherTitleRequestManagerModal from "./components/TeacherTitleRequestManagerModal";
import TeacherTitleStudentDetailModal from "./components/TeacherTitleStudentDetailModal";
import CertificateDetailModal from "./components/CertificateDetailModal";
import CertificateDefinitionCatalogModal from "./components/CertificateDefinitionCatalogModal";
import StudentTitleCollectionBrowseModal from "./components/StudentTitleCollectionBrowseModal";
import TeacherCertificateStudentDetailModal from "./components/TeacherCertificateStudentDetailModal";
import TitleCredentialsView from "./views/TitleCredentialsView";
import CertificateCredentialsView from "./views/CertificateCredentialsView";
import { buildCertificateStatus, formatDate, formatDexNumber, getTitleRequestStatusMeta, getTitleRevealMeta, getTitleSurfaceTheme, PREVIEW_MODE_TABS, TAB_ITEMS, titleSourceLabelMap, toMillis } from "./CredentialsPage.parts";
import { useCredentialsPageController } from "./useCredentialsPageController";
import { useUser } from "../../contexts/UserContext";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import { resolveCertificateClassName } from "./certificateAppearance";
import { usePublicTitleCollectionSummaries } from "./usePublicTitleCollectionSummaries";

const TITLE_VIEW_IDS = {
  student: new Set(["myDex", "friendDex"]),
  teacher: new Set(["overview", "management"]),
};

function getTitleViewStorageKey(viewerType, classId, uid) {
  return `finclass:credentials:title-view:${viewerType}:${classId || "default"}:${uid || "default"}`;
}

function readStoredTitleView(viewerType, classId, uid) {
  const fallback = viewerType === "teacher" ? "overview" : "myDex";
  if (typeof window === "undefined") return fallback;

  try {
    const storedView = window.localStorage.getItem(
      getTitleViewStorageKey(viewerType, classId, uid),
    );
    return TITLE_VIEW_IDS[viewerType]?.has(storedView) ? storedView : fallback;
  } catch {
    return fallback;
  }
}

export default function CredentialsPage() {
  const [certificateGradeSettingsModalOpen, setCertificateGradeSettingsModalOpen] = useState(false);
  const [certificateCatalogModalOpen, setCertificateCatalogModalOpen] = useState(false);
  const [teacherTitleRequestManagerOpen, setTeacherTitleRequestManagerOpen] = useState(false);
  const [teacherCertificateCategoryFilter, setTeacherCertificateCategoryFilter] = useState("all");
  const [certificateDetailState, setCertificateDetailState] = useState(null);
  const [browseStudentUid, setBrowseStudentUid] = useState("");
  const [studentTitleView, setStudentTitleViewState] = useState("myDex");
  const [teacherTitleView, setTeacherTitleViewState] = useState("overview");
  const [teacherCertificateView, setTeacherCertificateView] = useState("overview");
  const { userData, classData } = useUser();
  const {
    classId,
    canManageCredentials: hasCredentialManagerAccess,
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
    selectedStudentIssueUids,
    teacherTitleDetailModalOpen,
    teacherCertificateDetailModalOpen,
    teacherTitleIssuePickerModalOpen,
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
    teacherIssueCategoryFilter,
    setTeacherIssueCategoryFilter,
    titleGrades,
    titleCategories,
    titleCollectionStages,
    certificateCategories,
    certificateGrades,
    titleGradeOptions,
    certificateGradeOptions,
    resolvedTitleDefinitions,
    resolvedCertificateDefinitions: allCertificateDefinitions,
    resolvedOwnedCertificates,
    activeStudentLabel,
    canUseStudentSelfService,
    canManageRepresentativeTitles,
    canOperateOnActiveStudent,
    isTitleCollectionPublic,
    representativeCount,
    equippedTitles,
    selectedNextTargetId,
    titleHeroItem,
    studentTitleRequestMap,
    resolvedTitleRequests,
    selectedStudentActiveOwnedTitles,
    selectedStudentRevokedOwnedTitles,
    studentTitleOverviewRows,
    studentCertificateOverviewRows,
    selectedStudentIssueList,
    filteredActiveOwnedCertificates,
    filteredLockedCertificates,
    expiredCertificateCount,
    titleCollectionTotal,
    studentDexTotal,
    studentDexOwnedCount,
    studentDexLockedCount,
    titleCollectionRate,
    titleCollectionStage,
    unlockedTitleCollectionEmblemStage,
    selectedTitleCollectionEmblemStage,
    nextTitleCollectionStage,
    titlesUntilNextStage,
    nextTargetTitle,
    studentDexCategoryItems,
    studentCertificateCategoryFilter,
    setStudentCertificateCategoryFilter,
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
    clearSelectedStudentIssues,
    setStudentIssueSelection,
    handleStudentIssueSelectionMouseDown,
    handleStudentIssueSelectionMouseEnter,
    toggleAllStudentIssueSelection,
    openTeacherTitleIssuePicker,
    closeTeacherTitleIssuePicker,
    openTeacherTitleDetailModal,
    closeTeacherTitleDetailModal,
    openTeacherCertificateDetailModal,
    closeTeacherCertificateDetailModal,
    closeTitleRevocationModal,
    openCertificateIssue,
    closeIssueModal,
    saveDefinition,
    issueTitle,
    issueTitleToSelectedStudents,
    issueTitlesToSelectedStudents,
    issueCertificate,
    requestTitleClaim,
    submitTitleClaimRequest,
    setTitleCollectionVisibility,
    setTitleCollectionEmblemStage,
    equipTitle,
    updateRepresentativeTitles,
    setNextTarget,
    revokeTitle,
    deleteRevokedTitleRecord,
    revokeTitlesBulk,
    deleteRevokedTitleRecordsBulk,
    submitTitleRevocation,
    toggleCertificateRevocation,
    approveTitleRequest,
    rejectTitleRequest,
    submitTitleReview,
    saveGradeSettings,
  } = useCredentialsPageController();

  const studentTitleViewStorageKey = getTitleViewStorageKey(
    "student",
    classId,
    userData?.uid,
  );
  const teacherTitleViewStorageKey = getTitleViewStorageKey(
    "teacher",
    classId,
    userData?.uid,
  );
  const setStudentTitleView = useCallback(
    (nextView) => {
      const resolvedView = TITLE_VIEW_IDS.student.has(nextView) ? nextView : "myDex";
      setStudentTitleViewState(resolvedView);
      try {
        window.localStorage.setItem(studentTitleViewStorageKey, resolvedView);
      } catch {
        // Keeping the in-page selection is sufficient when storage is unavailable.
      }
    },
    [studentTitleViewStorageKey],
  );
  const setTeacherTitleView = useCallback(
    (nextView) => {
      const resolvedView = TITLE_VIEW_IDS.teacher.has(nextView) ? nextView : "overview";
      setTeacherTitleViewState(resolvedView);
      try {
        window.localStorage.setItem(teacherTitleViewStorageKey, resolvedView);
      } catch {
        // Keeping the in-page selection is sufficient when storage is unavailable.
      }
    },
    [teacherTitleViewStorageKey],
  );

  const canManageCredentials =
    hasCredentialManagerAccess &&
    !(previewMode === "student" && canUseStudentSelfService);
  useEffect(() => {
    setStudentTitleViewState(readStoredTitleView("student", classId, userData?.uid));
    setTeacherTitleViewState(readStoredTitleView("teacher", classId, userData?.uid));
  }, [classId, userData?.uid]);
  const headerRightSlot = hasCredentialManagerAccess ? (
    <div className="w-full max-w-[260px]">
      <Tabs ariaLabel="칭호·자격증 화면 대상" idPrefix="credential-audience" tabs={PREVIEW_MODE_TABS} activeTab={previewMode} onTabChange={setPreviewMode} variant="pills" size="sm" fullWidth className="w-full" />
    </div>
  ) : null;
  const allPendingTitleRequests = useMemo(
    () =>
      resolvedTitleRequests
        .filter((item) => (item.status || "pending") === "pending")
        .sort((a, b) => toMillis(b.requestedAt) - toMillis(a.requestedAt)),
    [resolvedTitleRequests],
  );
  useEffect(() => {
    if (!hasCredentialManagerAccess) {
      setTeacherTitleViewState("overview");
    }
  }, [hasCredentialManagerAccess]);
  useEffect(() => {
    if (canEditCredentialDefinitions && !canOperateCredentials) {
      setTeacherTitleViewState("management");
      return;
    }
    if (!canEditCredentialDefinitions && teacherTitleView !== "overview") {
      setTeacherTitleViewState("overview");
    }
  }, [canEditCredentialDefinitions, canOperateCredentials, teacherTitleView]);
  const recentReviewedTitleRequests = useMemo(
    () =>
      resolvedTitleRequests
        .filter((item) => (item.status || "pending") !== "pending")
        .sort(
          (a, b) =>
            toMillis(b.reviewedAt || b.updatedAt) -
            toMillis(a.reviewedAt || a.updatedAt),
        ),
    [resolvedTitleRequests],
  );
  const { data: classmateRoster = [], isLoading: classmateRosterLoading } =
    useClassStudents(classId, {
      enabled:
        !!classId &&
        activeTab === "titles" &&
        (previewMode === "student" || !canManageCredentials),
    });
  const publicBrowseableStudents = useMemo(
    () =>
      classmateRoster
        .filter((student) => student?.uid && student.uid !== userData?.uid)
        .filter(
          (student) =>
            String(student?.titleCollectionVisibility || "public").trim() !==
            "private",
        ),
    [classmateRoster, userData?.uid],
  );
  const {
    data: publicTitleCollectionCounts = {},
    isLoading: publicTitleCollectionCountsLoading,
  } = usePublicTitleCollectionSummaries(classId, publicBrowseableStudents, {
    enabled:
      activeTab === "titles" &&
      (previewMode === "student" || !canManageCredentials) &&
      studentTitleView === "friendDex",
  });
  const publicTitleCollectionTotal = useMemo(
    () =>
      resolvedTitleDefinitions.filter((definition) => definition?.isDeleted !== true)
        .length,
    [resolvedTitleDefinitions],
  );
  const browseableStudents = useMemo(
    () =>
      publicBrowseableStudents.map((student) => {
        const fetchedOwnedCount = publicTitleCollectionCounts[student.uid];
        const ownedCount = Math.max(
          0,
          Math.min(
            publicTitleCollectionTotal,
            fetchedOwnedCount == null
              ? Number(student?.dexOwnedCount || 0)
              : Number(fetchedOwnedCount || 0),
          ),
        );
        const rate = publicTitleCollectionTotal
          ? Math.round((ownedCount / publicTitleCollectionTotal) * 100)
          : 0;
        const stage = [...titleCollectionStages]
          .reverse()
          .find((item) => rate >= Number(item.minRate || 0)) || {
          label: "첫 발견",
          tone: "slate",
        };

        return {
          ...student,
          dexOwnedCount: ownedCount,
          dexTotal: publicTitleCollectionTotal,
          titleCollectionRate: rate,
          titleCollectionStageLabel: stage.label,
          titleCollectionStageTone: stage.tone,
          titleCollectionStageColor: stage.accentColor || "",
        };
      }),
    [
      publicBrowseableStudents,
      publicTitleCollectionCounts,
      titleCollectionStages,
      publicTitleCollectionTotal,
    ],
  );
  const selectedBrowseStudent = useMemo(
    () =>
      browseableStudents.find((student) => student.uid === browseStudentUid) ||
      null,
    [browseStudentUid, browseableStudents],
  );
  const titleDefinitionMap = useMemo(
    () =>
      new Map(
        resolvedTitleDefinitions
          .filter((item) => item?.id)
          .map((item) => [String(item.id), item]),
      ),
    [resolvedTitleDefinitions],
  );
  const handleEditTitleDefinitionFromDexEntry = (entry) => {
    const definitionId = String(entry?.definitionId || entry?.id || "").trim();
    if (!definitionId) return;

    const targetDefinition = titleDefinitionMap.get(definitionId);
    if (!targetDefinition) return;

    openTitleCatalogEdit(targetDefinition);
  };
  useEffect(() => {
    if (
      teacherCertificateCategoryFilter !== "all" &&
      !allCertificateDefinitions.some(
        (item) =>
          String(item.categoryId || "") === teacherCertificateCategoryFilter,
      )
    ) {
      setTeacherCertificateCategoryFilter("all");
    }
  }, [allCertificateDefinitions, teacherCertificateCategoryFilter]);
  useEffect(() => {
    if (canEditCredentialDefinitions && !canOperateCredentials) {
      setTeacherCertificateView("management");
      return;
    }
    if (!canEditCredentialDefinitions && teacherCertificateView !== "overview") {
      setTeacherCertificateView("overview");
    }
  }, [canEditCredentialDefinitions, canOperateCredentials, teacherCertificateView]);

  if (!classId) {
    return (
      <AppLayout title={"\uCE6D\uD638 \uC790\uACA9\uC99D"} showSidebar={true} showDefaultHeader={false}>
        <div className="mx-auto w-full max-w-5xl">
        {canOperateCredentials && !roster.length ? <Alert type="warning" message="\uD559\uC0DD \uBA85\uB2E8\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4." /> : null}
        </div>
      </AppLayout>
    );
  }

  const titleIssueSubmitting = submissionKey === "title-issue";
  const certificateIssueSubmitting = submissionKey === "certificate-issue";
  const titleDefinitionSubmitting = submissionKey === "title-definition";
  const certificateDefinitionSubmitting = submissionKey === "certificate-definition";
  const gradeSettingsSubmitting = submissionKey === "grade-settings";
  const titleCategoryOptions = Array.from(
    new Map(
      [
        ...titleCategories.map((category) => ({
          value: category.id,
          label: category.label,
          iconKey: category.iconKey,
          colorKey: category.colorKey,
        })),
        ...resolvedTitleDefinitions.map((item) => ({
          value: item.categoryId,
          label: item.categoryLabel || item.category,
          iconKey: item.categoryIconKey,
          colorKey: item.categoryColorKey,
        })),
      ]
        .filter((item) => item.value && item.label)
      .map((item) => [item.value, item]),
    ).values(),
  );
  const certificateCategoryOptions = Array.from(
    new Map(
      [
        ...certificateCategories.map((category) => ({
          value: category.id,
          label: category.label,
          iconKey: category.iconKey,
          colorKey: category.colorKey,
        })),
        ...allCertificateDefinitions.map((item) => ({
          value: item.categoryId,
          label: item.categoryLabel || item.category,
          iconKey: item.categoryIconKey,
          colorKey: item.categoryColorKey,
        })),
      ]
        .filter((item) => item.value && item.label)
      .map((item) => [item.value, item]),
    ).values(),
  );
  const filteredCertificateDefinitions = allCertificateDefinitions.filter(
    (item) =>
      teacherCertificateCategoryFilter === "all"
        ? true
        : String(item.categoryId || "") === teacherCertificateCategoryFilter,
  );
  const resolvedCertificateDefinitions = filteredCertificateDefinitions;
  const classDisplayName = resolveCertificateClassName(classData, classId);
  const openCertificateDetailModal = (item, options = {}) => {
    if (!item) return;
    setCertificateDetailState({
      item,
      locked: Boolean(options.locked),
    });
  };
  const closeCertificateDetailModal = () => setCertificateDetailState(null);
  return (
    <AppLayout title={"\uCE6D\uD638 \uC790\uACA9\uC99D"} showSidebar={true} showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader title={"\uCE6D\uD638 \uC790\uACA9\uC99D"} subtitle={"\uCE6D\uD638\uC640 \uC790\uACA9\uC99D \uD604\uD669\uC744 \uD655\uC778\uD558\uACE0 \uAD00\uB9AC\uD569\uB2C8\uB2E4."} icon={Award} rightSlot={headerRightSlot} />
        {canOperateCredentials && !roster.length ? <Alert type="warning" message={"\uD559\uC0DD \uBA85\uB2E8\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4."} /> : null}
        <div className="max-w-xl">
          <Tabs ariaLabel="칭호·자격증 업무" idPrefix="credential-section" tabs={TAB_ITEMS} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="md" fullWidth className="w-full" />
        </div>

        {activeTab === "titles" ? (
          <TitleCredentialsView
            model={{
              previewMode,
              canManageCredentials,
              canOperateCredentials,
              canUseStudentSelfService,
              canEditCredentialDefinitions,
              canDeleteCredentialDefinitions,
              canManageCredentialSettings,
              canManageRepresentativeTitles,
              equipTitle,
              formatDexNumber,
              getTitleRequestStatusMeta,
              getTitleRevealMeta,
              getTitleSurfaceTheme,
              handleEditTitleDefinitionFromDexEntry,
              manualSourceLabel: titleSourceLabelMap.manual,
              requestTitleClaim,
              representativeCount,
              representativeTitles: equippedTitles,
              selectedNextTargetId,
              setNextTarget,
              submissionKey,
              canReviewTitleRequests,
              credentialSettingsLoading,
              handleStudentIssueSelectionMouseDown,
              handleStudentIssueSelectionMouseEnter,
              onEditTitle: openTitleCatalogEdit,
              onOpenTitleCreate: openTitleCatalogCreate,
              onRebuildTeacherSummary: refreshTeacherTitleOverview,
              onSelectStudent: openTeacherTitleDetailModal,
              onSetGradeSettingsOpen: setGradeSettingsModalOpen,
              onSetRequestManagerOpen: setTeacherTitleRequestManagerOpen,
              ownedTitleCountByDefinition,
              requestCountByDefinition,
              resolvedTitleDefinitions,
              selectedStudentIssueUids,
              setStudentIssueSelection,
              setTeacherTitleView,
              studentTitleOverviewRows,
              teacherTitleSummaryLoading,
              teacherTitleView,
              titleCategoryOptions,
              titleGrades,
              titleLoading,
              titleRequestsLoading,
              toggleAllStudentIssueSelection,
              studentTitleView,
              setStudentTitleView,
              studentDexSearch,
              setStudentDexSearch,
              studentDexFilter,
              setStudentDexFilter,
              studentDexCategoryFilter,
              setStudentDexCategoryFilter,
              studentDexCategoryItems,
              studentDexTotal,
              studentDexOwnedCount,
              studentDexLockedCount,
              titleCollectionTotal,
              titleCollectionRate,
              titleCollectionStage,
              titleCollectionStages,
              unlockedTitleCollectionEmblemStage,
              selectedTitleCollectionEmblemStage,
              nextTitleCollectionStage,
              titlesUntilNextStage,
              nextTargetTitle,
              titleHeroItem,
              isTitleCollectionPublic,
              setTitleCollectionVisibility,
              setTitleCollectionEmblemStage,
              filteredTitleDexEntries,
              browseableStudents,
              browseableStudentsLoading:
                classmateRosterLoading || publicTitleCollectionCountsLoading,
              onBrowseStudent: setBrowseStudentUid,
            }}
          />
        ) : null}

        {activeTab === "certificates" ? (
          <CertificateCredentialsView
            model={{
              previewMode,
              canManageCredentials,
              canOperateCredentials,
              canEditCredentialDefinitions,
              canDeleteCredentialDefinitions,
              canIssueCredentials,
              activeStudentLabel,
              classDisplayName,
              classId,
              certificateLoading,
              ownedCertificatesLoading,
              teacherCertificateOverviewLoading,
              teacherCertificateView,
              setTeacherCertificateView,
              studentCertificateOverviewRows,
              openTeacherCertificateDetailModal,
              resolvedCertificateDefinitions,
              resolvedOwnedCertificates,
              setCertificateCatalogModalOpen,
              teacherCertificateCategoryFilter,
              setTeacherCertificateCategoryFilter,
              teacherCertificateCategoryItems,
              setCertificateGradeSettingsModalOpen,
              canManageCredentialSettings,
              setCertificateModalOpen,
              setEditingCertificate,
              openCertificateIssue,
              toggleCertificateRevocation,
              activeOwnedCertificates: filteredActiveOwnedCertificates,
              expiredCertificateCount,
              formatDate,
              lockedCertificates: filteredLockedCertificates,
              openCertificateDetailModal,
              setStudentCertificateCategoryFilter,
              studentCertificateCategoryFilter,
              studentCertificateCategoryItems,
            }}
          />
        ) : null}
        {activeTab === "titles" && previewMode === "teacher" && canManageCredentials && canIssueCredentials ? <BulkActionFloatingBar count={selectedStudentIssueUids.length} eyebrow={"\uC120\uD0DD \uD559\uC0DD"} title={`\uCE6D\uD638 \uC9C0\uAE09 (${selectedStudentIssueUids.length})`} subtitle={"\uC120\uD0DD\uD55C \uD559\uC0DD\uC5D0\uAC8C \uC9C0\uAE09\uD560 \uCE6D\uD638\uB97C \uC120\uD0DD\uD558\uC138\uC694."} tone="indigo" actions={[{ key: "issue", label: "\uCE6D\uD638 \uC9C0\uAE09", icon: Send, tone: "indigo", onClick: () => openTeacherTitleIssuePicker() }]} onClear={clearSelectedStudentIssues} clearLabel={"\uC120\uD0DD \uD574\uC81C"} dismissOnBackdropClick /> : null}
      </div>

      <CertificateDefinitionCatalogModal open={certificateCatalogModalOpen} onClose={() => setCertificateCatalogModalOpen(false)} items={allCertificateDefinitions} isLoading={certificateLoading} onCreate={() => { setCertificateCatalogModalOpen(false); setEditingCertificate(null); setCertificateModalOpen(true); }} onEdit={(item) => { setCertificateCatalogModalOpen(false); setEditingCertificate(item); setCertificateModalOpen(true); }} canDeleteDefinitions={canDeleteCredentialDefinitions} />
      <TeacherTitleRequestManagerModal open={canReviewTitleRequests && teacherTitleRequestManagerOpen && activeTab === "titles" && previewMode === "teacher"} onClose={() => setTeacherTitleRequestManagerOpen(false)} pendingRequests={allPendingTitleRequests} reviewedRequests={recentReviewedTitleRequests} isLoading={titleRequestsLoading} onApproveRequest={approveTitleRequest} onRejectRequest={rejectTitleRequest} onApproveSelected={(items) => openTitleReviewModal("approve", items)} onRejectSelected={(items) => openTitleReviewModal("reject", items)} submissionKey={submissionKey} />
      <TeacherTitleStudentDetailModal open={teacherTitleDetailModalOpen && activeTab === "titles" && previewMode === "teacher"} onClose={closeTeacherTitleDetailModal} studentLabel={activeStudentLabel} ownedTitlesLoading={ownedTitlesLoading} activeOwnedTitles={selectedStudentActiveOwnedTitles} revokedOwnedTitles={selectedStudentRevokedOwnedTitles} onRevokeTitle={revokeTitle} onDeleteRevokedTitle={deleteRevokedTitleRecord} onRevokeTitlesBulk={revokeTitlesBulk} onDeleteRevokedTitlesBulk={deleteRevokedTitleRecordsBulk} onEquipTitle={equipTitle} onUpdateRepresentativeTitles={updateRepresentativeTitles} submissionKey={submissionKey} canManageActions={canOperateOnActiveStudent} canManageRepresentativeTitles={canManageRepresentativeTitles} />
      <TeacherCertificateStudentDetailModal open={teacherCertificateDetailModalOpen && activeTab === "certificates" && previewMode === "teacher"} onClose={closeTeacherCertificateDetailModal} studentLabel={activeStudentLabel} items={resolvedOwnedCertificates} isLoading={ownedCertificatesLoading} onToggleRevocation={toggleCertificateRevocation} canManageActions={canOperateOnActiveStudent} />
      <TeacherTitleIssuePickerModal open={teacherTitleIssuePickerModalOpen} onClose={closeTeacherTitleIssuePicker} items={teacherIssueItems} categoryItems={teacherIssueCategoryItems} selectedCategoryId={teacherIssueCategoryFilter} onSelectCategory={setTeacherIssueCategoryFilter} isLoading={titleLoading} selectedStudents={selectedStudentIssueList} onIssue={issueTitleToSelectedStudents} onIssueSelected={issueTitlesToSelectedStudents} submissionKey={submissionKey} />
       <CertificateDetailModal open={Boolean(certificateDetailState?.item)} item={certificateDetailState?.item || null} locked={Boolean(certificateDetailState?.locked)} onClose={closeCertificateDetailModal} status={certificateDetailState?.item ? (certificateDetailState?.locked ? { label: "\uBBF8\uBC1C\uAE09", tone: "slate" } : buildCertificateStatus(certificateDetailState.item)) : null} formatDate={formatDate} studentLabel={activeStudentLabel} classDisplayName={classDisplayName} classId={classId} />
      <DefinitionModal type="title" open={titleModalOpen} initialData={editingTitle} onClose={() => { setTitleModalOpen(false); setEditingTitle(null); }} onSubmit={(form) => saveDefinition("title", form)} isSubmitting={titleDefinitionSubmitting} titleGradeOptions={titleGradeOptions} certificateGradeOptions={certificateGradeOptions} titleCategoryOptions={titleCategoryOptions} />
      <DefinitionModal type="certificate" open={certificateModalOpen} initialData={editingCertificate} onClose={() => { setCertificateModalOpen(false); setEditingCertificate(null); }} onSubmit={(form) => saveDefinition("certificate", form)} isSubmitting={certificateDefinitionSubmitting} titleGradeOptions={titleGradeOptions} certificateGradeOptions={certificateGradeOptions} certificateCategoryOptions={certificateCategoryOptions} />
      <GradeSettingsModal open={gradeSettingsModalOpen} titleGrades={titleGrades} titleCategories={titleCategories} titleCollectionStages={titleCollectionStages} onClose={() => setGradeSettingsModalOpen(false)} onSubmit={saveGradeSettings} isSubmitting={gradeSettingsSubmitting} />
      <CertificateGradeSettingsModal open={certificateGradeSettingsModalOpen} certificateGrades={certificateGrades} certificateCategories={certificateCategories} onClose={() => setCertificateGradeSettingsModalOpen(false)} onSubmit={async (form) => { const isSaved = await saveGradeSettings(form); if (isSaved) setCertificateGradeSettingsModalOpen(false); }} isSubmitting={gradeSettingsSubmitting} />
      <TitleClaimRequestModal open={Boolean(requestingTitleEntry)} entry={requestingTitleEntry} existingRequest={requestingTitleEntry ? studentTitleRequestMap.get(requestingTitleEntry.definitionId || requestingTitleEntry.id) || null : null} onClose={closeTitleRequestModal} onSubmit={submitTitleClaimRequest} isSubmitting={Boolean(requestingTitleEntry) && submissionKey === `request-title-${requestingTitleEntry.definitionId}`} />
      <TitleRequestReviewModal open={titleReviewModalState.open} mode={titleReviewModalState.mode} items={titleReviewModalState.items} onClose={closeTitleReviewModal} onSubmit={submitTitleReview} isSubmitting={submissionKey === "approve-title-request-bulk" || submissionKey === "reject-title-request-bulk"} />
      <TitleRevocationModal open={Boolean(titleRevocationModalItem)} item={titleRevocationModalItem} onClose={closeTitleRevocationModal} onSubmit={submitTitleRevocation} isSubmitting={Boolean(titleRevocationModalItem) && submissionKey === `revoke-title-${titleRevocationModalItem.ownedId}`} />
      <StudentTitleCollectionBrowseModal open={Boolean(selectedBrowseStudent) && activeTab === "titles" && (previewMode === "student" || !canManageCredentials)} onClose={() => setBrowseStudentUid("")} classId={classId} student={selectedBrowseStudent} titleDefinitions={resolvedTitleDefinitions} titleCategories={titleCategories} titleGrades={titleGrades} titleCollectionStages={titleCollectionStages} onEditDefinition={canManageCredentials && canEditCredentialDefinitions ? handleEditTitleDefinitionFromDexEntry : null} />
      <IssueModal type="title" open={Boolean(issuingTitle)} item={issuingTitle} roster={issuableRoster} selectedUids={issueSelectedUids} onSelectedUidsChange={setIssueSelectedUids} sourceType={issueSourceType} onSourceTypeChange={setIssueSourceType} sourceRefId={issueSourceRefId} onSourceRefIdChange={setIssueSourceRefId} expiresAt={issueExpiresAt} onExpiresAtChange={setIssueExpiresAt} onClose={closeIssueModal} onSubmit={issueTitle} isSubmitting={titleIssueSubmitting} />
      <IssueModal type="certificate" open={Boolean(issuingCertificate)} item={issuingCertificate} roster={issuableRoster} selectedUids={issueSelectedUids} onSelectedUidsChange={setIssueSelectedUids} sourceType={issueSourceType} onSourceTypeChange={setIssueSourceType} sourceRefId={issueSourceRefId} onSourceRefIdChange={setIssueSourceRefId} expiresAt={issueExpiresAt} onExpiresAtChange={setIssueExpiresAt} onClose={closeIssueModal} onSubmit={issueCertificate} isSubmitting={certificateIssueSubmitting} />
    </AppLayout>
  );
}
