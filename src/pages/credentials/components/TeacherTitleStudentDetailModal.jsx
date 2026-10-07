import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Lock,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Card,
  Modal,
  Spinner,
  Tabs,
} from "../../../components/ui";
import { EmptyState, formatDate } from "../CredentialsPage.parts";

const DETAIL_TABS = [
  { id: "active", label: "보유 칭호" },
  { id: "revoked", label: "회수 이력" },
];

const SORT_LABELS = {
  name: "칭호",
  grade: "등급",
  category: "카테고리",
  obtainedAt: "획득일",
  revokedAt: "회수일",
};

function SortHeaderButton({ label, active, descending, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-inherit text-inherit transition hover:text-slate-600"
    >
      <span>{label}</span>
      {active ? (
        descending ? (
          <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUp className="h-3.5 w-3.5" />
        )
      ) : null}
    </button>
  );
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "ko");
}

function compareDate(a, b) {
  const aTime = a?.seconds ? a.seconds * 1000 : new Date(a || 0).getTime() || 0;
  const bTime = b?.seconds ? b.seconds * 1000 : new Date(b || 0).getTime() || 0;
  return aTime - bTime;
}

function sortOwnedItems(items, sortKey, descending) {
  const sorted = [...items].sort((left, right) => {
    switch (sortKey) {
      case "grade":
        return compareText(left.gradeLabel, right.gradeLabel);
      case "category":
        return compareText(left.categoryLabel, right.categoryLabel);
      case "obtainedAt":
        return compareDate(left.obtainedAt, right.obtainedAt);
      case "revokedAt":
        return compareDate(left.revokedAt, right.revokedAt);
      case "name":
      default:
        return compareText(left.name, right.name);
    }
  });

  return descending ? sorted.reverse() : sorted;
}

function ActiveTitleTable({
  items,
  selectedIds,
  onToggleSelection,
  onToggleAll,
  onRowPointerDown,
  onRowMouseEnter,
  onRevokeTitle,
  onEquipTitle,
  submissionKey,
  canManageRepresentativeTitles,
  sortKey,
  descending,
  onToggleSort,
}) {
  if (!items.length) {
    return (
      <EmptyState
        icon={Lock}
        title="보유 중인 칭호가 없습니다"
        description="학생에게 칭호를 지급하거나 요청을 승인하면 이곳에 표시됩니다."
      />
    );
  }

  const allSelected =
    items.length > 0 && items.every((item) => selectedIds.includes(item.ownedId));

  return (
    <>
      <div className="space-y-3 md:hidden">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          현재 목록 전체 선택
        </label>

        {items.map((item) => {
          const isSelected = selectedIds.includes(item.ownedId);
          return (
            <article
              key={`mobile-${item.ownedId}`}
              className={`rounded-2xl border p-4 ${
                isSelected
                  ? "border-indigo-200 bg-indigo-50/60"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelection(item.ownedId)}
                  aria-label={`${item.name || "칭호"} 선택`}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-black text-slate-900">
                    {item.name || "이름 없는 칭호"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {item.acquisitionCondition ||
                      item.description ||
                      "설명이나 획득 조건이 아직 없습니다."}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={item.gradeTone || "slate"}>
                  {item.gradeLabel || "등급 없음"}
                </Badge>
                <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
                <Badge tone={item.equipped ? "emerald" : "slate"}>
                  {item.equipped ? "대표 표시 중" : "보유 중"}
                </Badge>
                {item.equippedOrder ? (
                  <Badge tone="indigo">{`대표 ${item.equippedOrder}`}</Badge>
                ) : null}
              </div>

              <p className="mt-3 text-xs text-slate-400">
                획득일 {item.obtainedAt ? formatDate(item.obtainedAt) : "-"}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={item.equipped ? "secondary" : "outline"}
                  tone={item.equipped ? "emerald" : "indigo"}
                  onClick={() => onEquipTitle?.(item)}
                  isLoading={submissionKey === `equip-${item.ownedId}`}
                  disabled={!canManageRepresentativeTitles}
                  className="min-h-11"
                >
                  {item.equipped ? "대표 해제" : "대표 설정"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  tone="red"
                  onClick={() => onRevokeTitle(item)}
                  icon={Trash2}
                  className="min-h-11"
                >
                  회수
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/90">
          <tr className="text-left text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <th className="w-12 px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                onClick={(event) => event.stopPropagation()}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
            </th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.name}
                active={sortKey === "name"}
                descending={descending}
                onClick={() => onToggleSort("name")}
              />
            </th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.grade}
                active={sortKey === "grade"}
                descending={descending}
                onClick={() => onToggleSort("grade")}
              />
            </th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.category}
                active={sortKey === "category"}
                descending={descending}
                onClick={() => onToggleSort("category")}
              />
            </th>
            <th className="px-4 py-3">상태</th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.obtainedAt}
                active={sortKey === "obtainedAt"}
                descending={descending}
                onClick={() => onToggleSort("obtainedAt")}
              />
            </th>
            <th className="px-4 py-3 text-right">작업</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((item) => {
            const isSelected = selectedIds.includes(item.ownedId);
            return (
              <tr
                key={item.ownedId}
                onMouseDown={(event) => onRowPointerDown(item.ownedId, event)}
                onMouseEnter={() => onRowMouseEnter(item.ownedId)}
                className={`align-top transition ${
                  isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50/70"
                } cursor-pointer select-none`}
              >
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelection(item.ownedId)}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </td>
                <td className="px-4 py-4">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">
                      {item.name || "이름 없는 칭호"}
                    </p>
                    <p className="max-w-[320px] text-xs leading-5 text-slate-500">
                      {item.acquisitionCondition ||
                        item.description ||
                        "설명이나 획득 조건이 아직 없습니다."}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-4">
                  {item.gradeLabel ? (
                    <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge>
                  ) : (
                    <Badge tone="slate">등급 없음</Badge>
                  )}
                </td>
                <td className="px-4 py-4">
                  <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={item.equipped ? "emerald" : "slate"}>
                      {item.equipped ? "대표 표시 중" : "보유 중"}
                    </Badge>
                    {item.equippedOrder ? (
                      <Badge tone="indigo">{`대표 ${item.equippedOrder}`}</Badge>
                    ) : null}
                    {item.missingDefinition ? (
                      <Badge tone="amber">정의 삭제됨</Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-4 text-slate-500">
                  {item.obtainedAt ? formatDate(item.obtainedAt) : "-"}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant={item.equipped ? "secondary" : "outline"}
                      tone={item.equipped ? "emerald" : "indigo"}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEquipTitle?.(item);
                      }}
                      isLoading={submissionKey === `equip-${item.ownedId}`}
                      disabled={!canManageRepresentativeTitles}
                    >
                      {item.equipped ? "대표 해제" : "대표 설정"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      tone="red"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRevokeTitle(item);
                      }}
                      icon={Trash2}
                    >
                      회수
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

function RevokedTitleTable({
  items,
  sortKey,
  descending,
  onToggleSort,
  onRevokeTitle,
}) {
  if (!items.length) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="회수 이력이 없습니다"
        description="회수된 칭호가 생기면 이곳에서 복구하거나 기록을 확인할 수 있습니다."
      />
    );
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <article
            key={`mobile-${item.ownedId}-revoked`}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-black text-slate-900">
                {item.name || "이름 없는 칭호"}
              </p>
              <Badge tone="red">회수됨</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={item.gradeTone || "slate"}>
                {item.gradeLabel || "등급 없음"}
              </Badge>
              <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-slate-400">회수일</dt>
                <dd className="text-right text-slate-600">
                  {item.revokedAt ? formatDate(item.revokedAt) : "-"}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-400">회수 사유</dt>
                <dd className="mt-1 break-words leading-5 text-slate-600">
                  {item.revokeReason || "회수 사유가 기록되지 않았습니다."}
                </dd>
              </div>
            </dl>
            <Button
              size="sm"
              tone="emerald"
              variant="outline"
              onClick={() => onRevokeTitle(item)}
              icon={CheckCircle2}
              className="mt-4 min-h-11 w-full"
            >
              복구
            </Button>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/90">
          <tr className="text-left text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.name}
                active={sortKey === "name"}
                descending={descending}
                onClick={() => onToggleSort("name")}
              />
            </th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.grade}
                active={sortKey === "grade"}
                descending={descending}
                onClick={() => onToggleSort("grade")}
              />
            </th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.category}
                active={sortKey === "category"}
                descending={descending}
                onClick={() => onToggleSort("category")}
              />
            </th>
            <th className="px-4 py-3">
              <SortHeaderButton
                label={SORT_LABELS.revokedAt}
                active={sortKey === "revokedAt"}
                descending={descending}
                onClick={() => onToggleSort("revokedAt")}
              />
            </th>
            <th className="px-4 py-3">회수 사유</th>
            <th className="px-4 py-3 text-right">작업</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((item) => (
            <tr
              key={`${item.ownedId}-revoked`}
              className="align-top transition hover:bg-slate-50/70"
            >
              <td className="px-4 py-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-slate-900">
                      {item.name || "이름 없는 칭호"}
                    </p>
                    <Badge tone="red">회수됨</Badge>
                  </div>
                  {item.restoredAt ? (
                    <p className="text-xs text-slate-400">
                      마지막 복구일 {formatDate(item.restoredAt)}
                    </p>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-4">
                {item.gradeLabel ? (
                  <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge>
                ) : (
                  <Badge tone="slate">등급 없음</Badge>
                )}
              </td>
              <td className="px-4 py-4">
                <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
              </td>
              <td className="px-4 py-4 text-slate-500">
                {item.revokedAt ? formatDate(item.revokedAt) : "-"}
              </td>
              <td className="px-4 py-4 text-slate-600">
                {item.revokeReason || "회수 사유가 기록되지 않았습니다."}
              </td>
              <td className="px-4 py-4">
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    tone="emerald"
                    variant="outline"
                    onClick={() => onRevokeTitle(item)}
                    icon={CheckCircle2}
                  >
                    복구
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

export default function TeacherTitleStudentDetailModal({
  open,
  onClose,
  studentLabel,
  ownedTitlesLoading,
  activeOwnedTitles,
  revokedOwnedTitles,
  onRevokeTitle,
  onRevokeTitlesBulk,
  onEquipTitle,
  onUpdateRepresentativeTitles,
  submissionKey = "",
  canManageRepresentativeTitles = false,
}) {
  const [selectedActiveIds, setSelectedActiveIds] = useState([]);
  const [dragSelection, setDragSelection] = useState({
    active: false,
    shouldSelect: true,
  });
  const [activeSort, setActiveSort] = useState({
    key: "obtainedAt",
    descending: true,
  });
  const [revokedSort, setRevokedSort] = useState({
    key: "revokedAt",
    descending: true,
  });
  const [activeDetailTab, setActiveDetailTab] = useState("active");

  const sortedActiveTitles = useMemo(
    () => sortOwnedItems(activeOwnedTitles, activeSort.key, activeSort.descending),
    [activeOwnedTitles, activeSort],
  );
  const sortedRevokedTitles = useMemo(
    () => sortOwnedItems(revokedOwnedTitles, revokedSort.key, revokedSort.descending),
    [revokedOwnedTitles, revokedSort],
  );

  const selectedActiveItems = useMemo(
    () =>
      sortedActiveTitles.filter((item) => selectedActiveIds.includes(item.ownedId)),
    [sortedActiveTitles, selectedActiveIds],
  );

  const selectedEquippedItems = selectedActiveItems.filter((item) => item.equipped);
  const selectedNotEquippedItems = selectedActiveItems.filter((item) => !item.equipped);

  useEffect(() => {
    if (!dragSelection.active) return undefined;

    const stopDragSelection = () => {
      setDragSelection((prev) => (prev.active ? { ...prev, active: false } : prev));
    };

    window.addEventListener("mouseup", stopDragSelection);
    return () => window.removeEventListener("mouseup", stopDragSelection);
  }, [dragSelection.active]);

  useEffect(() => {
    if (!open) {
      setActiveDetailTab("active");
      setSelectedActiveIds([]);
    }
  }, [open]);

  const toggleActiveSelection = (ownedId) => {
    setSelectedActiveIds((prev) =>
      prev.includes(ownedId)
        ? prev.filter((id) => id !== ownedId)
        : [...prev, ownedId],
    );
  };

  const toggleAllActive = () => {
    if (
      sortedActiveTitles.length > 0 &&
      selectedActiveIds.length === sortedActiveTitles.length
    ) {
      setSelectedActiveIds([]);
      return;
    }
    setSelectedActiveIds(sortedActiveTitles.map((item) => item.ownedId));
  };

  const handleRowPointerDown = (ownedId, event) => {
    if (event.button !== 0) return;

    const shouldSelect = !selectedActiveIds.includes(ownedId);
    setDragSelection({
      active: true,
      shouldSelect,
    });

    setSelectedActiveIds((prev) => {
      if (shouldSelect) {
        return prev.includes(ownedId) ? prev : [...prev, ownedId];
      }
      return prev.filter((id) => id !== ownedId);
    });
  };

  const handleRowMouseEnter = (ownedId) => {
    if (!dragSelection.active) return;

    setSelectedActiveIds((prev) => {
      if (dragSelection.shouldSelect) {
        return prev.includes(ownedId) ? prev : [...prev, ownedId];
      }
      return prev.filter((id) => id !== ownedId);
    });
  };

  const toggleSort = (setter, current, key) => {
    setter({
      key,
      descending: current.key === key ? !current.descending : false,
    });
  };

  if (!open) return null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`${studentLabel} 칭호 보유 현황`}
      size="xl"
    >
      <div className="space-y-4">
        <Card
          className="overflow-hidden border-slate-200 bg-white"
          variant="elevated"
          tone="white"
          noShadow
        >
          {ownedTitlesLoading ? (
            <div className="py-12">
              <Spinner />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <Tabs
                  tabs={DETAIL_TABS}
                  activeTab={activeDetailTab}
                  onTabChange={setActiveDetailTab}
                  variant="underline"
                  size="md"
                  className="w-full max-w-md"
                />
                <div className="flex flex-wrap gap-2">
                  <Badge tone={activeOwnedTitles.length ? "emerald" : "slate"}>
                    보유 {activeOwnedTitles.length}개
                  </Badge>
                  <Badge tone={revokedOwnedTitles.length ? "red" : "slate"}>
                    회수 {revokedOwnedTitles.length}건
                  </Badge>
                </div>
              </div>

              {activeDetailTab === "active" ? (
                <ActiveTitleTable
                  items={sortedActiveTitles}
                  selectedIds={selectedActiveIds}
                  onToggleSelection={toggleActiveSelection}
                  onToggleAll={toggleAllActive}
                  onRowPointerDown={handleRowPointerDown}
                  onRowMouseEnter={handleRowMouseEnter}
                  onRevokeTitle={onRevokeTitle}
                  onEquipTitle={onEquipTitle}
                  submissionKey={submissionKey}
                  canManageRepresentativeTitles={canManageRepresentativeTitles}
                  sortKey={activeSort.key}
                  descending={activeSort.descending}
                  onToggleSort={(key) =>
                    toggleSort(setActiveSort, activeSort, key)
                  }
                />
              ) : null}

              {activeDetailTab === "revoked" ? (
                <RevokedTitleTable
                  items={sortedRevokedTitles}
                  sortKey={revokedSort.key}
                  descending={revokedSort.descending}
                  onToggleSort={(key) =>
                    toggleSort(setRevokedSort, revokedSort, key)
                  }
                  onRevokeTitle={onRevokeTitle}
                />
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <BulkActionFloatingBar
        count={activeDetailTab === "active" ? selectedActiveItems.length : 0}
        eyebrow="보유 칭호 선택"
        title={`선택 칭호 ${selectedActiveItems.length}개`}
        subtitle="선택한 칭호를 한 번에 회수하거나 대표 명패로 설정/해제합니다."
        tone="indigo"
        icon={Sparkles}
        placement="sticky"
        actions={[
          {
            key: "bulk-revoke",
            label: "선택 회수",
            icon: Trash2,
            tone: "rose",
            onClick: () => onRevokeTitlesBulk?.(selectedActiveItems),
            isLoading: submissionKey === "title-revoke-bulk",
          },
          {
            key: "bulk-set-representative",
            label: "대표 설정",
            icon: Sparkles,
            tone: "indigo",
            onClick: () => onUpdateRepresentativeTitles?.(selectedActiveItems, "set"),
            isLoading: submissionKey === "equip-selected-set",
            disabled:
              !canManageRepresentativeTitles ||
              selectedActiveItems.length === 0 ||
              selectedActiveItems.length > 3,
          },
          {
            key: "bulk-clear-representative",
            label: "대표 해제",
            icon: CheckCircle2,
            tone: "slate",
            kind: "outline",
            onClick: () => onUpdateRepresentativeTitles?.(selectedEquippedItems, "unset"),
            isLoading: submissionKey === "equip-selected-clear",
            disabled:
              !canManageRepresentativeTitles || selectedEquippedItems.length === 0,
          },
        ]}
        onClear={() => setSelectedActiveIds([])}
        clearLabel="선택 해제"
      >
        {selectedActiveItems.length > 3 ? (
          <p className="text-xs text-amber-600">
            대표 명패는 한 번에 최대 3개까지만 설정할 수 있습니다.
          </p>
        ) : selectedNotEquippedItems.length ? (
          <p className="text-xs text-slate-500">
            선택한 칭호 {selectedNotEquippedItems.length}개를 대표 명패 세트로 지정할 수 있습니다.
          </p>
        ) : null}
      </BulkActionFloatingBar>
    </Modal>
  );
}
