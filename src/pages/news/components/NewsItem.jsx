import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Clock,
  Edit,
  MessageCircle,
  Heart,
  Newspaper,
  Trash2,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import Card from "../../../components/ui/Card";
import Spinner from "../../../components/ui/Spinner";
import { db } from "../../../firebase";
import { useFeedback } from "../../../contexts/FeedbackContext";
import NewsDetailModal from "../modals/NewsDetailModal";
import NewsModal from "../modals/NewsModal";
import { Button } from "../../../components/ui";

const stripHtmlToText = (value = "") =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractFirstImage = (value = "") => {
  const match = String(value || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? String(match[1] || "").trim() : "";
};

const truncatePreview = (value = "", maxLength = 100) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
};

const countWhitespace = (value = "") => (String(value).match(/\s/g) || []).length;

const getPreviewText = (news = {}) => {
  const summaryText = stripHtmlToText(news.summary);
  const contentText = stripHtmlToText(news.content);

  if (
    summaryText &&
    contentText &&
    summaryText.length >= 24 &&
    countWhitespace(summaryText) < countWhitespace(contentText) / 2
  ) {
    return truncatePreview(contentText);
  }

  return truncatePreview(summaryText || contentText);
};

const NewsItem = ({
  news,
  isTeacher,
  canManage,
  classId,
  onDelete,
  onEdit,
  categories = [],
  forceOpen = false,
  onForceOpenHandled,
  onOpenNews,
  variant = "card",
}) => {
  const { showFeedback } = useFeedback();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [fullNews, setFullNews] = useState(
    news?.dataSource === "news" ? news : null,
  );
  const [isResolvingFullNews, setIsResolvingFullNews] = useState(false);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (news?.dataSource === "news") {
      setFullNews(news);
      return;
    }

    setFullNews((prev) => {
      if (prev?.id === news?.id && prev?.dataSource === "news") {
        return prev;
      }
      return null;
    });
  }, [news]);

  const resolvedNews = fullNews || news;

  const isUnread = useMemo(() => {
    if (!news.createdAt) return false;

    const isReadItem = localStorage.getItem(`read_item_${news.id}`);
    if (isReadItem === "true") return false;

    const categoryKey = `lastRead_${classId}_${news.categoryId || "popular"}`;
    const lastReadTimestamp = localStorage.getItem(categoryKey);

    if (!lastReadTimestamp) return true;
    return news.createdAt.toMillis() > parseInt(lastReadTimestamp, 10);
  }, [news.id, news.createdAt, news.categoryId, classId]);

  const getCategoryInfo = () => {
    if (news.categoryId && categories.length > 0) {
      const found = categories.find((cat) => cat.id === news.categoryId);
      if (found) {
        return {
          label: found.label,
          color: found.color || "blue",
          icon: found.icon || Newspaper,
        };
      }
    }

    if (news.categoryName) {
      return { label: news.categoryName, color: "blue", icon: Newspaper };
    }

    if (news.type === "popular") {
      return { label: "인기", color: "orange", icon: Newspaper };
    }

    return { label: "미분류", color: "gray", icon: Newspaper };
  };

  const categoryInfo = getCategoryInfo();
  const thumbnailUrl = news.thumb || extractFirstImage(news.content);
  const previewText = getPreviewText(news);
  const isUrgent = news.priority === "high";
  const isPopupEnabled = !!news.popupEnabled;
  const canManageItem = isTeacher || canManage;

  useEffect(() => {
    if (!forceOpen) return;
    autoOpenedRef.current = true;
    setDetailModalOpen(true);
  }, [forceOpen]);

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = timestamp.toDate();
    const now = new Date();
    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));

    if (diffHours < 1) return "방금 전";
    if (diffHours < 24) return `${diffHours}시간 전`;
    return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  };

  const title = news.title || "제목 없음";

  const ensureFullNews = async () => {
    if (!classId || !news?.id) {
      return news;
    }

    if (fullNews?.id === news.id && fullNews?.dataSource === "news") {
      return fullNews;
    }

    if (news.dataSource === "news") {
      setFullNews(news);
      return news;
    }

    setIsResolvingFullNews(true);
    try {
      const snapshot = await getDoc(doc(db, `classes/${classId}/news`, news.id));
      if (!snapshot.exists()) {
        throw new Error("news-not-found");
      }

      const nextNews = {
        id: snapshot.id,
        dataSource: "news",
        ...snapshot.data(),
      };
      setFullNews(nextNews);
      return nextNews;
    } finally {
      setIsResolvingFullNews(false);
    }
  };

  const handleEditSubmit = async (newsData) => {
    try {
      await onEdit({
        classId,
        newsId: resolvedNews.id,
        newData: newsData,
      });

      showFeedback("뉴스가 성공적으로 수정되었습니다.", "success");
      setEditModalOpen(false);
    } catch (error) {
      console.error("뉴스 수정 에러:", error);
      showFeedback("뉴스 수정 중 오류가 발생했습니다.", "error");
    }
  };

  const handleOpenEditModal = async (event) => {
    event.stopPropagation();

    try {
      await ensureFullNews();
      setEditModalOpen(true);
    } catch (error) {
      console.error("뉴스 원문 조회 에러:", error);
      showFeedback("편집에 필요한 원문을 불러오지 못했습니다.", "error");
    }
  };

  const handleDelete = async () => {
    if (!(await appConfirm("정말 이 뉴스를 삭제하시겠습니까?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    if (!classId || !news?.id) {
      showFeedback("삭제에 필요한 정보가 누락되었습니다.", "error");
      return;
    }

    try {
      const result = await onDelete({ classId, newsId: news.id });
      if (result?.success) {
        showFeedback("뉴스가 삭제되었습니다.", "success");
      } else {
        showFeedback(result?.message || "뉴스 삭제에 실패했습니다.", "error");
      }
    } catch (error) {
      console.error("뉴스 삭제 에러:", error);
      showFeedback(error?.message || "뉴스 삭제 중 오류가 발생했습니다.", "error");
    }
  };

  const openDetail = () => {
    if (onOpenNews) {
      onOpenNews(resolvedNews);
      return;
    }
    setDetailModalOpen(true);
  };

  const handleDetailClose = () => {
    setDetailModalOpen(false);
    if (autoOpenedRef.current) {
      autoOpenedRef.current = false;
      onForceOpenHandled?.();
    }
  };

  const compactRow = (
    <article
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail();
        }
      }}
      className={`group relative flex cursor-pointer gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-5 ${
        isUrgent ? "bg-rose-50/35" : "bg-white"
      }`}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          className="hidden h-20 w-28 shrink-0 rounded-xl border border-slate-100 object-cover lg:block"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="hidden h-20 w-28 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-sky-50 text-indigo-500 lg:flex">
          <Newspaper className="h-6 w-6" />
        </div>
      )}

      <div className={`min-w-0 flex-1 ${canManageItem ? "pr-16" : ""}`}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="rounded-md bg-indigo-50 px-2 py-1 text-indigo-600">
            {categoryInfo.label}
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Clock className="h-3.5 w-3.5" />
            {formatTime(news.createdAt)}
          </span>
          {isUrgent ? (
            <span className="inline-flex items-center gap-1 text-rose-600">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              중요
            </span>
          ) : null}
        </div>

        <h3 className="mt-2 line-clamp-1 text-[15px] font-black leading-5 text-slate-900 group-hover:text-indigo-700">
          {isUnread ? (
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-rose-400 align-middle" />
          ) : null}
          {title}
        </h3>
        <p className="mt-1 line-clamp-1 text-sm leading-5 text-slate-500 [overflow-wrap:anywhere]">
          {previewText || "본문 미리보기가 없습니다."}
        </p>

        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-400">
          <span>{news.authorName || "작성자 미상"}</span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {Number(news.likesCount || news.likes?.length || 0)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" />
              {Number(news.commentsCount || 0)}
            </span>
          </span>
        </div>
      </div>

      {canManageItem ? (
        <div className="absolute right-3 top-3 flex items-center gap-1">
          <Button tone="slate" kind="outline" size="xs"
            type="button"
            aria-label="뉴스 수정"
            onClick={handleOpenEditModal}
            disabled={isResolvingFullNews}
            className="inline-flex w-8 items-center justify-center"
          >
            {isResolvingFullNews ? (
              <Spinner size="xs" color="current" containerClassName="gap-0" />
            ) : (
              <Edit className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button tone="slate" kind="outline" size="icon-md"
            type="button"
            aria-label="뉴스 삭제"
            onClick={(event) => {
              event.stopPropagation();
              handleDelete();
            }}
            className="inline-flex w-8 items-center justify-center"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </article>
  );

  return (
    <>
      {variant === "newsroom" ? (
        compactRow
      ) : (
      <Card
        onClick={openDetail}
        className={`transition-all duration-200 cursor-pointer hover:shadow-md ${
          isUrgent
            ? "border-rose-300 bg-rose-50/30 hover:bg-rose-50/60 hover:shadow-rose-100/60"
            : "border-slate-200 hover:bg-slate-50"
        }`}
        noPadding
      >
        <Card.Content className="p-4 relative">
          {canManageItem && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
              <Button tone="blue" kind="outline" size="xs"
                type="button"
                aria-label="뉴스 수정"
                onClick={handleOpenEditModal}
                disabled={isResolvingFullNews}
                className="inline-flex w-8 items-center justify-center disabled:cursor-wait disabled:opacity-70"
              >
                {isResolvingFullNews ? (
                  <Spinner size="xs" color="current" containerClassName="gap-0" />
                ) : (
                  <Edit className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button tone="rose" kind="outline" size="icon-md"
                type="button"
                aria-label="뉴스 삭제"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDelete();
                }}
                className="inline-flex w-8 items-center justify-center"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <div className="flex gap-4">
            {thumbnailUrl && (
              <div className="flex-shrink-0">
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg border border-slate-100"
                  onError={(event) => {
                    event.target.style.display = "none";
                  }}
                />
              </div>
            )}

            <div className={`flex-1 min-w-0 flex flex-col ${canManageItem ? "pr-20" : ""}`}>
              <div className="flex items-center gap-2 min-w-0 flex-wrap mb-1.5">
                {isUrgent && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-black bg-rose-100 text-rose-700 border border-rose-200 uppercase tracking-wide">
                    긴급
                  </span>
                )}
                {isPopupEnabled && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-black bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase tracking-wide inline-flex items-center gap-1">
                    <BellRing className="w-3 h-3" />
                    팝업
                  </span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold bg-${categoryInfo.color}-50 text-${categoryInfo.color}-600 border border-${categoryInfo.color}-100 uppercase`}
                >
                  {categoryInfo.label}
                </span>
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatTime(news.createdAt)}
                </span>
              </div>

              <h3 className="font-bold text-slate-900 text-base mb-1 line-clamp-2 leading-snug flex items-center gap-2">
                {isUnread && (
                  <span className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                )}
                {title}
              </h3>

              <p className="text-sm text-slate-500 line-clamp-1 mb-3 [word-break:keep-all] [overflow-wrap:anywhere]">
                {previewText || "본문 미리보기가 없습니다."}
              </p>

              <div className="flex items-center mt-auto">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">
                    {news.authorName || "익명"}
                  </span>
                  {news.commentsCount > 0 && (
                    <span className="flex items-center gap-1 text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">
                      <MessageCircle className="w-3 h-3" />
                      {news.commentsCount}
                    </span>
                  )}
                  {news.showOnDashboard && (
                    <span title="대시보드 공지">📌</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card.Content>
      </Card>
      )}

      {editModalOpen && (
        <NewsModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onSubmit={handleEditSubmit}
          mode="edit"
          newsToEdit={resolvedNews}
          categories={categories}
        />
      )}

      {detailModalOpen && (
        <NewsDetailModal
          isOpen={detailModalOpen}
          onClose={handleDetailClose}
          news={resolvedNews}
          isTeacher={isTeacher}
          canManage={canManage}
          classId={classId}
          onEdit={(loadedNews) => {
            if (loadedNews) {
              setFullNews(loadedNews);
            }
            setDetailModalOpen(false);
            setEditModalOpen(true);
          }}
          onDelete={handleDelete}
          categories={categories}
        />
      )}
    </>
  );
};

export default NewsItem;
