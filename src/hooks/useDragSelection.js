import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_RESOLVE_MODE = (_, isSelected) =>
  isSelected ? "deselect" : "select";

export default function useDragSelection({
  isSelected,
  onSelect,
  onDeselect,
  isItemEnabled = () => true,
  resolveMode = DEFAULT_RESOLVE_MODE,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const dragStateRef = useRef({ active: false, mode: null });

  const stopDrag = useCallback(() => {
    dragStateRef.current = { active: false, mode: null };
    setIsDragging(false);
    setDragMode(null);
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", stopDrag);
    window.addEventListener("blur", stopDrag);

    return () => {
      window.removeEventListener("mouseup", stopDrag);
      window.removeEventListener("blur", stopDrag);
    };
  }, [stopDrag]);

  const applyMode = useCallback(
    (item, mode) => {
      if (!mode || !isItemEnabled(item)) return false;
      if (mode === "select") {
        onSelect?.(item);
        return true;
      }
      if (mode === "deselect") {
        onDeselect?.(item);
        return true;
      }
      return false;
    },
    [isItemEnabled, onDeselect, onSelect],
  );

  const startDrag = useCallback(
    (item, options = {}) => {
      if (!isItemEnabled(item)) return false;

      const currentSelected =
        options.selected ?? Boolean(isSelected?.(item));
      const nextMode =
        options.mode ?? resolveMode(item, currentSelected);

      dragStateRef.current = { active: true, mode: nextMode };
      setIsDragging(true);
      setDragMode(nextMode);
      return applyMode(item, nextMode);
    },
    [applyMode, isItemEnabled, isSelected, resolveMode],
  );

  const enterDrag = useCallback(
    (item) => {
      const { active, mode } = dragStateRef.current;
      if (!active || !mode) return false;
      return applyMode(item, mode);
    },
    [applyMode],
  );

  return {
    isDragging,
    dragMode,
    startDrag,
    enterDrag,
    stopDrag,
    applyMode,
  };
}
