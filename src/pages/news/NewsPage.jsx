import { appConfirm } from "../../utils/appDialogs";
import React, { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { useUser } from "../../contexts/UserContext";
import { PlusCircle, Newspaper, Search } from "lucide-react";
import { Button, PageHeader } from "../../components/ui";
import NewsCategories from "./components/NewsCategories";
import NewsList from "./components/NewsList";
import PopularNewsList from "./components/PopularNewsList";
import NewsModal from "./modals/NewsModal";
import AddEditCategoryModal from "./modals/AddEditCategoryModal";
import NewsSidebar from "./components/NewsSidebar";
import NewsDetailPanel from "./components/NewsDetailPanel";

import { useLiveNews, useNewsActions } from "./hooks/useNewsQueries";

import { useFeedback } from "../../contexts/FeedbackContext";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase";

const NewsPage = () => {
  const { classId, userData, isTeacher, hasPermission } = useUser();
  const { showFeedback } = useFeedback();

  const { createNews, editNews, removeNews } = useNewsActions(classId);
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedCategory = searchParams.get("category") || "";
  const requestedNewsId = searchParams.get("news") || "";

  const [selectedNewsId, setSelectedNewsId] = useState(() => requestedNewsId);
  const [selectedNews, setSelectedNews] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(
    () => requestedCategory || "popular",
  );
  const [newsModalOpen, setNewsModalOpen] = useState(false);
  const [editingNews, setEditingNews] = useState(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categories, setCategories] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [, setCategoriesLoading] = useState(true);

  const canManageNews = hasPermission("news_admin");
  const {
    data: sidebarNews = [],
    isLoading: isSidebarNewsLoading,
    isError: isSidebarNewsError,
  } = useLiveNews(classId, {
    category: "all",
    pageSize: 50,
  });
  const activeCategoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories],
  );

  const activeNews = useMemo(
    () => sidebarNews.find((item) => item.id === selectedNewsId) || selectedNews || sidebarNews[0] || null,
    [selectedNews, selectedNewsId, sidebarNews],
  );
  const isDetailView = Boolean(selectedNewsId && activeNews);

  useEffect(() => {
    if (requestedNewsId === selectedNewsId) return;
    setSelectedNewsId(requestedNewsId);
    if (!requestedNewsId) setSelectedNews(null);
  }, [requestedNewsId, selectedNewsId]);
  useEffect(() => {
    if (!classId) {
      setCategoriesLoading(false);
      return;
    }

    const categoriesRef = collection(db, "classes", classId, "newsCategories");
    const q = query(categoriesRef, orderBy("order", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firestoreCategories = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      const allCategories = [
        {
          id: "popular",
          label: "인기",
          icon: "Trophy",
          color: "orange",
          description: "TOP 인기 뉴스",
          order: 0,
          isDefault: true,
          isActive: true,
        },
        ...firestoreCategories,
      ];

      allCategories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setCategories(allCategories);
      setCategoriesLoading(false);
    });

    return () => unsubscribe();
  }, [classId]);

  useEffect(() => {
    if (requestedCategory) {
      if (selectedCategory !== requestedCategory) {
        setSelectedCategory(requestedCategory);
      }
      return;
    }

    if (selectedCategory !== "popular" && activeCategoryIds.size > 0) {
      if (!activeCategoryIds.has(selectedCategory)) {
        setSelectedCategory("popular");
      }
    }
  }, [activeCategoryIds, requestedCategory, selectedCategory]);

  const handleCategoryChange = (nextCategory) => {
    setSelectedCategory(nextCategory);
    setSelectedNewsId("");
    setSelectedNews(null);

    const nextParams = new URLSearchParams(searchParams);
    if (nextCategory && nextCategory !== "popular") {
      nextParams.set("category", nextCategory);
    } else {
      nextParams.delete("category");
    }
    nextParams.delete("news");
    setSearchParams(nextParams, { replace: true });
  };

  const handleCloseNews = () => {
    setSelectedNewsId("");
    setSelectedNews(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("news");
    setSearchParams(nextParams, { replace: true });
  };
  const handleNewsOpen = (news) => {
    if (!news?.id) return;
    const nextCategory = news.categoryId || "popular";
    setSelectedNewsId(news.id);
    setSelectedNews(news);
    setSelectedCategory(nextCategory);
    const nextParams = new URLSearchParams(searchParams);
    if (nextCategory !== "popular") nextParams.set("category", nextCategory);
    else nextParams.delete("category");
    nextParams.set("news", news.id);
    setSearchParams(nextParams, { replace: true });
  };

  const handleDeleteNews = async (news) => {
    if (!news?.id || !(await appConfirm("이 뉴스를 삭제할까요?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    try {
      const result = await removeNews({ classId, newsId: news.id });
      if (!result?.success) throw new Error(result?.message || "삭제에 실패했습니다.");
      showFeedback("뉴스를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(error?.message || "뉴스 삭제 중 오류가 발생했습니다.", "error");
    }
  };
  const handleAddNewsSubmit = async (newsData) => {
    try {
      const result = await createNews({
        classId,
        ...newsData,
        authorUid: userData?.uid,
        authorName: userData?.name,
      });

      if (result.success) {
        showFeedback("새로운 소식이 성공적으로 발행되었습니다!", "success");
        setNewsModalOpen(false);
      }
    } catch (error) {
      console.error("뉴스 등록 에러:", error);
      showFeedback("뉴스 등록 중 오류가 발생했습니다.", "error");
    }
  };

  const handleEditNewsSubmit = async (newsData) => {
    if (!editingNews?.id) {
      console.error("수정할 뉴스 ID가 없습니다.");
      return;
    }

    try {
      await editNews({
        classId,
        newsId: editingNews.id,
        newData: newsData,
      });

      showFeedback("뉴스가 성공적으로 수정되었습니다.", "success");
      setNewsModalOpen(false);
      setEditingNews(null);
    } catch (error) {
      console.error("뉴스 수정 에러:", error);
    }
  };

  const handleOpenEditModal = (news) => {
    setEditingNews(news);
    setNewsModalOpen(true);
  };

  const handleDeleteCategory = async (category) => {
    if (!(await appConfirm(`'${category.label}' 주제를 삭제하시겠습니까?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    try {
      const categoryRef = doc(db, "classes", classId, "newsCategories", category.id);
      if (category.isDefault) {
        await updateDoc(categoryRef, { isActive: false, updatedAt: new Date() });
      } else {
        await deleteDoc(categoryRef);
        if (selectedCategory === category.id) handleCategoryChange("popular");
      }
      showFeedback("주제가 삭제되었습니다.", "success");
    } catch (error) {
      showFeedback("삭제 중 오류가 발생했습니다.", "error");
    }
  };

  const handleReorderCategories = async (newOrder) => {
    try {
      const batch = writeBatch(db);
      newOrder.forEach((category, index) => {
        if (category.id !== "popular") {
          const ref = doc(db, "classes", classId, "newsCategories", category.id);
          batch.update(ref, { order: index, updatedAt: new Date() });
        }
      });
      await batch.commit();
      showFeedback("주제 순서가 변경되었습니다.", "success");
    } catch (error) {
      showFeedback("순서 변경 실패", "error");
    }
  };

  const handleEditCategory = (category) => {
    setEditingCategory(category);
    setCategoryModalOpen(true);
  };

  const newsQuestGuide = useMemo(() => {
    if (!isTeacher && !canManageNews) return null;

    const customCategoryCount = categories.filter((category) => !category.isDefault).length;

    return {
      type: "quest",
      title: "뉴스 도우미",
      launcherTitle: "뉴스 도우미",
      launcherDescription: "주제, 기사 작성, 피드 확인 흐름을 체크합니다.",
      subtitle: "학급 소식과 경제 뉴스를 운영하는 기본 구조를 확인합니다.",
      storageKey: classId ? `finclass_news_quest_${classId}` : "finclass_news_quest",
      tourKey: "TEACHER_NEWS_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "category-list",
          title: "뉴스 주제 확인하기",
          description: "인기 뉴스와 학급 주제 구조를 확인합니다.",
          doneText: `${categories.length}개의 주제가 있습니다.`,
          completed: categories.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "category-ready",
              label: "주제 목록 확인",
              completed: categories.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="news-categories"]',
              title: "뉴스 주제",
              content: "뉴스를 주제별로 나누는 주제 영역입니다.",
            },
          ],
        },
        {
          id: "write-news",
          title: "뉴스 작성 흐름 확인하기",
          description: "학급 뉴스나 경제 관련 기사를 작성하는 버튼 위치를 확인합니다.",
          completed: newsModalOpen,
          manualComplete: true,
          objectives: [
            {
              id: "news-modal-open",
              label: "뉴스 작성 모달 열기",
              completed: newsModalOpen,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="news-actions"]',
              title: "뉴스 작성",
              content: "상단 뉴스 작성 버튼에서 새 기사를 발행합니다.",
            },
          ],
        },
        {
          id: "feed-preview",
          title: "뉴스 피드 확인하기",
          description: "학생에게 보이는 뉴스 목록과 인기 뉴스 흐름을 확인합니다.",
          completed: Boolean(selectedCategory),
          manualComplete: true,
          objectives: [
            {
              id: "selected-category",
              label: "뉴스 주제 선택",
              completed: Boolean(selectedCategory),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="news-feed-preview"]',
              title: "뉴스 피드",
              content: "선택한 주제의 뉴스 목록이 이 영역에 표시됩니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "custom-category",
          title: "맞춤 주제 만들기",
          description: "경제, 학교 행사, 학급 공지처럼 주제를 나눌 수 있습니다.",
          completed: customCategoryCount > 0 || categoryModalOpen,
          manualComplete: true,
          objectives: [
            {
              id: "category-modal-open",
              label: "주제 추가 열기",
              completed: categoryModalOpen,
            },
            {
              id: "custom-category-count",
              label: "맞춤 주제 확인",
              completed: customCategoryCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="news-categories"]',
              title: "주제 관리",
              content: "주제 영역에서 추가, 수정, 순서 변경을 할 수 있습니다.",
            },
          ],
        },
      ],
    };
  }, [
    canManageNews,
    categories,
    categoryModalOpen,
    classId,
    isTeacher,
    newsModalOpen,
    selectedCategory,
  ]);

  return (
    <AppLayout showDefaultHeader={false} pageGuide={newsQuestGuide}>
      <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6">
        <div className="mx-auto max-w-[1500px]">
        <PageHeader
          title="뉴스"
          subtitle="학급 소식과 기사 현황을 확인하고 관리합니다."
          icon={Newspaper}
          actions={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <label className="relative block min-w-0 sm:w-[360px]">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  aria-label="뉴스 검색"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="뉴스 제목, 내용, 작성자 검색"
                  className="h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 pl-10 pr-4 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
              {(isTeacher || canManageNews) && (
                <div data-tour="news-actions">
                  <Button size="md"
                    onClick={() => {
                      setEditingNews(null);
                      setNewsModalOpen(true);
                    }}
                    tone="blue"
                    className="whitespace-nowrap"
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    기사 작성
                  </Button>
                </div>
              )}
            </div>
          }
        />

        <div data-tour="news-categories">
          <NewsCategories
            selectedCategory={selectedCategory}
            categories={categories}
            onCategoryChange={handleCategoryChange}
            onReorderCategories={handleReorderCategories}
            onEditCategory={handleEditCategory}
            onDeleteCategory={handleDeleteCategory}
            onOpenAddCategoryModal={() => setCategoryModalOpen(true)}
          />
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.36fr)]">
          <div className="relative min-w-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
            {isDetailView ? (
              <NewsDetailPanel
                news={activeNews}
                classId={classId}
                isTeacher={isTeacher}
                canManage={canManageNews}
                categories={categories}
                onEdit={handleOpenEditModal}
                onDelete={handleDeleteNews}
                onBack={handleCloseNews}
              />
            ) : (
              <>
                <div data-tour="news-feed-preview" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]" />
                {selectedCategory === "popular" ? (
                  <PopularNewsList
                    classId={classId}
                    isTeacher={isTeacher}
                    canManage={canManageNews}
                    categories={categories}
                    onEdit={handleOpenEditModal}
                    searchTerm={searchTerm}
                    variant="newsroom"
                    onOpenNews={handleNewsOpen}
                    news={sidebarNews}
                    isLoading={isSidebarNewsLoading}
                    isError={isSidebarNewsError}
                  />
                ) : (
                  <NewsList classId={classId} selectedCategory={selectedCategory} isTeacher={isTeacher} canManage={canManageNews} categories={categories} onEdit={handleOpenEditModal} searchTerm={searchTerm} variant="newsroom" onOpenNews={handleNewsOpen} />
                )}
              </>
            )}
          </div>

          <NewsSidebar news={sidebarNews} categories={categories} onOpenNews={handleNewsOpen} selectedNewsId={selectedNewsId} />
        </div>
        {newsModalOpen && (
          <NewsModal
            isOpen={newsModalOpen}
            onClose={() => {
              setNewsModalOpen(false);
              setEditingNews(null);
            }}
            onSubmit={editingNews ? handleEditNewsSubmit : handleAddNewsSubmit}
            categories={categories}
            mode={editingNews ? "edit" : "add"}
            newsToEdit={editingNews}
          />
        )}

        {categoryModalOpen && (
          <AddEditCategoryModal
            isOpen={categoryModalOpen}
            onClose={() => {
              setCategoryModalOpen(false);
              setEditingCategory(null);
            }}
            existingCategories={categories}
            categoryToEdit={editingCategory}
            onCreated={(msg) => showFeedback(msg, "success")}
          />
        )}
        </div>
      </div>
    </AppLayout>
  );
};

export default NewsPage;
