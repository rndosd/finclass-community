import { useEffect, useMemo, useState } from "react";
import { Medal, Search, Send } from "lucide-react";

import {
  Badge,
  BulkActionFloatingBar,
  Button,
  CategoryChipBar,
  InputField,
  Modal,
  Spinner,
} from "../../../components/ui";
import { buildStudentLabel, EmptyState, formatDexNumber } from "../CredentialsPage.parts";

function buildTitleRowDescription(item) {
  const parts = [];
  if (item?.description) parts.push(item.description);
  if (item?.acquisitionCondition) {
    parts.push(`획득 조건: ${item.acquisitionCondition}`);
  }
  return parts.join(" / ");
}

export default function TeacherTitleIssuePickerModal({
  open,
  onClose,
  items,
  categoryItems,
  selectedCategoryId,
  onSelectCategory,
  isLoading,
  selectedStudents,
  onIssue,
  onIssueSelected,
  submissionKey,
}) {
  const [selectedTitleIds, setSelectedTitleIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!open) {
      setSelectedTitleIds([]);
      setSearchTerm("");
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return items;

    return items.filter((item) => {
      const searchableText = [
        item?.name,
        item?.description,
        item?.acquisitionCondition,
        item?.categoryLabel,
        item?.gradeLabel,
        formatDexNumber(item?.displayOrder),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(keyword);
    });
  }, [items, searchTerm]);

  const selectedItems = useMemo(() => {
    const selectedIdSet = new Set(selectedTitleIds);
    return items.filter((item) => selectedIdSet.has(item.id));
  }, [items, selectedTitleIds]);

  const allSelectableIds = useMemo(
    () => filteredItems.map((item) => item.id).filter(Boolean),
    [filteredItems],
  );

  const allSelected =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((itemId) => selectedTitleIds.includes(itemId));

  const toggleSelection = (itemId) => {
    setSelectedTitleIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    );
  };

  const toggleAllSelection = () => {
    setSelectedTitleIds((prev) => {
      const selectableIdSet = new Set(allSelectableIds);
      if (allSelected) {
        return prev.filter((itemId) => !selectableIdSet.has(itemId));
      }
      return [...new Set([...prev, ...allSelectableIds])];
    });
  };

  const handleBulkIssue = () => {
    if (!selectedItems.length) return;
    onIssueSelected?.(selectedItems);
  };

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onClose} title="칭호 지급" size="xl">
      <div className="space-y-5">
        <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">선택 학생 {selectedStudents.length}명</Badge>
            {selectedStudents.slice(0, 4).map((student) => (
              <Badge key={student.uid} tone="slate">
                {buildStudentLabel(student)}
              </Badge>
            ))}
            {selectedStudents.length > 4 ? (
              <Badge tone="slate">+{selectedStudents.length - 4}</Badge>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            목록에서 지급할 칭호를 여러 개 선택한 뒤 한 번에 지급할 수 있습니다.
          </p>
        </div>

        {categoryItems?.length ? (
          <CategoryChipBar
            items={categoryItems}
            selectedId={selectedCategoryId}
            onSelect={onSelectCategory}
            title="카테고리 보기"
            className="mt-0"
          />
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-9 h-4 w-4 text-slate-400" />
            <InputField
              label="칭호 검색"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="칭호명, 조건, 설명, 번호로 찾기"
              className="pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-12">
            <Spinner />
          </div>
        ) : items.length ? (
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed">
                <thead className="bg-slate-50/90">
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    <th className="w-14 px-4 py-4">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAllSelection}
                        onClick={(event) => event.stopPropagation()}
                        aria-label="전체 선택"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="w-24 px-4 py-4">번호</th>
                    <th className="min-w-[260px] px-4 py-4">칭호</th>
                    <th className="w-40 px-4 py-4">카테고리</th>
                    <th className="w-28 px-4 py-4">등급</th>
                    <th className="w-28 px-4 py-4">공개</th>
                    <th className="w-28 px-4 py-4 text-right">단건</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isSelected = selectedTitleIds.includes(item.id);
                    return (
                      <tr
                        key={`issue-${item.id}`}
                        onClick={() => toggleSelection(item.id)}
                        className={[
                          "cursor-pointer border-b border-slate-100 align-top transition",
                          isSelected ? "bg-indigo-50/70" : "bg-white hover:bg-slate-50/80",
                        ].join(" ")}
                      >
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelection(item.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`${item.name} 선택`}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <Badge tone="slate">
                            No. {formatDexNumber(item.displayOrder)}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-1">
                            <p className="font-bold text-slate-900">{item.name}</p>
                            <p className="text-xs leading-5 text-slate-500">
                              {buildTitleRowDescription(item) || "설명 없음"}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
                        </td>
                        <td className="px-4 py-4">
                          <Badge tone={item.gradeTone || "slate"}>
                            {item.gradeLabel || "등급 없음"}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          <Badge tone={item.isVisible === false ? "amber" : "emerald"}>
                            {item.isVisible === false ? "숨김" : "공개"}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Button
                            size="sm"
                            tone="indigo"
                            icon={Send}
                            onClick={(event) => {
                              event.stopPropagation();
                              onIssue?.(item);
                            }}
                            isLoading={submissionKey === `quick-title-issue-${item.id}`}
                          >
                            지급
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredItems.length ? (
                <div className="border-t border-slate-100 px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-slate-700">
                    검색 결과가 없습니다
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    검색어를 줄이거나 카테고리 필터를 바꿔 주세요.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Medal}
            title="지급 가능한 칭호가 없습니다"
            description="카테고리 필터를 바꾸거나 칭호 정의의 활성 상태를 확인해 주세요."
          />
        )}
      </div>

      <BulkActionFloatingBar
        count={selectedItems.length}
        eyebrow="선택 칭호"
        title={`선택 칭호 ${selectedItems.length}개`}
        subtitle="선택한 칭호를 현재 선택된 학생들에게 한 번에 지급합니다."
        tone="indigo"
        icon={Send}
        actions={[
          {
            key: "issue-selected-titles",
            label: "선택 칭호 지급",
            icon: Send,
            tone: "indigo",
            onClick: handleBulkIssue,
            isLoading: submissionKey === "quick-title-issue-bulk",
          },
        ]}
        onClear={() => setSelectedTitleIds([])}
        clearLabel="선택 해제"
        dismissOnBackdropClick={false}
      />
    </Modal>
  );
}
