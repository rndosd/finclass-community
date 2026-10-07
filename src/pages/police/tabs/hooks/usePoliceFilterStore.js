import { useQuery, useQueryClient } from '@tanstack/react-query';

// 💡 리액트 쿼리를 '상태 관리자'로 사용하는 커스텀 훅
export const usePoliceFilterStore = (key, initialValue) => {
    const queryClient = useQueryClient();

    // 캐시에서 데이터 가져오기
    const { data: filterState } = useQuery({
        queryKey: ['policeFilterState', key],
        queryFn: () => initialValue,
        staleTime: Infinity, // 💡 절대 상하지 않음 (탭 전환 시 유지 핵심)
        initialData: initialValue,
    });

    // 데이터 업데이트 함수
    const setFilterState = (newValue) => {
        queryClient.setQueryData(['policeFilterState', key], newValue);
    };

    return [filterState, setFilterState];
};