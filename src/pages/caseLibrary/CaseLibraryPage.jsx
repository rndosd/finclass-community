import React from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, LayoutDashboard, Plus } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button, ErrorState, PageHeader, SectionLoader } from "../../components/ui";
import { useUser } from "../../contexts/UserContext";
import {
  caseLibraryCategories,
  caseLibraryPageMeta,
} from "./caseLibraryRegistry";
import { caseSortOptions, sortCasePosts } from "./caseLibraryPostUtils";
import CaseLibraryBoardTable from "./components/CaseLibraryBoardTable";
import CaseLibraryEmptyState from "./components/CaseLibraryEmptyState";
import CaseLibraryFilterBar from "./components/CaseLibraryFilterBar";
import CaseLibrarySectionTabs from "./components/CaseLibrarySectionTabs";
import useCaseLibraryFilters from "./hooks/useCaseLibraryFilters";
import useCaseLibraryNewMarker from "./hooks/useCaseLibraryNewMarker";
import useCaseLibraryPosts from "./hooks/useCaseLibraryPosts";

export default function CaseLibraryPage() {
  const navigate = useNavigate();
  const { classId, userData } = useUser();
  const { error, hasMore, loadMore, loading, loadingMore, posts } =
    useCaseLibraryPosts(classId, {
    scope: "shared",
      pageSize: 40,
    });
  const currentUid = String(userData?.uid || "").trim();
  const { isItemNew } = useCaseLibraryNewMarker(classId, currentUid);
  const {
    activeCategory,
    activeSourceClassLabel,
    filteredCases,
    query,
    resetFilters,
    selectedMeta,
    setActiveCategory,
    setActiveSourceClassId,
    setQuery,
    setSortKey,
    showReset,
    sortKey,
    categoryTabs,
  } = useCaseLibraryFilters({
    cases: posts,
    categories: caseLibraryCategories,
    defaultSortKey: "latest",
    pageMeta: caseLibraryPageMeta,
    sortPosts: sortCasePosts,
  });

  const handleCreatePost = () => {
    if (activeCategory && activeCategory !== "all") {
      navigate(`/case-library/new?pageType=${activeCategory}`);
      return;
    }

    navigate("/case-library/new");
  };

  const boardSection = (
    <>
      <CaseLibraryFilterBar
        activeSourceClassLabel={activeSourceClassLabel}
        filteredCount={filteredCases.length}
        query={query}
        selectedMeta={selectedMeta}
        showReset={showReset}
        sortKey={sortKey}
        sortOptions={caseSortOptions}
        onQueryChange={setQuery}
        onReset={resetFilters}
        onSortChange={setSortKey}
      />
      <CaseLibraryBoardTable
        activeCategory={activeCategory}
        casePosts={filteredCases}
        categoryTabs={categoryTabs}
        isNewCasePost={isItemNew}
        onCategoryChange={setActiveCategory}
        onSourceClassSelect={setActiveSourceClassId}
      />
      {hasMore ? (
        <div className="flex justify-center">
          <Button
            tone="slate"
            kind="outline"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? "사례를 더 불러오는 중입니다..." : "사례 더 보기"}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1220px] space-y-6">
        <PageHeader
          title="운영사례 라이브러리"
          subtitle="페이지별 사례를 보고, 필요한 글은 스크랩하거나 템플릿과 함께 참고할 수 있습니다."
          icon={ClipboardList}
          rightSlot={
            <div className="flex flex-wrap gap-2">
              <Button
                tone="slate"
                kind="outline"
                icon={LayoutDashboard}
                onClick={() => navigate("/case-library/dashboard")}
              >
                내 활동
              </Button>
              <Button tone="blue" icon={Plus} onClick={handleCreatePost}>
                새 글 작성
              </Button>
            </div>
          }
        />

        <CaseLibrarySectionTabs />

        {loading ? (
          <SectionLoader
            message="운영사례를 불러오는 중입니다."
            minHeightClassName="min-h-[180px]"
          />
        ) : error ? (
          <ErrorState
            variant="section"
            title="운영사례를 불러오지 못했습니다."
            description="연결 상태를 확인한 뒤 페이지를 다시 불러와 주세요."
            onReload={() => window.location.reload()}
          />
        ) : filteredCases.length > 0 ? (
          boardSection
        ) : (
          <>
            {boardSection}
            <CaseLibraryEmptyState onReset={resetFilters} />
          </>
        )}
        </div>
      </div>
    </AppLayout>
  );
}
