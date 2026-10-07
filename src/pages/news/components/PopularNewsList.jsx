import React, { useMemo } from 'react';
import { Spinner } from '../../../components/ui';
import { useNewsActions } from '../hooks/useNewsQueries';
import { TrophyIcon, SparklesIcon } from '@heroicons/react/24/outline';
import NewsItem from './NewsItem';

const PopularNewsList = ({
    classId,
    isTeacher,
    canManage,
    categories = [],
    autoOpenNewsId = "",
    onAutoOpenHandled,
    onOpenNews,
    news = [],
    isLoading = false,
    isError = false,
    searchTerm = "",
    variant = "card",
}) => {
    const topNews = useMemo(() => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const toMillis = (value) => {
            if (!value) return 0;
            if (typeof value?.toMillis === "function") return value.toMillis();
            if (typeof value?.toDate === "function") return value.toDate().getTime();
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        };

        return [...news]
            .filter((item) => toMillis(item?.createdAt) >= cutoff)
            .sort((a, b) => {
                const scoreDiff =
                    Number(b?.interactionScore || 0) - Number(a?.interactionScore || 0);
                return scoreDiff || toMillis(b?.createdAt) - toMillis(a?.createdAt);
            })
            .slice(0, 5);
    }, [news]);
    const { removeNews, editNews } = useNewsActions(classId);
    const normalizedSearch = String(searchTerm || "").trim().toLowerCase();
    const visibleNews = normalizedSearch
        ? topNews.filter((item) =>
            [item.title, item.summary, item.content, item.authorName]
                .filter(Boolean)
                .join(" ")
                .replace(/<[^>]+>/g, " ")
                .toLowerCase()
                .includes(normalizedSearch),
          )
        : topNews;

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner size="lg" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="text-center py-16 text-rose-500">
                <SparklesIcon className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="font-medium">인기 뉴스를 불러오는 중 오류가 발생했습니다.</p>
            </div>
        );
    }

    return (
        <div className={variant === "newsroom" ? "" : "space-y-4"}>
            <div className={variant === "newsroom" ? "sr-only" : "flex items-center justify-between px-1"}>
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-orange-100 rounded-lg text-orange-600">
                        <TrophyIcon className="w-5 h-5" />
                    </div>
                    <p className="text-sm font-bold text-slate-600">최근 7일 인기 소식</p>
                </div>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
                    {visibleNews.length}건
                </span>
            </div>

            {visibleNews.length > 0 ? (
                <div className={variant === "newsroom" ? "divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" : "space-y-4"}>
                    {visibleNews.map((news, index) => (
                        <div key={news.id} className="relative">
                            {/* 🏆 1, 2, 3위 특별 배지 UI */}
                            {variant !== "newsroom" && index < 3 && (
                                <div className={`absolute -left-2 -top-2 z-10 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-lg ring-2 ring-white
                  ${index === 0 ? 'bg-gradient-to-br from-yellow-400 to-amber-600' :
                                        index === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-500' :
                                            'bg-gradient-to-br from-orange-400 to-orange-700'}`}
                                >
                                    {index + 1}
                                </div>
                            )}

                            <NewsItem
                                news={news}
                                isLatest={index === 0}
                                isTeacher={isTeacher}
                                canManage={canManage}
                                classId={classId}
                                onDelete={removeNews}
                                onEdit={editNews}
                                categories={categories}
                                forceOpen={autoOpenNewsId === news.id}
                                onForceOpenHandled={onAutoOpenHandled}
            onOpenNews={onOpenNews}
                                variant={variant}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-20 bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200">
                    <SparklesIcon className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                    <p className="text-slate-500 font-bold">아직 랭킹에 진입한 뉴스가 없어요</p>
                    <p className="text-xs text-slate-400 mt-1">뉴스에 좋아요와 댓글을 남겨주세요!</p>
                </div>
            )}
        </div>
    );
};

export default PopularNewsList;
