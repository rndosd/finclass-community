import { useMemo, useState } from 'react';

export const useMarketplaceFilters = (items, userData, canManageMarketplace) => {
    const [selectedCategory, setSelectedCategory] = useState('all');

    const filteredByApproval = useMemo(() => {
        const userUid = userData?.uid;

        return items.filter((item) => {
            // 본인 상품이 아니고 교사도 아닌 경우, 승인된 상품만 표시
            if (!item.approved && item.sellerId !== userUid && !canManageMarketplace) return false;

            // 경매 종료 필터링 (현재는 일반 판매만 하므로 주석처리 가능)
            // if (item.type === 'auction' && item.endDate && (item.endDate?.toDate ? item.endDate.toDate() : new Date(item.endDate)) < new Date() && !canManageMarketplace)
            //     return false;

            return true;
        });
    }, [items, userData?.uid, canManageMarketplace]);

    const filteredByCategory = useMemo(() => {
        if (selectedCategory === 'all') return filteredByApproval;
        return filteredByApproval.filter((i) => i.category === selectedCategory);
    }, [filteredByApproval, selectedCategory]);

    return {
        selectedCategory,
        setSelectedCategory,
        filteredItems: filteredByCategory
    };
};
