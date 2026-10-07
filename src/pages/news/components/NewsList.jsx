import React, { useEffect, useMemo, useState } from "react";
import { Spinner, Button } from "../../../components/ui";
import NewsItem from "./NewsItem";
// 🚀 로컬 훅 경로 확인!
import { useInfiniteNews, useNewsActions } from "../hooks/useNewsQueries";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
  NewspaperIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";

const NewsList = ({
  classId,
  selectedCategory,
  isTeacher,
  canManage,
  categories = [],
  autoOpenNewsId = "",
  onAutoOpenHandled,
  onOpenNews,
  searchTerm = "",
  variant = "card",
}) => {
  // 1️⃣ 리액트 쿼리 무한 스크롤 엔진 가동
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteNews(classId, { category: selectedCategory });

  // 2️⃣ 뉴스 관리(삭제/수정) 액션 연결
  const { removeNews, editNews } = useNewsActions(classId);
  const [targetNews, setTargetNews] = useState(null);

  // 무한 쿼리 데이터를 단일 리스트로 평탄화
  const allNews = useMemo(
    () => data?.pages.flatMap((page) => page.list) || [],
    [data],
  );
  const visibleNews = useMemo(() => {
    const mergedNews = targetNews
      ? allNews.some((item) => item.id === targetNews.id)
        ? allNews
        : [targetNews, ...allNews]
      : allNews;
    const normalizedSearch = String(searchTerm || "").trim().toLowerCase();
    if (!normalizedSearch) return mergedNews;

    return mergedNews.filter((item) => {
      const searchableText = [
        item.title,
        item.summary,
        item.content,
        item.authorName,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/<[^>]+>/g, " ")
        .toLowerCase();
      return searchableText.includes(normalizedSearch);
    });
  }, [allNews, searchTerm, targetNews]);

  // [로컬 스토리지] 읽음 시점 기록 로직 (기존 유지)
  useEffect(() => {
    return () => {
      if (classId && selectedCategory) {
        localStorage.setItem(`lastRead_${classId}_${selectedCategory}`, Date.now().toString());
      }
    };
  }, [classId, selectedCategory]);

  useEffect(() => {
    let cancelled = false;

    const loadTargetNews = async () => {
      if (!classId || !autoOpenNewsId) {
        setTargetNews(null);
        return;
      }

      if (allNews.some((item) => item.id === autoOpenNewsId)) {
        setTargetNews(null);
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, `classes/${classId}/news`, autoOpenNewsId));
        if (cancelled) return;
        if (!snapshot.exists()) {
          setTargetNews(null);
          return;
        }

        const nextNews = { id: snapshot.id, ...snapshot.data() };
        if (selectedCategory !== "all" && nextNews.categoryId !== selectedCategory) {
          setTargetNews(null);
          return;
        }

        setTargetNews(nextNews);
      } catch (_error) {
        if (!cancelled) {
          setTargetNews(null);
        }
      }
    };

    void loadTargetNews();

    return () => {
      cancelled = true;
    };
  }, [allNews, autoOpenNewsId, classId, selectedCategory]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Spinner size="md" />
        <p className="mt-4 text-slate-500 font-medium animate-pulse">소식을 가져오고 있어요...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-16 bg-red-50 rounded-2xl border border-red-100 mx-auto max-w-md">
        <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-red-900 mb-2">문제가 발생했습니다</h3>
        <p className="text-sm text-red-600 px-6">{error.message}</p>
      </div>
    );
  }

  if (visibleNews.length === 0) {
    return (
      <div className="text-center py-20 bg-white/50 rounded-3xl border-2 border-dashed border-slate-200">
        <NewspaperIcon className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-slate-800 mb-1">비어있는 소식함</h3>
        <p className="text-sm text-slate-500">
          {isTeacher ? "학생들에게 전해줄 첫 번째 소식을 작성해보세요!" : "아직 등록된 뉴스가 없어요."}
        </p>
      </div>
    );
  }

  const currentCategory = categories.find((c) => c.id === selectedCategory);

  return (
    <div className={variant === "newsroom" ? "" : "space-y-5"}>
      <div className={variant === "newsroom" ? "sr-only" : "flex items-end justify-between px-1"}>
        <div>
          <h2 className="text-lg font-bold text-slate-800">{currentCategory?.label || "뉴스"}</h2>
          {currentCategory?.description && <p className="text-xs text-slate-500 mt-0.5">{currentCategory.description}</p>}
        </div>
        <div className="bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-blue-600">{visibleNews.length}</span>
          <span className="text-[10px] text-slate-400 ml-1 font-medium uppercase">Posts</span>
        </div>
      </div>

      <div
        className={
          variant === "newsroom"
            ? "divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            : "grid gap-4"
        }
      >
        {visibleNews.map((item) => (
          <NewsItem
            key={item.id}
            news={item}
            isTeacher={isTeacher}
            canManage={canManage}
            classId={classId}
            onDelete={removeNews}
            onEdit={editNews}
            categories={categories}
            forceOpen={autoOpenNewsId === item.id}
            onForceOpenHandled={onAutoOpenHandled}
            onOpenNews={onOpenNews}
            variant={variant}
          />
        ))}
      </div>

      {/* 🚀 무한 스크롤: 더 보기 버튼 */}
      {hasNextPage && (
        <div className="flex justify-center pt-6">
          <Button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            variant="outline"
            className="w-full max-w-xs h-12 rounded-2xl bg-white border-slate-200 hover:border-blue-300 hover:text-blue-600 shadow-sm group"
          >
            {isFetchingNextPage ? (
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="font-bold">불러오는 중...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ChevronDownIcon className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                <span className="font-bold">이전 소식 더 보기</span>
              </div>
            )}
          </Button>
        </div>
      )}

      {!hasNextPage && (
        <div className="flex flex-col items-center justify-center gap-2 pt-10 pb-6 opacity-40">
          <CheckCircleIcon className="w-6 h-6 text-slate-400" />
          <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">All caught up!</span>
        </div>
      )}
    </div>
  );
};

export default NewsList;
