import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";

import AppLayout from "../../components/layout/AppLayout";
import HomeAssetCard from "./components/HomeAssetCard";
import HomeMissionCard from "./components/HomeMissionCard";
import HomeCreditCard from "./components/HomeCreditCard";
import HomeDonationCard from "./components/HomeDonationCard";
import HomeNews from "./components/HomeNews";
import StudentMenuNotice from "./components/StudentMenuNotice";

import { getTierInfoByScore } from "../credit/utils/tierUtils";

import { db } from "../../firebase";
import { doc, getDoc } from "firebase/firestore";

import { useUser } from "../../contexts/UserContext";
import { NumberFormatProvider } from "../../contexts/NumberFormatContext";
import { useDashboardSettings } from "../admin/hooks/useDashboardSettings";
import {
  CardSkeleton,
} from "../../components/ui";

import TeacherUpdateNoticeModal from "../admin/modals/TeacherUpdateNoticeModal";
import useEquippedTitle from "../../hooks/credentials/useEquippedTitle";
import { getDashboardCardLayout } from "./dashboardCardLayout";
import HomeTitleGallery from "./components/HomeTitleGallery";

const DASHBOARD_CARD_SURFACES = {
  news: "bg-transparent",
  asset: "bg-transparent",
  mission: "bg-transparent",
  credit: "bg-transparent",
  donation: "bg-transparent",
};

const DashboardPageSkeleton = () => (
  <div className="space-y-6 sm:space-y-8">
    <div className="space-y-3">
      <div className="h-10 w-64 animate-pulse rounded-2xl bg-slate-200/80 sm:w-80" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`dashboard-title-skeleton-${index}`}
            className="h-8 w-20 animate-pulse rounded-full bg-slate-200/80"
          />
        ))}
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <CardSkeleton
          key={`dashboard-card-skeleton-${index}`}
          rows={5}
          showFooter
          className="min-h-[280px] rounded-[2rem] border-0 bg-white shadow-xl shadow-slate-200/40"
        />
      ))}
    </div>
  </div>
);

const StudentDashboard = () => {
  const {
    userData: currentUser,
    classId,
    classData,
    loading: userLoading,
    isTeacher,
    hasPermission,
  } = useUser();
  const navigate = useNavigate();

  // 1. Dashboard Settings Hook (Reads from displaySettings/dashboard)
  const { getVisibleCards, loading: settingsLoading } = useDashboardSettings(
    classId,
    { readOnly: true },
  );

  const currencyUnit = classData?.currencyUnit || "단위";
  const studentName = currentUser?.name || "학생";
  const canManageNews = hasPermission("news_admin");
  const { equippedTitles } = useEquippedTitle(classId, currentUser?.uid);
  const primaryRepresentativeTitle = equippedTitles[0] || null;
  const secondaryRepresentativeTitle = equippedTitles[1] || null;

  const creditScore = currentUser?.creditScore;
  const [tierCriteria, setTierCriteria] = useState([]);

  const resolvedTierInfo = useMemo(() => {
    return getTierInfoByScore(creditScore, tierCriteria);
  }, [creditScore, tierCriteria]);

  // 2. Compute Visible Cards
  const visibleCards = useMemo(() => {
    const cards =
      (typeof getVisibleCards === "function" ? getVisibleCards() : []) || [];
    // Ensure we filter out any undefined or invalid card types
    return Array.from(new Set(cards)).filter((card) =>
      ["news", "asset", "mission", "credit", "donation"].includes(card),
    );
  }, [getVisibleCards]);

  const dashboardCardLayout = useMemo(
    () => getDashboardCardLayout(visibleCards),
    [visibleCards],
  );

  // 3. Load Tier Criteria once to reduce dashboard watch pressure.
  useEffect(() => {
    if (!classId) {
      setTierCriteria([]);
      return undefined;
    }

    let cancelled = false;

    const loadTierCriteria = async () => {
      try {
        const tierRef = doc(db, `classes/${classId}/tierCriteria/default`);
        const tierSnap = await getDoc(tierRef);
        if (cancelled) return;
        setTierCriteria(tierSnap.exists() ? tierSnap.data().tiers || [] : []);
      } catch (error) {
        if (cancelled) return;
        console.error("[StudentDashboard] tier criteria error:", error);
        setTierCriteria([]);
      }
    };

    void loadTierCriteria();

    return () => {
      cancelled = true;
    };
  }, [classId]);

  const renderCard = useCallback(
    (cardType, displayVariant = "featured") => {
      switch (cardType) {
        case "news":
          return (
            <HomeNews
              isTeacher={isTeacher}
              canManage={canManageNews}
              displayVariant={displayVariant}
            />
          );
        case "asset":
          return (
            <HomeAssetCard
              key="asset-card"
              assets={currentUser?.assets}
              currencyUnit={currencyUnit}
              userData={currentUser}
              onOpenAssets={() => navigate("/assets")}
              displayVariant={displayVariant}
            />
          );
        case "mission":
          return <HomeMissionCard displayVariant={displayVariant} />;
        case "credit":
          return (
            <HomeCreditCard
              creditScore={creditScore}
              tierInfo={resolvedTierInfo}
              tierCriteria={tierCriteria}
              onOpenCreditPage={() =>
                navigate("/credit", { state: { defaultTab: "my" } })
              }
              displayVariant={displayVariant}
            />
          );
        case "donation":
          return <HomeDonationCard displayVariant={displayVariant} />;
        default:
          return null;
      }
    },
    [
      isTeacher,
      canManageNews,
      currentUser,
      currencyUnit,
      creditScore,
      navigate,
      resolvedTierInfo,
      tierCriteria,
    ],
  );

  const isInitialLoading = userLoading || settingsLoading;
  const dashboardQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "대시보드 도우미",
      launcherTitle: "대시보드 도우미",
      launcherDescription: "카드와 전역 바로가기 도크를 확인합니다.",
      subtitle:
        "핀클래스 첫 화면에서 현재 학급 상태와 자주 쓰는 기능을 확인합니다.",
      storageKey: classId
        ? `finclass_dashboard_quest_${classId}`
        : "finclass_dashboard_quest",
      tourKey: "TEACHER_DASHBOARD_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "quick-links",
          title: "바로가기 도크 확인하기",
          description:
            "어느 페이지에서나 자주 쓰는 관리 메뉴를 여는 도크를 확인합니다.",
          doneText: "상단의 바로가기 버튼에서 도크를 열 수 있습니다.",
          completed: true,
          manualComplete: true,
          objectives: [
            {
              id: "quick-link-area",
              label: "퀵링크 영역 확인",
              completed: true,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="global-shortcuts-trigger"]',
              title: "전역 바로가기",
              content:
                "도크를 열어 둔 채로 다른 페이지로 이동하고 위치도 바꿀 수 있습니다.",
            },
          ],
        },
        {
          id: "dashboard-cards",
          title: "홈 카드 확인하기",
          description:
            "뉴스, 자산, 과제, 신용 같은 첫 화면 카드 구성을 확인합니다.",
          doneText: `${visibleCards.length}개의 카드가 표시됩니다.`,
          completed: visibleCards.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "visible-card-count",
              label: "표시 카드 1개 이상 확인",
              completed: visibleCards.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="dashboard-card-preview"]',
              title: "홈 카드",
              content: "학생과 교사가 첫 화면에서 보는 주요 카드 영역입니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "dashboard-settings",
          title: "홈 화면 설정으로 이동하기",
          description:
            "첫 화면 카드와 사이드바 메뉴 구성을 바꾸려면 홈 화면 설정을 사용합니다.",
          completed: false,
          manualComplete: true,
          objectives: [
            {
              id: "settings-location",
              label: "홈 화면 설정 위치 확인",
              completed: false,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="dashboard-card-preview"]',
              title: "카드 구성",
              content: "카드 표시 여부는 관리자 홈 화면 설정에서 조정합니다.",
            },
          ],
        },
      ],
    }),
    [classId, visibleCards.length],
  );

  if (isInitialLoading) {
    return (
      <NumberFormatProvider>
        <AppLayout showSidebar={true} showDefaultHeader={false}>
          <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
            <DashboardPageSkeleton />
          </div>
        </AppLayout>
      </NumberFormatProvider>
    );
  }

  if (!currentUser || !classId) {
    return (
      <NumberFormatProvider>
        <AppLayout showSidebar={true} showDefaultHeader={false}>
          <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-200 bg-white/70 px-6 text-center shadow-sm">
              <p className="text-base font-semibold text-slate-600">
                대시보드를 표시할 수 없습니다.
              </p>
              <p className="mt-2 text-sm text-slate-400">
                사용자 또는 학급 정보를 다시 확인해 주세요.
              </p>
            </div>
          </div>
        </AppLayout>
      </NumberFormatProvider>
    );
  }

  return (
    <NumberFormatProvider>
      <AppLayout
        showSidebar={true}
        showDefaultHeader={false}
        pageGuide={dashboardQuestGuide}
      >
        <div className="fc-home-page min-h-screen bg-[#f0f5ff]">
          {isTeacher && currentUser?.uid && (
            <TeacherUpdateNoticeModal uid={currentUser.uid} />
          )}

          {primaryRepresentativeTitle ? (
            <HomeTitleGallery
              className={classData?.name || classData?.className}
              studentName={studentName}
              primaryTitle={primaryRepresentativeTitle}
              secondaryTitle={secondaryRepresentativeTitle}
              onOpenTitles={() => navigate("/credentials")}
            />
          ) : (
            <section className="px-1 py-2 sm:px-2">
              <p className="text-[11px] font-black tracking-[0.16em] text-blue-500">
                {classData?.name || classData?.className || "\uB098\uC758 \uD559\uAE09"}
              </p>
              <h1 className="mt-1 break-keep text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                {studentName}{"\uB2D8, \uD658\uC601\uD569\uB2C8\uB2E4"}
              </h1>
              <p className="mt-2 text-sm font-medium text-slate-500">{"\uC624\uB298\uB3C4 \uB0B4 \uD398\uC774\uC2A4\uB85C \uD559\uAE09 \uD65C\uB3D9\uC744 \uC2DC\uC791\uD574\uBCF4\uC138\uC694."}</p>
            </section>
          )}
          <StudentMenuNotice />
          <div className="relative">
            <div
              data-tour="dashboard-card-preview"
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
            />
            <div>
              <div className="fc-home-grid">
                {dashboardCardLayout.length > 0 ? (
                  dashboardCardLayout.map(
                    ({ cardType, variant, gridClassName, orderClassName }) => (
                      <div
                        key={cardType}
                        className={`min-w-0 ${orderClassName} ${gridClassName} ${
                          DASHBOARD_CARD_SURFACES[cardType] || "bg-white"
                        }`}
                        style={{ '--span': Number(gridClassName.match(/col-span-(\d+)/)?.[1] || 12), '--rows': gridClassName.includes('row-span-2') ? 2 : 1 }}
                        data-dashboard-card={cardType}
                        data-dashboard-variant={variant}
                      >
                        {renderCard(cardType, variant)}
                      </div>
                    ),
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center bg-white/80 p-8 sm:p-12 lg:col-span-12">
                    <p className="text-slate-500 font-medium">
                      표시할 카드가 없습니다.
                    </p>
                    {isTeacher && (
                      <p className="text-sm text-slate-400 mt-2">
                        관리자 페이지 &gt; 홈 화면 설정에서 카드를 켜 주세요.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    </NumberFormatProvider>
  );
};

export default StudentDashboard;
