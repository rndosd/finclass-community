import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { Check, ChevronDown, ChevronUp, RotateCcw, Shield } from "lucide-react";

import { db } from "../../firebase";
import { useUser } from "../../contexts/UserContext";

const NO_TIER_ID = "__no_tier__";

const normalizeTierDefinition = (tierData = {}) => {
  if (!tierData) return null;

  if (typeof tierData === "string") {
    const value = tierData.trim();
    if (!value) return null;

    return {
      id: value,
      name: value,
      color: "#64748b",
      minScore: 0,
    };
  }

  const id = String(tierData?.id || tierData?.name || "").trim();
  if (!id) return null;

  const parsedMinScore = Number(tierData?.minScore);

  return {
    id,
    name: String(tierData?.name || id).trim(),
    color: tierData?.color || "#64748b",
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
};

const normalizeTierFromStudent = (studentData = {}) => {
  const rawTier = studentData?.creditTier;
  if (!rawTier) {
    return null;
  }

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    if (!value) return null;

    return {
      id: value,
      name: value,
      color: "#64748b",
      minScore: Number.NEGATIVE_INFINITY,
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  if (!id) return null;

  return {
    id,
    name: String(rawTier?.name || rawTier?.id || id).trim(),
    color: rawTier?.color || "#64748b",
    minScore: Number.isFinite(Number(rawTier?.minScore))
      ? Number(rawTier.minScore)
      : Number.NEGATIVE_INFINITY,
  };
};

const sortTiers = (tiers = []) =>
  [...tiers].sort((left, right) => {
    const scoreDelta = Number(right.minScore) - Number(left.minScore);
    if (!Number.isNaN(scoreDelta) && scoreDelta !== 0) return scoreDelta;
    return String(left.name || "").localeCompare(String(right.name || ""), "ko");
  });

const CreditTierSelector = ({
  label,
  selectedTierIds = [],
  onChange,
  singleSelect = false,
}) => {
  const { classId } = useUser();
  const [allTiers, setAllTiers] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        isExpanded &&
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  const fetchTiers = useCallback(async () => {
    if (!classId) {
      setAllTiers([]);
      return;
    }

    try {
      const [tierSnapshot, studentSnapshot] = await Promise.all([
        getDoc(doc(db, `classes/${classId}/tierCriteria/default`)),
        getDocs(
          query(
            collection(db, `classes/${classId}/students`),
            orderBy("studentNumber"),
          ),
        ),
      ]);

      const tierMap = new Map();
      const configuredTiers = Array.isArray(tierSnapshot.data()?.tiers)
        ? tierSnapshot.data().tiers
        : [];

      configuredTiers.forEach((rawTier) => {
        const normalized = normalizeTierDefinition(rawTier);
        if (!normalized || tierMap.has(normalized.id)) return;
        tierMap.set(normalized.id, normalized);
      });

      let hasNoTier = false;

      studentSnapshot.forEach((docSnap) => {
        const normalized = normalizeTierFromStudent(docSnap.data() || {});

        if (!normalized) {
          hasNoTier = true;
          return;
        }

        if (!tierMap.has(normalized.id)) {
          tierMap.set(normalized.id, normalized);
        }
      });

      if (hasNoTier) {
        tierMap.set(NO_TIER_ID, {
          id: NO_TIER_ID,
          name: "무등급",
          color: "#94a3b8",
          minScore: Number.NEGATIVE_INFINITY,
        });
      }

      setAllTiers(sortTiers(Array.from(tierMap.values())));
    } catch (error) {
      console.error("신용등급 목록 로드 실패:", error);
      setAllTiers([]);
    }
  }, [classId]);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const toggleTier = (tierId, mode) => {
    if (singleSelect) {
      onChange(mode === "select" ? [tierId] : []);
      if (mode === "select") setIsExpanded(false);
      return;
    }

    const next = new Set(selectedTierIds);
    if (mode === "select") next.add(tierId);
    else next.delete(tierId);
    onChange(Array.from(next));
  };

  const handleMouseDown = (tierId, isSelected) => {
    if (singleSelect) {
      toggleTier(tierId, isSelected ? "deselect" : "select");
      return;
    }

    const nextMode = isSelected ? "deselect" : "select";
    setIsDragging(true);
    setDragMode(nextMode);
    toggleTier(tierId, nextMode);
  };

  const handleMouseEnter = (tierId) => {
    if (!singleSelect && isDragging && dragMode) {
      toggleTier(tierId, dragMode);
    }
  };

  const selectedLabel = (() => {
    if (selectedTierIds.length === 0) return "등급을 선택하세요";

    if (singleSelect) {
      const tier = allTiers.find((item) => item.id === selectedTierIds[0]);
      return `${tier?.name || "1개"} 선택됨`;
    }

    if (selectedTierIds.length === allTiers.length && allTiers.length > 0) {
      return "모든 등급 선택됨";
    }

    return `${selectedTierIds.length}개 등급 선택됨`;
  })();

  return (
    <div className="space-y-1 select-none" ref={containerRef}>
      <label className="ml-1 text-[10px] font-black uppercase tracking-tighter text-slate-400">
        {label || "신용등급 선택"}
      </label>

      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className={`flex w-full items-center justify-between rounded-xl border bg-white px-3 py-2 transition-all ${
          isExpanded
            ? "border-indigo-500 ring-2 ring-indigo-50"
            : "border-slate-100 hover:border-slate-200"
        }`}
      >
        <div className="flex items-center gap-2">
          <Shield
            size={14}
            className={
              selectedTierIds.length > 0 ? "text-indigo-500" : "text-slate-300"
            }
          />
          <span className="text-xs font-bold text-slate-700">{selectedLabel}</span>
        </div>
        {isExpanded ? (
          <ChevronUp size={14} className="text-indigo-500" />
        ) : (
          <ChevronDown size={14} className="text-slate-400" />
        )}
      </button>

      {isExpanded ? (
        <div className="animate-in slide-in-from-top-1 rounded-xl border border-slate-100 bg-slate-50 p-2.5 shadow-lg fade-in duration-200">
          {!singleSelect ? (
            <div className="mb-2.5 flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="text-[8px] font-bold text-slate-400">빠른 선택</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      selectedTierIds.length === allTiers.length
                        ? []
                        : allTiers.map((tier) => tier.id),
                    )
                  }
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[8px] font-bold text-slate-400 transition-all hover:border-indigo-300 hover:text-indigo-500"
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="p-1 text-slate-300 hover:text-rose-500"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>
          ) : null}

          <div className="custom-scrollbar grid max-h-[180px] grid-cols-2 gap-1.5 overflow-y-auto p-0.5 sm:grid-cols-3">
            {allTiers.length === 0 ? (
              <div className="col-span-full py-4 text-center text-xs text-slate-400">
                설정된 신용등급이 없습니다.
              </div>
            ) : (
              allTiers.map((tier) => {
                const isSelected = selectedTierIds.includes(tier.id);

                return (
                  <button
                    key={tier.id}
                    type="button"
                    onMouseDown={() => handleMouseDown(tier.id, isSelected)}
                    onMouseEnter={() => handleMouseEnter(tier.id)}
                    className={`relative rounded-lg border px-2 py-2 text-left transition-all ${
                      isSelected
                        ? "border-indigo-400 bg-white text-indigo-700 shadow-sm"
                        : "border-transparent bg-slate-200/40 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: tier.color || "#64748b" }}
                      />
                      <span className="truncate text-[11px] font-bold">
                        {tier.name}
                      </span>
                    </div>
                    {isSelected ? (
                      <div className="absolute -right-1 -top-1 rounded-full bg-indigo-500 p-0.5 text-white">
                        <Check size={6} strokeWidth={5} />
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CreditTierSelector;
