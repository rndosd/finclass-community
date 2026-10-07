"use strict";

const admin = require("../firebaseAdminCompat");
const { Filter } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const REGION = "asia-northeast3";
const KST_OFFSET = "+09:00";
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SCAN_BATCH_SIZE = 40;
const MAX_SCAN_BATCHES_PER_PAGE = 6;
const ACTIVITY_LOG_SCOPE = {
    ALL: "all",
    GENERAL: "general",
    MISSION_TOKEN: "missionToken",
};
const MISSION_TOKEN_LOG_CURRENCIES = ["mission_token", "미션토큰"];
const LEGACY_GENERAL_LOG_CURRENCIES = ["class_currency", "USD"];

const normalizeValue = (value) => String(value || "").trim();

const toSerializableNumber = (value, fallback = null) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : fallback;
    }

    if (typeof value === "string") {
        const normalized = value.trim();
        if (!normalized) return fallback;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    if (typeof value?.toNumber === "function") {
        const parsed = Number(value.toNumber());
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    if (typeof value?.valueOf === "function") {
        const primitive = value.valueOf();
        if (primitive !== value) {
            const parsed = Number(primitive);
            if (Number.isFinite(parsed)) return parsed;
        }
    }

    if (typeof value === "object") {
        if ("integerValue" in value || "doubleValue" in value || "value" in value) {
            return toSerializableNumber(
                value.integerValue ?? value.doubleValue ?? value.value,
                fallback,
            );
        }

        if (
            Number.isFinite(Number(value.low)) &&
            (value.high === 0 || value.high === -1 || value.high === undefined)
        ) {
            return Number(value.low);
        }
    }

    return fallback;
};

const toTimestamp = (value, endOfDay = false) => {
    const normalized = normalizeValue(value);
    if (!normalized) return null;

    const dateValue = new Date(
        `${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${KST_OFFSET}`,
    );
    if (Number.isNaN(dateValue.getTime())) {
        throw new HttpsError("invalid-argument", "Invalid date filter.");
    }

    return admin.firestore.Timestamp.fromDate(dateValue);
};

const sanitizeCategoryFilter = (categoryFilter = "all") => {
    if (Array.isArray(categoryFilter)) {
        return Array.from(
            new Set(categoryFilter.map(normalizeValue).filter(Boolean)),
        ).slice(0, 10);
    }

    const normalized = normalizeValue(categoryFilter);
    if (!normalized || normalized === "all") return [];
    return [normalized];
};

const sanitizeLogScope = (logScope = ACTIVITY_LOG_SCOPE.ALL) => {
    const normalized = normalizeValue(logScope);
    if (
        normalized === ACTIVITY_LOG_SCOPE.GENERAL ||
        normalized === ACTIVITY_LOG_SCOPE.MISSION_TOKEN
    ) {
        return normalized;
    }
    return ACTIVITY_LOG_SCOPE.ALL;
};

const buildScopeFilter = ({
    logScope = ACTIVITY_LOG_SCOPE.ALL,
    currencyUnit,
}) => {
    if (logScope === ACTIVITY_LOG_SCOPE.GENERAL) {
        const currencies = Array.from(
            new Set(
                [currencyUnit, ...LEGACY_GENERAL_LOG_CURRENCIES]
                    .map(normalizeValue)
                    .filter(Boolean),
            ),
        );

        return Filter.or(
            Filter.where("activityScope", "==", "general"),
            ...currencies.map((currency) => Filter.where("currency", "==", currency)),
        );
    }

    if (logScope === ACTIVITY_LOG_SCOPE.MISSION_TOKEN) {
        return Filter.or(
            Filter.where("activityScope", "==", "mission_token"),
            ...MISSION_TOKEN_LOG_CURRENCIES.map((currency) =>
                Filter.where("currency", "==", currency),
            ),
        );
    }

    return null;
};

const buildBaseActivityQuery = ({
    classId,
    startDate,
    endDate,
    categoryFilter,
    logScope = ACTIVITY_LOG_SCOPE.ALL,
    currencyUnit,
}) => {
    let activityQuery = db
        .collectionGroup("activityLogs")
        .where("classId", "==", classId)
        .orderBy("createdAt", "desc");

    const startTimestamp = toTimestamp(startDate, false);
    if (startTimestamp) {
        activityQuery = activityQuery.where("createdAt", ">=", startTimestamp);
    }

    const endTimestamp = toTimestamp(endDate, true);
    if (endTimestamp) {
        activityQuery = activityQuery.where("createdAt", "<=", endTimestamp);
    }

    const categories = sanitizeCategoryFilter(categoryFilter);
    if (categories.length === 1) {
        activityQuery = activityQuery.where("category", "==", categories[0]);
    } else if (categories.length > 1) {
        activityQuery = activityQuery.where("category", "in", categories);
    }

    const scopeFilter = buildScopeFilter({ logScope, currencyUnit });
    if (scopeFilter) {
        activityQuery = activityQuery.where(scopeFilter);
    }

    return activityQuery.select(
        "studentUid",
        "type",
        "category",
        "description",
        "reason",
        "note",
        "title",
        "amount",
        "delta",
        "adjustmentDelta",
        "missionTokenDelta",
        "amountInClassCurrency",
        "createdAt",
        "timestamp",
        "activityScope",
        "assetType",
        "currency",
    );
};

const serializeActivityRow = (docSnap) => {
    const data = docSnap.data() || {};
    const createdAt = data.createdAt || null;
    const timestamp = data.timestamp || data.createdAt || null;

    return {
        id: docSnap.id,
        path: docSnap.ref.path,
        studentUid: normalizeValue(data.studentUid) || normalizeValue(docSnap.ref.parent.parent?.id),
        type: data.type || "",
        category: data.category || "",
        description: data.description || "",
        reason: data.reason || "",
        note: data.note || "",
        title: data.title || "",
        amount: toSerializableNumber(data.amount, 0),
        delta: toSerializableNumber(data.delta, null),
        adjustmentDelta: toSerializableNumber(data.adjustmentDelta, null),
        missionTokenDelta: toSerializableNumber(data.missionTokenDelta, null),
        amountInClassCurrency: toSerializableNumber(data.amountInClassCurrency, null),
        activityScope: data.activityScope || null,
        assetType: data.assetType || null,
        currency: data.currency || "",
        createdAtMs: typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : null,
        timestampMs: typeof timestamp?.toMillis === "function" ? timestamp.toMillis() : null,
    };
};

const matchesKeyword = (row, keyword) => {
    const normalizedKeyword = normalizeValue(keyword).toLowerCase();
    if (!normalizedKeyword) return true;

    const haystacks = [
        row.description,
        row.note,
        row.reason,
        row.title,
    ]
        .map((value) => String(value || "").toLowerCase())
        .filter(Boolean);

    return haystacks.some((value) => value.includes(normalizedKeyword));
};

exports.queryClassActivityLogs = onCall(
    {
        region: REGION,
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async (request) => {
        const classId = normalizeValue(request.data?.classId);
        const startDate = normalizeValue(request.data?.startDate);
        const endDate = normalizeValue(request.data?.endDate);
        const categoryFilter = request.data?.categoryFilter ?? "all";
        const logScope = sanitizeLogScope(request.data?.logScope);
        const currencyUnit = normalizeValue(request.data?.currencyUnit);
        const keyword = normalizeValue(request.data?.keyword);
        const cursorPath = normalizeValue(request.data?.cursorPath);
        const pageSize = Math.max(
            1,
            Math.min(MAX_PAGE_SIZE, Math.floor(Number(request.data?.pageSize) || DEFAULT_PAGE_SIZE)),
        );

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const baseQuery = buildBaseActivityQuery({
            classId,
            startDate,
            endDate,
            categoryFilter,
            logScope,
            currencyUnit,
        });

        let cursorSnap = null;
        if (cursorPath) {
            const segments = cursorPath.split("/");
            if (segments.length !== 6 || segments[0] !== "classes" ||
                segments[1] !== classId || segments[2] !== "students" ||
                !segments[3] || segments[4] !== "activityLogs" || !segments[5]) {
                throw new HttpsError("invalid-argument", "Invalid activity cursor.");
            }
            cursorSnap = await db.doc(cursorPath).get();
            if (!cursorSnap.exists) {
                throw new HttpsError("invalid-argument", "Cursor document was not found.");
            }
        }

        if (!keyword) {
            let pageQuery = baseQuery.limit(pageSize);
            if (cursorSnap) {
                pageQuery = pageQuery.startAfter(cursorSnap);
            }

            const snapshot = await pageQuery.get();
            return {
                rows: snapshot.docs.map(serializeActivityRow),
                cursorPath:
                    snapshot.docs.length > 0
                        ? snapshot.docs[snapshot.docs.length - 1].ref.path
                        : null,
                hasMore: snapshot.docs.length === pageSize,
                mode: "server_page_v1",
            };
        }

        let nextCursorSnap = cursorSnap;
        let reachedEnd = false;
        let batchesFetched = 0;
        const matchedRows = [];

        while (
            matchedRows.length < pageSize &&
            !reachedEnd &&
            batchesFetched < MAX_SCAN_BATCHES_PER_PAGE
        ) {
            // Read only as many possible matches as the page can still hold.
            // Advancing beyond discarded matches would skip them on the next page.
            const scanBatchSize = Math.min(DEFAULT_SCAN_BATCH_SIZE, pageSize - matchedRows.length);
            let scanQuery = baseQuery.limit(scanBatchSize);
            if (nextCursorSnap) {
                scanQuery = scanQuery.startAfter(nextCursorSnap);
            }

            const snapshot = await scanQuery.get();
            batchesFetched += 1;

            if (snapshot.empty) {
                reachedEnd = true;
                break;
            }

            nextCursorSnap = snapshot.docs[snapshot.docs.length - 1] || nextCursorSnap;
            matchedRows.push(
                ...snapshot.docs
                    .map(serializeActivityRow)
                    .filter((row) => matchesKeyword(row, keyword)),
            );

            if (snapshot.docs.length < scanBatchSize) {
                reachedEnd = true;
            }
        }

        return {
            rows: matchedRows.slice(0, pageSize),
            cursorPath: nextCursorSnap?.ref?.path || null,
            hasMore: !reachedEnd,
            mode: "server_scan_v1",
        };
    },
);
