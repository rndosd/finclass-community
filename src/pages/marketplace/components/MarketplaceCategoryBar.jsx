import { appAlert, appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo } from "react";
import { CategoryChipBar } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";

const stripLeadingEmoji = (raw = "") => {
  const match = raw.match(
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})\s*/u,
  );
  return match ? raw.slice(match[0].length).trim() : raw;
};

const MarketplaceCategoryBar = ({
  categories = [],
  selectedCategoryId = "all",
  onCategoryChange,
  onOpenAddCategoryModal,
  onReorderCategories,
  onEditCategory,
  onDeleteCategory,
  className = "",
}) => {
  const { isTeacher, hasPermission } = useUser();
  const isMarketplaceAdmin = isTeacher || hasPermission("marketplace_admin");

  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [categories],
  );

  const chipItems = useMemo(
    () => [
      {
        id: "all",
        label: "전체",
        iconKey: "Tag",
        colorKey: "slate",
        active: true,
        raw: null,
      },
      ...orderedCategories.map((category) => ({
        id: category.id,
        label: stripLeadingEmoji(category.name),
        iconKey: category.icon || "Tag",
        colorKey: category.iconColor,
        active: category.isActive !== false,
        raw: category,
      })),
    ],
    [orderedCategories],
  );

  useEffect(() => {
    const hasSelectedCategory = chipItems.some(
      (item) => item.id === selectedCategoryId,
    );

    if (!hasSelectedCategory) {
      onCategoryChange?.("all");
    }
  }, [chipItems, onCategoryChange, selectedCategoryId]);

  const handleDelete = async (item) => {
    if (!item.raw) return;

    if (categories.length <= 1) {
      appAlert("카테고리는 최소 1개 이상 있어야 합니다.");
      return;
    }

    if ((await appConfirm(`"${item.label}" 카테고리를 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
      onDeleteCategory?.(item.raw);
    }
  };

  return (
    <CategoryChipBar
      title="장터 카테고리"
      items={chipItems}
      selectedId={selectedCategoryId}
      onSelect={onCategoryChange}
      canEdit={isMarketplaceAdmin}
      onAdd={onOpenAddCategoryModal}
      onEdit={(item) => item.raw && onEditCategory?.(item.raw)}
      onDelete={handleDelete}
      onReorder={(items) =>
        onReorderCategories?.(items.map((item) => item.raw).filter(Boolean))
      }
      mode="navigation"
      addLabel="카테고리 추가"
      className={className}
    />
  );
};

export default MarketplaceCategoryBar;
