import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Checkbox, Badge } from "../../../components/ui";
import {
  PERMISSION_CONFIG,
  applyImpliedPermissions,
} from "../PermissionConfig";
import { getPermissionGroupRows } from "../permissionLayoutUtils";

export default function PermissionEditModal({
  student,
  onClose,
  onSave,
  isSaving,
}) {
  const [permissions, setPermissions] = useState(() =>
    applyImpliedPermissions(student.permissions || {}),
  );

  useEffect(() => {
    setPermissions(applyImpliedPermissions(student.permissions || {}));
  }, [student]);

  const jobLinkedPermissionCount = useMemo(
    () => Object.values(student.jobPermissions || {}).filter(Boolean).length,
    [student.jobPermissions],
  );

  const permissionRows = useMemo(
    () => getPermissionGroupRows(PERMISSION_CONFIG),
    [],
  );

  const handlePermissionChange = (key, checked) => {
    setPermissions((prev) =>
      applyImpliedPermissions({ ...prev, [key]: checked }),
    );
  };

  const renderPermissionControl = (permission) => {
    const isManualChecked = !!permissions[permission.key];
    const isJobLinked = student.jobPermissions?.[permission.key] === true;
    const isEffectivelyEnabled = isManualChecked || isJobLinked;
    const isLockedToJob = isJobLinked && !isManualChecked;

    return (
      <label
        key={permission.key}
        htmlFor={permission.key}
        className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-all ${
          isEffectivelyEnabled
            ? "border-slate-200 bg-white shadow-sm ring-1 ring-slate-100"
            : "border-slate-100 bg-white/70 hover:bg-slate-50"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Badge
            color={permission.color || "gray"}
            size="sm"
            variant={isEffectivelyEnabled ? "solid" : "soft"}
            className={`h-2 w-2 shrink-0 rounded-full p-0 transition-all ${
              isEffectivelyEnabled
                ? "opacity-100 shadow-[0_0_8px_rgba(0,0,0,0.15)]"
                : "opacity-70 grayscale-[0.3]"
            }`}
          >
            {" "}
          </Badge>

          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              id={`permission-label-${permission.key}`}
              className={`min-w-0 truncate text-sm font-semibold transition-colors ${
                isEffectivelyEnabled ? "text-slate-900" : "text-slate-500"
              }`}
              title={permission.label}
            >
              {permission.label}
            </div>

            <div className="flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap">
              {isManualChecked ? (
                <Badge
                  color="slate"
                  size="sm"
                  variant="soft"
                  className="shrink-0 px-1.5 py-0 text-[10px] whitespace-nowrap"
                >
                  수동
                </Badge>
              ) : null}
              {isJobLinked ? (
                <Badge
                  color="amber"
                  size="sm"
                  variant="soft"
                  className="shrink-0 px-1.5 py-0 text-[10px] whitespace-nowrap"
                >
                  직업
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <Checkbox
          id={permission.key}
          aria-labelledby={`permission-label-${permission.key}`}
          checked={isManualChecked}
          onChange={(event) =>
            handlePermissionChange(permission.key, event.target.checked)
          }
          onMouseDown={(event) => event.stopPropagation()}
          disabled={isLockedToJob || isSaving}
        />
      </label>
    );
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${student.name} 학생 권한 수정`}
      size="xl"
    >
      {jobLinkedPermissionCount > 0 ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">직업 권한이 함께 적용되고 있습니다.</p>
          <p className="mt-1 text-amber-800">
            직업 배지는 직업에서 내려온 권한이며, 수동 권한을 해제해도 직업 권한은 유지됩니다.
          </p>
        </div>
      ) : null}

      <div className="max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin select-none">
        <div className="sticky top-0 z-20 hidden grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-bold text-slate-500 backdrop-blur md:grid">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0" />
            <span>구분</span>
          </div>
          <div>보기 권한</div>
          <div>관리자 권한</div>
        </div>

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/50">
          {permissionRows.map((row) => (
            <div
              key={row.name}
              className="grid grid-cols-1 gap-2 bg-white px-2.5 py-2 md:grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <div className="flex min-h-[30px] items-center gap-1.5 text-sm font-bold text-slate-800">
                <Badge
                  color={row.color || "gray"}
                  size="sm"
                  variant="solid"
                  className="h-2 w-2 shrink-0 rounded-full p-0"
                >
                  {" "}
                </Badge>
                <span className="truncate" title={row.name}>
                  {row.name}
                </span>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-400 md:hidden">
                  보기 권한
                </div>
                {row.viewPermissions.length > 0 ? (
                  row.viewPermissions.map(renderPermissionControl)
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-2.5 py-1.5 text-xs text-slate-400">
                    없음
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-400 md:hidden">
                  관리자 권한
                </div>
                {row.adminPermissions.length > 0 ? (
                  row.adminPermissions.map(renderPermissionControl)
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-2.5 py-1.5 text-xs text-slate-400">
                    없음
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t pt-6">
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>
          취소
        </Button>
        <Button size="md"
          color="blue"
          onClick={() => onSave(student.uid, permissions)}
          isLoading={isSaving}
          
        >
          저장하기
        </Button>
      </div>
    </Modal>
  );
}
