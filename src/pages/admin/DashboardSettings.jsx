import React, { useMemo, useState } from "react";
import { useUser } from "../../contexts/UserContext";
import AppLayout from "../../components/layout/AppLayout";
import { useDashboardSettings } from "./hooks/useDashboardSettings";
import { LayoutDashboard, Menu as MenuIcon } from "lucide-react";
import { Card, CardSkeleton, PageSkeleton, Tabs } from "../../components/ui";

// ✅ 경로 다시 확인 (컴포넌트 폴더 안에 있는지 확인하세요!)
import DashboardCardsTab from "./tabs/DashboardCardsTab";
import MenuSettingsTab from "./tabs/MenuSettingsTab";
import DashboardPreview from "./components/DashboardPreview";

const DashboardSettings = () => {
  const { classId, loading: userLoading } = useUser();
  const [activeTab, setActiveTab] = useState("cards");
  const {
    settings,
    loading,
    saving,
    applyCardSettings,
  } = useDashboardSettings(classId);
  const dashboardQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "홈 화면 설정 도우미",
      launcherTitle: "홈 화면 설정 도우미",
      launcherDescription: "카드 구성, 메뉴 구성, 미리보기 흐름을 체크합니다.",
      subtitle: "학생 홈에 무엇을 보여줄지 정하는 운영 화면입니다.",
      storageKey: classId
        ? `finclass_dashboard_settings_quest_${classId}`
        : "finclass_dashboard_settings_quest",
      tourKey: "TEACHER_MANAGE_DASHBOARD_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "cards-tab",
          title: "홈 카드 설정하기",
          description: "학생 화면에 표시할 카드를 켜고 끄는 위치를 확인합니다.",
          completed: activeTab === "cards",
          manualComplete: true,
          objectives: [
            {
              id: "cards-open",
              label: "홈 카드 탭 열기",
              completed: activeTab === "cards",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-dashboard-tabs"]',
              title: "설정 탭",
              content: "카드 설정과 사이드바 메뉴 설정을 전환합니다.",
            },
            {
              target: '[data-tour="manage-dashboard-content"]',
              title: "카드 설정",
              content: "카드 표시 여부와 순서를 조정하고 미리보기를 확인합니다.",
            },
          ],
        },
        {
          id: "menu-tab",
          title: "사이드바 메뉴 설정하기",
          description: "학생에게 보일 메뉴 구성을 확인합니다.",
          completed: activeTab === "menu",
          manualComplete: true,
          objectives: [
            {
              id: "menu-open",
              label: "사이드바 메뉴 탭 열기",
              completed: activeTab === "menu",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-dashboard-tabs"]',
              title: "사이드바 메뉴",
              content: "메뉴 설정 탭으로 이동해 학생 메뉴 구성을 확인합니다.",
            },
          ],
        },
        {
          id: "preview",
          title: "미리보기 확인하기",
          description: "변경한 설정이 학생 화면에서 어떻게 보이는지 확인합니다.",
          completed: Boolean(settings),
          manualComplete: true,
          objectives: [
            {
              id: "settings-ready",
              label: "홈 화면 설정 데이터 확인",
              completed: Boolean(settings),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="manage-dashboard-content"]',
              title: "미리보기",
              content: "설정 내용과 학생 화면 미리보기를 함께 확인합니다.",
            },
          ],
        },
      ],
    }),
    [activeTab, classId, settings],
  );

  if (loading || userLoading) {
    return (
      <AppLayout title="홈 화면 설정">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          <PageSkeleton summaryCards={0} showChart={false} showTable={false} />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <CardSkeleton rows={6} showFooter />
            <CardSkeleton rows={8} showFooter={false} />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="홈 화면 설정" pageGuide={dashboardQuestGuide}>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">홈 화면 설정</h2>
          <p className="text-gray-600 mt-1">
            학생 홈 화면 구성을 실시간으로 미리보고 수정합니다.
          </p>
        </div>

        <div data-tour="manage-dashboard-tabs" data-active-tab={activeTab} className="mb-6 border-b border-gray-200">
          <Tabs ariaLabel="홈 화면 설정 업무" idPrefix="dashboard-settings" tabs={[{id:"cards",label:"홈 카드",icon:LayoutDashboard},{id:"menu",label:"사이드바 메뉴",icon:MenuIcon}]} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="md" />
        </div>

        <div data-tour="manage-dashboard-content" className="mt-6">
          {activeTab === "cards" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <Card noPadding className="shadow-sm border-gray-200">
                <DashboardCardsTab
                  settings={settings}
                  saving={saving}
                  onApply={applyCardSettings}
                />
              </Card>

              <div className="sticky top-6">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-sm font-bold text-gray-700">
                    실시간 미리보기 (학생 홈)
                  </span>
                  <span className="text-[10px] text-gray-400">
                    실제 화면과 약간 다를 수 있습니다
                  </span>
                </div>
                <DashboardPreview settings={settings} />
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              <Card noPadding className="shadow-sm border-gray-200">
                <MenuSettingsTab />
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default DashboardSettings;
