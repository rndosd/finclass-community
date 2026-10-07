import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  FileStack,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  Save,
} from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button, ErrorState, PageHeader, SectionLoader } from "../../components/ui";
import CaseLibraryDashboardCommentList from "./components/CaseLibraryDashboardCommentList";
import CaseLibraryDashboardDraftCard from "./components/CaseLibraryDashboardDraftCard";
import CaseLibraryDashboardEmptyState from "./components/CaseLibraryDashboardEmptyState";
import CaseLibraryDashboardPostList from "./components/CaseLibraryDashboardPostList";
import CaseLibraryDashboardTabBar from "./components/CaseLibraryDashboardTabBar";
import useCaseLibraryDashboard from "./hooks/useCaseLibraryDashboard";

function StatusPanel({ message, tone = "slate" }) {
  if (tone === "rose") return <ErrorState variant="section" title="내 활동을 불러오지 못했습니다." description={message} onReload={() => window.location.reload()} />;
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

export default function CaseLibraryDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnContext = location.state?.caseLibraryReturn;
  const didRestoreScroll = useRef(false);
  const [activeTab, setActiveTab] = useState(() =>
    ["posts", "saved", "drafts", "comments"].includes(returnContext?.activeTab)
      ? returnContext.activeTab
      : "posts",
  );
  const [selectedPostIds, setSelectedPostIds] = useState(() =>
    Array.isArray(returnContext?.selectedPostIds)
      ? returnContext.selectedPostIds.filter((id) => typeof id === "string")
      : [],
  );
  const { draft, errors, loadingState, ownComments, ownPosts, savedPosts } =
    useCaseLibraryDashboard();

  useEffect(() => {
    if (loadingState?.posts || errors?.posts) return;
    const availableIds = new Set(ownPosts.map((post) => post.id));
    setSelectedPostIds((currentIds) =>
      currentIds.filter((postId) => availableIds.has(postId)),
    );
  }, [errors?.posts, loadingState?.posts, ownPosts]);

  const tabs = useMemo(
    () => [
      { id: "posts", label: "내 글", icon: FileText, count: ownPosts.length },
      { id: "saved", label: "스크랩", icon: Bookmark, count: savedPosts.length },
      { id: "drafts", label: "임시저장", icon: Save, count: draft ? 1 : 0 },
      {
        id: "comments",
        label: "내 댓글",
        icon: MessageSquareText,
        count: ownComments.length,
      },
    ],
    [draft, ownComments.length, ownPosts.length, savedPosts.length],
  );

  const selectedOwnPostCount = selectedPostIds.length;
  const canBuildSelectedPdf = activeTab === "posts" && selectedOwnPostCount > 0;
  const activeLoading = loadingState?.[activeTab] || false;
  const activeError = errors?.[activeTab] || null;

  useEffect(() => {
    if (didRestoreScroll.current || activeLoading || activeError) return;
    const scrollY = returnContext?.scrollY;
    if (!Number.isFinite(scrollY) || scrollY < 0) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "instant" });
      didRestoreScroll.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeError, activeLoading, returnContext?.scrollY]);

  const handleTogglePostSelection = (postId) => {
    setSelectedPostIds((currentIds) =>
      currentIds.includes(postId)
        ? currentIds.filter((currentId) => currentId !== postId)
        : [...currentIds, postId],
    );
  };

  const handleSelectAllPosts = () => {
    if (selectedOwnPostCount === ownPosts.length) {
      setSelectedPostIds([]);
      return;
    }

    setSelectedPostIds(ownPosts.map((post) => post.id));
  };

  const handleOpenPdfBuilder = () => {
    const state = {
      caseLibraryReturn: { activeTab, selectedPostIds, scrollY: window.scrollY },
    };
    if (canBuildSelectedPdf) {
      const encodedIds = encodeURIComponent(selectedPostIds.join(","));
      navigate(`/case-library/pdf-builder?posts=${encodedIds}`, { state });
      return;
    }

    navigate("/case-library/pdf-builder", { state });
  };

  const renderActiveSection = () => {
    if (activeTab === "posts") {
      return (
        <CaseLibraryDashboardPostList
          posts={ownPosts}
          selectable
          selectedIds={selectedPostIds}
          onSelectAll={handleSelectAllPosts}
          onToggleSelect={handleTogglePostSelection}
          emptyState={
            <CaseLibraryDashboardEmptyState
              title="아직 작성한 글이 없습니다."
              description="운영 사례를 하나씩 기록해 두면 나중에 연수자료나 공유 자료로 묶기 쉬워집니다."
              actionLabel="새 글 작성"
              onAction={() => navigate("/case-library/new")}
            />
          }
        />
      );
    }

    if (activeTab === "saved") {
      return (
        <CaseLibraryDashboardPostList
          posts={savedPosts}
          emptyState={
            <CaseLibraryDashboardEmptyState
              title="스크랩한 글이 없습니다."
              description="나중에 다시 보고 싶은 운영사례는 스크랩해 두면 바로 모아볼 수 있습니다."
              actionLabel="운영사례 보러 가기"
              onAction={() => navigate("/case-library")}
            />
          }
        />
      );
    }

    if (activeTab === "drafts") {
      return draft ? (
        <CaseLibraryDashboardDraftCard
          draft={draft}
          onContinue={() => navigate("/case-library/new")}
        />
      ) : (
        <CaseLibraryDashboardEmptyState
          title="임시저장 글이 없습니다."
          description="작성 중인 글을 저장해 두면 나중에 이어서 마무리할 수 있습니다."
          actionLabel="새 글 작성"
          onAction={() => navigate("/case-library/new")}
        />
      );
    }

    return (
      <CaseLibraryDashboardCommentList
        comments={ownComments}
        emptyState={
          <CaseLibraryDashboardEmptyState
            title="작성한 댓글이 없습니다."
            description="게시글에 댓글을 남기면 여기서 내가 쓴 댓글만 다시 모아볼 수 있습니다."
            actionLabel="운영사례 보러 가기"
            onAction={() => navigate("/case-library")}
          />
        }
      />
    );
  };

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            tone="slate"
            kind="outline"
            onClick={() => navigate("/case-library")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            목록으로
          </Button>
        </div>

        <PageHeader
          title="내 활동"
          subtitle="내가 작성한 글, 스크랩한 글, 임시저장, 댓글을 한 곳에서 볼 수 있습니다."
          icon={LayoutDashboard}
          rightSlot={
            <div className="flex flex-wrap gap-2">
              <Button
                tone={canBuildSelectedPdf ? "blue" : "slate"}
                kind={canBuildSelectedPdf ? "solid" : "outline"}
                icon={FileStack}
                onClick={handleOpenPdfBuilder}
              >
                {canBuildSelectedPdf
                  ? `선택한 글 ${selectedOwnPostCount}건으로 PDF 만들기`
                  : "PDF 만들기"}
              </Button>
              <Button
                tone="blue"
                icon={Plus}
                onClick={() => navigate("/case-library/new")}
              >
                새 글 작성
              </Button>
            </div>
          }
        />

        <CaseLibraryDashboardTabBar
          activeTab={activeTab}
          tabs={tabs}
          onChange={setActiveTab}
        />

        {activeLoading ? (
          <SectionLoader
            message="내 활동을 불러오는 중입니다."
            minHeightClassName="min-h-[180px]"
          />
        ) : activeError ? (
          <StatusPanel
            message="내 활동을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            tone="rose"
          />
        ) : (
          renderActiveSection()
        )}
      </div>
    </AppLayout>
  );
}
