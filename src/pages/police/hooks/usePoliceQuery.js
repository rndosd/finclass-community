// src/pages/police/hooks/usePoliceQuery.js
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { db } from "../../../firebase";
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    where,
    Timestamp,
    limit,
    startAfter,
    getDocs,
    doc,
    getDoc,
} from "firebase/firestore";
import dayjs from "dayjs";
import {
    buildReflectionSummaryFromData,
    hasReflectionSummary,
} from "../utils/reflectionFirestoreUtils";
import { resolvePoliceRuleType } from "../utils/policeRuleUtils";
import {
    createSnapshotTelemetryModeTracker,
    trackFirestorePayload,
} from "../../../utils/firestoreTelemetry";

const PAGE_SIZE = 20;
const STATS_HISTORY_CACHE_STALE_TIME = 1000 * 60 * 30;
const REPORT_TYPE_RULE = "rule";
const REPORT_TYPE_FREEFORM = "freeform";
const FREEFORM_REPORT_RULE_TEXT = "\uc790\uc720 \uc2e0\uace0";

const statsHistoryRangeCache = new Map();

const getStatsHistoryCache = (classId) => {
    const key = String(classId || "");
    if (!statsHistoryRangeCache.has(key)) {
        statsHistoryRangeCache.set(key, {
            ranges: [],
            recordsById: new Map(),
            updatedAt: 0,
        });
    }
    return statsHistoryRangeCache.get(key);
};

export const invalidatePoliceStatsHistoryCache = (classId) => {
    if (!classId) return;
    statsHistoryRangeCache.delete(String(classId));
};

const normalizeStatsRange = (dateStart, dateEnd) => {
    const start = dateStart ? dayjs(dateStart).startOf("day") : dayjs().subtract(1, "month").startOf("day");
    const end = dateEnd ? dayjs(dateEnd).endOf("day") : dayjs().endOf("day");
    const startMs = start.valueOf();
    const endMs = end.valueOf();

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
        return null;
    }

    return {
        start,
        end,
        startMs,
        endMs,
    };
};

const mergeStatsRanges = (ranges = []) => {
    const sorted = ranges
        .filter((range) => Number.isFinite(range?.startMs) && Number.isFinite(range?.endMs))
        .sort((a, b) => a.startMs - b.startMs);

    return sorted.reduce((acc, range) => {
        const previous = acc[acc.length - 1];
        if (!previous || range.startMs > previous.endMs + 1) {
            acc.push({ startMs: range.startMs, endMs: range.endMs });
            return acc;
        }

        previous.endMs = Math.max(previous.endMs, range.endMs);
        return acc;
    }, []);
};

const getMissingStatsRanges = (requestedRange, loadedRanges = []) => {
    let missing = [{ startMs: requestedRange.startMs, endMs: requestedRange.endMs }];

    mergeStatsRanges(loadedRanges).forEach((loaded) => {
        missing = missing.flatMap((range) => {
            if (loaded.endMs < range.startMs || loaded.startMs > range.endMs) {
                return [range];
            }

            const next = [];
            if (loaded.startMs > range.startMs) {
                next.push({ startMs: range.startMs, endMs: loaded.startMs - 1 });
            }
            if (loaded.endMs < range.endMs) {
                next.push({ startMs: loaded.endMs + 1, endMs: range.endMs });
            }
            return next;
        });
    });

    return missing.filter((range) => range.startMs <= range.endMs);
};

const getHistoryRecordMillis = (record = {}) => {
    const value = record?.appliedAt || record?.createdAt;
    if (!value) return 0;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const loadStatsHistoryRange = async (classId, dateStart, dateEnd) => {
    const requestedRange = normalizeStatsRange(dateStart, dateEnd);
    if (!classId || !requestedRange) {
        return {
            records: [],
            loadedRanges: [],
            fetchedRanges: [],
        };
    }

    const cache = getStatsHistoryCache(classId);
    const isFresh = Date.now() - Number(cache.updatedAt || 0) <= STATS_HISTORY_CACHE_STALE_TIME;
    const missingRanges = isFresh
        ? getMissingStatsRanges(requestedRange, cache.ranges)
        : [{ startMs: requestedRange.startMs, endMs: requestedRange.endMs }];

    if (!isFresh) {
        cache.ranges = [];
        cache.recordsById = new Map();
    }

    await Promise.all(
        missingRanges.map(async (range) => {
            const q = query(
                collection(db, getPath("history", classId)),
                where("appliedAt", ">=", Timestamp.fromMillis(range.startMs)),
                where("appliedAt", "<=", Timestamp.fromMillis(range.endMs)),
                orderBy("appliedAt", "desc"),
            );
            const snap = await getDocs(q);
            trackFirestorePayload({
                classId,
                source: "usePoliceStatsHistoryQuery.historyRange",
                sourceGroup: "page",
                pathKey: "classes/{classId}/policeFineHistory",
                mode: "getDocs",
                snapshot: snap,
            });
            snap.docs.forEach((docSnap) => {
                cache.recordsById.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
            });
        }),
    );

    cache.ranges = mergeStatsRanges([
        ...cache.ranges,
        ...missingRanges,
    ]);
    cache.updatedAt = Date.now();

    const records = [...cache.recordsById.values()]
        .filter((record) => {
            const appliedAtMs = getHistoryRecordMillis(record);
            return appliedAtMs >= requestedRange.startMs && appliedAtMs <= requestedRange.endMs;
        })
        .sort((a, b) => getHistoryRecordMillis(b) - getHistoryRecordMillis(a));

    return {
        records,
        loadedRanges: cache.ranges,
        fetchedRanges: missingRanges,
    };
};

// ?꾪뿕???쇰꺼 湲곕낯媛?
const DANGER_DEFAULTS = {
    3: "중대한 규칙 위반",
    2: "주의가 필요한 행동",
    1: "일반 생활 수칙",
};

const normalizeDangerLabel = (entry, fallback) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") return entry.label || fallback;
    return fallback;
};

const isFineRecord = (record) =>
    record?.type === "fine" || Number(record?.amountSigned || 0) < 0;

const getReflectionDocRef = (classId, fineId) =>
    doc(db, `classes/${classId}/reflections`, fineId);
const getPoliceRuleCatalogSummaryRef = (classId) =>
    doc(db, "classes", classId, "dashboardSummary", "policeRuleCatalog");

const normalizePoliceRule = (rule = {}, fallbackOrder = 0) => {
    const fineAmount = Number(rule?.fineAmount || 0);
    const creditChange = Number(rule?.creditChange || 0);
    const missionTokenChange = Number(rule?.missionTokenChange || 0);
    const rawOrder = Number(rule?.order);
    const rawDangerLevel = Number(rule?.dangerLevel);

    return {
        ...rule,
        id: String(rule?.id || "").trim(),
        text: String(rule?.text || "").trim(),
        notes: typeof rule?.notes === "string" ? rule.notes : "",
        fineAmount,
        creditChange,
        missionTokenChange,
        order: Number.isFinite(rawOrder) ? rawOrder : fallbackOrder,
        dangerLevel: Number.isFinite(rawDangerLevel) ? rawDangerLevel : 1,
        missionTokenEnabled:
            rule?.missionTokenEnabled === true || missionTokenChange !== 0,
        sensitive: rule?.sensitive === true,
        type: resolvePoliceRuleType({
            ...rule,
            fineAmount,
            creditChange,
            missionTokenChange,
        }),
    };
};

const normalizePoliceRuleList = (rules = []) =>
    (Array.isArray(rules) ? rules : [])
        .map((rule, index) => normalizePoliceRule(rule, index + 1))
        .filter((rule) => Boolean(rule.id))
        .sort((a, b) =>
            Number(a.order || 0) - Number(b.order || 0) ||
            String(a.id || "").localeCompare(String(b.id || "")),
        );

const normalizePoliceReport = (report = {}) => {
    const normalizedReportType =
        typeof report?.reportType === "string" && report.reportType.trim()
            ? report.reportType.trim()
            : report?.ruleId
                ? REPORT_TYPE_RULE
                : REPORT_TYPE_FREEFORM;

    return {
        ...report,
        reportType: normalizedReportType,
        ruleId: report?.ruleId ? String(report.ruleId).trim() : null,
        ruleText:
            typeof report?.ruleText === "string" && report.ruleText.trim()
                ? report.ruleText
                : normalizedReportType === REPORT_TYPE_FREEFORM
                    ? FREEFORM_REPORT_RULE_TEXT
                    : "",
    };
};

export const getPath = (type, classId) => {
    const base = `classes/${classId}`;
    switch (type) {
        case "rules":
            return `${base}/policeRules`;
        case "reports":
            return `${base}/policeReports`;
        case "history":
            return `${base}/policeFineHistory`;
        case "settings":
            return `${base}/policeSettings`;
        case "reflections":
            return `${base}/reflections`;
        case "dangerLabels":
            return `${base}/policeDangerLabels`;
        default:
            return null;
    }
};

// ---------------------------------------------------------------------
// 1) 洹쒖튃 (?ㅼ떆媛?
// ---------------------------------------------------------------------
export const usePoliceRulesQuery = (classId, enabled = true) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ["policeRules", classId], [classId]);
    const hasCachedData = queryClient.getQueryData(queryKey) !== undefined;
    const [snapshotReady, setSnapshotReady] = useState(hasCachedData);

    useEffect(() => {
        if (!classId || !enabled) {
            setSnapshotReady(false);
            return undefined;
        }

        setSnapshotReady(queryClient.getQueryData(queryKey) !== undefined);

        const q = query(collection(db, getPath("rules", classId)), orderBy("order"));
        const getTelemetryMode = createSnapshotTelemetryModeTracker();

        return onSnapshot(
            q, { includeMetadataChanges: true },
            (snap) => {
                const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                trackFirestorePayload({
                    classId,
                    source: "usePoliceRulesQuery",
                    sourceGroup: "page",
                    pathKey: "classes/{classId}/policeRules",
                    mode: getTelemetryMode(snap),
                    rows,
                    snapshot: snap,
                });
                queryClient.setQueryData(
                    queryKey,
                    normalizePoliceRuleList(rows),
                );
                setSnapshotReady(true);
            },
            (err) => {
                console.error("[policeRules snapshot error]", getPath("rules", classId), err.code, err.message);
                setSnapshotReady(true);
            }
        );
    }, [classId, enabled, queryClient, queryKey]);

    const queryState = useQuery({
        queryKey,
        enabled: !!classId && !!enabled,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
        initialData: () => queryClient.getQueryData(queryKey) ?? [],
        staleTime: Infinity,
    });

    return {
        ...queryState,
        isLoading: !!classId && !!enabled && !snapshotReady && !hasCachedData,
    };
};

// ---------------------------------------------------------------------
// 2) ?좉퀬 (?ㅼ떆媛? 理쒓렐 100媛?
//   - ?쇰컲 ?숈깮??蹂대㈃ permission-denied ?????덉쑝??enabled濡??쒖뼱 沅뚯옣
// ---------------------------------------------------------------------
export const usePoliceRuleCatalogQuery = (classId, enabled = true) => {
    const [rules, setRules] = useState([]);
    const [snapshotReady, setSnapshotReady] = useState(false);
    const [hasSummary, setHasSummary] = useState(false);

    useEffect(() => {
        if (!classId || !enabled) {
            setRules([]);
            setSnapshotReady(false);
            setHasSummary(false);
            return undefined;
        }

        const summaryRef = getPoliceRuleCatalogSummaryRef(classId);
        const getTelemetryMode = createSnapshotTelemetryModeTracker();

        return onSnapshot(
            summaryRef, { includeMetadataChanges: true },
            (snap) => {
                const data = snap.exists() ? snap.data() || {} : null;
                trackFirestorePayload({
                    classId,
                    source: "usePoliceRuleCatalogQuery",
                    sourceGroup: "page",
                    pathKey: "classes/{classId}/dashboardSummary/policeRuleCatalog",
                    mode: getTelemetryMode(snap),
                    rows: data ? [{ id: "policeRuleCatalog", ...data }] : [],
                    snapshot: snap,
                });
                const nextRules = Array.isArray(data?.rules) ?
                    normalizePoliceRuleList(data.rules) :
                    [];

                setRules(nextRules);
                setHasSummary(Boolean(data && Array.isArray(data.rules)));
                setSnapshotReady(true);
            },
            (err) => {
                console.error(
                    "[policeRuleCatalog summary error]",
                    summaryRef.path,
                    err.code,
                    err.message,
                );
                setRules([]);
                setHasSummary(false);
                setSnapshotReady(true);
            },
        );
    }, [classId, enabled]);

    return {
        data: rules,
        isLoading: !!classId && !!enabled && !snapshotReady,
        isReady: snapshotReady,
        hasSummary,
    };
};

export const useReportsQuery = (classId, enabled = true) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ["policeReports", classId], [classId]);
    const hasCachedData = queryClient.getQueryData(queryKey) !== undefined;
    const [snapshotReady, setSnapshotReady] = useState(hasCachedData);

    useEffect(() => {
        if (!classId || !enabled) {
            setSnapshotReady(false);
            return undefined;
        }

        setSnapshotReady(queryClient.getQueryData(queryKey) !== undefined);

        const q = query(
            collection(db, getPath("reports", classId)),
            orderBy("createdAt", "desc"),
            limit(100)
        );
        const getTelemetryMode = createSnapshotTelemetryModeTracker();

        return onSnapshot(
            q, { includeMetadataChanges: true },
            (snap) => {
                const rows = snap.docs.map((d) =>
                    normalizePoliceReport({ id: d.id, ...d.data() }),
                );
                trackFirestorePayload({
                    classId,
                    source: "useReportsQuery",
                    sourceGroup: "page",
                    pathKey: "classes/{classId}/policeReports",
                    mode: getTelemetryMode(snap),
                    rows,
                    snapshot: snap,
                });
                queryClient.setQueryData(
                    queryKey,
                    rows,
                );
                setSnapshotReady(true);
            },
            (err) => {
                console.error("[policeReports snapshot error]", getPath("reports", classId), err.code, err.message);
                setSnapshotReady(true);
            }
        );
    }, [classId, enabled, queryClient, queryKey]);

    const queryState = useQuery({
        queryKey,
        enabled: !!classId && !!enabled,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
        initialData: () => queryClient.getQueryData(queryKey) ?? [],
        staleTime: Infinity,
    });

    return {
        ...queryState,
        isLoading: !!classId && !!enabled && !snapshotReady && !hasCachedData,
    };
};

// ---------------------------------------------------------------------
// 3) 踰뚭툑/?곴툑 ?덉뒪?좊━ - ?ㅼ떆媛?(理쒖떊 20嫄?
//   - ?닿쾬??enabled濡??쒖뼱 沅뚯옣
// ---------------------------------------------------------------------
export const useRecentHistoryRealtime = (classId, enabled = true) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => ["policeFineHistory", classId, "latest"],
        [classId],
    );
    const hasCachedData = queryClient.getQueryData(queryKey) !== undefined;
    const [snapshotReady, setSnapshotReady] = useState(hasCachedData);

    useEffect(() => {
        if (!classId || !enabled) {
            setSnapshotReady(false);
            return undefined;
        }

        setSnapshotReady(queryClient.getQueryData(queryKey) !== undefined);

        const q = query(
            collection(db, getPath("history", classId)),
            orderBy("appliedAt", "desc"),
            limit(20)
        );
        const getTelemetryMode = createSnapshotTelemetryModeTracker();

        return onSnapshot(
            q, { includeMetadataChanges: true },
            (snap) => {
                const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                trackFirestorePayload({
                    classId,
                    source: "useRecentHistoryRealtime",
                    sourceGroup: "page",
                    pathKey: "classes/{classId}/policeFineHistory",
                    mode: getTelemetryMode(snap),
                    rows,
                    snapshot: snap,
                });
                queryClient.setQueryData(
                    queryKey,
                    rows
                );
                setSnapshotReady(true);
            },
            (err) => {
                console.error("[policeHistory(latest) snapshot error]", getPath("history", classId), err.code, err.message);
                setSnapshotReady(true);
            }
        );
    }, [classId, enabled, queryClient, queryKey]);

    const queryState = useQuery({
        queryKey,
        enabled: !!classId && !!enabled,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
        initialData: () => queryClient.getQueryData(queryKey) ?? [],
        staleTime: Infinity,
    });

    return {
        ...queryState,
        isLoading: !!classId && !!enabled && !snapshotReady && !hasCachedData,
    };
};

// ---------------------------------------------------------------------
// 4) 踰뚭툑/?곴툑 ?덉뒪?좊━ - 湲곌컙 ?꾪꽣 + 臾댄븳 ?ㅽ겕濡?(getDocs 湲곕컲)
//   - snapshot???꾨땲?쇱꽌 permission-denied媛 ?섎룄 "snapshot listener"濡?李랁엳吏??딆쓬
// ---------------------------------------------------------------------
export const useFineHistoryInfinite = (classId, dateStart, dateEnd, typeFilter = "all", enabled = true) => {
    return useInfiniteQuery({
        queryKey: ["policeFineHistory", classId, "past", dateStart, dateEnd, typeFilter],
        enabled: !!classId && !!enabled,
        initialPageParam: null,
        getNextPageParam: (lastPage) => (lastPage?.hasMore ? lastPage.lastDoc : undefined),

        queryFn: async ({ pageParam = null }) => {
            if (!classId) return { items: [], lastDoc: null, hasMore: false };

            const start = dateStart ? dayjs(dateStart).startOf("day") : dayjs().subtract(1, "month");
            const end = dateEnd ? dayjs(dateEnd).endOf("day") : dayjs();

            const constraints = [
                where("appliedAt", ">=", Timestamp.fromDate(start.toDate())),
                where("appliedAt", "<=", Timestamp.fromDate(end.toDate())),
                ...(typeFilter !== "all" ? [where("type", "==", typeFilter)] : []),
                orderBy("appliedAt", "desc"),
                limit(PAGE_SIZE),
                ...(pageParam ? [startAfter(pageParam)] : []),
            ];

            const q = query(collection(db, getPath("history", classId)), ...constraints);
            const snap = await getDocs(q);

            return {
                items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
                lastDoc: snap.docs[snap.docs.length - 1] || null,
                hasMore: snap.docs.length === PAGE_SIZE,
            };
        },
    });
};

// ---------------------------------------------------------------------
// 5) 寃쎌같 ?ㅼ젙 (?ㅼ떆媛?
//   - 援먯궗留??덉슜??媛?μ꽦???믪븘??enabled ?쒖뼱 異붿쿇
// ---------------------------------------------------------------------
export const usePoliceStatsHistoryQuery = (classId, dateStart, dateEnd, enabled = true) => {
    return useQuery({
        queryKey: ["policeStatsHistory", classId, dateStart || "", dateEnd || ""],
        enabled: !!classId && !!enabled,
        queryFn: () => loadStatsHistoryRange(classId, dateStart, dateEnd),
        staleTime: STATS_HISTORY_CACHE_STALE_TIME,
        gcTime: STATS_HISTORY_CACHE_STALE_TIME * 2,
    });
};

export const usePoliceSettingsQuery = (classId, enabled = true) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ["policeSettings", classId], [classId]);
    const hasCachedData = queryClient.getQueryData(queryKey) !== undefined;
    const [snapshotReady, setSnapshotReady] = useState(hasCachedData);

    useEffect(() => {
        if (!classId || !enabled) {
            setSnapshotReady(false);
            return undefined;
        }

        setSnapshotReady(queryClient.getQueryData(queryKey) !== undefined);

        const docRef = doc(db, getPath("settings", classId), "config");
        const getTelemetryMode = createSnapshotTelemetryModeTracker();

        return onSnapshot(
            docRef, { includeMetadataChanges: true },
            (snap) => {
                const data = snap.exists() ? snap.data() : {};
                trackFirestorePayload({
                    classId,
                    source: "usePoliceSettingsQuery",
                    sourceGroup: "page",
                    pathKey: "classes/{classId}/policeSettings/config",
                    mode: getTelemetryMode(snap),
                    rows: [{ id: "config", ...data }],
                    snapshot: snap,
                });
                queryClient.setQueryData(queryKey, data);
                setSnapshotReady(true);
            },
            (err) => {
                console.error("[policeSettings snapshot error]", docRef.path, err.code, err.message);
                setSnapshotReady(true);
            }
        );
    }, [classId, enabled, queryClient, queryKey]);

    const queryState = useQuery({
        queryKey,
        enabled: !!classId && !!enabled,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? {},
        initialData: () => queryClient.getQueryData(queryKey) ?? {},
        staleTime: Infinity,
    });

    return {
        ...queryState,
        isLoading: !!classId && !!enabled && !snapshotReady && !hasCachedData,
    };
};

// ---------------------------------------------------------------------
// 6) 諛섏꽦臾?(?⑤컻??
// ---------------------------------------------------------------------
export const useReflectionQuery = (classId, fineId, enabled = true) => {
    return useQuery({
        queryKey: ["reflection", classId, fineId],
        enabled: !!classId && !!fineId && !!enabled,
        queryFn: async () => {
            const snap = await getDoc(getReflectionDocRef(classId, fineId));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        },
    });
};

export const useReflectionSummaryFallback = (
    classId,
    records = [],
    enabled = true,
) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => ["policeReflectionSummaryFallback", classId],
        [classId],
    );
    const targetIds = useMemo(() => {
        if (!Array.isArray(records) || !records.length) return [];

        return [...new Set(
            records
                .filter(
                    (record) =>
                        record?.id &&
                        isFineRecord(record) &&
                        !hasReflectionSummary(record),
                )
                .map((record) => record.id),
        )];
    }, [records]);

    useEffect(() => {
        if (!classId || !enabled || !targetIds.length) {
            return undefined;
        }

        const cached = queryClient.getQueryData(queryKey) ?? {};
        const idsToFetch = targetIds.filter(
            (id) => !Object.prototype.hasOwnProperty.call(cached, id),
        );

        if (!idsToFetch.length) {
            return undefined;
        }

        let cancelled = false;

        (async () => {
            try {
                const entries = await Promise.all(
                    idsToFetch.map(async (fineId) => {
                        const snap = await getDoc(getReflectionDocRef(classId, fineId));
                        return [
                            fineId,
                            snap.exists()
                                ? buildReflectionSummaryFromData(snap.data())
                                : null,
                        ];
                    }),
                );

                if (cancelled) return;

                queryClient.setQueryData(queryKey, (current = {}) => ({
                    ...current,
                    ...Object.fromEntries(entries),
                }));
            } catch (err) {
                console.error(
                    "[policeReflectionFallback getDoc error]",
                    classId,
                    err?.code,
                    err?.message,
                );
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [classId, enabled, queryClient, queryKey, targetIds]);

    return useQuery({
        queryKey,
        enabled: !!classId && !!enabled,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? {},
        initialData: () => queryClient.getQueryData(queryKey) ?? {},
        staleTime: Infinity,
    });
};

// ---------------------------------------------------------------------
// 7) ?꾪뿕???쇰꺼 (?ㅼ떆媛?
//   - 援먯궗 ?꾩슜?대㈃ enabled濡??쒖뼱
// ---------------------------------------------------------------------
export const useDangerLabelsQuery = (classId, enabled = true) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => ["policeDangerLabels", classId],
        [classId],
    );
    const hasCachedData = queryClient.getQueryData(queryKey) !== undefined;
    const [snapshotReady, setSnapshotReady] = useState(hasCachedData);

    useEffect(() => {
        if (!classId || !enabled) {
            setSnapshotReady(false);
            return undefined;
        }

        setSnapshotReady(queryClient.getQueryData(queryKey) !== undefined);

        const docRef = doc(db, getPath("dangerLabels", classId), "settings");

        return onSnapshot(
            docRef, (snap) => {
                if (!snap.exists()) {
                    queryClient.setQueryData(queryKey, DANGER_DEFAULTS);
                    return;
                }
                const data = snap.data();
                queryClient.setQueryData(queryKey, {
                    3: normalizeDangerLabel(data?.[3], DANGER_DEFAULTS[3]),
                    2: normalizeDangerLabel(data?.[2], DANGER_DEFAULTS[2]),
                    1: normalizeDangerLabel(data?.[1], DANGER_DEFAULTS[1]),
                });
                setSnapshotReady(true);
            },
            (err) => {
                console.error("[policeDangerLabels snapshot error]", docRef.path, err.code, err.message);
                setSnapshotReady(true);
            }
        );
    }, [classId, enabled, queryClient, queryKey]);

    const queryState = useQuery({
        queryKey,
        enabled: !!classId && !!enabled,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? DANGER_DEFAULTS,
        initialData: () => queryClient.getQueryData(queryKey) ?? DANGER_DEFAULTS,
        staleTime: Infinity,
    });

    return {
        ...queryState,
        isLoading: !!classId && !!enabled && !snapshotReady && !hasCachedData,
    };
};

// ---------------------------------------------------------------------
// ??(?명솚??alias export)
// PolicePage?먯꽌 湲곗〈 ?대쫫(useFineHistoryQuery) 洹몃?濡??곌퀬 ?띠쓣 ??
// ---------------------------------------------------------------------
export const useFineHistoryQuery = (classId, dateStart, dateEnd, typeFilter, enabled = true) =>
    useFineHistoryInfinite(classId, dateStart, dateEnd, typeFilter, enabled);

// ??湲곗〈 ?대쫫 ?좎??섍퀬 ?띠쑝硫??닿쾬??媛??
export const usePastHistoryInfinite = useFineHistoryInfinite;

