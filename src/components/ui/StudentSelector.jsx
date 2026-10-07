import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  Users,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";

import { db } from "../../firebase";
import { useUser } from "../../contexts/UserContext";

const TEAM_META = [
  { id: "team1", name: "1모둠" },
  { id: "team2", name: "2모둠" },
  { id: "team3", name: "3모둠" },
  { id: "team4", name: "4모둠" },
  { id: "team5", name: "5모둠" },
  { id: "team6", name: "6모둠" },
];

const TEAM_ORDER = new Map(TEAM_META.map((team, index) => [team.id, index]));
const TEAM_NAME_MAP = TEAM_META.reduce((accumulator, team) => {
  accumulator[team.id] = team.name;
  return accumulator;
}, {});

const NO_TIER_ID = "__no_credit_tier__";
const STUDENT_SEARCH_PLACEHOLDER = "이름 또는 학번으로 검색";
const GROUP_SEARCH_PLACEHOLDER = "모둠명, 이름 또는 학번으로 검색";
const SEARCH_EMPTY_MESSAGE = "검색 결과가 없습니다.";

const isValidTeamId = (value) => /^team\d+$/.test(String(value || "").trim());
const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim().toLowerCase();

const normalizeGroupingByStudent = (raw) => {
  if (!raw || typeof raw !== "object") return {};

  return Object.entries(raw).reduce((accumulator, [uid, teamId]) => {
    const safeUid = String(uid || "").trim();
    const safeTeamId = String(teamId || "").trim();
    if (!safeUid || !isValidTeamId(safeTeamId)) return accumulator;
    accumulator[safeUid] = safeTeamId;
    return accumulator;
  }, {});
};

const normalizeStudentTier = (member = {}) => {
  const rawTier = member?.creditTier;
  if (!rawTier) {
    return {
      id: NO_TIER_ID,
      name: "무등급",
      minScore: Number.NEGATIVE_INFINITY,
    };
  }

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    if (!value) {
      return {
        id: NO_TIER_ID,
        name: "무등급",
        minScore: Number.NEGATIVE_INFINITY,
      };
    }

    return {
      id: value,
      name: value,
      minScore: 0,
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  if (!id) {
    return {
      id: NO_TIER_ID,
      name: "무등급",
      minScore: Number.NEGATIVE_INFINITY,
    };
  }

  const parsedMinScore = Number(rawTier?.minScore);
  return {
    id,
    name: String(rawTier?.name || id).trim(),
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
};

const sortMembers = (members) => {
  const list = Array.isArray(members) ? [...members] : [];
  return list.sort((left, right) => {
    const leftNo = Number(left?.studentNumber);
    const rightNo = Number(right?.studentNumber);
    const leftHasNo = Number.isFinite(leftNo);
    const rightHasNo = Number.isFinite(rightNo);

    if (leftHasNo && rightHasNo && leftNo !== rightNo) return leftNo - rightNo;
    if (leftHasNo && !rightHasNo) return -1;
    if (!leftHasNo && rightHasNo) return 1;

    return String(left?.name || "").localeCompare(String(right?.name || ""), "ko");
  });
};

const buildGroupOptions = (members, groupingByStudent) => {
  const grouped = new Map();

  members.forEach((member) => {
    const uid = member?.uid;
    if (!uid) return;

    const teamId = groupingByStudent[uid];
    if (!isValidTeamId(teamId)) return;

    if (!grouped.has(teamId)) grouped.set(teamId, []);
    grouped.get(teamId).push(member);
  });

  return Array.from(grouped.entries())
    .map(([teamId, memberList]) => ({
      id: teamId,
      name: TEAM_NAME_MAP[teamId] || teamId,
      members: memberList,
      uids: memberList.map((member) => member.uid),
    }))
    .sort((left, right) => {
      const leftOrder = TEAM_ORDER.has(left.id)
        ? TEAM_ORDER.get(left.id)
        : Number.MAX_SAFE_INTEGER;
      const rightOrder = TEAM_ORDER.has(right.id)
        ? TEAM_ORDER.get(right.id)
        : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name, "ko");
    });
};

const mergeUniqueIds = (...groups) =>
  Array.from(new Set(groups.flat().filter(Boolean)));

const buildMemberSearchBlob = (member = {}) =>
  [
    member?.name,
    member?.displayName,
    member?.studentNumber,
    member?.email,
    normalizeStudentTier(member).name,
  ].join(" ");

const buildGroupSearchBlob = (group = {}) =>
  [
    group?.name,
    ...((group.members || []).flatMap((member) => [
      member?.name,
      member?.displayName,
      member?.studentNumber,
    ])),
  ].join(" ");

const StudentSelector = ({
  label,
  hideLabel = false,
  selectedUids = [],
  onChange,
  onEnter,
  singleSelect,
  multiple,
  excludeSelf = false,
  allowGroupSelect = true,
  includeTeacher = false,
  includeAdmin = false,
  disabled = false,
  allStudents,
  className = "",
  fieldAppearance = "default",
  enableTierFilter = false,
  dropdownAbsolute = false,
}) => {
  const { classId, userData } = useUser();
  const [allMembers, setAllMembers] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const [selectionMode, setSelectionMode] = useState("student");
  const [groupingByStudent, setGroupingByStudent] = useState({});
  const [tierFilterId, setTierFilterId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  const isSingleSelect =
    typeof singleSelect === "boolean" ? singleSelect : multiple === false;

  const applyMemberFilters = useCallback(
    (members) => {
      const list = Array.isArray(members) ? members : [];
      const filtered = list
        .map((member) => ({
          ...member,
          uid: String(member?.uid || "").trim(),
        }))
        .filter((member) => member.uid)
        .filter(
          (member) =>
            !(excludeSelf && userData?.uid && member.uid === userData.uid),
        )
        .filter((member) => {
          const role = normalizeRole(member?.role);
          if (role === "teacher" && !includeTeacher) return false;
          if (role === "admin" && !includeAdmin) return false;
          return true;
        });

      return sortMembers(filtered);
    },
    [excludeSelf, includeAdmin, includeTeacher, userData?.uid],
  );

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

  useEffect(() => {
    const localStudents = Array.isArray(allStudents) ? allStudents : null;
    if (localStudents) {
      setAllMembers(applyMemberFilters(localStudents));
      return;
    }

    if (!classId) {
      setAllMembers([]);
      return;
    }

    let isCancelled = false;

    const fetchMembers = async () => {
      try {
        const memberQuery = query(
          collection(db, `classes/${classId}/students`),
          orderBy("studentNumber"),
        );
        const snapshot = await getDocs(memberQuery);
        const data = snapshot.docs.map((document) => ({
          uid: document.id,
          ...document.data(),
        }));

        if (!isCancelled) {
          setAllMembers(applyMemberFilters(data));
        }
      } catch (error) {
        if (!isCancelled) {
          console.error("학생 목록 로드 실패:", error);
          setAllMembers([]);
        }
      }
    };

    fetchMembers();
    return () => {
      isCancelled = true;
    };
  }, [allStudents, classId, applyMemberFilters]);

  useEffect(() => {
    if (!classId || !allowGroupSelect || isSingleSelect) {
      setGroupingByStudent({});
      return undefined;
    }

    const groupingRef = doc(db, `classes/${classId}/real_estate/grouping`);
    const unsubscribe = onSnapshot(
      groupingRef,
      (snapshot) => {
        const nextMap = snapshot.exists()
          ? normalizeGroupingByStudent(snapshot.data()?.byStudent)
          : {};
        setGroupingByStudent(nextMap);
      },
      (error) => {
        console.error("모둠 설정 로드 실패:", error);
        setGroupingByStudent({});
      },
    );

    return () => unsubscribe();
  }, [allowGroupSelect, classId, isSingleSelect]);

  const tierOptions = useMemo(() => {
    const deduped = new Map();
    allMembers.forEach((member) => {
      const tier = normalizeStudentTier(member);
      deduped.set(tier.id, tier);
    });

    return Array.from(deduped.values()).sort((left, right) => {
      if (left.minScore !== right.minScore) return right.minScore - left.minScore;
      return left.name.localeCompare(right.name, "ko");
    });
  }, [allMembers]);

  const tierFilteredMembers = useMemo(() => {
    if (!enableTierFilter || !tierFilterId) return allMembers;
    return allMembers.filter(
      (member) => normalizeStudentTier(member).id === tierFilterId,
    );
  }, [allMembers, enableTierFilter, tierFilterId]);

  const normalizedSearchTerm = useMemo(
    () => normalizeText(searchTerm),
    [searchTerm],
  );

  const visibleMembers = useMemo(() => {
    if (!normalizedSearchTerm) return tierFilteredMembers;
    return tierFilteredMembers.filter((member) =>
      normalizeText(buildMemberSearchBlob(member)).includes(normalizedSearchTerm),
    );
  }, [normalizedSearchTerm, tierFilteredMembers]);

  const selectedUidSet = useMemo(() => new Set(selectedUids), [selectedUids]);
  const visibleUidSet = useMemo(
    () => new Set(visibleMembers.map((member) => member.uid)),
    [visibleMembers],
  );

  const groupOptions = useMemo(
    () => buildGroupOptions(tierFilteredMembers, groupingByStudent),
    [groupingByStudent, tierFilteredMembers],
  );

  const hasGroupOptions =
    !isSingleSelect &&
    allowGroupSelect &&
    !tierFilterId &&
    groupOptions.length > 0;

  const filteredGroupOptions = useMemo(() => {
    if (!normalizedSearchTerm) return groupOptions;
    return groupOptions.filter((group) =>
      normalizeText(buildGroupSearchBlob(group)).includes(normalizedSearchTerm),
    );
  }, [groupOptions, normalizedSearchTerm]);

  const selectedGroupIds = useMemo(
    () =>
      groupOptions
        .filter(
          (group) =>
            group.uids.length > 0 &&
            group.uids.every((uid) => selectedUidSet.has(uid)),
        )
        .map((group) => group.id),
    [groupOptions, selectedUidSet],
  );

  const selectedVisibleGroupCount = useMemo(
    () =>
      filteredGroupOptions.filter(
        (group) =>
          group.uids.length > 0 &&
          group.uids.every((uid) => selectedUidSet.has(uid)),
      ).length,
    [filteredGroupOptions, selectedUidSet],
  );

  const visibleGroupUids = useMemo(
    () => Array.from(new Set(filteredGroupOptions.flatMap((group) => group.uids))),
    [filteredGroupOptions],
  );

  useEffect(() => {
    if (!hasGroupOptions && selectionMode !== "student") {
      setSelectionMode("student");
    }
  }, [hasGroupOptions, selectionMode]);

  useEffect(() => {
    if (!enableTierFilter && tierFilterId) {
      setTierFilterId("");
    }
  }, [enableTierFilter, tierFilterId]);

  useEffect(() => {
    if (disabled && isExpanded) {
      setIsExpanded(false);
    }
  }, [disabled, isExpanded]);

  useEffect(() => {
    if (!isExpanded) {
      setSearchTerm("");
      return;
    }

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [isExpanded]);

  const handleKeyDownCapture = useCallback(
    (event) => {
      if (!onEnter || disabled) return;
      if (event.key !== "Enter" || event.nativeEvent?.isComposing) return;

      event.preventDefault();
      event.stopPropagation();
      setIsExpanded(false);
      onEnter();
    },
    [disabled, onEnter],
  );

  const getHeaderText = () => {
    if (selectedUids.length === 0) {
      return selectionMode === "group" && hasGroupOptions
        ? "모둠을 선택해 주세요"
        : "학생을 선택해 주세요";
    }

    if (isSingleSelect) {
      return `${allMembers.find((member) => member.uid === selectedUids[0])?.name || "1명"} 선택`;
    }

    if (
      selectionMode === "group" &&
      hasGroupOptions &&
      selectedGroupIds.length > 0
    ) {
      if (selectedGroupIds.length === groupOptions.length) return "전체 모둠 선택";
      return `${selectedGroupIds.length}모둠 선택 (${selectedUids.length}명)`;
    }

    if (selectedUids.length === allMembers.length && allMembers.length > 0) {
      return "전체 선택";
    }

    return `${selectedUids.length}명 선택`;
  };

  const toggleMember = (uid, mode) => {
    if (disabled) return;

    if (isSingleSelect) {
      onChange(mode === "select" ? [uid] : []);
      if (mode === "select") setIsExpanded(false);
      return;
    }

    const nextSet = new Set(selectedUids);
    if (mode === "select") nextSet.add(uid);
    else nextSet.delete(uid);
    onChange(Array.from(nextSet));
  };

  const handleMouseDown = (uid, isSelected) => {
    if (disabled) return;
    if (isSingleSelect) {
      toggleMember(uid, isSelected ? "deselect" : "select");
      return;
    }

    setIsDragging(true);
    const nextMode = isSelected ? "deselect" : "select";
    setDragMode(nextMode);
    toggleMember(uid, nextMode);
  };

  const handleMouseEnter = (uid) => {
    if (disabled || isSingleSelect || !isDragging) return;
    toggleMember(uid, dragMode);
  };

  const toggleGroup = (groupId) => {
    if (disabled) return;

    const targetGroup = groupOptions.find((group) => group.id === groupId);
    if (!targetGroup) return;

    const nextSet = new Set(selectedUids);
    const isSelected = targetGroup.uids.every((uid) => nextSet.has(uid));

    if (isSelected) targetGroup.uids.forEach((uid) => nextSet.delete(uid));
    else targetGroup.uids.forEach((uid) => nextSet.add(uid));

    onChange(Array.from(nextSet));
  };

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const replaceWithVisibleMembers = (nextVisibleUids) => {
    const preserved = selectedUids.filter((uid) => !visibleUidSet.has(uid));
    onChange(mergeUniqueIds(preserved, nextVisibleUids));
  };

  const clearVisibleMembers = () => {
    onChange(selectedUids.filter((uid) => !visibleUidSet.has(uid)));
  };

  const searchPlaceholder =
    selectionMode === "group" && hasGroupOptions
      ? GROUP_SEARCH_PLACEHOLDER
      : STUDENT_SEARCH_PLACEHOLDER;

  const isSearching = normalizedSearchTerm.length > 0;
  const areAllVisibleGroupsSelected =
    filteredGroupOptions.length > 0 &&
    selectedVisibleGroupCount === filteredGroupOptions.length;

  return (
    <div
      className={`space-y-1 select-none ${dropdownAbsolute ? "relative" : ""} ${className}`.trim()}
      ref={containerRef}
      onKeyDownCapture={handleKeyDownCapture}
    >
      {!hideLabel ? (
        <label className={fieldAppearance === "mission" ? "text-[15px] font-semibold text-[#101b49]" : "ml-1 text-xs font-bold text-slate-500"}>
          {label || "학생 선택"}
        </label>
      ) : null}

      <div
        onMouseDown={(event) => {
          if (disabled) return;
          if (event.target.closest("button")) return;
          if (event.target === searchInputRef.current) return;
          event.preventDefault();
          setIsExpanded(true);
          searchInputRef.current?.focus();
        }}
        className={`${fieldAppearance === "mission" ? "min-h-[50px] rounded-md border-[#cad6ed]" : "min-h-[42px] rounded-xl"} w-full border bg-white px-3 py-2 transition-all ${
          isExpanded
            ? "border-blue-400"
            : fieldAppearance === "mission" ? "hover:border-blue-300" : "border-slate-200 hover:border-slate-300"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {isExpanded ? (
              <Search size={16} className="shrink-0 text-indigo-400" />
            ) : (
              <Users
                size={16}
                className={
                  selectedUids.length > 0
                    ? "shrink-0 text-indigo-500"
                    : "shrink-0 text-slate-300"
                }
              />
            )}
            <input
              ref={searchInputRef}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-unstyled-input="true"
              disabled={disabled}
              value={isExpanded ? searchTerm : getHeaderText()}
              onFocus={() => {
                if (!disabled) setIsExpanded(true);
              }}
              onChange={(event) => {
                if (disabled) return;
                setSearchTerm(event.target.value);
                if (!isExpanded) setIsExpanded(true);
              }}
              placeholder={isExpanded ? searchPlaceholder : ""}
              className={`h-6 w-full appearance-none rounded-none border-0 bg-transparent p-0 font-semibold leading-6 shadow-none outline-none focus:border-0 focus:ring-0 placeholder:text-slate-400 disabled:cursor-not-allowed ${fieldAppearance === "mission" ? "text-[15px] text-[#101b49]" : "text-sm text-slate-700"}`}
            />
          </div>

          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (disabled) return;
              if (isExpanded) {
                setIsExpanded(false);
                return;
              }
              setIsExpanded(true);
              searchInputRef.current?.focus();
            }}
            disabled={disabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100"
          >
            {isExpanded ? (
              <ChevronUp size={15} className="text-indigo-500" />
            ) : (
              <ChevronDown size={15} className="text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div
          className={`animate-in slide-in-from-top-1 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-lg fade-in duration-200 ${
            dropdownAbsolute ? "absolute left-0 right-0 top-full z-50 mt-2" : ""
          }`}
        >
          {!isSingleSelect && (
            <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-400">
                  {selectionMode === "group" && hasGroupOptions
                    ? "모둠 선택"
                    : "드래그 가능"}
                </span>
                {hasGroupOptions && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                    <ModeBtn
                      active={selectionMode === "student"}
                      label="개인"
                      disabled={disabled}
                      onClick={() => setSelectionMode("student")}
                    />
                    <ModeBtn
                      active={selectionMode === "group"}
                      label="모둠"
                      disabled={disabled}
                      onClick={() => setSelectionMode("group")}
                    />
                  </div>
                )}
                {enableTierFilter && tierOptions.length > 0 && (
                  <select
                    value={tierFilterId}
                    onChange={(event) => setTierFilterId(event.target.value)}
                    disabled={disabled}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600"
                  >
                    <option value="">전체 등급</option>
                    {tierOptions.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex gap-1">
                {selectionMode === "group" && hasGroupOptions ? (
                  <QuickBtn
                    disabled={disabled || filteredGroupOptions.length === 0}
                    onClick={() =>
                      onChange(
                        areAllVisibleGroupsSelected
                          ? selectedUids.filter(
                              (uid) => !visibleGroupUids.includes(uid),
                            )
                          : mergeUniqueIds(
                              selectedUids.filter(
                                (uid) => !visibleGroupUids.includes(uid),
                              ),
                              visibleGroupUids,
                            ),
                      )
                    }
                    label="전체모둠"
                  />
                ) : (
                  <>
                    <QuickBtn
                      disabled={disabled}
                      onClick={() =>
                        replaceWithVisibleMembers(
                          visibleMembers.map((member) => member.uid),
                        )
                      }
                      label="전체"
                    />
                    <QuickBtn
                      disabled={disabled}
                      onClick={() =>
                        replaceWithVisibleMembers(
                          visibleMembers
                            .filter(
                              (member) =>
                                Number(member.studentNumber) % 2 !== 0,
                            )
                            .map((member) => member.uid),
                        )
                      }
                      label="홀수"
                    />
                    <QuickBtn
                      disabled={disabled}
                      onClick={() =>
                        replaceWithVisibleMembers(
                          visibleMembers
                            .filter(
                              (member) => Number(member.studentNumber) % 2 === 0,
                            )
                            .map((member) => member.uid),
                        )
                      }
                      label="짝수"
                    />
                  </>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={
                    selectionMode === "group" && hasGroupOptions
                      ? () =>
                          onChange(
                            selectedUids.filter(
                              (uid) => !visibleGroupUids.includes(uid),
                            ),
                          )
                      : clearVisibleMembers
                  }
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition ${
                    disabled
                      ? "cursor-not-allowed opacity-60"
                      : "hover:text-rose-500"
                  }`}
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>
          )}

          {selectionMode === "group" && hasGroupOptions ? (
            <div className="custom-scrollbar grid max-h-[200px] grid-cols-1 gap-1.5 overflow-y-auto p-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredGroupOptions.map((group) => {
                const isSelected = selectedGroupIds.includes(group.id);
                const previewNames = group.members
                  .slice(0, 3)
                  .map((member) => member.name)
                  .join(", ");
                const extraCount = Math.max(0, group.members.length - 3);

                return (
                  <button
                    key={group.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleGroup(group.id)}
                    className={`relative min-h-[50px] rounded-xl border px-3 py-1.5 text-left transition-all ${
                      isSelected
                        ? "border-indigo-400 bg-white text-indigo-700 shadow-sm"
                        : "border-transparent bg-slate-200/40 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <div
                      className={`text-xs font-black ${
                        isSelected ? "text-indigo-600" : "text-slate-700"
                      }`}
                    >
                      {group.name}
                    </div>
                    <div
                      className={`text-[10px] font-bold ${
                        isSelected ? "text-indigo-300" : "text-slate-400"
                      }`}
                    >
                      {group.members.length}명
                    </div>
                    <div className="mt-1 truncate text-[10px]">
                      {previewNames}
                      {extraCount > 0 ? ` 외 ${extraCount}명` : ""}
                    </div>
                    {isSelected && (
                      <div className="absolute -right-1 -top-1 rounded-full bg-indigo-500 p-0.5 text-white">
                        <Check size={6} strokeWidth={5} />
                      </div>
                    )}
                  </button>
                );
              })}

              {filteredGroupOptions.length === 0 && (
                <div className="col-span-full py-6 text-center text-[11px] font-semibold text-slate-400">
                  {isSearching
                    ? SEARCH_EMPTY_MESSAGE
                    : "조건에 맞는 모둠이 없습니다."}
                </div>
              )}
            </div>
          ) : (
            <div className="custom-scrollbar grid max-h-[200px] grid-cols-1 gap-1.5 overflow-y-auto p-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {visibleMembers.map((member) => {
                const isSelected = selectedUids.includes(member.uid);
                return (
                  <button
                    key={member.uid}
                    type="button"
                    disabled={disabled}
                    onMouseDown={() => handleMouseDown(member.uid, isSelected)}
                    onMouseEnter={() => handleMouseEnter(member.uid)}
                    className={`relative flex min-h-[42px] items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left transition-all ${
                      isSelected
                        ? "border-indigo-400 bg-white text-indigo-700 shadow-sm"
                        : "border-transparent bg-slate-200/40 text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    <div
                      className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black leading-none ${
                        isSelected
                          ? "bg-indigo-50 text-indigo-500"
                          : "bg-white/70 text-slate-400"
                      }`}
                    >
                      {String(member.studentNumber ?? "").padStart(2, "0")}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-xs font-bold">
                      {member.name}
                    </div>
                    {isSelected && (
                      <div className="absolute -right-1 -top-1 rounded-full bg-indigo-500 p-0.5 text-white">
                        <Check size={6} strokeWidth={5} />
                      </div>
                    )}
                  </button>
                );
              })}

              {visibleMembers.length === 0 && (
                <div className="col-span-full py-6 text-center text-[11px] font-semibold text-slate-400">
                  {isSearching
                    ? SEARCH_EMPTY_MESSAGE
                    : "조건에 맞는 학생이 없습니다."}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const QuickBtn = ({ onClick, label, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold transition-all ${
      disabled
        ? "cursor-not-allowed text-slate-300"
        : "text-slate-400 hover:border-indigo-300 hover:text-indigo-500"
    }`}
  >
    {label}
  </button>
);

const ModeBtn = ({ active, label, onClick, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition-all ${
      active ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-indigo-500"
    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
  >
    {label}
  </button>
);

export default StudentSelector;
