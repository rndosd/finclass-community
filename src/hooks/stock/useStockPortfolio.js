import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../../firebase";
import {
    createSnapshotTelemetryModeTracker,
    trackFirestorePayload,
} from "../../utils/firestoreTelemetry";

export function useStockPortfolio(classId, uid) {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ["stockPortfolio", classId, uid], [classId, uid]);
    const scope = JSON.stringify(queryKey);
    const [listenerState, setListenerState] = useState({ scope: null, error: null });
    const [attempt, setAttempt] = useState(0);
    const refetch = useCallback(() => {
        setListenerState({ scope, error: null });
        setAttempt((value) => value + 1);
    }, [scope]);

    useEffect(() => {
        if (!classId || !uid) return;
        let active = true;
        setListenerState({ scope, error: null });

        // 1️⃣ 실시간 리스너 설정
        const portfolioRef = collection(db, `classes/${classId}/students/${uid}/stockPortfolio`);
        const q = query(portfolioRef, orderBy("symbol"));
        const getTelemetryMode = createSnapshotTelemetryModeTracker();

        // 2️⃣ Firestore 데이터가 변할 때마다 실행됨
        const unsub = onSnapshot(q, { includeMetadataChanges: true },
          (snap) => {
            if (!active) return;
            const portfolioData = {};
            const rows = [];
            snap.forEach((doc) => {
                // ID를 키로 하여 객체 형태로 저장 (Context에서 Map처럼 쓰기 위함)
                const row = {
                    id: doc.id,
                    ...doc.data()
                };
                rows.push(row);
                portfolioData[doc.id.toUpperCase()] = row;
            });
            trackFirestorePayload({
                classId,
                source: "useStockPortfolio",
                sourceGroup: "page",
                pathKey: "classes/{classId}/students/{uid}/stockPortfolio",
                mode: getTelemetryMode(snap),
                rows,
                snapshot: snap,
            });

            // 🚀 [핵심] TanStack Query 캐시를 강제로 업데이트
            // 이 코드가 실행되는 순간 StockContext의 데이터가 바뀌고 UI가 리렌더링됩니다.
            queryClient.setQueryData(queryKey, portfolioData);
            setListenerState({ scope, error: null });
        }, (error) => {
            if (!active) return;
            console.error("📊 Portfolio Listener Error:", error);
            setListenerState({ scope, error });
        });

        // 컴포넌트 언마운트 시 리스너 해제
        return () => { active = false; unsub(); };
    }, [classId, uid, queryClient, queryKey, scope, attempt]);

    // 3️⃣ UI에서는 캐시에 저장된 데이터를 사용
    const result = useQuery({
        queryKey,
        // The listener owns the data; absence of a snapshot is not an empty portfolio.
        enabled: false,
        queryFn: () => queryClient.getQueryData(queryKey) || {},
        staleTime: Infinity, // 리스너가 관리하므로 자동 refetch 방지
        gcTime: Infinity,
    });
    const error = listenerState.scope === scope ? listenerState.error : null;
    return {
        ...result,
        error,
        isError: Boolean(error),
        isLoading: Boolean(classId && uid && !result.data && !error),
        refetch,
    };
}
