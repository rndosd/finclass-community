import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  Timestamp,
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Filter,
  ListChecks,
  RotateCcw,
  Search,
} from "lucide-react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Spinner,
  StudentSelector,
} from "../../../components/ui";
import {
  ACTIVITY_CATEGORY_GROUPS,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_OPTIONS,
} from "../../../constants/financeExportConfig";
import { getUserFacingRecordDescription } from "../../../utils/userFacingRecordDescription";
import { db, functions } from "../../../firebase";
import {
  buildActivityLogQuery,
  convertFirestoreDocToActivity,
  getActivityDisplayInfo,
  getDefaultDateRange,
  isMissionTokenActivity,
} from "../../../utils/activityUtils";
import { DEFAULT_CLASS_CURRENCY_UNIT } from "../../../utils/currencyUnit";
import { useUser } from "../../../contexts/UserContext";
import { loadMultiStudentActivityPage } from "../utils/multiStudentActivityPage";

const PAGE_SIZE = 30;
const SEARCH_SCAN_BATCH_SIZE = 40;
const MAX_SCAN_BATCHES_PER_PAGE = 6;

const queryClassActivityLogsCallable = httpsCallable(
  functions,
  "queryClassActivityLogs",
);

const TONE_BADGE_CLASS = {
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  slate: "bg-slate-100 text-slate-600",
};

const buildLegacyClassActivityLogQuery = ({
  classId,
  startDate,
  endDate,
  categoryFilter = "all",
  pageSize = 30,
  lastVisible = null,
}) => {
  const historyGroupRef = collectionGroup(db, "activityLogs");

  let qy = query(
    historyGroupRef,
    where("classId", "==", classId),
    orderBy("createdAt", "desc"),
  );

  if (startDate) {
    qy = query(
      qy,
      where(
        "createdAt",
        ">=",
        Timestamp.fromDate(dayjs(startDate).startOf("day").toDate()),
      ),
    );
  }

  if (endDate) {
    qy = query(
      qy,
      where(
        "createdAt",
        "<=",
        Timestamp.fromDate(dayjs(endDate).endOf("day").toDate()),
      ),
    );
  }

  const categoryFilters = Array.isArray(categoryFilter)
    ? Array.from(
        new Set(
          categoryFilter
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      )
    : categoryFilter && categoryFilter !== "all"
      ? [String(categoryFilter).trim()]
      : [];

  if (categoryFilters.length === 1) {
    qy = query(qy, where("category", "==", categoryFilters[0]));
  } else if (categoryFilters.length > 1 && categoryFilters.length <= 10) {
    qy = query(qy, where("category", "in", categoryFilters));
  }

  if (lastVisible) qy = query(qy, startAfter(lastVisible));
  if (pageSize) qy = query(qy, limit(pageSize));

  return qy;
};

const toNormalizedText = (value) => String(value || "").trim().toLowerCase();
const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const QUERYABLE_CATEGORY_FILTERS = (() => {
  const filterMap = new Map();
  const registerFilter = (alias, categories) => {
    const normalizedAlias = toNormalizedText(alias);
    const normalizedCategories = Array.from(
      new Set(
        (Array.isArray(categories) ? categories : [categories])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );

    if (!normalizedAlias || normalizedCategories.length === 0) return;

    const existingCategories = filterMap.get(normalizedAlias) || [];
    filterMap.set(
      normalizedAlias,
      Array.from(new Set([...existingCategories, ...normalizedCategories])),
    );
  };

  ACTIVITY_CATEGORY_OPTIONS.forEach(({ key, label }) => {
    const categories = ACTIVITY_CATEGORY_GROUPS[key] || [key];
    registerFilter(key, categories);
    registerFilter(label, categories);
  });

  Object.entries(ACTIVITY_CATEGORY_LABELS).forEach(([category, label]) => {
    registerFilter(category, category);
    registerFilter(label, category);
  });

  return filterMap;
})();
const resolveQueryableCategoryFilter = (keyword) =>
  QUERYABLE_CATEGORY_FILTERS.get(toNormalizedText(keyword)) || null;
const shouldUseDirectStudentQuery = (studentUids, keyword) => {
  const selectedStudentUids = Array.isArray(studentUids)
    ? studentUids.filter(Boolean)
    : [];

  if (selectedStudentUids.length !== 1) return false;
  return !String(keyword || "").trim();
};

const resolveStudentUidFromPath = (path = "") => {
  const segments = String(path).split("/");
  return segments[3] || "";
};

const normalizeLegacyStoreDescription = (activity, rawDescription) => {
  const safeDescription = String(rawDescription || "").trim();
  if (!safeDescription) return "";

  const category = String(activity?.category || "");
  if (!category.includes("store")) return safeDescription;

  const legacyPurchaseMatch = safeDescription.match(/^(.*)\s+(\d+)\s+purchase$/i);
  if (!legacyPurchaseMatch) return safeDescription;

  const itemName = legacyPurchaseMatch[1].trim();
  const quantity = Number(legacyPurchaseMatch[2]);

  if (!Number.isFinite(quantity)) return safeDescription;
  return `${itemName} ${quantity}개 구매`;
};

const resolveActivityDescription = (activity) => {
  const rawDescription = String(
    activity?.description ||
      activity?.reason ||
      activity?.note ||
      activity?.title ||
      "",
  ).trim();

  if (rawDescription) {
    return getUserFacingRecordDescription(
      normalizeLegacyStoreDescription(activity, rawDescription),
    );
  }

  if (ACTIVITY_CATEGORY_LABELS[activity?.category]) {
    return ACTIVITY_CATEGORY_LABELS[activity.category];
  }

  if (activity?.type === "income") return "수입";
  if (activity?.type === "expense") return "지출";
  return "";
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return "-";
  return dayjs(dateValue).format("MM.DD HH:mm");
};
export default function ClassActivityLogTab({
  classId,
  students = [],
  currencyUnit = DEFAULT_CLASS_CURRENCY_UNIT,
}) {
  const { missionTokenLabel } = useUser();
  const defaultRange = useMemo(() => getDefaultDateRange(30), []);
  const [filters, setFilters] = useState(() => ({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    studentUids: [],
    categoryKey: "all",
    keyword: "",
  }));
  const [appliedFilters, setAppliedFilters] = useState(() => ({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    studentUids: [],
    categoryKey: "all",
    keyword: "",
  }));
  const [activities, setActivities] = useState([]);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const multiStudentQueryStateRef = useRef(null);

  // Balances, jobs and other profile changes must not restart log queries.
  const studentDisplayKey = JSON.stringify(students.map(({ uid, name, studentNumber }) =>
    [uid, name ?? null, studentNumber ?? null],
  ));
  const studentMap = useMemo(
    () => new Map(JSON.parse(studentDisplayKey).map(([uid, name, studentNumber]) =>
      [uid, { name, studentNumber }],
    )),
    [studentDisplayKey],
  );

  const availableStudents = useMemo(
    () =>
      students.filter((student) => {
        const role = normalizeRole(student?.role);
        return role !== "teacher" && role !== "admin";
      }),
    [students],
  );

  const hydrateActivity = useCallback(
    (docSnap) => {
      const activity = convertFirestoreDocToActivity(docSnap);
      const studentUid =
        String(activity.studentUid || "").trim() ||
        resolveStudentUidFromPath(docSnap.ref.path);
      const student = studentMap.get(studentUid);

      return {
        ...activity,
        studentUid,
        studentName: student?.name || activity.studentName || "이름 없음",
        studentNumber: student?.studentNumber ?? activity.studentNumber ?? "",
        description: resolveActivityDescription(activity),
      };
    },
    [studentMap],
  );

  const hydrateServerActivity = useCallback(
    (row) => {
      const activity = {
        ...row,
        createdAt: row?.createdAtMs ? new Date(row.createdAtMs) : null,
        timestamp: row?.timestampMs
          ? new Date(row.timestampMs)
          : row?.createdAtMs
            ? new Date(row.createdAtMs)
            : null,
      };
      const studentUid = String(activity.studentUid || "").trim();
      const student = studentMap.get(studentUid);

      return {
        ...activity,
        studentUid,
        studentName: student?.name || activity.studentName || "?대쫫 ?놁쓬",
        studentNumber: student?.studentNumber ?? activity.studentNumber ?? "",
        description: resolveActivityDescription(activity),
      };
    },
    [studentMap],
  );

  const matchesFilters = useCallback((activity, currentFilters) => {
    const selectedStudentUids = Array.isArray(currentFilters.studentUids)
      ? currentFilters.studentUids.filter(Boolean)
      : [];
    const selectedCategoryFilter = resolveQueryableCategoryFilter(
      currentFilters.categoryKey,
    );
    const keywordQuery = toNormalizedText(currentFilters.keyword);

    if (
      isMissionTokenActivity(activity) ||
      (
      selectedStudentUids.length > 0 &&
      !selectedStudentUids.includes(activity.studentUid)
      )
    ) {
      return false;
    }

    if (
      selectedCategoryFilter?.length > 0 &&
      !selectedCategoryFilter.includes(String(activity.category || "").trim())
    ) {
      return false;
    }

    if (keywordQuery) {
      const contentHaystacks = [
        activity.description,
        activity.note,
        activity.reason,
        activity.title,
      ]
        .map(toNormalizedText)
        .filter(Boolean);

      if (!contentHaystacks.some((value) => value.includes(keywordQuery))) {
        return false;
      }
    }

    return true;
  }, []);

  const fetchStudentActivityBatch = useCallback(
    async ({
      studentUid,
      filtersOverride,
      categoryFilter = "all",
      batchSize,
      cursor = null,
    }) => {
      const activityQuery = buildActivityLogQuery({
        db,
        classId,
        studentUid,
        startDate: filtersOverride.startDate,
        endDate: filtersOverride.endDate,
        categoryFilter,
        pageSize: batchSize,
        lastVisible: cursor,
      });
      const snapshot = await getDocs(activityQuery);

      return {
        activities: snapshot.docs
          .map(hydrateActivity)
          .filter((activity) => matchesFilters(activity, filtersOverride)),
        lastVisible: snapshot.docs[snapshot.docs.length - 1] || cursor,
        exhausted: snapshot.docs.length < batchSize,
      };
    },
    [classId, hydrateActivity, matchesFilters],
  );

  const loadSelectedStudentActivitiesPage = useCallback(
    async ({ studentUids, filtersOverride, queryState = null }) => {
      const categoryFilter =
        resolveQueryableCategoryFilter(filtersOverride.categoryKey) || "all";
      return loadMultiStudentActivityPage({
        studentUids,
        queryState,
        pageSize: PAGE_SIZE,
        fetchBatch: (options) => fetchStudentActivityBatch({
          ...options, filtersOverride, categoryFilter,
        }),
      });
    },
    [fetchStudentActivityBatch],
  );

  const loadClassActivityPageFromServer = useCallback(
    async ({ filtersOverride, cursorPath = null }) => {
      const categoryFilter =
        resolveQueryableCategoryFilter(filtersOverride.categoryKey) || "all";
      const result = await queryClassActivityLogsCallable({
        classId,
        startDate: filtersOverride.startDate,
        endDate: filtersOverride.endDate,
        categoryFilter,
        keyword: filtersOverride.keyword?.trim() || "",
        pageSize: PAGE_SIZE,
        cursorPath,
      });
      const payload = result?.data || {};

      return {
        activities: Array.isArray(payload.rows)
          ? payload.rows
              .map(hydrateServerActivity)
              .filter((activity) => !isMissionTokenActivity(activity))
          : [],
        cursorPath: payload.cursorPath || null,
        hasMore: payload.hasMore === true,
      };
    },
    [classId, hydrateServerActivity],
  );

  const loadClassActivityPageFromLegacyRaw = useCallback(
    async ({ filtersOverride, cursor = null }) => {
      const selectedCategoryFilter =
        resolveQueryableCategoryFilter(filtersOverride.categoryKey) || "all";
      const requiresKeywordScan = Boolean(filtersOverride.keyword?.trim());

      if (!requiresKeywordScan) {
        const activityQuery = buildLegacyClassActivityLogQuery({
          classId,
          startDate: filtersOverride.startDate,
          endDate: filtersOverride.endDate,
          categoryFilter: selectedCategoryFilter,
          pageSize: PAGE_SIZE,
          lastVisible: cursor,
        });

        const snapshot = await getDocs(activityQuery);
        return {
          activities: snapshot.docs
            .map(hydrateActivity)
            .filter((activity) => matchesFilters(activity, filtersOverride)),
          cursor: snapshot.docs[snapshot.docs.length - 1] || null,
          hasMore: snapshot.docs.length === PAGE_SIZE,
        };
      }

      let nextCursor = cursor;
      let reachedEnd = false;
      let batchesFetched = 0;
      const matchedActivities = [];

      while (
        matchedActivities.length < PAGE_SIZE &&
        !reachedEnd &&
        batchesFetched < MAX_SCAN_BATCHES_PER_PAGE
      ) {
        const activityQuery = buildLegacyClassActivityLogQuery({
          classId,
          startDate: filtersOverride.startDate,
          endDate: filtersOverride.endDate,
          categoryFilter: selectedCategoryFilter,
          pageSize: SEARCH_SCAN_BATCH_SIZE,
          lastVisible: nextCursor,
        });

        const snapshot = await getDocs(activityQuery);
        batchesFetched += 1;

        if (snapshot.empty) {
          reachedEnd = true;
          break;
        }

        nextCursor = snapshot.docs[snapshot.docs.length - 1] || nextCursor;

        matchedActivities.push(
          ...snapshot.docs
            .map(hydrateActivity)
            .filter((activity) => matchesFilters(activity, filtersOverride)),
        );

        if (snapshot.docs.length < SEARCH_SCAN_BATCH_SIZE) {
          reachedEnd = true;
        }
      }

      return {
        activities: matchedActivities,
        cursor: nextCursor,
        hasMore: !reachedEnd,
      };
    },
    [classId, hydrateActivity, matchesFilters],
  );

  const loadActivities = useCallback(
    async ({
      append = false,
      cursor = null,
      filtersOverride = appliedFilters,
    } = {}) => {
      if (!classId || !filtersOverride.startDate || !filtersOverride.endDate) {
        return;
      }

      const setLoadingState = append ? setIsLoadingMore : setIsLoading;
      setLoadingState(true);

      if (!append) {
        setErrorMessage("");
      }

      const selectedStudentUids = Array.isArray(filtersOverride.studentUids)
        ? Array.from(new Set(filtersOverride.studentUids.filter(Boolean)))
        : [];
      const selectedCategoryFilter =
        resolveQueryableCategoryFilter(filtersOverride.categoryKey) || "all";
      const shouldUseSingleStudentDirectQuery = shouldUseDirectStudentQuery(
        selectedStudentUids,
        filtersOverride.keyword,
      );
      const hasKeywordFilter = Boolean(filtersOverride.keyword?.trim());

      try {
        if (shouldUseSingleStudentDirectQuery) {
          const activityQuery = buildActivityLogQuery({
            db,
            classId,
            studentUid: selectedStudentUids[0],
            startDate: filtersOverride.startDate,
            endDate: filtersOverride.endDate,
            categoryFilter: selectedCategoryFilter,
            pageSize: PAGE_SIZE,
            lastVisible: append ? cursor : null,
          });

          const snapshot = await getDocs(activityQuery);
          const nextActivities = snapshot.docs
            .map(hydrateActivity)
            .filter((activity) => matchesFilters(activity, filtersOverride));

          multiStudentQueryStateRef.current = null;
          setActivities((prev) =>
            append ? [...prev, ...nextActivities] : nextActivities,
          );
          setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
          setHasMore(snapshot.docs.length === PAGE_SIZE);
          return;
        }

        if (selectedStudentUids.length > 0) {
          const nextPage = await loadSelectedStudentActivitiesPage({
            studentUids: selectedStudentUids,
            filtersOverride,
            queryState: append ? multiStudentQueryStateRef.current : null,
          });

          multiStudentQueryStateRef.current = nextPage.queryState;
          setLastDoc(null);
          setActivities((prev) =>
            append ? [...prev, ...nextPage.activities] : nextPage.activities,
          );
          setHasMore(nextPage.hasMore);
          return;
        }

        if (!hasKeywordFilter) {
          const nextPage = await loadClassActivityPageFromLegacyRaw({
            filtersOverride,
            cursor: append ? cursor : null,
          });

          multiStudentQueryStateRef.current = null;
          setActivities((prev) =>
            append ? [...prev, ...nextPage.activities] : nextPage.activities,
          );
          setLastDoc(nextPage.cursor);
          setHasMore(nextPage.hasMore);
          return;
        }

        try {
          const nextPage = await loadClassActivityPageFromServer({
            filtersOverride,
            cursorPath: append ? cursor : null,
          });

          multiStudentQueryStateRef.current = null;
          setActivities((prev) =>
            append ? [...prev, ...nextPage.activities] : nextPage.activities,
          );
          setLastDoc(nextPage.cursorPath);
          setHasMore(nextPage.hasMore);
          return;
        } catch (serverError) {
          console.warn(
            "[ClassActivityLogTab] falling back to legacy raw class query:",
            serverError,
          );

          if (append && typeof cursor === "string") {
            throw serverError;
          }

          const fallbackPage = await loadClassActivityPageFromLegacyRaw({
            filtersOverride,
            cursor: null,
          });

          multiStudentQueryStateRef.current = null;
          setActivities((prev) =>
            append ? [...prev, ...fallbackPage.activities] : fallbackPage.activities,
          );
          setLastDoc(fallbackPage.cursor);
          setHasMore(fallbackPage.hasMore);
        }
      } catch (error) {
        console.error("[ClassActivityLogTab] failed to load activity logs:", error);
        setErrorMessage(
          "학급 활동 로그를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        );
        if (!append) {
          setActivities([]);
        }
        setHasMore(false);
      } finally {
        setLoadingState(false);
      }
    },
    [
      appliedFilters,
      classId,
      hydrateActivity,
      loadClassActivityPageFromLegacyRaw,
      loadClassActivityPageFromServer,
      loadSelectedStudentActivitiesPage,
      matchesFilters,
    ],
  );

  useEffect(() => {
    if (!classId) return;
    void loadActivities({ append: false, filtersOverride: appliedFilters });
  }, [appliedFilters, classId, loadActivities]);

  const handleFilterChange = useCallback(
    (key) => (event) => {
      const value = event.target.value;
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleStudentFilterChange = useCallback((studentUids) => {
    setFilters((prev) => ({
      ...prev,
      studentUids: Array.from(new Set((studentUids || []).filter(Boolean))),
    }));
  }, []);

  const applyFilters = useCallback(() => {
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      setErrorMessage("시작일은 종료일보다 늦을 수 없습니다.");
      setIsFilterOpen(true);
      return;
    }

    setErrorMessage("");
    setActivities([]);
    multiStudentQueryStateRef.current = null;
    setLastDoc(null);
    setHasMore(true);
    setAppliedFilters({
      startDate: filters.startDate,
      endDate: filters.endDate,
      studentUids: Array.from(new Set((filters.studentUids || []).filter(Boolean))),
      categoryKey: filters.categoryKey || "all",
      keyword: filters.keyword.trim(),
    });
  }, [filters]);

  const handleApplyFilters = useCallback(
    (event) => {
      event?.preventDefault();
      applyFilters();
    },
    [applyFilters],
  );

  const handleFilterInputKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" || event.nativeEvent?.isComposing) return;
      event.preventDefault();
      applyFilters();
    },
    [applyFilters],
  );

  const handleResetFilters = useCallback(() => {
    const nextFilters = {
      startDate: defaultRange.startDate,
      endDate: defaultRange.endDate,
      studentUids: [],
      categoryKey: "all",
      keyword: "",
    };

    setErrorMessage("");
    setActivities([]);
    multiStudentQueryStateRef.current = null;
    setLastDoc(null);
    setHasMore(true);
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }, [defaultRange.endDate, defaultRange.startDate]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || isLoading || isLoadingMore) return;

    const shouldUseStudentDirectQuery = shouldUseDirectStudentQuery(
      appliedFilters.studentUids,
      appliedFilters.keyword,
    );

    if (appliedFilters.studentUids.length > 0 && !shouldUseStudentDirectQuery) {
      void loadActivities({
        append: true,
        filtersOverride: appliedFilters,
      });
      return;
    }

    if (!lastDoc) return;
    void loadActivities({
      append: true,
      cursor: lastDoc,
      filtersOverride: appliedFilters,
    });
  }, [appliedFilters, hasMore, isLoading, isLoadingMore, lastDoc, loadActivities]);

  const filterSummary = useMemo(() => {
    const dateLabel =
      appliedFilters.startDate && appliedFilters.endDate
        ? `${appliedFilters.startDate} ~ ${appliedFilters.endDate}`
        : "기간 미지정";
    const studentLabel =
      appliedFilters.studentUids.length > 0
        ? `학생 ${appliedFilters.studentUids.length}명`
        : "전체 학생";
    const categoryOption = ACTIVITY_CATEGORY_OPTIONS.find(
      ({ key }) => key === appliedFilters.categoryKey,
    );
    const categoryLabel = categoryOption
      ? `카테고리: ${categoryOption.label}`
      : "전체 카테고리";
    const keywordLabel = appliedFilters.keyword
      ? `검색어: ${appliedFilters.keyword}`
      : "전체 내용";

    return [dateLabel, studentLabel, categoryLabel, keywordLabel].join(" · ");
  }, [appliedFilters]);

  return (
    <div className="space-y-5">
      <Card className="rounded-[28px] border border-white/60 bg-white/85 shadow-lg shadow-slate-200/40 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Filter size={16} className="text-indigo-600" />
              활동 로그 필터
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{filterSummary}</p>
          </div>

          <Button tone="slate" kind="outline" size="sm"
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            aria-expanded={isFilterOpen}
            aria-label={isFilterOpen ? "필터 접기" : "필터 펼치기"}
            className="inline-flex w-10 shrink-0 items-center justify-center transition"
          >
            {isFilterOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </Button>
        </div>

        {isFilterOpen ? (
          <>
            <form
              onSubmit={handleApplyFilters}
              className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-[0.95fr_0.95fr_1.9fr_1fr_1.05fr_auto_auto]"
            >
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <CalendarDays size={14} />
                  시작일
                </span>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={handleFilterChange("startDate")}
                  onKeyDown={handleFilterInputKeyDown}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>

              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <CalendarDays size={14} />
                  종료일
                </span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={handleFilterChange("endDate")}
                  onKeyDown={handleFilterInputKeyDown}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>

              <div className="min-w-0">
                <StudentSelector
                  label="학생 선택"
                  selectedUids={filters.studentUids}
                  onChange={handleStudentFilterChange}
                  onEnter={handleApplyFilters}
                  allStudents={availableStudents}
                  allowGroupSelect={false}
                  className="min-w-0"
                />
              </div>

              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <Filter size={14} />
                  카테고리
                </span>
                <select
                  value={filters.categoryKey}
                  onChange={handleFilterChange("categoryKey")}
                  onKeyDown={handleFilterInputKeyDown}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">전체 카테고리</option>
                  {ACTIVITY_CATEGORY_OPTIONS.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <FileSearch size={14} />
                  활동 내용
                </span>
                <input
                  type="text"
                  value={filters.keyword}
                  onChange={handleFilterChange("keyword")}
                  onKeyDown={handleFilterInputKeyDown}
                  placeholder="물건명, 메모, 사유 검색"
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>

              <div className="flex items-end">
                <Button
                  type="submit"
                  tone="blue"
                  size="lg"
                  icon={Search}
                  fullWidth
                  title="Enter 키로도 조회할 수 있습니다"
                >
                  조회 (Enter)
                </Button>
              </div>

              <div className="flex items-end justify-end">
                <Button
                  type="button"
                  kind="outline"
                  tone="slate"
                  size="icon-lg"
                  icon={RotateCcw}
                  onClick={handleResetFilters}
                  title="초기화"
                  aria-label="필터 초기화"
                />
              </div>
            </form>

            <div className="border-t border-slate-100 px-5 pb-5 pt-3 text-xs text-slate-500">
              학생과 카테고리로 먼저 좁힌 뒤, 텍스트 검색은 물건명·메모·사유를 부분 일치로 찾습니다.
            </div>
          </>
        ) : null}
      </Card>

      <Card className="overflow-hidden rounded-[28px] border border-white/60 bg-white/85 shadow-lg shadow-slate-200/40 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ListChecks size={18} className="text-indigo-600" />
              학급 활동 로그
            </div>
            <p className="mt-1 text-sm text-slate-500">
              현재 조건으로 불러온 로그 {activities.length}건을 최신순으로 보여줍니다.
            </p>
          </div>
          {isLoading ? <Spinner tone="indigo" /> : null}
        </div>

        {errorMessage ? (
          <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-600">
            {errorMessage}
          </div>
        ) : null}

        {!isLoading && activities.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ListChecks}
              title={hasMore ? "아직 검색하지 않은 기록이 남아 있습니다" : "조건에 맞는 활동 로그가 없습니다"}
              description={hasMore ? "더 보기를 눌러 남은 기록을 계속 검색해 주세요." : "날짜 범위를 넓히거나 학생, 활동 내용 검색어를 조정해 보세요."}
            />
          </div>
        ) : (
          <DataTable>
            <DataTable.Header>
              <DataTable.Row interactive={false}>
                <DataTable.HeadCell align="right">연번</DataTable.HeadCell>
                <DataTable.HeadCell>일시</DataTable.HeadCell>
                <DataTable.HeadCell>학생</DataTable.HeadCell>
                <DataTable.HeadCell>활동 내용</DataTable.HeadCell>
                <DataTable.HeadCell>유형</DataTable.HeadCell>
                <DataTable.HeadCell align="right">금액</DataTable.HeadCell>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
                {activities.map((activity, index) => {
                  const displayInfo = getActivityDisplayInfo(
                    activity,
                    currencyUnit,
                    undefined,
                    missionTokenLabel,
                  );
                  const badgeClass =
                    TONE_BADGE_CLASS[displayInfo.tone] || TONE_BADGE_CLASS.slate;
                  const studentLabel = activity.studentNumber
                    ? `${activity.studentNumber}번 ${activity.studentName}`
                    : activity.studentName;

                  return (
                    <DataTable.Row
                      key={`${activity.studentUid || "unknown"}-${activity.id}`}
                      className="align-top transition hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold text-slate-400">
                        {index + 1}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-sm font-medium text-slate-500">
                        {formatTimestamp(activity.timestamp)}
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <span className="font-semibold text-slate-700">
                          {studentLabel}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-slate-800">
                          {resolveActivityDescription(activity) || "-"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${badgeClass}`}
                        >
                          {displayInfo.isIncome ? "수입" : "지출"}
                        </span>
                      </td>
                      <td
                        className={`whitespace-nowrap px-5 py-4 text-right text-sm font-bold ${displayInfo.color}`}
                      >
                        {displayInfo.amountText}
                      </td>
                    </DataTable.Row>
                  );
                })}
            </DataTable.Body>
          </DataTable>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <p className="text-xs text-slate-400">
            로그가 많을 때는 최근 기록부터 차례대로 불러옵니다.
          </p>

          {hasMore ? (
            <Button
              kind="outline"
              tone="blue"
              size="sm"
              onClick={handleLoadMore}
              isLoading={isLoadingMore}
              disabled={isLoading}
            >
              더 보기
            </Button>
          ) : (
            <span className="text-xs font-semibold text-slate-400">
              마지막 로그까지 모두 확인했습니다.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
