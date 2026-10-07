import React, { useEffect, useMemo } from "react";

import { CategoryChipBar } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import {
  formatVipRequirementLabel,
  getVipLoungeCategory,
  isVipLoungeCategory,
} from "../utils/vipLounge";

const VIP_LOUNGE_ADD_ID = "__add_vip_lounge__";

const stripLeadingEmoji = (raw = "") => {
  const match = raw.match(
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})\s*/u,
  );
  return match ? raw.slice(match[0].length).trim() : raw;
};

const StoreToolbar = ({
  activeTab,
  selectedCategoryId,
  categories = [],
  onCategoryChange,
  onOpenAddCategoryModal,
  onOpenAddVipLoungeModal,
  onReorderCategories,
  onEditCategory,
  onDeleteCategory,
  canManageStore = false,
  canManageVipLounge = false,
}) => {
  const { hasPermission } = useUser();
  const canEdit = canManageStore || hasPermission("store_admin");

  const vipLounge = useMemo(
    () => getVipLoungeCategory(categories),
    [categories],
  );

  const orderedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        if (a?.isVirtual === true) return -1;
        if (b?.isVirtual === true) return 1;
        return (a.order ?? 0) - (b.order ?? 0);
      }),
    [categories],
  );

  const chipItems = useMemo(() => {
    const baseItems = orderedCategories.map((category) => {
      const isVip = isVipLoungeCategory(category);

      return {
        id: category.id,
        label: stripLeadingEmoji(category.name),
        iconKey: isVip ? category.icon || "Crown" : category.icon,
        colorKey: category.iconColor,
        active: category.isActive !== false,
        editable: category.isVirtual !== true && (!isVip || canManageVipLounge),
        deletable: category.isVirtual !== true && (!isVip || canManageVipLounge),
        reorderable: category.isVirtual !== true && (!isVip || canManageVipLounge),
        variant: isVip ? "vip" : "normal",
        badgeLabel: isVip ? formatVipRequirementLabel(category) : "",
        raw: category,
      };
    });

    if (canManageVipLounge && !vipLounge) {
      baseItems.push({
        id: VIP_LOUNGE_ADD_ID,
        label: "VIP 라운지 추가",
        iconKey: "Crown",
        colorKey: "slate",
        active: true,
        editable: false,
        deletable: false,
        reorderable: false,
        variant: "vip",
        badgeLabel: "교사 전용",
        action: true,
      });
    }

    return baseItems;
  }, [canManageVipLounge, orderedCategories, vipLounge]);

  useEffect(() => {
    if (chipItems.length > 0 && !selectedCategoryId) {
      const firstCategory = chipItems.find((item) => item.raw);
      if (firstCategory) onCategoryChange?.(firstCategory.id);
    }
  }, [chipItems, onCategoryChange, selectedCategoryId]);

  const handleSelect = (categoryId) => {
    if (categoryId === VIP_LOUNGE_ADD_ID) {
      onOpenAddVipLoungeModal?.(null);
      return;
    }

    onCategoryChange?.(categoryId);
  };

  if (activeTab !== "shop") return null;

  return (
    <CategoryChipBar
      title="상점 카테고리"
      items={chipItems}
      selectedId={selectedCategoryId}
      onSelect={handleSelect}
      canEdit={canEdit}
      onAdd={onOpenAddCategoryModal}
      onEdit={(item) => item.raw && onEditCategory?.(item.raw)}
      onDelete={(item) => item.raw && onDeleteCategory?.(item.raw)}
      onReorder={(items) =>
        onReorderCategories?.(
          items
            .filter((item) => item.raw && item.reorderable !== false)
            .map((item) => item.raw),
        )
      }
      mode="navigation"
      addLabel="카테고리 추가"
    />
  );
};

export default StoreToolbar;
