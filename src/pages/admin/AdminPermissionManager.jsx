import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { HelpCircle, KeyRound, Settings, ShieldAlert } from "lucide-react";

import { db } from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";
import AppLayout from "../../components/layout/AppLayout";
import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  PageHeader,
  PageSkeleton,
  SurfaceLoader,
  TableSkeleton,
  Tooltip,
} from "../../components/ui";
import useDragSelection from "../../hooks/useDragSelection";
import PermissionEditModal from "./modals/PermissionEditModal";
import BulkPermissionEditModal from "./modals/BulkPermissionEditModal";
import PermissionGuideModal from "./components/PermissionGuideModal";
import { PERMISSION_CONFIG } from "./PermissionConfig";
import {
  isViewPermission,
  sortPermissionsByDisplayName,
} from "./permissionLayoutUtils";

const getPermissionDisplayLabel = (permission) =>
  permission.label?.replace(/\s*\([^)]*\)\s*$/, "") || permission.label;

const PERMISSION_KEYS = PERMISSION_CONFIG.map((permission) => permission.key).filter(Boolean);

const normalizePermissionMap = (permissionMap = {}) =>
  PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = permissionMap?.[key] === true;
    return acc;
  }, {});

const deriveEditableManualPermissions = (studentData = {}) => {
  const normalizedJobPermissions = normalizePermissionMap(studentData.jobPermissions);
  const normalizedEffectivePermissions = normalizePermissionMap(studentData.permissions);
  const hasManualPermissions =
    typeof studentData.manualPermissions === "object" &&
    studentData.manualPermissions !== null &&
    !Array.isArray(studentData.manualPermissions);

  if (hasManualPermissions) {
    return normalizePermissionMap(studentData.manualPermissions);
  }

  return PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] =
      normalizedEffectivePermissions[key] === true &&
      normalizedJobPermissions[key] !== true;
    return acc;
  }, {});
};

const StudentRow = memo(
  ({
    student,
    isSelected,
    onStartSelection,
    onEnterSelection,
    onEdit,
    isSaving,
  }) => {
    const grantedPermissions = useMemo(
      () =>
        sortPermissionsByDisplayName(PERMISSION_CONFIG).filter(
          (permission) => student.effectivePermissions?.[permission.key] === true,
        ),
      [student.effectivePermissions],
    );

    const viewPermissions = useMemo(
      () =>
        grantedPermissions.filter((permission) =>
          isViewPermission(permission.key),
        ),
      [grantedPermissions],
    );

    const adminPermissions = useMemo(
      () =>
        grantedPermissions.filter(
          (permission) => !isViewPermission(permission.key),
        ),
      [grantedPermissions],
    );

    const renderPermissionBadges = (permissions) => {
      if (permissions.length === 0) {
        return <div className="pt-[6px] text-xs italic text-slate-300">없음</div>;
      }

      return permissions.map((permission) => (
        <Badge
          key={permission.key}
          color={permission.color || "gray"}
          size="sm"
          variant="soft"
          className="shrink-0 px-1.5 py-0.5 text-xs"
        >
          {getPermissionDisplayLabel(permission)}
        </Badge>
      ));
    };

    return (
      <DataTable.Row
        onMouseDown={() => onStartSelection(student.uid, isSelected)}
        onMouseEnter={() => onEnterSelection(student.uid)}
        className={`cursor-pointer select-none transition-colors ${
          isSelected ? "bg-blue-50/80" : "hover:bg-slate-50"
        }`}
      >
        <td
          className="w-12 p-3 text-center align-top"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex justify-center pt-[5px]">
            <Checkbox checked={isSelected} readOnly disabled={isSaving} />
          </div>
        </td>

        <td className="w-14 whitespace-nowrap p-3 text-center align-top">
          <div className="pt-[6px] text-sm font-medium text-slate-500">
            {student.studentNumber || "-"}
          </div>
        </td>

        <td className="w-24 whitespace-nowrap p-3 text-center align-top">
          <div className="pt-[6px] text-sm font-bold text-slate-800">
            {student.name}
          </div>
        </td>

        <td className="w-[42%] p-3 align-top">
          <div className="flex min-h-[32px] flex-wrap items-start gap-1">
            {renderPermissionBadges(viewPermissions)}
          </div>
        </td>

        <td className="w-[24%] p-3 align-top">
          <div className="flex min-h-[32px] flex-wrap items-start gap-1">
            {renderPermissionBadges(adminPermissions)}
          </div>
        </td>

        <td
          className="w-20 whitespace-nowrap p-2 text-center align-top"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="pt-[2px]">
            <Button
              size="sm"
              tone="slate"
              kind="soft"
              onClick={() => onEdit(student)}
              disabled={isSaving}
              icon={Settings}
              className="mx-auto flex items-center gap-1 whitespace-nowrap"
            >
              수정
            </Button>
          </div>
        </td>
      </DataTable.Row>
    );
  },
);

const MobileStudentPermissionCard = memo(
  ({
    student,
    isSelected,
    onStartSelection,
    onEdit,
    isSaving,
  }) => {
    const grantedPermissions = useMemo(
      () =>
        sortPermissionsByDisplayName(PERMISSION_CONFIG).filter(
          (permission) => student.effectivePermissions?.[permission.key] === true,
        ),
      [student.effectivePermissions],
    );
    const viewPermissions = grantedPermissions.filter((permission) =>
      isViewPermission(permission.key),
    );
    const adminPermissions = grantedPermissions.filter(
      (permission) => !isViewPermission(permission.key),
    );

    const renderCompactPermissionList = (permissions) => {
      if (permissions.length === 0) {
        return <span className="text-xs font-medium text-slate-400">없음</span>;
      }

      return (
        <div className="flex min-w-0 flex-wrap gap-1">
          {permissions.slice(0, 2).map((permission) => (
            <Badge
              key={permission.key}
              color={permission.color || "gray"}
              size="sm"
              variant="soft"
              className="max-w-full truncate px-2 py-1 text-xs"
            >
              {getPermissionDisplayLabel(permission)}
            </Badge>
          ))}
          {permissions.length > 2 ? (
            <span className="inline-flex min-h-7 items-center rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-600">
              +{permissions.length - 2}
            </span>
          ) : null}
        </div>
      );
    };

    return (
      <article
        className={`rounded-2xl border p-4 shadow-sm transition ${
          isSelected
            ? "border-blue-300 bg-blue-50/80"
            : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex items-start gap-3">
          <label className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50">
            <Checkbox
              checked={isSelected}
              onChange={() => onStartSelection(student.uid, isSelected)}
              disabled={isSaving}
            />
            <span className="sr-only">{student.name} 선택</span>
          </label>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-blue-600">
              번호 {student.studentNumber || "-"}
            </p>
            <h3 className="truncate text-base font-black text-slate-900">
              {student.name}
            </h3>
          </div>

          <Button
            size="sm"
            tone="slate"
            kind="soft"
            onClick={() => onEdit(student)}
            disabled={isSaving}
            icon={Settings}
            className="shrink-0"
          >
            수정
          </Button>
        </div>

        <dl className="mt-4 grid gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="mb-2 text-xs font-black text-slate-500">보기 권한</dt>
            <dd>{renderCompactPermissionList(viewPermissions)}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="mb-2 text-xs font-black text-slate-500">관리 권한</dt>
            <dd>{renderCompactPermissionList(adminPermissions)}</dd>
          </div>
        </dl>
      </article>
    );
  },
);

const AdminPermissionManager = () => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();
  const functions = getFunctions(undefined, "asia-northeast3");
  const updatePermsCallable = httpsCallable(functions, "updateUserPermissions");

  const [students, setStudents] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedUids, setSelectedUids] = useState(new Set());
  const [editingStudent, setEditingStudent] = useState(null);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const hasLoadedStudentsRef = useRef(false);

  const fetchStudents = useCallback(async ({ preserveCurrent = false } = {}) => {
    if (!classId) {
      setStudents([]);
      setIsInitialLoading(false);
      setIsRefreshing(false);
      hasLoadedStudentsRef.current = false;
      return;
    }

    if (preserveCurrent && hasLoadedStudentsRef.current) {
      setIsRefreshing(true);
    } else {
      setIsInitialLoading(true);
    }

    try {
      const studentsQuery = query(
        collection(db, `classes/${classId}/students`),
        orderBy("studentNumber", "asc"),
      );
      const snapshot = await getDocs(studentsQuery);
      const nextStudents = snapshot.docs
        .map((item) => {
          const data = item.data();
          const manualPermissions = deriveEditableManualPermissions(data);
          const jobPermissions = normalizePermissionMap(data.jobPermissions);
          const effectivePermissions = normalizePermissionMap(data.permissions);
          return {
            uid: item.id,
            ...data,
            name: data.name || "이름 없음",
            effectivePermissions,
            permissions: manualPermissions,
            manualPermissions,
            jobPermissions,
          };
        })
        .filter((student) => student.role === "student");

      setStudents(nextStudents);
    } catch (_error) {
      showFeedback("학생 권한 정보를 불러오지 못했습니다.", "error");
    } finally {
      hasLoadedStudentsRef.current = true;
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }, [classId, showFeedback]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const selectUid = useCallback((uid) => {
    setSelectedUids((prev) => new Set(prev).add(uid));
  }, []);

  const deselectUid = useCallback((uid) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }, []);

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (uid) => selectedUids.has(uid),
    onSelect: selectUid,
    onDeselect: deselectUid,
  });

  const handleSelectionStart = useCallback(
    (uid, isSelected) => {
      startDrag(uid, { selected: isSelected });
    },
    [startDrag],
  );

  const handleSelectionEnter = useCallback(
    (uid) => {
      enterDrag(uid);
    },
    [enterDrag],
  );

  const handleMobileSelectionToggle = useCallback(
    (uid, isSelected) => {
      if (isSelected) {
        deselectUid(uid);
      } else {
        selectUid(uid);
      }
    },
    [deselectUid, selectUid],
  );

  const handleSave = async (uid, permissions) => {
    setIsSaving(true);

    try {
      await updatePermsCallable({ targetUid: uid, classId, permissions });
      showFeedback("권한을 저장했습니다.", "success");
      await fetchStudents({ preserveCurrent: true });
      setEditingStudent(null);
    } catch (error) {
      showFeedback(error?.message || "권한 저장에 실패했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkSave = async (actionsToCommit) => {
    if (selectedUids.size === 0) return;
    setIsSaving(true);

    try {
      const targets = Array.from(selectedUids);
      await Promise.all(
        targets.map((uid) => {
          const student = students.find((item) => item.uid === uid);
          const nextPermissions = { ...(student?.manualPermissions || {}) };

          Object.entries(actionsToCommit).forEach(([key, grant]) => {
            nextPermissions[key] = grant;
          });

          return updatePermsCallable({
            targetUid: uid,
            classId,
            permissions: nextPermissions,
          });
        }),
      );

      showFeedback("선택한 학생들의 권한을 수정했습니다.", "success");
      setSelectedUids(new Set());
      setIsBulkModalOpen(false);
      await fetchStudents({ preserveCurrent: true });
    } catch (error) {
      showFeedback(error?.message || "일괄 권한 수정에 실패했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const permissionsQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "권한 관리 도우미",
      launcherTitle: "권한 관리 도우미",
      launcherDescription: "학생 권한 확인, 개별 수정, 일괄 수정 흐름을 체크합니다.",
      subtitle: "학생이 볼 수 있는 페이지와 관리할 수 있는 기능을 조정합니다.",
      storageKey: classId
        ? `finclass_permissions_quest_${classId}`
        : "finclass_permissions_quest",
      tourKey: "TEACHER_MANAGE_PERMISSIONS_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "permission-table",
          title: "권한 표 확인하기",
          description: "학생별 보기 권한과 관리 권한을 표에서 확인합니다.",
          doneText: `${students.length}명의 권한 정보를 볼 수 있습니다.`,
          completed: students.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "student-permission-count",
              label: "학생 권한 목록 확인",
              completed: students.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-permissions-table"]',
              title: "권한 표",
              content: "학생별 보기 권한과 관리 권한이 나뉘어 표시됩니다.",
            },
          ],
        },
        {
          id: "single-edit",
          title: "개별 권한 수정하기",
          description: "한 학생의 권한을 수정하는 모달 위치를 확인합니다.",
          completed: Boolean(editingStudent),
          manualComplete: true,
          objectives: [
            {
              id: "single-edit-open",
              label: "개별 권한 수정 열기",
              completed: Boolean(editingStudent),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-permissions-table"]',
              title: "개별 수정",
              content: "학생 행의 수정 버튼으로 개별 권한을 조정합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "bulk-edit",
          title: "일괄 권한 수정하기",
          description: "여러 학생을 선택해 권한을 한 번에 수정합니다.",
          completed: selectedUids.size > 0 || isBulkModalOpen,
          manualComplete: true,
          objectives: [
            {
              id: "selected-students",
              label: "학생 1명 이상 선택",
              completed: selectedUids.size > 0,
            },
            {
              id: "bulk-modal-open",
              label: "일괄 수정 모달 열기",
              completed: isBulkModalOpen,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-permissions-table"]',
              title: "학생 선택",
              content: "체크박스나 드래그로 여러 학생을 선택합니다.",
            },
          ],
        },
        {
          id: "permission-guide",
          title: "권한 안내 보기",
          description: "보기 권한과 관리 권한의 차이를 확인합니다.",
          completed: isGuideOpen,
          manualComplete: true,
          objectives: [
            {
              id: "guide-open",
              label: "권한 안내 열기",
              completed: isGuideOpen,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-permissions-table"]',
              title: "권한 안내",
              content: "상단 권한 안내 버튼에서 권한 종류를 확인합니다.",
            },
          ],
        },
      ],
    }),
    [
      classId,
      editingStudent,
      isBulkModalOpen,
      isGuideOpen,
      selectedUids.size,
      students.length,
    ],
  );

  if (isInitialLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <PageSkeleton summaryCards={0} showChart={false} showTable={false} />
          <TableSkeleton columns={6} rows={10} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout pageGuide={permissionsQuestGuide}>
      <div className="min-h-screen select-none space-y-4 bg-[#f0f5ff] p-4 pb-40 sm:p-6 lg:p-8">
        <PageHeader
          title="학생 권한 관리"
          subtitle="학생별 권한을 보기 권한과 관리 권한으로 나눠 확인하고, 여러 학생에게 한꺼번에 적용할 수 있습니다."
          icon={KeyRound}
          noMargin
          rightSlot={
            <Tooltip
              position="bottom"
              maxWidth={360}
              content={
                <div className="space-y-1">
                  <p className="font-semibold">권한 표시 안내</p>
                  <p>
                    보기 권한은 학생이 페이지에 들어갈 수 있는 권한이고, 관리
                    권한은 해당 페이지의 운영 기능까지 사용할 수 있는 권한입니다.
                  </p>
                  <p>
                    같은 영역 권한이라도 보기와 관리가 분리되어 보여서, 역할을 더
                    빠르게 확인할 수 있습니다.
                  </p>
                </div>
              }
            >
              <span>
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  icon={HelpCircle}
                  onClick={() => setIsGuideOpen(true)}
                >
                  권한 안내
                </Button>
              </span>
            </Tooltip>
          }
        />

        <SurfaceLoader
          loading={isRefreshing}
          variant="refreshing"
          message="학생 권한 정보를 새로고침하는 중입니다..."
        >
          <Card data-tour="manage-permissions-table" tone="slate" variant="surface">
          <Card.Content noPadding>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-3 md:hidden">
              {students.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedUids(
                        selectedUids.size === students.length
                          ? new Set()
                          : new Set(students.map((student) => student.uid)),
                      )
                    }
                    className="mb-3 flex min-h-11 w-full items-center justify-between rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-700"
                  >
                    <span>전체 학생 선택</span>
                    <span className="text-blue-600">
                      {selectedUids.size} / {students.length}
                    </span>
                  </button>
                  <div className="grid gap-3">
                    {students.map((student) => (
                      <MobileStudentPermissionCard
                        key={student.uid}
                        student={student}
                        isSelected={selectedUids.has(student.uid)}
                        onStartSelection={handleMobileSelectionToggle}
                        onEdit={setEditingStudent}
                        isSaving={isSaving}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-12">
                  <EmptyState
                    icon={KeyRound}
                    title="권한을 관리할 학생이 없습니다"
                    description="학생 계정을 등록하면 여기에서 보기 권한과 관리 권한을 조정할 수 있습니다."
                  />
                </div>
              )}
            </div>

            <div className="hidden h-[calc(100vh-220px)] scrollbar-thin md:block">
              <DataTable tableClassName="table-fixed" className="h-full overflow-auto">
                <DataTable.Header className="sticky top-0 z-10 bg-white shadow-sm">
                  <DataTable.Row interactive={false}>
                    <DataTable.HeadCell align="center" className="w-12 p-3">
                      <Checkbox
                        checked={students.length > 0 && selectedUids.size === students.length}
                        onChange={() =>
                          setSelectedUids(
                            selectedUids.size === students.length
                              ? new Set()
                              : new Set(students.map((student) => student.uid)),
                          )
                        }
                      />
                    </DataTable.HeadCell>
                    <DataTable.HeadCell align="center" className="w-14 p-3">번호</DataTable.HeadCell>
                    <DataTable.HeadCell align="center" className="w-24 p-3">이름</DataTable.HeadCell>
                    <DataTable.HeadCell className="w-[42%] p-3">보기 권한</DataTable.HeadCell>
                    <DataTable.HeadCell className="w-[24%] p-3">관리 권한</DataTable.HeadCell>
                    <DataTable.HeadCell align="center" className="w-24 p-3">수정</DataTable.HeadCell>
                  </DataTable.Row>
                </DataTable.Header>

                <DataTable.Body>
                  {students.length === 0 ? (
                    <DataTable.Empty colSpan={6} className="py-16">
                      <EmptyState
                        icon={KeyRound}
                        title="권한을 관리할 학생이 없습니다"
                        description="학생 계정이 등록되면 이곳에서 보기 권한과 관리 권한을 조정할 수 있습니다."
                      />
                    </DataTable.Empty>
                  ) : (
                    students.map((student) => (
                      <StudentRow
                        key={student.uid}
                        student={student}
                        isSelected={selectedUids.has(student.uid)}
                        onStartSelection={handleSelectionStart}
                        onEnterSelection={handleSelectionEnter}
                        onEdit={setEditingStudent}
                        isSaving={isSaving}
                      />
                    ))
                  )}
                </DataTable.Body>
              </DataTable>
            </div>
          </Card.Content>
          </Card>
        </SurfaceLoader>
      </div>

      {selectedUids.size > 0 ? (
        <BulkActionFloatingBar
          count={selectedUids.size}
          tone="blue"
          icon={ShieldAlert}
          eyebrow="권한 일괄 수정"
          title="선택한 학생들의 권한을 한 번에 바꿀 수 있습니다"
          subtitle="필요한 권한만 골라 여러 학생에게 동시에 적용해 보세요."
          actions={[
            {
              key: "bulk-edit",
              label: "일괄 권한 수정",
              onClick: () => setIsBulkModalOpen(true),
              icon: ShieldAlert,
              tone: "blue",
              disabled: isSaving,
            },
          ]}
          onClear={() => setSelectedUids(new Set())}
        />
      ) : null}

      {editingStudent ? (
        <PermissionEditModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSave={handleSave}
          isSaving={isSaving}
        />
      ) : null}

      {isBulkModalOpen ? (
        <BulkPermissionEditModal
          onClose={() => setIsBulkModalOpen(false)}
          onSave={handleBulkSave}
          isSaving={isSaving}
          selectedCount={selectedUids.size}
        />
      ) : null}

      {isGuideOpen ? (
        <PermissionGuideModal
          isOpen={isGuideOpen}
          onClose={() => setIsGuideOpen(false)}
        />
      ) : null}
    </AppLayout>
  );
};

export default AdminPermissionManager;
