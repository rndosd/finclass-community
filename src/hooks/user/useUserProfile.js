import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { createSnapshotTelemetryModeTracker, trackFirestorePayload } from "../../utils/firestoreTelemetry";

const DEFAULT_STOCK_CONVERSION_RATE = 10;

const toSafeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAssets = (assets = {}) => {
    const cash = toSafeNumber(assets.cash, 0);
    const deposit = toSafeNumber(assets.deposit, 0);
    const loan = toSafeNumber(assets.loan, 0);
    const itemValue = toSafeNumber(assets.itemValue, 0);
    const realEstateValue = toSafeNumber(assets.realEstateValue, 0);
    const realEstateCount = toSafeNumber(assets.realEstateCount, 0);
    const usdBalance = toSafeNumber(assets.usdBalance, 0);

    const rawStockValue =
        assets.stockValue && typeof assets.stockValue === "object"
            ? assets.stockValue
            : {};
    const stockValue = toSafeNumber(rawStockValue.value, 0);
    const lastConversionRate = toSafeNumber(rawStockValue.lastConversionRate, 0);
    const appliedRate =
        lastConversionRate > 0
            ? lastConversionRate
            : DEFAULT_STOCK_CONVERSION_RATE;

    const storedTotalNetWorth = Number(assets.totalNetWorth);
    const totalNetWorth = Number.isFinite(storedTotalNetWorth)
        ? storedTotalNetWorth
        : 0;

    return {
        ...assets,
        cash,
        deposit,
        loan,
        itemValue,
        realEstateValue,
        realEstateCount,
        usdBalance,
        totalNetWorth,
        stockValue: {
            ...rawStockValue,
            value: stockValue,
            lastConversionRate: appliedRate,
        },
    };
};

export function useUserProfile(classId, uid) {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ["userProfile", classId, uid], [classId, uid]);
    // Readiness belongs to this subscription, not to the previous account.
    const [readyQueryKey, setReadyQueryKey] = useState(null);
    const profileReady = !classId || !uid || readyQueryKey === queryKey;

    useEffect(() => {
        if (!classId || !uid) return undefined;

        let active = true;
        const studentDocRef = doc(db, "classes", classId, "students", uid);
        const getTelemetryMode = createSnapshotTelemetryModeTracker();
        const unsub = onSnapshot(
            studentDocRef, { includeMetadataChanges: true },
            (snap) => {
                if (!active) return;
                if (snap.exists()) {
                    const profile = snap.data() || {};
                    trackFirestorePayload({
                        classId,
                        source: "useUserProfile",
                        sourceGroup: "global",
                        pathKey: "classes/{classId}/students/{uid}",
                        mode: getTelemetryMode(snap),
                        rows: [{ uid: snap.id, ...profile }],
                        snapshot: snap,
                    });
                    queryClient.setQueryData(queryKey, {
                        uid: snap.id,
                        ...profile,
                        assets: normalizeAssets(profile.assets),
                    });
                } else {
                    queryClient.setQueryData(queryKey, null);
                }
                setReadyQueryKey(queryKey);
            },
            (error) => {
                if (!active) return;
                console.error("[useUserProfile] profile listen error:", {
                    classId,
                    uid,
                    code: error?.code,
                    message: error?.message,
                });
                setReadyQueryKey(queryKey);
            }
        );

        return () => {
            active = false;
            unsub();
        };
    }, [classId, uid, queryClient, queryKey]);

    const profileQuery = useQuery({
        queryKey,
        // 🌟 [핵심 수정] invalidateQueries 시 null을 반환하지 않고 
        // 기존 캐시 데이터를 반환하여 화면 하얘짐이나 0으로 변하는 현상을 막습니다.
        queryFn: () => {
            const existingData = queryClient.getQueryData(queryKey);
            return existingData ? Promise.resolve(existingData) : Promise.resolve(null);
        },
        enabled: !!classId && !!uid,
        staleTime: Infinity,
        gcTime: Infinity,
    });

    return {
        ...profileQuery,
        profileReady,
    };
}
