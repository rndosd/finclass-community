import { appConfirm } from "../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  PieChart,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import { Alert, Button, Modal, SectionLoader, Tabs } from "../../components/ui";
import { useNumberFormat } from "../../contexts/NumberFormatContext";
import { useUser } from "../../contexts/UserContext";
import { useStockSettings } from "../../hooks/stock/useStockSettings";
import { useStockFilter } from "../stock/hooks/useStockFilter";
import {
  useFundActions,
  useFundApplications,
  useFundPositions,
  useFunds,
  useManagedFundPositions,
  useFundReports,
  useMyFundOrders,
} from "./hooks/useFunds";
import FundApplicationModal from "./modals/FundApplicationModal";
import FundApprovalModal from "./modals/FundApprovalModal";
import FundDetailModal from "./modals/FundDetailModal";
import FundNavChartModal from "./modals/FundNavChartModal";
import FundOrderModal from "./modals/FundOrderModal";
import FundProfileModal from "./modals/FundProfileModal";
import FundRebalanceModal from "./modals/FundRebalanceModal";
import FundReportModal from "./modals/FundReportModal";
import FundReportViewModal from "./modals/FundReportViewModal";
import FundSettingsModal from "./modals/FundSettingsModal";
import FundAdminTab from "./tabs/FundAdminTab";
import FundMarketTab from "./tabs/FundMarketTab";
import MyFundsTab from "./tabs/MyFundsTab";

export default function FundsPanel({
  detailOnly = false,
  initialDetailTarget = null,
  onInitialDetailTargetClose,
  onOpenStockInfoModal,
}) {
  const { userData, classId, isTeacher, loading: userLoading } = useUser();
  const { formatFin } = useNumberFormat();
  const currencyUnit = "FIN";
  const uid = userData?.uid;

  const { funds, isLoading: fundsLoading } = useFunds(classId);
  const { applications, isLoading: applicationsLoading } =
    useFundApplications(classId);
  const { reports, isLoading: reportsLoading } = useFundReports(classId);
  const { positions, isLoading: positionsLoading } = useFundPositions(classId, uid);
  const { orders, isLoading: ordersLoading } = useMyFundOrders(classId, uid);
  const { allStockSymbols, isLoading: stockFilterLoading } =
    useStockFilter(classId);
  const {
    settings,
    updateSettings,
    isLoading: settingsLoading,
    isSaving: isSavingSettings,
  } = useStockSettings(classId);
  const {
    submitApplication,
    reviewApplication,
    submitRebalance,
    updateProfile,
    submitReport,
    updateReport,
    submitOrder,
    deleteFund,
    isSubmittingApplication,
    isReviewingApplication,
    isSubmittingRebalance,
    isUpdatingProfile,
    isSubmittingReport,
    isUpdatingReport,
    isSubmittingOrder,
    isDeletingFund,
  } = useFundActions(classId, uid);

  const [activeTab, setActiveTab] = useState("market");
  const [isApplicationOpen, setIsApplicationOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isApprovalQueueOpen, setIsApprovalQueueOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [editingApplication, setEditingApplication] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [profileTarget, setProfileTarget] = useState(null);
  const [rebalanceTarget, setRebalanceTarget] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportViewTarget, setReportViewTarget] = useState(null);
  const [orderTarget, setOrderTarget] = useState(null);
  const [chartTarget, setChartTarget] = useState(null);

  const availableSymbols = useMemo(
    () =>
      [...(allStockSymbols || [])].sort((left, right) =>
        String(left.symbol || "").localeCompare(String(right.symbol || "")),
      ),
    [allStockSymbols],
  );

  const managedFunds = useMemo(
    () => (funds || []).filter((fund) => fund.managerUid === uid),
    [funds, uid],
  );
  const managedFundIds = useMemo(
    () => managedFunds.map((fund) => fund.id).filter(Boolean),
    [managedFunds],
  );
  const { positions: managedInvestorPositions } = useManagedFundPositions(
    classId,
    managedFundIds,
  );
  const myApplications = useMemo(
    () =>
      (applications || []).filter(
        (application) => application.applicantUid === uid,
      ),
    [applications, uid],
  );
  const pendingApplications = useMemo(
    () => (applications || []).filter((application) => application.status === "pending"),
    [applications],
  );
  const positionsByFundId = useMemo(
    () => Object.fromEntries((positions || []).map((position) => [position.fundId, position])),
    [positions],
  );
  const latestOrdersByFundId = useMemo(() => {
    const latestMap = {};
    (orders || []).forEach((order) => {
      if (!latestMap[order.fundId]) {
        latestMap[order.fundId] = order;
      }
    });
    return latestMap;
  }, [orders]);
  const latestReportsByFundId = useMemo(() => {
    const latestMap = {};
    (reports || []).forEach((report) => {
      if (!latestMap[report.fundId]) {
        latestMap[report.fundId] = report;
      }
    });
    return latestMap;
  }, [reports]);

  useEffect(() => {
    if (!initialDetailTarget?.id) return;
    const currentFund = (funds || []).find((fund) => fund.id === initialDetailTarget.id);
    setDetailTarget(currentFund || initialDetailTarget);
  }, [funds, initialDetailTarget]);

  const tabs = useMemo(
    () => [
      { id: "market", label: "둘러보기", icon: PieChart },
      {
        id: "my",
        label: "내 펀드",
        icon: ClipboardCheck,
      },
    ],
    [],
  );

  useEffect(() => {
    if (activeTab !== "market" && activeTab !== "my") {
      setActiveTab("market");
    }
  }, [activeTab]);

  const isInitialLoading =
    (userLoading ||
      fundsLoading ||
      applicationsLoading ||
      reportsLoading ||
      positionsLoading ||
      ordersLoading ||
      stockFilterLoading ||
      settingsLoading) &&
    (funds?.length || 0) === 0 &&
    (applications?.length || 0) === 0;

  const openNewApplication = () => {
    setEditingApplication(null);
    setIsApplicationOpen(true);
  };

  const openRetryApplication = (application) => {
    setEditingApplication(application);
    setIsApplicationOpen(true);
  };

  const closeApplicationModal = () => {
    setIsApplicationOpen(false);
    setEditingApplication(null);
  };

  const openFundDetail = (fund) => setDetailTarget(fund);
  const clearInitialDetailTarget = () => {
    if (initialDetailTarget?.id) onInitialDetailTargetClose?.();
  };

  const openApplicationReview = (application) => {
    setIsApprovalQueueOpen(false);
    setReviewTarget(application);
  };
  const closeFundDetail = () => {
    setDetailTarget(null);
    clearInitialDetailTarget();
  };
  const openProfileEditor = (fund) => {
    setProfileTarget(fund);
  };
  const switchFromDetail = (nextAction) => {
    setDetailTarget(null);
    clearInitialDetailTarget();
    setTimeout(() => {
      nextAction?.();
    }, 0);
  };
  const closeProfileEditor = () => setProfileTarget(null);
  const closeRebalanceModal = () => setRebalanceTarget(null);
  const closeReportModal = () => setReportTarget(null);
  const closeReportViewModal = () => setReportViewTarget(null);
  const closeOrderModal = () => setOrderTarget(null);
  const closeChartModal = () => setChartTarget(null);
  const handleDeleteFund = async (fund) => {
    if (!fund?.id) return { success: false };

    const confirmed = (await appConfirm(`"${fund.fundName || "펀드"}"을 삭제할까요?\n투자자가 보유 중이거나 처리 중인 주문이 있으면 삭제되지 않습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}));
    if (!confirmed) return { success: false, cancelled: true };

    const result = await deleteFund(fund.id);
    if (result?.success) {
      setDetailTarget(null);
    }
    return result;
  };
  const openNewReport = (fund) => setReportTarget({ fund, report: null });
  const openEditReport = (fund, report) => {
    setReportViewTarget(null);
    setReportTarget({ fund, report });
  };
  const canEditReport = (report) => {
    if (!report) return false;
    const isLatest = latestReportsByFundId[report.fundId]?.id === report.id;
    if (!isLatest) return false;
    if (isTeacher) return true;
    return report.submittedByUid === uid;
  };

  if (isInitialLoading && !detailOnly) {
    return (
      <SectionLoader
        message="펀드 화면을 준비하고 있습니다..."
        minHeightClassName="min-h-[360px]"
      />
    );
  }

  if (!uid) {
    return <Alert type="warning" message="로그인이 필요합니다." />;
  }

  if (!classId) {
    return <Alert type="warning" message="학급 정보를 찾을 수 없습니다." />;
  }

  return (
    <>
      {!detailOnly ? (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 md:flex-none">
              <Tabs
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                variant="underline"
                size="md"
                idPrefix="funds"
                className="max-w-full"
              />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
              {isTeacher && pendingApplications.length > 0 ? (
                <Button
                  tone="amber"
                  kind="soft"
                  size="sm"
                  icon={ShieldCheck}
                  onClick={() => setIsApprovalQueueOpen(true)}
                >
                  승인 대기 {pendingApplications.length}
                </Button>
              ) : null}
              {isTeacher ? (
                  <Button
                    tone="slate"
                    kind="outline"
                    size="sm"
                    onClick={() => setIsSettingsOpen(true)}
                    icon={Settings2}
                  >
                    펀드 설정
                  </Button>
              ) : null}
              <Button tone="blue" kind="solid" size="sm" onClick={openNewApplication}>
                신청서 작성
              </Button>
            </div>
        </div>

        {activeTab === "market" ? (
          <FundMarketTab
            funds={funds}
            formatFin={formatFin}
            currencyUnit={currencyUnit}
            positionsByFundId={positionsByFundId}
            latestOrdersByFundId={latestOrdersByFundId}
            orderCutoffTime={settings?.fundDailyCutoffTime || settings?.fundOrderCutoffTime}
            isTeacher={isTeacher}
            onOpenDetail={openFundDetail}
            onOpenChart={setChartTarget}
            onOpenReport={openNewReport}
            onOpenRebalance={(fund) => setRebalanceTarget(fund)}
            onOpenSubscribe={(fund) => setOrderTarget({ mode: "subscribe", fund })}
            onOpenRedeem={(fund) => setOrderTarget({ mode: "redeem", fund })}
          />
        ) : null}

        {activeTab === "my" ? (
          <MyFundsTab
            managedFunds={managedFunds}
            myApplications={myApplications}
            managedInvestorPositions={managedInvestorPositions}
            myPositions={positions}
            allFunds={funds}
            formatFin={formatFin}
            currencyUnit={currencyUnit}
            orderCutoffTime={settings?.fundDailyCutoffTime || settings?.fundOrderCutoffTime}
            isTeacher={isTeacher}
            onRetryApplication={openRetryApplication}
            onOpenDetail={openFundDetail}
            onOpenChart={setChartTarget}
            onOpenReport={openNewReport}
            onOpenRebalance={(fund) => setRebalanceTarget(fund)}
          />
        ) : null}
      </div>
      ) : null}

      <Modal
        isOpen={isApprovalQueueOpen}
        onClose={() => setIsApprovalQueueOpen(false)}
        size="2xl"
        title={`펀드 승인 대기 ${pendingApplications.length}건`}
      >
        <FundAdminTab
          pendingApplications={pendingApplications}
          onOpenReview={openApplicationReview}
        />
      </Modal>

      <FundApplicationModal
        isOpen={isApplicationOpen}
        onClose={closeApplicationModal}
        onSubmit={submitApplication}
        availableSymbols={availableSymbols}
        isSubmitting={isSubmittingApplication}
        currencyUnit={currencyUnit}
        fundSettings={settings}
        initialValue={editingApplication}
        classId={classId}
      />

      <FundSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentSettings={settings}
        onSubmitSettings={updateSettings}
        isSubmitting={isSavingSettings}
      />

      <FundApprovalModal
        isOpen={!!reviewTarget}
        application={reviewTarget}
        classId={classId}
        onClose={() => setReviewTarget(null)}
        onReview={reviewApplication}
        isSubmitting={isReviewingApplication}
      />

      <FundRebalanceModal
        isOpen={!!rebalanceTarget}
        fund={rebalanceTarget}
        availableSymbols={availableSymbols}
        orderCutoffTime={settings?.fundDailyCutoffTime || settings?.fundOrderCutoffTime}
        isTeacher={isTeacher}
        classId={classId}
        onClose={closeRebalanceModal}
        onSubmit={submitRebalance}
        isSubmitting={isSubmittingRebalance}
      />

      <FundDetailModal
        isOpen={!!detailTarget}
        fund={detailTarget}
        latestReport={latestReportsByFundId[detailTarget?.id] || null}
        formatFin={formatFin}
        currencyUnit={currencyUnit}
        position={positionsByFundId[detailTarget?.id] || null}
        latestOrder={latestOrdersByFundId[detailTarget?.id] || null}
        orderCutoffTime={settings?.fundDailyCutoffTime || settings?.fundOrderCutoffTime}
        canManage={isTeacher || detailTarget?.managerUid === uid}
        isManager={detailTarget?.managerUid === uid}
        isTeacher={isTeacher}
        onClose={closeFundDetail}
        onOpenChart={(fund) => switchFromDetail(() => setChartTarget(fund))}
        onOpenReportView={(report) =>
          switchFromDetail(() => setReportViewTarget(report))
        }
        onOpenReport={(fund) =>
          switchFromDetail(() => openNewReport(fund))
        }
        onOpenStockInfoModal={onOpenStockInfoModal}
        availableSymbols={availableSymbols}
        onOpenProfileEdit={(fund) => switchFromDetail(() => openProfileEditor(fund))}
        onDeleteFund={handleDeleteFund}
        isDeletingFund={isDeletingFund}
        onOpenRebalance={(fund) => {
          switchFromDetail(() => setRebalanceTarget(fund));
        }}
        onOpenSubscribe={(fund) => {
          switchFromDetail(() => setOrderTarget({ mode: "subscribe", fund }));
        }}
        onOpenRedeem={(fund) => {
          switchFromDetail(() => setOrderTarget({ mode: "redeem", fund }));
        }}
      />

      <FundProfileModal
        isOpen={!!profileTarget}
        fund={profileTarget}
        onClose={closeProfileEditor}
        onSubmitProfile={updateProfile}
        isSubmitting={isUpdatingProfile}
      />

      <FundReportModal
        isOpen={!!reportTarget}
        fund={reportTarget?.fund || null}
        report={reportTarget?.report || null}
        onClose={closeReportModal}
        onSubmit={reportTarget?.report ? updateReport : submitReport}
        isSubmitting={reportTarget?.report ? isUpdatingReport : isSubmittingReport}
      />

      <FundReportViewModal
        isOpen={!!reportViewTarget}
        report={reportViewTarget}
        onClose={closeReportViewModal}
        canEdit={canEditReport(reportViewTarget)}
        onEdit={(report) => {
          const fund = funds.find((item) => item.id === report?.fundId) || null;
          if (!fund) return;
          openEditReport(fund, report);
        }}
      />

      <FundOrderModal
        isOpen={!!orderTarget}
        mode={orderTarget?.mode || "subscribe"}
        fund={orderTarget?.fund || null}
        position={positionsByFundId[orderTarget?.fund?.id] || null}
        balanceUSD={Number(userData?.assets?.usdBalance || 0)}
        currencyUnit={currencyUnit}
        formatFin={formatFin}
        orderCutoffTime={settings?.fundDailyCutoffTime || settings?.fundOrderCutoffTime}
        onClose={closeOrderModal}
        onSubmit={submitOrder}
        isSubmitting={isSubmittingOrder}
      />

      <FundNavChartModal
        isOpen={!!chartTarget}
        fund={chartTarget}
        classId={classId}
        formatFin={formatFin}
        currencyUnit={currencyUnit}
        onClose={closeChartModal}
      />
    </>
  );
}
