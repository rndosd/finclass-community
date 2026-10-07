import React, { useMemo } from "react";
import { CircleHelp, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { Button, ErrorState, PageHeader, SectionLoader } from "../../components/ui";
import { useUser } from "../../contexts/UserContext";
import {
  caseLibraryCategories,
  caseLibraryPageMeta,
} from "./caseLibraryRegistry";
import {
  caseRequestSortOptions,
  sortCaseRequests,
} from "./caseLibraryRequestUtils";
import CaseLibraryEmptyState from "./components/CaseLibraryEmptyState";
import CaseLibraryFilterBar from "./components/CaseLibraryFilterBar";
import CaseLibraryRequestBoardTable from "./components/CaseLibraryRequestBoardTable";
import CaseLibrarySectionTabs from "./components/CaseLibrarySectionTabs";
import useCaseLibraryFilters from "./hooks/useCaseLibraryFilters";
import useCaseLibraryNewMarker from "./hooks/useCaseLibraryNewMarker";
import useCaseLibraryPosts from "./hooks/useCaseLibraryPosts";
import useCaseLibraryRequests from "./hooks/useCaseLibraryRequests";

function StatusPanel({ message, tone = "slate" }) {
  if (tone === "rose") return <ErrorState variant="section" title="사례 요청을 불러오지 못했습니다." description={message} onReload={() => window.location.reload()} />;
  const toneClassName =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-white text-slate-600";

  return (
    <section className={`rounded-2xl border px-5 py-8 text-sm ${toneClassName}`}>
      {message}
    </section>
  );
}

export default function CaseLibraryRequestsPage() {
  const navigate = useNavigate();
  const { classId, userData } = useUser();
  const { error, loading, requests } = useCaseLibraryRequests(classId, {
    scope: "shared",
  });
  const { posts } = useCaseLibraryPosts(classId, { scope: "shared" });
  const currentUid = String(userData?.uid || "").trim();
  const { isItemNew } = useCaseLibraryNewMarker(classId, currentUid);

  const requestsWithLinks = useMemo(() => {
    const linkedCounts = posts.reduce((accumulator, post) => {
      const requestId = String(post.requestId || "").trim();
      if (!requestId) {
        return accumulator;
      }

      accumulator[requestId] = (accumulator[requestId] || 0) + 1;
      return accumulator;
    }, {});

    return requests.map((request) => ({
      ...request,
      linkedCaseCount: linkedCounts[request.id] || 0,
    }));
  }, [posts, requests]);

  const {
    activeCategory,
    filteredCases,
    query,
    resetFilters,
    selectedMeta,
    setActiveCategory,
    setQuery,
    setSortKey,
    showReset,
    sortKey,
    categoryTabs,
  } = useCaseLibraryFilters({
    cases: requestsWithLinks,
    categories: caseLibraryCategories,
    defaultSortKey: "featured",
    pageMeta: caseLibraryPageMeta,
    sortPosts: sortCaseRequests,
  });

  const handleCreateRequest = () => {
    if (activeCategory && activeCategory !== "all") {
      navigate(`/case-library/requests/new?pageType=${activeCategory}`);
      return;
    }

    navigate("/case-library/requests/new");
  };

  const boardSection = (
    <>
      <CaseLibraryFilterBar
        filteredCount={filteredCases.length}
        query={query}
        selectedMeta={selectedMeta}
        showReset={showReset}
        sortKey={sortKey}
        sortOptions={caseRequestSortOptions}
        onQueryChange={setQuery}
        onReset={resetFilters}
        onSortChange={setSortKey}
      />
      <CaseLibraryRequestBoardTable
        activeCategory={activeCategory}
        categoryTabs={categoryTabs}
        onCategoryChange={setActiveCategory}
        isNewRequest={isItemNew}
        requests={filteredCases}
      />
    </>
  );

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-[1220px] space-y-6">
        <PageHeader
          title="사례 요청"
          subtitle="필요한 운영사례를 먼저 요청해 두면, 짧은 답변이나 실제 운영사례 글로 이어질 수 있어요."
          icon={CircleHelp}
          rightSlot={
            <Button tone="blue" icon={Plus} onClick={handleCreateRequest}>
              요청 작성
            </Button>
          }
        />

        <CaseLibrarySectionTabs />

        {loading ? (
          <SectionLoader
            message="사례 요청을 불러오는 중입니다."
            minHeightClassName="min-h-[180px]"
          />
        ) : error ? (
          <StatusPanel
            message="사례 요청을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            tone="rose"
          />
        ) : filteredCases.length > 0 ? (
          boardSection
        ) : (
          <>
            {boardSection}
            <CaseLibraryEmptyState
              onReset={resetFilters}
              title="아직 등록된 사례 요청이 없어요."
              description="궁금한 운영사례가 있다면 먼저 요청 글을 남겨보세요."
              actionLabel="요청 작성"
              onAction={handleCreateRequest}
            />
          </>
        )}
        </div>
      </div>
    </AppLayout>
  );
}
