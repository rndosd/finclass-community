import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../firebase'; // 프로젝트 구조에 맞게 경로 확인 필요
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';

export const useJobDefinitionsQuery = (
    classId,
    { enabled = true } = {},
) => {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => ['class', 'jobs', classId], [classId]);

    useEffect(() => {
        if (!classId || !enabled) return;

        // 직업 명칭(name) 순으로 정렬하여 실시간 구독
        const q = query(
            collection(db, `classes/${classId}/jobDefinitions`),
            orderBy('name', 'asc')
        );

        const unsub = onSnapshot(q, (snap) => {
            const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // 🚀 React Query 캐시에 즉시 업데이트
            queryClient.setQueryData(queryKey, jobs);
        }, (error) => {
            console.error("[useJobInfo] 구독 에러:", error);
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
