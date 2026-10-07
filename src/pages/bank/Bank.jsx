import React, { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { useUser } from "../../contexts/UserContext";
import { useBank } from "../../contexts/BankContext";
import { NumberFormatProvider } from "../../contexts/NumberFormatContext";

// UI & Layout (湲곗〈怨??숈씪)
import { Tabs, PageHeader, Button, PageLoader } from "../../components/ui";
import AppLayout from "../../components/layout/AppLayout";
import { DollarSign, LineChart } from "lucide-react";
import {
  WalletIcon,
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";

// Tabs & Components (湲곗〈怨??숈씪)
import BankMainTab from "./tabs/BankMainTab";
import BankDepositTab from "./tabs/BankDepositTab";
import BankLoanTab from "./tabs/BankLoanTab";
import BankAdminTab from "./bankadmin/BankAdminTab";
import BankSubscriptionTab from "./tabs/BankSubscriptionTab";
import BankModalRegistry from "./components/BankModalRegistry";
import BankReadError from "./components/BankReadError";

// Hooks (湲곗〈怨??숈씪)
import useDepositActions from "./hooks/useDepositActions";
import useLoanActions from "./hooks/useLoanActions";
import useSavingsManagement from "./hooks/useSavingsManagement";
import useLoanRepayment from "./hooks/useLoanRepayment";

export default function Bank({ uid: propUid, classId: propClassId }) {
  const {
    userData,
    classId: contextClassId,
    classData,
    hasPermission,
    loading: userLoading,
  } = useUser();
  const [searchParams] = useSearchParams();

  // ?? 由ы뙥?좊쭅??BankContext ?ъ슜
  const {
    studentProfile,
    bankSettings,
    tierCriteria,
    tierAdjustments,
    savings,
    loans,
    isLoading: bankLoading,
    bankBaseLoading,
    bankReadError,
    retryBankReads,
    myScore,
    modifiers,
    totalPendingCount,
    actionableSavingsCount,
    actionableLoansCount,
    actionableSubscriptionCount, // ?? ??遺遺꾩쓣 異붽??섏꽭??
    setActiveBankSurfaces,
  } = useBank();

  // 1. ?앸퀎媛?諛?沅뚰븳 ?ㅼ젙
  const uid = searchParams.get("debugUid") || propUid || userData?.uid;
  const classId =
    propClassId || contextClassId || userData?.classId || classData?.classId;
  const isMyBankPage = uid === userData?.uid;
  const isBankAdmin = hasPermission("bank_admin");
  const isBankInitialLoading = userLoading || bankBaseLoading || !studentProfile || !bankSettings;

  // 2. UI ?곹깭 愿由?(湲곗〈 ?좎?)
  const [activeTabKey, setActiveTabKey] = useState("main");
  const [approvalActiveTab, setApprovalActiveTab] = useState("savings");
  const [modalState, setModalState] = useState({
    depositHistory: false,
    loanHistory: false,
    product: false,
    tierRate: false,
    approval: false,
    loanLimit: false,
    subscriptionHistory: false,
    subscriptionManagement: false,
    subscriptionOverview: false,
    loanContracts: false,
    overview: false,
    depositSimulator: false,
    depositOperationAssistant: false,
  });

  const openModal = (name) =>
    setModalState((prev) => ({ ...prev, [name]: true }));
  const closeModal = (name) =>
    setModalState((prev) => ({ ...prev, [name]: false }));

  const depositActions = useDepositActions({
    studentAssets: studentProfile?.assets,
    bankSettings,
    // ?? [?듭떖] modifiers(?ㅼ젣 蹂댁젙移??곗씠??瑜?tierAdjustments?쇰뒗 ?대쫫?쇰줈 ?꾨떖?⑸땲??
    tierAdjustments: modifiers,
    uid,
    classId,
    studentName: studentProfile?.name,
    currencyUnit: classData?.currencyUnit,
    creditScore: myScore,
    currentTierInfo: studentProfile?.creditTier,
  });

  const loanActions = useLoanActions({
    bankSettings,
    // ?? [?듭떖] ?異??낆뿉???숈씪?섍쾶 蹂댁젙移?蹂대뵲由щ? ?섍꺼以띾땲??
    tierAdjustments: modifiers,
    studentInfo: studentProfile,
    creditScore: myScore,
    currentTierInfo: studentProfile?.creditTier,
    uid,
    classId,
    isMyBankPage,
    currencyUnit: classData?.currencyUnit,
    loans,
    currentRateModifiers: modifiers, // 湲곗〈 肄붾뱶 ?좎?
  });

  const savingsManagement = useSavingsManagement({
    savings,
    uid,
    classId,
  });
  const loanRepayment = useLoanRepayment({
    classId,
    currencyUnit: classData?.currencyUnit,
  });

  // 4. 硫붾돱 諛????뺤쓽 (湲곗〈 ?좎?, ?섏〈?깅쭔 ?뺤씤)
  const adminQuickLinks = useMemo(() => {
    if (!isBankAdmin) return [];
    return [
      {
        id: "products",
        label: "상품관리",
        icon: Cog6ToothIcon,
        onClick: () => openModal("product"),
        tone: "indigo",
        tourId: "bank-product-action",
      },
      {
        id: "approvals",
        label: "승인관리",
        icon: CheckCircleIcon,
        onClick: () => {
          setApprovalActiveTab("savings");
          openModal("approval");
        },
        tone: "emerald",
        badge: totalPendingCount,
        tourId: "bank-approval-action",
      },
      {
        id: "subscription",
        label: "청약관리",
        icon: DocumentTextIcon,
        onClick: () => openModal("subscriptionManagement"),
        tone: "green",
        tourId: "bank-subscription-management-action",
      },
      {
        id: "subscriptionOverview",
        label: "청약현황",
        icon: BanknotesIcon,
        onClick: () => openModal("subscriptionOverview"),
        tone: "emerald",
        tourId: "bank-subscription-overview-action",
      },
      {
        id: "overview",
        label: "현황조회",
        icon: BanknotesIcon,
        onClick: () => openModal("overview"),
        tone: "amber",
        tourId: "bank-overview-action",
      },
    ];
  }, [isBankAdmin, totalPendingCount]);

  const tabsData = useMemo(
    () =>
      [
        { id: "main", label: "메인", icon: WalletIcon },
        {
          id: "deposit_apply",
          label: "예금",
          icon: ArrowDownCircleIcon,
          condition: isMyBankPage,
          badge: actionableSavingsCount > 0 ? actionableSavingsCount : null,
        },
        {
          id: "loan_apply",
          label: "대출",
          icon: ArrowUpCircleIcon,
          condition: isMyBankPage,
          badge: actionableLoansCount > 0 ? actionableLoansCount : null,
        },
        {
          id: "subscription",
          label: "청약",
          icon: DocumentTextIcon,
          condition: isMyBankPage,
          // 청약 신청 가능한 건수 배지
          badge:
            actionableSubscriptionCount > 0
              ? actionableSubscriptionCount
              : null,
        },
        {
          id: "admin_management",
          label: "은행관리",
          icon: Cog6ToothIcon,
          condition: isBankAdmin,
          badge: totalPendingCount > 0 ? totalPendingCount : null,
        },
      ].filter((t) => t.condition !== false),
    [
      isMyBankPage,
      isBankAdmin,
      totalPendingCount,
      actionableSavingsCount,
      actionableLoansCount,
      actionableSubscriptionCount,
    ],
  );

  // 5. 濡쒕뵫 ?붾㈃
  const bankQuestGuide = useMemo(() => {
    if (!isBankAdmin) return null;

    const depositProducts = Array.isArray(bankSettings?.depositProducts)
      ? bankSettings.depositProducts
      : [];
    const loanProducts = Array.isArray(bankSettings?.loanProducts)
      ? bankSettings.loanProducts
      : [];
    const activeDepositProducts = depositProducts.filter(
      (product) => product?.active !== false,
    );
    const activeLoanProducts = loanProducts.filter(
      (product) => product?.active !== false,
    );
    const hasAutoApprovalSetting =
      typeof bankSettings?.depositAutoApprovalEnabled === "boolean" ||
      typeof bankSettings?.loanAutoApprovalEnabled === "boolean" ||
      typeof bankSettings?.isAutoApprovalEnabled === "boolean";
    const hasTierAdjustments =
      modifiers &&
      (Number(modifiers.depositRateModifier || 0) !== 0 ||
        Number(modifiers.loanRateModifier || 0) !== 0 ||
        Number(modifiers.transferFee || 0) !== 0);
    const hasLoanLimitPolicy =
      Boolean(bankSettings?.isLoanLimitRatioEnabled) ||
      Number(
        bankSettings?.defaultLoanLimitRatio ??
          bankSettings?.loanLimitRatio ??
          0,
      ) > 0;

    return {
      type: "quest",
      title: "은행 도우미",
      launcherTitle: "은행 도우미",
      launcherDescription: "예금, 대출, 승인, 관리자 설정 흐름을 체크합니다.",
      subtitle: "학생들이 돈을 모으고 빌리는 기본 은행 구조를 확인합니다.",
      storageKey: classId
        ? `finclass_bank_quest_${classId}`
        : "finclass_bank_quest",
      tourKey: "TEACHER_BANK_QUEST_TOUR",
      guidePath: "/case-library",
      operationTitle: "은행 운영 도우미",
      operation: {
        id: "bank-operation-assistant",
        actionId: "openDepositOperationAssistant",
        title: "은행 운영도우미",
        description:
          "현재 학급의 주급과 보유 화폐를 기준으로 은행 운영을 점검합니다.",
        actionLabel: "운영 점검 시작",
      },
      quests: [
        {
          id: "bank-overview",
          title: "은행 화면 둘러보기",
          description: "메인, 예금, 대출, 청약, 관리자 탭의 위치를 확인합니다.",
          completed: Boolean(bankSettings),
          manualComplete: true,
          objectives: [
            {
              id: "tabs-ready",
              label: "은행 탭 구조 확인하기",
              completed: Boolean(bankSettings),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-tabs"]',
              title: "은행 탭",
              content:
                "메인, 예금, 대출, 청약, 관리자 화면을 여기에서 전환합니다.",
            },
            {
              target: '[data-tour="bank-main-summary"]',
              title: "자산 요약",
              content:
                "학생의 현금, 신용 등급, 예금과 대출 보정값을 먼저 확인합니다.",
            },
          ],
        },
        {
          id: "deposit-product",
          title: "예금 상품 준비하기",
          description:
            "학생이 돈을 맡길 수 있는 예금 상품을 하나 이상 준비합니다.",
          doneText: `${activeDepositProducts.length}개의 예금 상품이 있습니다.`,
          completed: activeDepositProducts.length >= 1,
          manualComplete: false,
          objectives: [
            {
              id: "deposit-product-count",
              label: "활성 예금 상품 1개 이상 만들기",
              completed: activeDepositProducts.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-actions"]',
              title: "상품 관리",
              content:
                "상단의 상품 관리에서 예금 상품을 만들고 이자율을 정합니다.",
            },
            {
              target: '[data-tour="bank-product-action"]',
              title: "상품 관리 열기",
              content:
                "상품 관리 버튼을 누르면 예금과 대출 상품을 설정하는 모달로 이어집니다.",
              waitForTarget: '[data-tour="bank-product-modal"]',
            },
            {
              target: '[data-tour="bank-product-modal"]',
              title: "은행 상품 관리",
              content:
                "예금 상품의 기간, 이자율, 활성 상태를 여기에서 조정합니다.",
            },
            {
              target: '[data-tour="bank-deposit-products"]',
              title: "예금 상품 카드",
              content: "예금 탭에서 학생에게 보이는 상품 조건을 확인합니다.",
            },
          ],
        },
        {
          id: "approval-flow",
          title: "승인 흐름 확인하기",
          description:
            "예금 가입과 대출 신청을 교사가 승인할지, 자동 승인할지 확인합니다.",
          completed: hasAutoApprovalSetting || totalPendingCount > 0,
          manualComplete: true,
          objectives: [
            {
              id: "approval-setting",
              label: "자동 승인 또는 승인 관리 위치 확인",
              completed: hasAutoApprovalSetting || totalPendingCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-actions"]',
              title: "승인 관리",
              content:
                "상단 또는 관리자 탭에서 예금 가입과 대출 신청 승인 흐름을 확인합니다.",
            },
            {
              target: '[data-tour="bank-approval-action"]',
              title: "승인 관리 열기",
              content:
                "승인 관리 버튼을 누르면 대기 중인 예금, 대출, 청약 신청을 확인하는 모달이 열립니다.",
              waitForTarget: '[data-tour="bank-approval-modal"]',
            },
            {
              target: '[data-tour="bank-approval-modal"]',
              title: "승인 관리 센터",
              content:
                "대기 신청을 검토하고 승인 또는 반려하는 흐름을 확인합니다.",
            },
            {
              target: '[data-tour="bank-admin-grid"]',
              title: "관리 카드",
              content:
                "관리자 화면에서 상품, 승인, 현황, 이자율, 한도 설정을 찾을 수 있습니다.",
            },
          ],
        },
        {
          id: "student-flow",
          title: "학생 이용 흐름 확인하기",
          description:
            "학생이 예금 상품을 고르고, 대출 조건을 비교하는 화면을 확인합니다.",
          completed:
            activeTabKey === "deposit_apply" ||
            activeTabKey === "loan_apply" ||
            savings.length > 0 ||
            loans.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "deposit-tab-open",
              label: "예금 탭 또는 대출 탭 열어보기",
              completed:
                activeTabKey === "deposit_apply" ||
                activeTabKey === "loan_apply" ||
                savings.length > 0 ||
                loans.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-tabs"]',
              title: "학생 이용 탭",
              content:
                "예금과 대출 탭에서 학생이 보는 금융 상품 흐름을 확인합니다.",
            },
            {
              target: '[data-tour="bank-content"]',
              title: "상품 신청 흐름",
              content:
                "상품 조건, 신청 금액, 예상 결과를 이 영역에서 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "loan-product",
          title: "대출 상품 준비하기",
          description:
            "학생이 돈을 빌릴 수 있는 대출 상품을 하나 이상 준비합니다.",
          doneText: `${activeLoanProducts.length}개의 대출 상품이 있습니다.`,
          completed: activeLoanProducts.length >= 1,
          manualComplete: true,
          objectives: [
            {
              id: "loan-product-count",
              label: "활성 대출 상품 1개 이상 만들기",
              completed: activeLoanProducts.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-actions"]',
              title: "상품 관리",
              content:
                "상단의 상품 관리에서 대출 상품과 이자율, 상환 기간을 정합니다.",
            },
            {
              target: '[data-tour="bank-product-action"]',
              title: "상품 관리 열기",
              content:
                "상품 관리 버튼을 누르면 대출 상품도 같은 모달에서 설정할 수 있습니다.",
              waitForTarget: '[data-tour="bank-product-modal"]',
            },
            {
              target: '[data-tour="bank-product-modal"]',
              title: "대출 상품 설정",
              content:
                "대출 탭에서 한도, 이자율, 상환 기간처럼 학생에게 보일 조건을 조정합니다.",
            },
            {
              target: '[data-tour="bank-loan-products"]',
              title: "대출 상품 카드",
              content: "대출 탭에서 학생에게 보이는 대출 조건을 확인합니다.",
            },
          ],
        },
        {
          id: "deposit-simulator",
          title: "예금 시뮬레이터 보기",
          description: "예금 기간과 이자 결과를 미리 비교할 수 있습니다.",
          completed: modalState.depositSimulator,
          manualComplete: true,
          objectives: [
            {
              id: "simulator-open",
              label: "예금 시뮬레이터 열기",
              completed: modalState.depositSimulator,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-actions"]',
              title: "예금 시뮬레이터",
              content: "상단 버튼에서 예금 결과를 미리 계산해 볼 수 있습니다.",
            },
            {
              target: '[data-tour="bank-deposit-simulator-action"]',
              title: "시뮬레이터 열기",
              content:
                "예금 시뮬레이터 버튼을 눌러 기간과 이자 결과를 비교합니다.",
              waitForTarget: '[data-tour="bank-deposit-simulator-modal"]',
            },
            {
              target: '[data-tour="bank-deposit-simulator-modal"]',
              title: "예금 효과 시뮬레이터",
              content:
                "예치 금액과 기간을 바꾸며 학생에게 설명할 예금 결과를 미리 확인합니다.",
            },
          ],
        },
        {
          id: "tier-rate",
          title: "등급별 금리 보정 살펴보기",
          description:
            "신용 등급에 따라 예금 이자와 대출 이자를 다르게 둘 수 있습니다.",
          completed: hasTierAdjustments,
          manualComplete: true,
          objectives: [
            {
              id: "tier-adjustment",
              label: "등급별 이자 보정 설정 확인",
              completed: hasTierAdjustments,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-admin-grid"]',
              title: "이자율 관리",
              content:
                "관리자 화면에서 등급별 예금/대출 금리 보정을 관리합니다.",
            },
          ],
        },
        {
          id: "loan-limit",
          title: "대출 한도 정책 확인하기",
          description:
            "학생별 자산이나 신용 상태에 맞춰 대출 한도를 조정할 수 있습니다.",
          completed: hasLoanLimitPolicy,
          manualComplete: true,
          objectives: [
            {
              id: "loan-limit-policy",
              label: "대출 한도 정책 확인",
              completed: hasLoanLimitPolicy,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-admin-grid"]',
              title: "대출 한도",
              content:
                "관리자 화면에서 개별 학생의 대출 한도 정책을 조정할 수 있습니다.",
            },
          ],
        },
        {
          id: "subscription",
          title: "청약 기능 살펴보기",
          description:
            "희소한 상품이나 추첨형 금융 활동을 운영할 때 청약을 사용할 수 있습니다.",
          completed:
            activeTabKey === "subscription" ||
            modalState.subscriptionManagement ||
            modalState.subscriptionOverview,
          manualComplete: true,
          objectives: [
            {
              id: "subscription-open",
              label: "청약 탭 또는 청약 관리 열기",
              completed:
                activeTabKey === "subscription" ||
                modalState.subscriptionManagement ||
                modalState.subscriptionOverview,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="bank-tabs"]',
              title: "청약 탭",
              content:
                "청약 탭에서 학생이 참여할 수 있는 청약 상품을 확인합니다.",
            },
            {
              target: '[data-tour="bank-admin-grid"]',
              title: "청약 관리",
              content: "관리자 화면에서 청약 상품과 진행 현황을 관리합니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTabKey,
    bankSettings,
    classId,
    isBankAdmin,
    loans.length,
    modalState.depositSimulator,
    modalState.subscriptionManagement,
    modalState.subscriptionOverview,
    modifiers,
    savings.length,
    totalPendingCount,
  ]);

  useEffect(() => {
    setActiveBankSurfaces({
      savings: Boolean(modalState.depositHistory),
      loans: activeTabKey === "loan_apply" || Boolean(modalState.loanHistory),
      subscription:
        activeTabKey === "subscription" ||
        Boolean(modalState.subscriptionHistory),
    });
  }, [
    activeTabKey,
    modalState.depositHistory,
    modalState.loanHistory,
    modalState.subscriptionHistory,
    setActiveBankSurfaces,
  ]);

  if (bankReadError) {
    return <NumberFormatProvider><AppLayout showSidebar={true}><BankReadError onRetry={retryBankReads} /></AppLayout></NumberFormatProvider>;
  }

  if (isBankInitialLoading) {
    return (
      <NumberFormatProvider>
        <AppLayout showSidebar={true}>
          <PageLoader
            fullHeight={false}
            className="min-h-screen"
            message="은행 데이터를 불러오는 중입니다..."
            tone="emerald"
          />
        </AppLayout>
      </NumberFormatProvider>
    );
  }

  return (
    <NumberFormatProvider>
      <AppLayout
        showDefaultHeader={false}
        showSidebar={true}
        pageGuide={bankQuestGuide}
        onPageGuideAction={(operation) => {
          if (operation?.actionId === "openDepositOperationAssistant") {
            openModal("depositOperationAssistant");
          }
        }}
      >
        <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 overflow-x-hidden">
          <PageHeader
            title="은행"
            subtitle="예금, 대출, 청약 현황을 확인하고 관리합니다."
            icon={DollarSign}
            rightSlot={
              <div
                data-tour="bank-actions"
                className="flex items-center gap-1.5 sm:gap-2 flex-wrap w-full sm:w-auto"
              >
                <Button
                  size="xs"
                  tone="slate"
                  kind="outline"
                  onClick={() => openModal("depositSimulator")}
                  data-tour="bank-deposit-simulator-action"
                  data-tutorial-interactive="true"
                  className="relative"
                >
                  <LineChart className="w-3.5 h-3.5 mr-1" /> 예금 시뮬레이터
                </Button>
                {adminQuickLinks.map((link) => (
                  <Button
                    key={link.id}
                    size="xs"
                    tone="slate"
                    kind="outline"
                    onClick={link.onClick}
                    data-tour={link.tourId}
                    data-tutorial-interactive={link.tourId ? "true" : undefined}
                    className="relative"
                  >
                    <link.icon className="w-3.5 h-3.5 mr-1" /> {link.label}
                    {link.badge > 0 && (
                      <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black leading-none flex items-center justify-center ring-2 ring-white">
                        {link.badge > 99 ? "99+" : link.badge}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            }
          />

          <div data-tour="bank-tabs" data-active-tab={activeTabKey}>
            <Tabs
              tabs={tabsData}
              activeTab={activeTabKey}
              onTabChange={setActiveTabKey}
              variant="underline"
              size="md"
            />
          </div>

          <main className="relative">
            <div
              data-tour="bank-content"
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
            />
            {activeTabKey === "main" && (
              <BankMainTab
                studentAssets={studentProfile?.assets}
                creditScore={myScore}
                studentInfo={studentProfile}
                classId={classId}
                hasPermission={hasPermission}
                currentTierInfo={studentProfile?.creditTier}
                currentRateModifiers={modifiers}
                currencyUnit={classData?.currencyUnit}
                currentStudentUid={uid}
                bankSettings={bankSettings}
                savings={savings}
                loans={loans}
                onTabChange={setActiveTabKey}
              />
            )}
            {activeTabKey === "deposit_apply" && (
              <BankDepositTab
                {...depositActions}
                bankSettings={bankSettings}
                classId={classId}
                studentInfo={studentProfile}
                studentTierName={studentProfile?.creditTier?.name}
                currentRateModifiers={modifiers}
                tierCriteria={tierCriteria}
                historyBadgeCount={actionableSavingsCount}
                setShowDepositHistoryModal={() => openModal("depositHistory")}
                isLoading={bankLoading}
                savings={savings}
                uid={uid}
              />
            )}
            {activeTabKey === "loan_apply" && (
              <BankLoanTab
                {...loanActions} // ?? ?듭떖: ?ш린??setSelectedLoanProductId媛 ?ы븿?섏뼱 ?꾨떖?⑸땲??
                bankSettings={bankSettings}
                studentInfo={studentProfile}
                studentTierName={studentProfile?.creditTier?.name}
                currentRateModifiers={modifiers}
                tierCriteria={tierCriteria}
                historyBadgeCount={actionableLoansCount}
                setShowLoanHistoryModal={() => openModal("loanHistory")}
                isLoading={bankLoading && (loans?.length || 0) === 0}
                isMyBankPage={isMyBankPage}
                loans={loans}
                uid={uid}
                onOpenLoanContractsModal={
                  isBankAdmin ? () => openModal("loanContracts") : undefined
                }
              />
            )}
            {activeTabKey === "subscription" && (
              <BankSubscriptionTab
                uid={uid}
                classId={classId}
                studentAssets={studentProfile?.assets}
                onOpenHistoryModal={() => openModal("subscriptionHistory")}
              />
            )}
            {activeTabKey === "admin_management" && (
              <BankAdminTab
                classId={classId}
                badgeCount={totalPendingCount}
                onOpenProductModal={() => openModal("product")}
                onOpenApprovalModal={(tab) => {
                  setApprovalActiveTab(tab);
                  openModal("approval");
                }}
                onOpenTierRateModal={() => openModal("tierRate")}
                onOpenLoanLimitModal={() => openModal("loanLimit")}
                onOpenSubscriptionManagementModal={() =>
                  openModal("subscriptionManagement")
                }
                onOpenSubscriptionOverviewModal={() =>
                  openModal("subscriptionOverview")
                }
                onOpenOverviewModal={() => openModal("overview")}
              />
            )}
          </main>
        </div>

        <BankModalRegistry
          modalState={modalState}
          closeModal={closeModal}
          actions={{
            depositActions,
            loanActions,
            savingsManagement,
            loanRepayment,
          }}
          data={{
            uid,
            classId,
            studentInfo: studentProfile,
            studentAssets: studentProfile?.assets,
            bankSettings,
            currentRateModifiers: modifiers,
            tierAdjustments,
            savings,
            loans,
            totalPendingCount,
            hasPermission,
            isMyBankPage,
            approvalActiveTab,
            currencyUnit: classData?.currencyUnit,
            tierCriteria,
            classDisplayName: classData?.className || "우리 반",
          }}
        />
      </AppLayout>
    </NumberFormatProvider>
  );
}
