import React, { useMemo, useState } from "react";
import { Modal, Button, Badge } from "../../../components/ui";
import {
  IMPLIED_PERMISSION_MAP,
  PERMISSION_CONFIG,
} from "../PermissionConfig";
import { getPermissionGroupRows } from "../permissionLayoutUtils";

const ACTION_OPTIONS = [
  {
    label: "부여",
    value: "grant",
    activeClass: "bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-600/20",
  },
  {
    label: "유지",
    value: "no_change",
    activeClass: "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200",
  },
  {
    label: "해제",
    value: "revoke",
    activeClass: "bg-rose-500 text-white shadow-sm ring-1 ring-rose-600/20",
  },
];

const ActionSegment = ({ value, onChange }) => (
  <div className="flex w-full shrink-0 rounded-lg border border-slate-200/70 bg-slate-100/80 p-0.5 sm:w-[150px]">
    {ACTION_OPTIONS.map((option) => (
      <Button
        key={option.value}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onChange(option.value);
        }}
        className={`min-h-11 flex-1 rounded-md px-1 py-2 text-xs font-bold transition-all ${
          value === option.value
            ? option.activeClass
            : "text-slate-400 hover:bg-slate-200/70 hover:text-slate-600"
        }`}
      >
        {option.label}
      </Button>
    ))}
  </div>
);

export default function BulkPermissionEditModal({
  onClose,
  onSave,
  isSaving,
  selectedCount,
}) {
  const [permissionActions, setPermissionActions] = useState({});

  const permissionRows = useMemo(
    () => getPermissionGroupRows(PERMISSION_CONFIG),
    [],
  );

  const changedActionCount = useMemo(
    () =>
      Object.values(permissionActions).filter((action) => action !== "no_change")
        .length,
    [permissionActions],
  );

  const handleActionChange = (permissionKey, action) => {
    setPermissionActions((prev) => {
      const next = { ...prev, [permissionKey]: action };
      if (action === "grant") {
        (IMPLIED_PERMISSION_MAP[permissionKey] || []).forEach((impliedKey) => {
          next[impliedKey] = "grant";
        });
      }
      return next;
    });
  };

  const handleSaveClick = () => {
    const actionsToCommit = Object.entries(permissionActions)
      .filter(([, action]) => action !== "no_change")
      .reduce((acc, [key, action]) => {
        acc[key] = action === "grant";
        return acc;
      }, {});

    onSave(actionsToCommit);
  };

  const renderPermissionAction = (permission) => {
    const currentAction = permissionActions[permission.key] || "no_change";
    const isGrant = currentAction === "grant";
    const isRevoke = currentAction === "revoke";

    return (
      <div
        key={permission.key}
        className={`flex flex-col items-stretch gap-2 rounded-lg border px-3 py-2 transition-all sm:flex-row sm:items-center sm:justify-between ${
          isGrant
            ? "border-emerald-200 bg-emerald-50/40 ring-1 ring-emerald-100"
            : isRevoke
              ? "border-rose-100 bg-rose-50/30"
              : "border-slate-100 bg-white/70 hover:bg-slate-50"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Badge
            color={permission.color || "gray"}
            size="sm"
            variant="solid"
            className={`h-2 w-2 shrink-0 rounded-full p-0 shadow-sm transition-all ${
              isRevoke ? "scale-90 opacity-25 grayscale" : "opacity-100"
            }`}
          >
            {" "}
          </Badge>
          <span
            className={`min-w-0 truncate text-sm font-semibold ${
              isRevoke
                ? "text-slate-400 line-through decoration-slate-300"
                : isGrant
                  ? "text-emerald-900"
                  : "text-slate-700"
            }`}
            title={permission.label}
          >
            {permission.label}
          </span>
        </div>

        <ActionSegment
          value={currentAction}
          onChange={(action) => handleActionChange(permission.key, action)}
        />
      </div>
    );
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${selectedCount}명 권한 일괄 변경`}
      size="xl"
    >
      <div className="space-y-4 select-none">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs text-indigo-800">
          <span className="font-bold">
            선택한 {selectedCount}명에게 적용할 권한 변경값을 고르세요.
          </span>
          <Badge
            color="indigo"
            size="sm"
            variant="soft"
            className="px-2 py-0.5 text-[10px]"
          >
            변경 {changedActionCount}개
          </Badge>
        </div>

        <div className="max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
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
                    row.viewPermissions.map(renderPermissionAction)
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
                    row.adminPermissions.map(renderPermissionAction)
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

        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-5 sm:flex sm:justify-end">
          <Button size="md"
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            취소
          </Button>
          <Button size="md"
            color="blue"
            onClick={handleSaveClick}
            isLoading={isSaving}
            className="w-full transition-shadow sm:w-auto"
          >
            {selectedCount}명 권한 수정하기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
