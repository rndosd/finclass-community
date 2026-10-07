import React from 'react';

const StockListItemSkeleton = () => {
    return (
        /* 실제 StockListItem의 높이, 여백, 테두리와
           완벽하게 동일한 컨테이너 설정을 가져가야 덜컥거림이 없습니다. 
        */
        <div className="flex min-h-[184px] flex-col rounded-2xl border border-slate-200/90 bg-white p-3 animate-pulse">

            {/* 헤더 영역: 티커 & 액션 버튼 */}
            <div className="flex justify-between items-start">
                <div className="space-y-2 flex-1">
                    {/* 티커 (h3 위치) */}
                    <div className="h-5 bg-slate-200 rounded-lg w-1/3"></div>
                    {/* 회사명 (p 위치) */}
                    <div className="h-4 bg-slate-100 rounded-md w-1/2"></div>
                </div>
                {/* 우측 상단 버튼들 세트 */}
                <div className="flex gap-1 ml-2">
                    <div className="h-8 w-8 bg-slate-100 rounded-lg"></div>
                    <div className="h-8 w-8 bg-slate-100 rounded-lg"></div>
                </div>
            </div>

            {/* 실시간 시세 영역 */}
            <div className="my-3 flex items-center justify-between gap-2">
                {/* 가격 숫자 */}
                <div className="h-7 bg-slate-200 rounded-xl w-1/2"></div>
                {/* 변동률 배지 */}
                <div className="h-5 bg-slate-100 rounded-lg w-1/3"></div>
            </div>

            {/* 하단 버튼 영역 (mt-auto로 바닥 고정) */}
            <div className="mt-auto">
                <div className="h-10 bg-slate-200 rounded-xl w-full"></div>
            </div>
        </div>
    );
};

export default StockListItemSkeleton;
