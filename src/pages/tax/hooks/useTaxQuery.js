// src/pages/tax/hooks/useTaxQuery.js
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../../firebase';
import { collection, query, orderBy, onSnapshot, doc, where } from 'firebase/firestore';
import { beginFirestoreSubscriptionDebug } from '../../../utils/firestoreSubscriptionDebug';

/**
 * 1. 세금 규칙 목록 (실시간 구독)
 * - 세율, 징수 조건 등 세금 정책 데이터
 */
export const useTaxRulesQuery = (
    classId,
    { enabled = true } = {},
) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ['tax', 'rules', classId], [classId]);

    useEffect(() => {
        if (!classId || !enabled) return;

        const q = query(
            collection(db, `classes/${classId}/taxRules`),
            orderBy('createdAt', 'desc')
        );

        const unsub = onSnapshot(q, (snap) => {
            const rules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            queryClient.setQueryData(queryKey, rules);
        }, (error) => {
            console.error("[useTaxRulesQuery] 구독 에러:", error);
        });

        return () => unsub();
    }, [classId, enabled, queryClient, queryKey]);

    return useQuery({
        queryKey,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
        initialData: () => queryClient.getQueryData(queryKey) ?? [],
        enabled: !!classId && enabled,
        staleTime: Infinity
    });
};

/**
 * 2. 세금 재정 요약 (실시간 구독)
 * - 총 세수, 최근 세금 변동 통계 등 단일 문서
 */
export const useTaxSummaryQuery = (
    classId,
    { enabled = true } = {},
) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ['tax', 'summary', classId], [classId]);

    useEffect(() => {
        if (!classId || !enabled) return;

        const docRef = doc(db, `classes/${classId}/dashboardSummary/taxSummary`);

        const unsub = onSnapshot(docRef, (snap) => {
            const summary = snap.exists() ? snap.data() : null;
            queryClient.setQueryData(queryKey, summary);
        }, (error) => {
            console.error("[useTaxSummaryQuery] 구독 에러:", error);
        });

        return () => unsub();
    }, [classId, enabled, queryClient, queryKey]);

    return useQuery({
        queryKey,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? null,
        initialData: () => queryClient.getQueryData(queryKey) ?? null,
        enabled: !!classId && enabled,
        staleTime: Infinity
    });
};

export const useClassFundsQuery = (
    classId,
    { enabled = true, debug = {}, operatorUid = "" } = {},
) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => ['tax', 'classFunds', classId, operatorUid ? `operator:${operatorUid}` : 'all'],
        [classId, operatorUid],
    );

    useEffect(() => {
        if (!classId || !enabled) return;

        const q = operatorUid
            ? query(
                collection(db, `classes/${classId}/classFunds`),
                where('operatorUids', 'array-contains', operatorUid),
            )
            : query(
                collection(db, `classes/${classId}/classFunds`),
                orderBy('createdAt', 'desc'),
            );
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: debug.source || 'useClassFundsQuery',
            pathKey: 'classes/{classId}/classFunds',
            classId,
            role: debug.role,
        });

        const unsub = onSnapshot(q, (snap) => {
            subscriptionDebug.recordSnapshot(snap);
            const funds = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(fund => fund.status !== 'deleted')
                .sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() || 0;
                    const bTime = b.createdAt?.toMillis?.() || 0;
                    return bTime - aTime;
                });
            queryClient.setQueryData(queryKey, funds);
        }, (error) => {
            subscriptionDebug.recordError(error);
            console.error("[useClassFundsQuery] 구독 에러:", error);
        });

        return () => {
            unsub();
            subscriptionDebug.stop();
        };
    }, [classId, debug.role, debug.source, enabled, operatorUid, queryClient, queryKey]);

    return useQuery({
        queryKey,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
        initialData: () => queryClient.getQueryData(queryKey) ?? [],
        enabled: !!classId && enabled,
        staleTime: Infinity
    });
};

export const useClassFundUsagesQuery = (
    classId,
    { enabled = true } = {},
) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ['tax', 'classFundUsages', classId], [classId]);

    useEffect(() => {
        if (!classId || !enabled) return;

        const q = query(
            collection(db, `classes/${classId}/fundUsages`),
            orderBy('createdAt', 'desc')
        );

        const unsub = onSnapshot(q, (snap) => {
            const usages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            queryClient.setQueryData(queryKey, usages);
        }, (error) => {
            console.error("[useClassFundUsagesQuery] subscription error:", error);
        });

        return () => unsub();
    }, [classId, enabled, queryClient, queryKey]);

    return useQuery({
        queryKey,
        queryFn: async () => queryClient.getQueryData(queryKey) ?? [],
        initialData: () => queryClient.getQueryData(queryKey) ?? [],
        enabled: !!classId && enabled,
        staleTime: Infinity
    });
};
