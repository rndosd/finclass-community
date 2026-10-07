import React, { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { IconButton, Spinner } from "../../../components/ui";
import StoreItemCard from "./StoreItemCard";

const SortableStoreItem = ({ item, canReorder, saving, ...cardProps }) => {
  const {
    setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging,
  } = useSortable({ id: item.id, disabled: !canReorder || saving });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 30 : undefined }}
      className={`relative min-w-0 ${isDragging ? "opacity-80" : ""}`}
    >
      <StoreItemCard
        {...cardProps}
        item={item}
        orderDragHandle={canReorder ? (
          <IconButton
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            icon={GripVertical}
            label={`${item.name} 순서 변경`}
            title="드래그하여 상품 순서 변경"
            disabled={saving}
            tone={cardProps.isVipLounge ? "amber" : "slate"}
            className={`touch-none cursor-grab active:cursor-grabbing ${cardProps.isVipLounge ? "bg-black/40 text-slate-300" : "bg-white text-slate-400"}`}
          />
        ) : null}
      />
    </div>
  );
};

const StoreItemList = ({
  items,
  currencyUnit,
  classData,
  canManageStore,
  allowOrderEditing = true,
  onBuyItem,
  onAddToCart,
  onEditItem,
  onDeleteItem,
  onReorderItems,
  isLoadingItems,
  categoryName,
  emptyStateClassName = "",
  emptyStateTextClassName = "",
  isVipLounge = false,
  purchaseDisabled = false,
}) => {
  const [orderedItems, setOrderedItems] = useState(items || []);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const latestItemsRef = useRef(items || []);
  const canReorder = canManageStore && allowOrderEditing && items?.length > 1 && Boolean(onReorderItems);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    latestItemsRef.current = items || [];
    if (!savingRef.current) setOrderedItems(items || []);
  }, [items]);

  const handleDragEnd = async ({ active, over }) => {
    if (!canReorder || savingRef.current || !over || active.id === over.id) return;
    const oldIndex = orderedItems.findIndex((item) => item.id === active.id);
    const newIndex = orderedItems.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(orderedItems, oldIndex, newIndex);
    savingRef.current = true;
    setSaving(true);
    setOrderedItems(reordered);
    try {
      const saved = await onReorderItems(reordered);
      if (saved === false) setOrderedItems(latestItemsRef.current);
    } catch {
      setOrderedItems(latestItemsRef.current);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (isLoadingItems) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Spinner size="lg" />
        <p className="mt-4 text-sm font-medium text-slate-400">상품을 불러오는 중입니다...</p>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className={`rounded-[2.5rem] border-2 border-dashed border-slate-100 bg-white py-20 text-center ${emptyStateClassName}`}>
        <p className={`font-medium text-slate-400 ${emptyStateTextClassName}`}>
          {categoryName === "특가" ? "현재 진행 중인 특가 상품이 없습니다." : `"${categoryName}" 카테고리에 등록된 상품이 없습니다.`}
        </p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedItems.map((item) => item.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={saving}>
          {orderedItems.map((item) => (
            <SortableStoreItem
              key={item.id}
              item={item}
              canReorder={canReorder}
              saving={saving}
              currencyUnit={currencyUnit}
              classData={classData}
              onBuyItem={onBuyItem}
              onAddToCart={onAddToCart}
              onEditItem={onEditItem}
              onDeleteItem={onDeleteItem}
              isStoreAdmin={canManageStore}
              isVipLounge={isVipLounge}
              purchaseDisabled={purchaseDisabled}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

export default StoreItemList;
