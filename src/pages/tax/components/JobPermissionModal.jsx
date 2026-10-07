import React, { useEffect, useMemo, useState } from "react";
import { Badge, Button, Checkbox, Modal } from "../../../components/ui";
import {
  getPermissionGroupRows,
  isViewPermission,
} from "../../admin/permissionLayoutUtils";
import {
  filterJobLinkedPermissionKeys,
  getJobLinkedSelectablePermissions,
} from "./jobLinkedPermissionUtils";

export default function JobPermissionModal({
  job,
  permissionOptions = [],
  isOpen,
  isSaving,
  onClose,
  onSave,
}) {
  const [permissions, setPermissions] = useState({});

  const selectablePermissionOptions = useMemo(
    () => getJobLinkedSelectablePermissions(permissionOptions),
    [permissionOptions],
  );

  const permissionRows = useMemo(
    () =>
      getPermissionGroupRows(selectablePermissionOptions).map((row) => ({
        ...row,
        autoViewPermissions: permissionOptions.filter(
          (permission) =>
            permission.group === row.name &&
            (isViewPermission(permission.key) ||
              permission.key === "asset_manager_view"),
        ),
      })),
    [permissionOptions, selectablePermissionOptions],
  );

  const selectedKeys = useMemo(
    () =>
      Object.entries(permissions)
        .filter(([, checked]) => checked)
        .map(([key]) => key),
    [permissions],
  );

  const selectablePermissionCount = useMemo(
    () => permissionRows.reduce((sum, row) => sum + row.adminPermissions.length, 0),
    [permissionRows],
  );

  useEffect(() => {
    if (!isOpen) return;

    const nextKeys = filterJobLinkedPermissionKeys(job?.linkedPermissionKeys);
    setPermissions(
      nextKeys.reduce((acc, key) => {
        acc[key] = true;
        return acc;
      }, {}),
    );
  }, [isOpen, job]);

  const handlePermissionChange = (key, checked) => {
    setPermissions((prev) => ({ ...prev, [key]: checked }));
  };

  const renderPermissionControl = (permission) => {
    const isChecked = !!permissions[permission.key];

    return (
      <div
        key={permission.key}
        className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-all ${
          isChecked
            ? "border-slate-200 bg-white shadow-sm ring-1 ring-slate-100"
            : "border-slate-100 bg-white/70 hover:bg-slate-50"
        }`}
        onClick={() => handlePermissionChange(permission.key, !isChecked)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Badge
            color={permission.color || "gray"}
            size="sm"
            variant={isChecked ? "solid" : "soft"}
            className={`h-2 w-2 shrink-0 rounded-full p-0 transition-all ${
              isChecked
                ? "opacity-100 shadow-[0_0_8px_rgba(0,0,0,0.15)]"
                : "grayscale-[0.3] opacity-70"
            }`}
          >
            {" "}
          </Badge>
          <span
            className={`min-w-0 truncate text-sm font-semibold transition-colors ${
              isChecked ? "text-slate-900" : "text-slate-500"
            }`}
            title={permission.label}
          >
            {permission.label}
          </span>
        </div>

        <Checkbox
          id={permission.key}
          checked={isChecked}
          onChange={(event) =>
            handlePermissionChange(permission.key, event.target.checked)
          }
          onMouseDown={(event) => event.stopPropagation()}
        />
      </div>
    );
  };

  const renderAutoViewPermissions = (row) => {
    if (row.autoViewPermissions.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-slate-200 px-2.5 py-1.5 text-xs text-slate-400">
          자동 보기 권한 없음
        </div>
      );
    }

    return row.autoViewPermissions.map((permission) => (
      <div
        key={permission.key}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs font-semibold text-slate-500"
      >
        <Badge
          color={permission.color || "gray"}
          size="sm"
          variant="soft"
          className="h-2 w-2 shrink-0 rounded-full p-0"
        >
          {" "}
        </Badge>
        <span className="min-w-0 truncate" title={permission.label}>
          {permission.label}
        </span>
        <Badge
          color="slate"
          size="sm"
          variant="soft"
          className="ml-auto shrink-0 px-1.5 py-0 text-[10px]"
        >
          자동
        </Badge>
      </div>
    ));
  };

  if (!isOpen || !job) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${job.name} 연결 권한 설정`}
      size="xl"
    >
      <div className="space-y-4 select-none">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800">
                직업으로 부여할 관리자 권한을 선택하세요.
              </p>
              <p className="text-sm text-slate-600">
                보기 권한은 선택한 관리자 권한에 맞춰 자동으로 함께 부여됩니다.
              </p>
            </div>
            <Badge
              color="indigo"
              size="sm"
              variant="soft"
              className="px-2.5 py-1 text-[11px] font-semibold"
            >
              선택 {selectedKeys.length}/{selectablePermissionCount}개
            </Badge>
          </div>
        </div>

        <div className="overflow-visible md:max-h-[60vh] md:overflow-y-auto md:pr-2 md:scrollbar-thin">
          <div className="sticky top-0 z-20 hidden grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-bold text-slate-500 backdrop-blur md:grid">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0" />
              <span>구분</span>
            </div>
            <div>자동 보기 권한</div>
            <div>직업 권한</div>
          </div>

          {permissionRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              연결할 권한 항목이 없습니다.
            </div>
          ) : (
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
                      자동 보기 권한
                    </div>
                    {renderAutoViewPermissions(row)}
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-slate-400 md:hidden">
                      직업 권한
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
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-4 grid grid-cols-2 gap-2 border-t bg-white px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:flex sm:justify-end sm:px-0 sm:pb-0 sm:pt-6">
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>
          취소
        </Button>
        <Button size="md"
          color="blue"
          onClick={() => onSave(job.id, { linkedPermissionKeys: selectedKeys })}
          isLoading={isSaving}
          
        >
          저장하기
        </Button>
      </div>
    </Modal>
  );
}
