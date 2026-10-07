import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { ArrowLeft, Edit, Heart, Trash2 } from "lucide-react";
import DOMPurify from "dompurify";
import { Button, ImageLightbox, Spinner } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { doc, onSnapshot } from "firebase/firestore";
import NewsComments from "./NewsComments";
import { useNewsActions } from "../hooks/useNewsQueries";
import SurveyLauncher from "../../../components/survey/SurveyLauncher";

const cleanContent = (content) =>
  content ? content.replace(/<div[^>]*data-survey-id[^>]*>.*?<\/div>/gs, "") : "";

const extractSurveyIds = (content) =>
  content
    ? (content.match(/data-survey-id="([^"]+)"/g) || [])
        .map((match) => match.match(/"([^"]+)"/)?.[1])
        .filter(Boolean)
    : [];

const formatDate = (value) => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : "";
};

const NewsDetailPanel = ({ news, classId: propClassId, isTeacher, canManage, categories = [], onEdit, onDelete, onBack }) => {
  const { userData, classId: sessionClassId } = useUser();
  const classId = propClassId || sessionClassId;
  const uid = userData?.uid;
  const { editNews } = useNewsActions(classId);
  const contentRef = useRef(null);
  const [liveNews, setLiveNews] = useState(news);
  const [isLoading, setIsLoading] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);

  useEffect(() => setLiveNews(news), [news]);

  useEffect(() => {
    if (!classId || !news?.id) return undefined;
    setIsLoading(true);
    const unsubscribe = onSnapshot(doc(db, `classes/${classId}/news`, news.id), (snapshot) => {
      if (snapshot.exists()) setLiveNews({ id: snapshot.id, dataSource: "news", ...snapshot.data() });
      setIsLoading(false);
    }, () => setIsLoading(false));
    return () => unsubscribe();
  }, [classId, news?.id]);

  const currentNews = liveNews || news;

  useEffect(() => {
    if (!currentNews || !uid) return;
    setLikesCount(currentNews.likesCount ?? currentNews.likes?.length ?? 0);
    setIsLiked(currentNews.likes?.includes(uid) || false);
    localStorage.setItem(`read_item_${currentNews.id}`, "true");
  }, [currentNews, uid]);

  useEffect(() => {
    if (!currentNews?.content || isLoading) return undefined;
    const timer = setTimeout(() => {
      const container = contentRef.current;
      if (!container) return;
      container.querySelectorAll("img").forEach((image) => {
        image.style.cursor = "zoom-in";
        image.onclick = (event) => {
          const sources = Array.from(container.querySelectorAll("img")).map((node) => node.src);
          setLightboxImages(sources);
          setLightboxIndex(sources.indexOf(event.target.src));
          setShowLightbox(true);
        };
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [currentNews?.content, isLoading]);

  const handleLikeToggle = async () => {
    if (!classId || !uid || !currentNews) return;
    const previouslyLiked = isLiked;
    const nextLikes = previouslyLiked
      ? (currentNews.likes || []).filter((id) => id !== uid)
      : [...(currentNews.likes || []), uid];
    setIsLiked(!previouslyLiked);
    setLikesCount((count) => count + (previouslyLiked ? -1 : 1));
    try {
      await editNews({
        classId,
        newsId: currentNews.id,
        newData: { likes: nextLikes, interactionScore: nextLikes.length * 2 + (currentNews.commentsCount || 0) },
      });
    } catch (_error) {
      setIsLiked(previouslyLiked);
      setLikesCount((count) => count + (previouslyLiked ? 1 : -1));
    }
  };

  if (!currentNews || !classId) {
    return <div className="flex min-h-[440px] items-center justify-center bg-white text-sm font-semibold text-slate-400">뉴스를 선택해 주세요.</div>;
  }

  const category = categories.find((item) => item.id === currentNews.categoryId) || { label: "뉴스", color: "slate" };
  const canEdit = isTeacher || canManage;

  return (
    <article className="min-w-0 bg-white">
      <div className="border-b border-slate-100 px-6 pb-6 pt-7 sm:px-8 xl:px-10 xl:pt-9">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="slate" kind="outline" size="xs" type="button" onClick={onBack} className="inline-flex items-center gap-1.5"><ArrowLeft className="h-3.5 w-3.5" />{"\uBAA9\uB85D"}</Button>
            <span className="rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-600">{category.label}</span>
            {currentNews.priority === "high" ? <span className="rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">중요</span> : null}
          </div>
          {canEdit ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button tone="slate" kind="ghost" size="icon-md" type="button" aria-label="뉴스 수정" onClick={() => onEdit?.(currentNews)} className="inline-flex w-8 items-center justify-center"><Edit className="h-4 w-4" /></Button>
              <Button tone="slate" kind="ghost" size="icon-md" type="button" aria-label="뉴스 삭제" onClick={() => onDelete?.(currentNews)} className="inline-flex w-8 items-center justify-center"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ) : null}
        </div>
        <h1 className="mt-5 break-keep text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{currentNews.title || "제목 없음"}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500"><span className="text-slate-800">{currentNews.authorName || "작성자"}</span><span className="text-slate-300">•</span><span>{formatDate(currentNews.createdAt)}</span></div>
      </div>

      <div className="px-6 py-8 sm:px-8 xl:px-10">
        {isLoading && !liveNews ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center text-slate-400"><Spinner size="md" /><p className="mt-4 text-sm font-medium">뉴스 본문을 불러오는 중입니다.</p></div>
        ) : (
          <>
            <div className="prose prose-slate max-w-none prose-headings:font-black prose-p:leading-8 prose-img:rounded-2xl prose-img:border prose-img:border-slate-100">
              <div ref={contentRef} className="break-words text-[16px] leading-8 text-slate-700" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(cleanContent(currentNews.content)) }} />
            </div>
            {extractSurveyIds(currentNews.content).map((surveyId) => <div key={surveyId} className="mt-8"><SurveyLauncher surveyId={surveyId} newsId={currentNews.id} classId={classId} userId={uid} /></div>)}
            <section className="mt-16 border-t border-slate-100 pt-6">
              <div className="mb-5 flex justify-end"><Button type="button" onClick={handleLikeToggle} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black ${isLiked ? "border-rose-100 bg-rose-50 text-rose-500" : "border-slate-200 bg-white text-slate-500"}`}><Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />{likesCount}</Button></div>
              <NewsComments newsId={currentNews.id} classId={classId} isTeacher={isTeacher} canManage={canManage} />
            </section>
          </>
        )}
      </div>
      {showLightbox ? ReactDOM.createPortal(<ImageLightbox images={lightboxImages} initialIndex={lightboxIndex} onClose={() => setShowLightbox(false)} />, document.body) : null}
    </article>
  );
};

export default NewsDetailPanel;
