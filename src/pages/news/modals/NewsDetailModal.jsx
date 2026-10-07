import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { BellRing, Edit, Heart, Lock, Trash2, X } from "lucide-react";
import DOMPurify from "dompurify";
import {
  Badge,
  Button,
  ImageLightbox,
  Modal,
  Spinner,
} from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { doc, onSnapshot } from "firebase/firestore";
import NewsComments from "../components/NewsComments";
import { useNewsActions } from "../hooks/useNewsQueries";
import SurveyLauncher from "../../../components/survey/SurveyLauncher";

const getPopupTargetLabel = (target) => {
  if (target === "student") return "학생 전용";
  if (target === "teacher") return "교사 전용";
  return "전체 대상";
};

const cleanContent = (content) =>
  content
    ? content.replace(/<div[^>]*data-survey-id[^>]*>.*?<\/div>/gs, "")
    : "";

const extractSurveyIds = (content) =>
  content
    ? (content.match(/data-survey-id="([^"]+)"/g) || [])
        .map((match) => match.match(/"([^"]+)"/)?.[1])
        .filter(Boolean)
    : [];

const NewsDetailModal = ({
  isOpen,
  onClose,
  news,
  isTeacher,
  canManage,
  classId: propClassId,
  onEdit,
  onDelete,
  categories = [],
}) => {
  const { userData, classId: sessionClassId } = useUser();
  const classId = propClassId || sessionClassId;
  const uid = userData?.uid;

  const { editNews } = useNewsActions(classId);
  const contentRef = useRef(null);

  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);
  const [liveNews, setLiveNews] = useState(news);
  const [isLiveNewsLoading, setIsLiveNewsLoading] = useState(false);

  useEffect(() => {
    setLiveNews(news);
  }, [isOpen, news]);

  useEffect(() => {
    if (!isOpen || !classId || !news?.id) return undefined;

    setIsLiveNewsLoading(true);

    const newsRef = doc(db, `classes/${classId}/news`, news.id);
    const unsubscribe = onSnapshot(
      newsRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setIsLiveNewsLoading(false);
          return;
        }

        setLiveNews({
          id: snapshot.id,
          dataSource: "news",
          ...snapshot.data(),
        });
        setIsLiveNewsLoading(false);
      },
      () => {
        setIsLiveNewsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, isOpen, news?.dataSource, news?.id]);

  const currentNews = liveNews || news;
  const detailIsHydrating = Boolean(isOpen && isLiveNewsLoading && !currentNews);

  useEffect(() => {
    if (!currentNews || !uid) return;
    setLikesCount(currentNews.likesCount ?? currentNews.likes?.length ?? 0);
    setIsLiked(currentNews.likes?.includes(uid) || false);

    if (isOpen) {
      localStorage.setItem(`read_item_${currentNews.id}`, "true");
    }
  }, [currentNews, uid, isOpen]);

  useEffect(() => {
    if (!isOpen || !currentNews?.content || detailIsHydrating) return;

    const timer = setTimeout(() => {
      if (!contentRef.current) return;
      const imgs = contentRef.current.querySelectorAll("img");
      imgs.forEach((img) => {
        img.style.cursor = "zoom-in";
        img.onclick = (event) => {
          const allSrcs = Array.from(
            contentRef.current.querySelectorAll("img"),
          ).map((node) => node.src);
          setLightboxImages(allSrcs);
          setLightboxIndex(allSrcs.indexOf(event.target.src));
          setShowLightbox(true);
        };
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [currentNews?.content, detailIsHydrating, isOpen]);

  const handleLikeToggle = async () => {
    if (!classId || !uid || !currentNews || detailIsHydrating) return;

    const currentlyLiked = isLiked;
    const currentLikes = currentNews.likes || [];
    const nextLikes = currentlyLiked
      ? currentLikes.filter((id) => id !== uid)
      : [...currentLikes, uid];

    setIsLiked(!currentlyLiked);
    setLikesCount((prev) => (currentlyLiked ? prev - 1 : prev + 1));

    try {
      await editNews({
        classId,
        newsId: currentNews.id,
        newData: {
          likes: nextLikes,
          interactionScore:
            nextLikes.length * 2 + (currentNews.commentsCount || 0),
        },
      });
    } catch (_error) {
      setIsLiked(currentlyLiked);
      setLikesCount((prev) => (currentlyLiked ? prev + 1 : prev - 1));
    }
  };

  if (!currentNews || !classId) return null;

  const category =
    categories.find((item) => item.id === currentNews.categoryId) || {
      label: "뉴스",
      color: "slate",
    };
  const popupTargetLabel = getPopupTargetLabel(currentNews.popupTarget);
  const canEditDetail =
    !detailIsHydrating && (isTeacher || canManage);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        showDefaultCloseButton={false}
      >
        <div className="flex flex-col h-[90vh] bg-white rounded-[2rem] overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-slate-50 bg-white/80 sticky top-0 z-20 backdrop-blur-md">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Badge
                  color={category.color}
                  className="rounded-full px-3.5 py-1 font-bold text-[11px]"
                >
                  {category.label}
                </Badge>
                {currentNews.popupEnabled && (
                  <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                    <BellRing className="w-3.5 h-3.5" />
                    팝업
                    {currentNews.popupMode === "mandatory_phrase" && (
                      <Lock className="w-3.5 h-3.5" />
                    )}
                    <span className="text-indigo-500">{popupTargetLabel}</span>
                  </span>
                )}
              </div>

              <div className="flex gap-1">
                {(isTeacher || canManage) && (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onEdit?.(currentNews)}
                      disabled={!canEditDetail}
                    >
                      <Edit className="w-4 h-4 text-slate-300 hover:text-blue-500" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onDelete?.(currentNews.id)}
                    >
                      <Trash2 className="w-4 h-4 text-slate-300 hover:text-red-400" />
                    </Button>
                  </>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={onClose}
                >
                  <X className="w-4 h-4 text-slate-400 hover:text-slate-700" />
                </Button>
              </div>
            </div>

            <h2 className="text-xl font-black text-slate-900 leading-tight mb-4 break-keep">
              {currentNews.title}
            </h2>

            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <span className="text-slate-800">{currentNews.authorName}</span>
              <span className="text-slate-200">|</span>
              <span>{currentNews.createdAt?.toDate().toLocaleDateString()}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-white">
            {detailIsHydrating ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Spinner size="md" />
                <p className="mt-4 text-sm font-medium">뉴스 본문을 불러오는 중입니다.</p>
              </div>
            ) : (
              <>
                <div className="prose prose-slate max-w-none mb-10">
                  <div
                    ref={contentRef}
                    className="text-slate-700 text-[16px] leading-relaxed break-words"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(cleanContent(currentNews.content)),
                    }}
                  />
                </div>

                {extractSurveyIds(currentNews.content).map((surveyId) => (
                  <div key={surveyId} className="mb-8">
                    <SurveyLauncher
                      surveyId={surveyId}
                      newsId={currentNews.id}
                      classId={classId}
                      userId={uid}
                    />
                  </div>
                ))}

                <div className="mt-20 pt-10 border-t border-slate-100">
                  <div className="mb-5 flex items-center justify-end">
                    <Button
                      type="button"
                      onClick={handleLikeToggle}
                      className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                        isLiked
                          ? "bg-red-50 text-red-500 ring-1 ring-red-100"
                          : "bg-slate-50 text-slate-500 ring-1 ring-slate-100"
                      }`}
                    >
                      <Heart className={`h-3.5 w-3.5 ${isLiked ? "fill-current" : ""}`} />
                      {likesCount}
                    </Button>
                  </div>
                  <NewsComments
                    newsId={currentNews.id}
                    classId={classId}
                    isTeacher={isTeacher}
                    canManage={canManage}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      {showLightbox &&
        ReactDOM.createPortal(
          <ImageLightbox
            images={lightboxImages}
            initialIndex={lightboxIndex}
            onClose={() => setShowLightbox(false)}
          />,
          document.body,
        )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
    </>
  );
};

export default NewsDetailModal;
