import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo } from "react";
import { CategoryChipBar } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";

const sortCategories = (categories = []) =>
  [...categories].sort((a, b) => {
    if (a.id === "popular") return -1;
    if (b.id === "popular") return 1;
    if (a.id === "legacy") return 1;
    if (b.id === "legacy") return -1;
    return (a.order ?? 0) - (b.order ?? 0);
  });

const NewsCategories = ({
  selectedCategory,
  categories = [],
  onCategoryChange,
  onReorderCategories,
  onEditCategory,
  onDeleteCategory,
  onOpenAddCategoryModal,
}) => {
  const { hasPermission } = useUser();
  const canEdit = hasPermission("news_admin");

  const orderedCategories = useMemo(
    () => sortCategories(categories),
    [categories],
  );

  const chipItems = useMemo(
    () =>
      orderedCategories.map((category) => ({
        id: category.id,
        label: category.label,
        iconKey: category.icon || "Newspaper",
        colorKey: category.color || "blue",
        active: category.isActive !== false,
        locked: Boolean(category.isDefault),
        raw: category,
      })),
    [orderedCategories],
  );

  useEffect(() => {
    if (chipItems.length > 0 && !selectedCategory) {
      const firstActive = chipItems.find((item) => item.active !== false);
      if (firstActive) onCategoryChange?.(firstActive.id);
    }
  }, [chipItems, onCategoryChange, selectedCategory]);

  const handleDelete = async (item) => {
    const message = item.locked
      ? `"${item.label}" 기본 주제를 삭제할까요?`
      : `"${item.label}" 주제를 삭제할까요?`;

    if ((await appConfirm(message))) {
      onDeleteCategory?.(item.raw);
    }
  };

  return (
    <CategoryChipBar
      title="뉴스 주제"
      items={chipItems}
      selectedId={selectedCategory}
      onSelect={onCategoryChange}
      canEdit={canEdit}
      onAdd={onOpenAddCategoryModal}
      onEdit={(item) => onEditCategory?.(item.raw)}
      onDelete={handleDelete}
      onReorder={(items) => onReorderCategories?.(items.map((item) => item.raw))}
      mode="navigation"
      addLabel="주제 추가"
    />
  );
};

export default NewsCategories;
