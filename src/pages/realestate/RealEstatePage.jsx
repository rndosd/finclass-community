import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { BarChart3, Building2, Gavel, History, Landmark, LayoutGrid, Map as MapIcon, Settings, Wallet } from 'lucide-react';
import AppLayout from '../../components/layout/AppLayout';
import { PageHeader, PageLoader, SectionLoader } from '../../components/ui';
import RealEstateNavigation from './components/RealEstateNavigation';
import { useUser } from '../../contexts/UserContext';
import { useFeedback } from '../../contexts/FeedbackContext';
import { useFundMode } from '../../contexts/FundModeContext';
import { useNumberFormat } from '../../contexts/NumberFormatContext';
import { useClassStudents } from '../../hooks/user/useClassStudents';
import { db } from '../../firebase';
import { startOfDayInKST } from '../../utils/kstDate';
import ClassroomViewer from './tabs/ClassroomViewer';
import ClassroomLayoutEditor from './tabs/ClassroomLayoutEditor';
import AdminRealEstateSettings from './tabs/AdminRealEstateSettings';
import HoldingTaxStatusTab from './tabs/HoldingTaxStatusTab';
import MyRealEstateTab from './tabs/MyRealEstateTab';
import RealEstateAuctionTab from './tabs/RealEstateAuctionTab';
import RealEstateLedgerTab from './tabs/RealEstateLedgerTab';
import RealEstateMarketStatsTab from './tabs/RealEstateMarketStatsTab';
import RealEstateContractCenterModal from './modals/RealEstateContractCenterModal';
import { useRealEstateFinancialData } from './hooks/useRealEstateFinancialData';
import { createRealEstateSeat, saveRealEstateAssignments, saveRealEstateDeskDisplayScale, saveRealEstatePlacement, setRealEstateSeatActive } from './services/realEstatePlacementService';
import SharedUiButton from "../../components/ui/Button";

const DEFAULT_LAYOUT = {
  groups: [],
  constraints: {
    fixedSeats: {},
    avoidGroups: [],
    genderShuffleMode: 'ignore',
    genderSeatPreferences: {},
  },
};

const DEFAULT_CONFIG = {
  enabled: true,
  acquisitionTaxEnabled: true,
  acquisitionTaxRate: 0,
  capitalGainsTaxEnabled: true,
  capitalGainsTaxRate: 0,
  officialPriceRatio: 70,
  seedMarketPrice: 1000,
  rentLimitEnabled: true,
  rentLimitRate: 0,
  rentTaxEnabled: true,
  rentTaxRate: 0,
  holdingTaxEnabled: false,
  holdingTaxRate: 0,
  holdingTaxCutoverAt: null,
  saleTemplate: '',
  saleSpecialTerms: '',
};

const isLocalRuntime = () => {
  if (typeof window === 'undefined') return false;
  const hostname = String(window.location?.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

const getAllowedTabs = (isTeacher, isRealEstateAdmin, showMyTab) => {
  const baseTabs = ['classroom', 'auction', ...(showMyTab ? ['my'] : [])];
  if (isTeacher) {
    return [...baseTabs, 'stats', 'ledger', 'holding', 'manage', 'policy'];
  }
  return isRealEstateAdmin ? [...baseTabs, 'manage'] : baseTabs;
};

const getDefaultTab = (isTeacher, showMyTab) => {
  if (isTeacher) return 'classroom';
  return showMyTab ? 'my' : 'classroom';
};

const LAYOUT_TABS = new Set(['manage', 'classroom', 'auction', 'my', 'holding']);

const normalizeLayout = (raw) => {
  const data = raw || {};
  return {
    ...DEFAULT_LAYOUT,
    ...data,
    groups: Array.isArray(data.groups) ? data.groups : [],
    constraints: {
      fixedSeats: data?.constraints?.fixedSeats || {},
      avoidGroups: Array.isArray(data?.constraints?.avoidGroups)
        ? data.constraints.avoidGroups
        : [],
      genderShuffleMode:
        data?.constraints?.genderShuffleMode === 'grouped'
          ? 'grouped'
          : 'ignore',
      genderSeatPreferences:
        data?.constraints?.genderSeatPreferences &&
        typeof data.constraints.genderSeatPreferences === 'object'
          ? data.constraints.genderSeatPreferences
          : {},
    },
  };
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeConfig = (raw) => {
  const data = raw || {};
  return {
    ...DEFAULT_CONFIG,
    ...data,
    enabled: data.enabled !== false,
    acquisitionTaxEnabled: data.acquisitionTaxEnabled !== false,
    acquisitionTaxRate: toNumber(data.acquisitionTaxRate, DEFAULT_CONFIG.acquisitionTaxRate),
    capitalGainsTaxEnabled: data.capitalGainsTaxEnabled !== false,
    capitalGainsTaxRate: toNumber(data.capitalGainsTaxRate, DEFAULT_CONFIG.capitalGainsTaxRate),
    officialPriceRatio: toNumber(data.officialPriceRatio, DEFAULT_CONFIG.officialPriceRatio),
    seedMarketPrice: toNumber(data.seedMarketPrice, DEFAULT_CONFIG.seedMarketPrice),
    rentLimitEnabled: data.rentLimitEnabled !== false,
    rentLimitRate: toNumber(data.rentLimitRate, DEFAULT_CONFIG.rentLimitRate),
    rentTaxEnabled: data.rentTaxEnabled !== false,
    rentTaxRate: toNumber(data.rentTaxRate, DEFAULT_CONFIG.rentTaxRate),
    holdingTaxEnabled: data.holdingTaxEnabled === true,
    holdingTaxRate: toNumber(data.holdingTaxRate, DEFAULT_CONFIG.holdingTaxRate),
    holdingTaxCutoverAt: data?.holdingTaxCutoverAt || null,
    saleTemplate: typeof data.saleTemplate === 'string' ? data.saleTemplate : '',
    saleSpecialTerms: typeof data.saleSpecialTerms === 'string' ? data.saleSpecialTerms : '',
  };
};

const GROUP_NAME_MAP = {
  team1: '1모둠',
  team2: '2모둠',
  team3: '3모둠',
  team4: '4모둠',
  team5: '5모둠',
  team6: '6모둠',
};

const OwnedPropertyTabIcon = ({ className }) => (
  <span className="relative inline-flex items-center justify-center">
    <span className="absolute inline-flex h-3.5 w-3.5 rounded-full bg-emerald-300/70 animate-ping" />
    <Building2 className={`${className} relative z-10 text-emerald-600`} />
  </span>
);

export default function RealEstatePage() {
  const { userData, classData, isTeacher, hasPermission } = useUser();
  const { showFeedback } = useFeedback();
  const { activeFund, activeFundId, isFundMode } = useFundMode();
  const { formatClassCurrency } = useNumberFormat();
  const classId = userData?.classId;
  const isStudentRealEstateAdmin = !isTeacher && hasPermission('realestate_admin');
  const canManageRealEstate = isTeacher || isStudentRealEstateAdmin;
  const showMyRealEstateTab = isLocalRuntime() && !isStudentRealEstateAdmin;

  const [activeTab, setActiveTab] = useState(getDefaultTab(isTeacher, showMyRealEstateTab));
  const [isTabHydrated, setIsTabHydrated] = useState(false);
  const [rawLayoutData, setLayoutData] = useState(DEFAULT_LAYOUT);
  const [classroomFinancialDemand, setClassroomFinancialDemand] = useState({ all: false, deskId: '', includeContracts: false });
  const [placementData, setPlacementData] = useState(null);
  const placementClassRef = useRef(null);
  const assignmentRequestRef = useRef(null);
  const [configData, setConfigData] = useState(DEFAULT_CONFIG);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const [isConfigReady, setIsConfigReady] = useState(false);
  const [isLayoutSaving, setIsLayoutSaving] = useState(false);
  const [isConfigSaving, setIsConfigSaving] = useState(false);
  const [isContractCenterOpen, setIsContractCenterOpen] = useState(false);
  const [requestedFundDeskId, setRequestedFundDeskId] = useState('');
  const [hasResolvedPageOnce, setHasResolvedPageOnce] = useState(false);
  const isTabSelectionReady = !classId || isTabHydrated;
  const shouldLoadStudents =
    !!classId &&
    isTabSelectionReady &&
    canManageRealEstate &&
    activeTab === 'manage';
  const shouldSubscribePlacement = !!classId && isTabSelectionReady && LAYOUT_TABS.has(activeTab);
  const financialData = useRealEstateFinancialData({
    classId, layout: rawLayoutData,
    all: shouldSubscribePlacement && (activeTab !== 'classroom' || isContractCenterOpen || classroomFinancialDemand.all),
    deskId: shouldSubscribePlacement && activeTab === 'classroom' ? classroomFinancialDemand.deskId : '',
    includeContracts: activeTab !== 'classroom' || isContractCenterOpen || classroomFinancialDemand.includeContracts,
    uid: userData?.uid, canManage: canManageRealEstate,
  });
  const layoutData = financialData.layout;
  useEffect(() => {
    setIsContractCenterOpen(false);
  }, [classId, activeTab]);
  const onClassroomFinancialDemand = useCallback((next) => setClassroomFinancialDemand((previous) =>
    previous.all === next.all && previous.deskId === next.deskId && previous.includeContracts === next.includeContracts ? previous : next), []);
  useEffect(() => {
    if (financialData.error) showFeedback({ type: 'error', message: financialData.error.message || '부동산 정보를 불러오지 못했습니다.' });
  }, [financialData.error, showFeedback]);


  useEffect(() => {
    if (!classId || !shouldSubscribePlacement) {
      if (!classId) {
        placementClassRef.current = null;
        setPlacementData(null);
      }
      return undefined;
    }
    if (placementClassRef.current !== classId) {
      placementClassRef.current = classId;
      setPlacementData(null);
    }
    const placementRef = doc(db, 'classes', classId, 'real_estate', 'placement');
    return onSnapshot(placementRef,
      (snapshot) => setPlacementData((previous) => {
        if (!snapshot.exists()) return snapshot.metadata.fromCache && previous ? previous : null;
        const latest = snapshot.data();
        return Number(previous?.revision) > Number(latest.revision) ? previous : latest;
      }),
      (error) => {
        console.error('[RealEstatePage] placement subscribe failed:', error);
        setPlacementData(null);
      });
  }, [classId, shouldSubscribePlacement]);
  const { data: rosterStudents } = useClassStudents(classId, {
    enabled: shouldLoadStudents,
  });
  const students = useMemo(
    () =>
      Array.isArray(rosterStudents)
        ? rosterStudents.filter((student) => String(student?.role || '').toLowerCase() !== 'teacher')
        : [],
    [rosterStudents],
  );
  const areStudentsReady = !shouldLoadStudents || rosterStudents !== undefined;
  const loading = !isTabSelectionReady || !isLayoutReady || !isConfigReady || !areStudentsReady ||
    (activeTab !== 'classroom' && shouldSubscribePlacement && !financialData.ready && !financialData.error);
  const isInitialPageLoading = loading && !hasResolvedPageOnce;

  useEffect(() => {
    setHasResolvedPageOnce(false);
  }, [classId]);

  useEffect(() => {
    if (!loading) {
      setHasResolvedPageOnce(true);
    }
  }, [loading]);

  const tabStorageKey = useMemo(() => {
    if (!classId) return null;
    return `realestate:activeTab:${classId}:${isTeacher ? 'teacher' : 'student'}`;
  }, [classId, isTeacher]);

  useEffect(() => {
    if (!tabStorageKey) {
      setIsTabHydrated(false);
      return;
    }

    const allowedTabs = new Set(
      getAllowedTabs(isTeacher, isStudentRealEstateAdmin, showMyRealEstateTab),
    );
    const savedTab = window.localStorage.getItem(tabStorageKey);
    if (savedTab && allowedTabs.has(savedTab)) {
      setActiveTab(savedTab);
    } else {
      setActiveTab(getDefaultTab(isTeacher, showMyRealEstateTab));
    }

    setIsTabHydrated(true);
  }, [isStudentRealEstateAdmin, isTeacher, showMyRealEstateTab, tabStorageKey]);

  useEffect(() => {
    if (!tabStorageKey || !isTabHydrated) return;
    window.localStorage.setItem(tabStorageKey, activeTab);
  }, [activeTab, isTabHydrated, tabStorageKey]);

  useEffect(() => {
    if (!classId) { setLayoutData(DEFAULT_LAYOUT); setIsLayoutReady(true); return undefined; }
    if (!isTabSelectionReady) { setIsLayoutReady(false); return undefined; }
    if (!shouldSubscribePlacement) { setIsLayoutReady(true); return undefined; }
    setIsLayoutReady(false);
    return onSnapshot(doc(db, 'classes', classId, 'real_estate', 'layout'), (snapshot) => {
      setLayoutData(normalizeLayout(snapshot.exists() ? snapshot.data() : null));
      setIsLayoutReady(true);
    }, (error) => {
      console.error('[RealEstatePage] layout subscribe failed:', error);
      setLayoutData(DEFAULT_LAYOUT); setIsLayoutReady(true);
    });
  }, [classId, isTabSelectionReady, shouldSubscribePlacement]);

  useEffect(() => {
    if (!classId) {
      setConfigData(DEFAULT_CONFIG);
      setIsConfigReady(true);
      return;
    }

    setIsConfigReady(false);

    const configRef = doc(db, 'classes', classId, 'real_estate', 'config');

    const unsubscribeConfig = onSnapshot(
      configRef,
      (snapshot) => {
        setConfigData(normalizeConfig(snapshot.exists() ? snapshot.data() : null));
        setIsConfigReady(true);
      },
      (error) => {
        console.error('[RealEstatePage] config subscribe failed:', error);
        setConfigData(DEFAULT_CONFIG);
        setIsConfigReady(true);
      },
    );

    return () => {
      unsubscribeConfig();
    };
  }, [classId]);

  const handleSaveLayout = async (newData) => {
    if (!canManageRealEstate || !classId) return false;

    setIsLayoutSaving(true);
    try {
      const signature = JSON.stringify(newData);
      if (assignmentRequestRef.current?.signature !== signature) assignmentRequestRef.current = {
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 100000000)}`,
        signature,
      };
      await saveRealEstateAssignments({
        classId,
        groups: newData.groups,
        constraints: newData.constraints,
        expectedRevision: Number(layoutData?.editorRevision) || 0,
        requestId: assignmentRequestRef.current.id,
      });
      assignmentRequestRef.current = null;
      showFeedback('좌석 배정을 저장했습니다.', 'success');
      return true;
    } catch (error) {
      console.error('[RealEstatePage] save failed:', error);
      showFeedback(error.message || '좌석 배정 저장에 실패했습니다.', 'error');
      return false;
    } finally {
      setIsLayoutSaving(false);
    }
  };

  const handleSavePlacement = async (seats, requestId, labels) => {
    if (!canManageRealEstate || !classId) throw new Error('배치 관리 권한이 없습니다.');
    setIsLayoutSaving(true);
    try {
      const result = await saveRealEstatePlacement({
        classId,
        seats,
        expectedRevision: Number(placementData?.revision) || 0,
        requestId,
        labels,
      });
      setPlacementData((previous) => ({ ...previous, seats, revision: result.revision, version: 2 }));
      return result;
    } finally {
      setIsLayoutSaving(false);
    }
  };

  const handleSaveDeskDisplayScale = async (deskDisplayScale, requestId) => {
    if (!canManageRealEstate || !classId) throw new Error('배치 관리 권한이 없습니다.');
    const result = await saveRealEstateDeskDisplayScale({ classId, deskDisplayScale, requestId });
    setPlacementData((previous) => ({ ...previous, deskDisplayScale: result.deskDisplayScale }));
    return result;
  };

  const handleCreateSeat = async (requestId) => {
    if (!canManageRealEstate || !classId) throw new Error('자리 관리 권한이 없습니다.');
    setIsLayoutSaving(true);
    try {
      return await createRealEstateSeat(classId, requestId);
    } finally {
      setIsLayoutSaving(false);
    }
  };

  const handleSetSeatActive = async (deskId, isActive) => {
    if (!canManageRealEstate || !classId) throw new Error('자리 관리 권한이 없습니다.');
    setIsLayoutSaving(true);
    try {
      return await setRealEstateSeatActive(classId, deskId, isActive);
    } finally {
      setIsLayoutSaving(false);
    }
  };

  const handleSaveConfig = async (nextConfig) => {
    if (!isTeacher || !classId) return false;

    setIsConfigSaving(true);
    try {
      const configRef = doc(db, 'classes', classId, 'real_estate', 'config');
      const normalized = normalizeConfig(nextConfig);
      const payload = {
        ...normalized,
        holdingTaxCutoverAt:
          normalized.holdingTaxCutoverAt ||
          (normalized.holdingTaxEnabled
            ? startOfDayInKST(new Date())?.toISOString() || null
            : null),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(configRef, payload, { merge: true });
      setConfigData(payload);
      showFeedback('부동산 정책을 저장했습니다.', 'success');
      return true;
    } catch (error) {
      console.error('[RealEstatePage] config save failed:', error);
      showFeedback('부동산 정책 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      return false;
    } finally {
      setIsConfigSaving(false);
    }
  };

  const ownedDeskCount = useMemo(
    () => {
      const currentUserUid = String(userData?.uid || '').trim();
      if (!currentUserUid) return 0;

      return (layoutData?.groups || []).reduce((count, group) => {
        const ownedInGroup = (group?.desks || []).filter(
          (desk) => desk?.isActive !== false && String(desk?.ownerId || '').trim() === currentUserUid,
        ).length;
        return count + ownedInGroup;
      }, 0);
    },
    [layoutData?.groups, userData?.uid],
  );

  const activeFundProperties = useMemo(
    () =>
      (layoutData?.groups || []).flatMap((group) =>
        (group?.desks || [])
          .filter(
            (desk) =>
              desk?.isActive !== false &&
              desk?.ownerType === 'classFund' &&
              String(desk?.ownerFundId || '') === String(activeFundId || ''),
          )
          .map((desk) => ({
            ...desk,
            groupName: group?.name || GROUP_NAME_MAP[group?.id] || '교실',
            fundValue: Math.max(
              0,
              Number(desk?.lastPurchasePrice || desk?.price || 0) || 0,
            ),
          })),
      ),
    [activeFundId, layoutData?.groups],
  );
  const activeFundPropertyValue = useMemo(
    () =>
      activeFundProperties.reduce(
        (sum, desk) => sum + Number(desk?.fundValue || 0),
        0,
      ),
    [activeFundProperties],
  );
  const handleOpenFundProperty = useCallback((deskId) => {
    setActiveTab('classroom');
    setRequestedFundDeskId(String(deskId || ''));
  }, []);
  const handleRequestedFundDeskHandled = useCallback(() => {
    setRequestedFundDeskId('');
  }, []);

  const tabs = useMemo(() => {
    const myTabIcon = ownedDeskCount > 0 ? OwnedPropertyTabIcon : Wallet;
    return [
      { id: 'classroom', label: '교실 보기', icon: MapIcon },
      { id: 'auction', label: '경매', icon: Gavel },
      { id: 'my', label: '내 부동산', icon: myTabIcon },
      ...(isTeacher
        ? [
            { id: 'stats', label: '통계', icon: BarChart3 },
            { id: 'ledger', label: '거래기록', icon: History },
            { id: 'holding', label: '보유세', icon: Landmark },
            { id: 'manage', label: '배치 관리', icon: LayoutGrid },
            { id: 'policy', label: '정책 설정', icon: Settings },
          ]
        : isStudentRealEstateAdmin
          ? [
              { id: 'manage', label: '배치 관리', icon: LayoutGrid },
            ]
          : []),
    ].filter((tab) => showMyRealEstateTab || tab.id !== 'my');
  }, [isStudentRealEstateAdmin, isTeacher, ownedDeskCount, showMyRealEstateTab]);

  const realEstateQuestGuide = useMemo(() => {
    if (!isTeacher) return null;

    const activeDesks = (layoutData?.groups || []).flatMap((group) =>
      (group?.desks || []).filter((desk) => desk?.isActive !== false),
    );
    const activeDeskCount = activeDesks.length;
    const ownedCount = activeDesks.filter((desk) => Boolean(desk?.ownerId)).length;
    const pricedDeskCount = activeDesks.filter((desk) => {
      const price = Number(
        desk?.marketPrice ??
          desk?.currentPrice ??
          desk?.price ??
          configData?.seedMarketPrice ??
          0,
      );
      return Number.isFinite(price) && price > 0;
    }).length;
    const hasAuctionActivity = activeDesks.some(
      (desk) =>
        Boolean(desk?.auctionSummary) ||
        Boolean(desk?.auctionId) ||
        String(desk?.status || "").includes("auction"),
    );
    const hasRentPolicy =
      configData?.rentLimitEnabled !== false || configData?.rentTaxEnabled !== false;
    const hasSaleTemplate =
      Boolean(String(configData?.saleTemplate || "").trim()) ||
      Boolean(String(configData?.saleSpecialTerms || "").trim());

    return {
      type: "quest",
      title: "부동산 도우미",
      launcherTitle: "부동산 도우미",
      launcherDescription: "교실 배치, 경매, 소유권, 세금 정책 흐름을 체크합니다.",
      subtitle: "자리와 소유권을 경제 활동으로 연결하는 기본 구조를 점검합니다.",
      storageKey: classId
        ? `finclass_realestate_quest_${classId}`
        : "finclass_realestate_quest",
      tourKey: "TEACHER_REALESTATE_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "layout-ready",
          title: "교실 자리 배치 만들기",
          description: "거래 대상이 될 자리를 하나 이상 배치합니다.",
          doneText: `${activeDeskCount}개의 자리가 있습니다.`,
          completed: activeDeskCount > 0,
          manualComplete: false,
          objectives: [
            {
              id: "desk-count",
              label: "활성 자리 1개 이상 만들기",
              completed: activeDeskCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-tabs"]',
              title: "배치 관리 탭",
              content: "배치 관리에서 교실 자리와 조 편성을 만들 수 있습니다.",
            },
            {
              target: '[data-tour="realestate-content"]',
              title: "교실 배치",
              content: "자리 카드가 실제 부동산 거래 대상이 됩니다.",
            },
          ],
        },
        {
          id: "price-ready",
          title: "자리 가격 기준 확인하기",
          description: "학생이 매수하거나 경매에 참여할 수 있도록 가격 기준을 확인합니다.",
          doneText: `${pricedDeskCount}개의 자리에 가격 기준이 있습니다.`,
          completed: pricedDeskCount > 0,
          manualComplete: true,
          objectives: [
            {
              id: "price-count",
              label: "가격이 있는 자리 확인",
              completed: pricedDeskCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-content"]',
              title: "자리 가격",
              content: "교실 보기 또는 배치 관리에서 자리별 가격과 상태를 확인합니다.",
            },
            {
              target: '[data-tour="realestate-price-adjust-action"]',
              title: "땅값 일괄 조정",
              content: "땅값 일괄 조정 버튼을 누르면 여러 자리의 가격을 한 번에 바꾸는 모달이 열립니다.",
              waitForTarget: '[data-tour="realestate-price-adjust-modal"]',
            },
            {
              target: '[data-tour="realestate-price-adjust-modal"]',
              title: "가격 조정 모달",
              content: "조정 방식, 대상 자리, 적용 가격을 확인하고 저장하는 흐름을 살펴봅니다.",
            },
          ],
        },
        {
          id: "policy-ready",
          title: "세금과 임대 정책 확인하기",
          description: "취득세, 양도세, 임대료 제한, 보유세 같은 운영 기준을 확인합니다.",
          completed: activeTab === "policy" || Boolean(configData),
          manualComplete: true,
          objectives: [
            {
              id: "policy-open",
              label: "정책 설정 탭 열기",
              completed: activeTab === "policy",
            },
            {
              id: "policy-data-ready",
              label: "부동산 정책 데이터 확인",
              completed: Boolean(configData),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-tabs"]',
              title: "정책 설정 탭",
              content: "정책 설정에서 세금과 임대 관련 기준을 조정합니다.",
            },
            {
              target: '[data-tour="realestate-content"]',
              title: "정책 설정",
              content: "취득세, 양도세, 임대료 제한, 보유세 기준을 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "auction-flow",
          title: "경매 흐름 살펴보기",
          description: "학생들이 입찰하고 낙찰되는 경매 흐름을 확인합니다.",
          completed: activeTab === "auction" || hasAuctionActivity,
          manualComplete: true,
          objectives: [
            {
              id: "auction-open",
              label: "경매 탭 열기",
              completed: activeTab === "auction",
            },
            {
              id: "auction-activity",
              label: "경매 진행 상태 확인",
              completed: hasAuctionActivity,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-tabs"]',
              title: "경매 탭",
              content: "경매 탭에서 입찰과 낙찰 흐름을 확인합니다.",
            },
            {
              target: '[data-tour="realestate-content"]',
              title: "경매 현황",
              content: "진행 중인 경매와 입찰 상태가 이 영역에 표시됩니다.",
            },
          ],
        },
        {
          id: "ownership-flow",
          title: "소유권 흐름 확인하기",
          description: "자리가 학생에게 소유되면 임대, 세금, 거래 기록으로 이어집니다.",
          doneText: `${ownedCount}개의 자리가 소유 중입니다.`,
          completed: ownedCount > 0,
          manualComplete: true,
          objectives: [
            {
              id: "owned-count",
              label: "소유자가 있는 자리 확인",
              completed: ownedCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-content"]',
              title: "소유 상태",
              content: "교실 보기에서 자리별 소유자와 임대 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "holding-tax",
          title: "보유세 기능 살펴보기",
          description: "자리 소유가 쌓이면 보유세로 장기 보유 비용을 만들 수 있습니다.",
          completed: configData?.holdingTaxEnabled === true || activeTab === "holding",
          manualComplete: true,
          objectives: [
            {
              id: "holding-open",
              label: "보유세 탭 열기",
              completed: activeTab === "holding",
            },
            {
              id: "holding-enabled",
              label: "보유세 정책 확인",
              completed: configData?.holdingTaxEnabled === true,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-tabs"]',
              title: "보유세",
              content: "보유세 탭에서 학생별 예상 세금과 발급 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "rent-policy",
          title: "임대 정책 확인하기",
          description: "임대료 제한과 임대 수익 세금으로 임대 활동을 조정할 수 있습니다.",
          completed: hasRentPolicy,
          manualComplete: true,
          objectives: [
            {
              id: "rent-policy-ready",
              label: "임대료 제한 또는 임대세 정책 확인",
              completed: hasRentPolicy,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-content"]',
              title: "임대 정책",
              content: "정책 설정에서 임대료 제한과 임대 수익 세금을 확인합니다.",
            },
            {
              target: '[data-tour="realestate-rent-contract-action"]',
              title: "임대 계약 설정",
              content: "임대 계약 설정 버튼을 누르면 여러 자리의 임대 조건을 한 번에 설정하는 모달이 열립니다.",
              waitForTarget: '[data-tour="realestate-rent-contract-modal"]',
            },
            {
              target: '[data-tour="realestate-rent-contract-modal"]',
              title: "임대 계약 모달",
              content: "대상 자리, 임대 기간, 주 임대료를 확인하고 적용하는 흐름을 살펴봅니다.",
            },
          ],
        },
        {
          id: "market-stats",
          title: "시장 통계 보기",
          description: "거래가 쌓이면 가격 변화와 시장 흐름을 통계로 확인할 수 있습니다.",
          completed: activeTab === "stats",
          manualComplete: true,
          objectives: [
            {
              id: "stats-open",
              label: "통계 탭 열기",
              completed: activeTab === "stats",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-tabs"]',
              title: "통계 탭",
              content: "통계 탭에서 부동산 시장 흐름을 확인합니다.",
            },
          ],
        },
        {
          id: "ledger",
          title: "거래 기록 확인하기",
          description: "매매, 경매, 임대료 기록을 장부처럼 확인할 수 있습니다.",
          completed: activeTab === "ledger",
          manualComplete: true,
          objectives: [
            {
              id: "ledger-open",
              label: "거래기록 탭 열기",
              completed: activeTab === "ledger",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-tabs"]',
              title: "거래기록",
              content: "거래기록 탭에서 매매와 임대료 이력을 확인합니다.",
            },
          ],
        },
        {
          id: "contract-template",
          title: "계약서 문구 준비하기",
          description: "특약이나 계약서 문구를 미리 준비하면 학생 거래가 더 명확해집니다.",
          completed: hasSaleTemplate,
          manualComplete: true,
          objectives: [
            {
              id: "contract-template-ready",
              label: "계약서 문구 또는 특약 확인",
              completed: hasSaleTemplate,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="realestate-content"]',
              title: "계약 정책",
              content: "정책 설정에서 계약서 문구와 특약을 관리합니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTab,
    classId,
    configData,
    isTeacher,
    layoutData?.groups,
  ]);

  if (loading && Date.now() < 0) {
    return <PageLoader message="부동산 데이터를 불러오는 중입니다..." />;
  }

  if (isInitialPageLoading) {
    return (
    <AppLayout
      title="援먯떎 遺?숈궛"
      showSidebar={true}
      showDefaultHeader={false}
      pageGuide={realEstateQuestGuide}
    >
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message="부동산 데이터를 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  const renderContent = () => {

    if (activeTab === 'classroom') {
      return (
        <ClassroomViewer
          layoutData={layoutData}
          placementData={placementData}
          configData={configData}
          onOpenContractCenter={() => setIsContractCenterOpen(true)}
          requestedDeskId={requestedFundDeskId}
          onRequestedDeskHandled={handleRequestedFundDeskHandled}
          onFinancialDemand={onClassroomFinancialDemand}
          financialReady={financialData.ready}
        />
      );
    }

    if (activeTab === 'my') {
      return showMyRealEstateTab ? (
        <MyRealEstateTab layoutData={layoutData} userData={userData} configData={configData} />
      ) : (
        <ClassroomViewer layoutData={layoutData} placementData={placementData} configData={configData} onOpenContractCenter={() => setIsContractCenterOpen(true)} onFinancialDemand={onClassroomFinancialDemand} financialReady={financialData.ready} />
      );
    }

    if (activeTab === 'auction') {
      return (
        <RealEstateAuctionTab
          classId={classId}
          layoutData={layoutData}
          configData={configData}
        />
      );
    }

    if (activeTab === 'ledger') {
      return isTeacher ? <RealEstateLedgerTab classId={classId} /> : null;
    }

    if (activeTab === 'stats') {
      return isTeacher ? <RealEstateMarketStatsTab classId={classId} layoutData={layoutData} /> : null;
    }

    if (activeTab === 'holding') {
      return isTeacher ? (
        <HoldingTaxStatusTab
          classId={classId}
          layoutData={layoutData}
          configData={configData}
          students={students}
        />
      ) : null;
    }

    if (activeTab === 'manage') {
      return canManageRealEstate ? (
        <ClassroomLayoutEditor
          classId={classId}
          initialData={layoutData}
          placementData={placementData}
          onSavePlacement={handleSavePlacement}
          onSaveDeskDisplayScale={handleSaveDeskDisplayScale}
          onSetSeatActive={handleSetSeatActive}
          onCreateSeat={handleCreateSeat}
          configData={configData}
          students={students}
          onSave={handleSaveLayout}
          saving={isLayoutSaving}
        />
      ) : null;
    }

    if (activeTab === 'policy') {
      return isTeacher ? (
        <AdminRealEstateSettings
          initialConfig={configData}
          onSave={handleSaveConfig}
          saving={isConfigSaving}
        />
      ) : null;
    }

    return null;
  };

  return (
    <AppLayout
      title="교실 부동산"
      showSidebar={true}
      showDefaultHeader={false}
      pageGuide={realEstateQuestGuide}
    >
      <div className={`min-h-screen bg-[#f0f5ff] p-4 font-sans sm:p-6 lg:p-8 ${activeTab === 'classroom' ? 'realestate-page--classroom space-y-3' : 'space-y-6'}`}>
        <PageHeader
          title="교실 부동산"
          subtitle="자리 자산과 거래 현황을 확인하고 관리합니다."
          icon={Building2}
        />

        {isFundMode ? (
          <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black text-emerald-600">기금 보유 부동산</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">
                  {activeFund?.name || '선택한 기금'}
                </h2>
              </div>
              <div className="flex gap-2">
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-bold text-emerald-600">보유</p>
                  <p className="text-sm font-black text-emerald-800">
                    {activeFundProperties.length}건
                  </p>
                </div>
                <div className="rounded-xl bg-indigo-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-bold text-indigo-500">평가액</p>
                  <p className="text-sm font-black text-indigo-800">
                    {formatClassCurrency(activeFundPropertyValue)} {classData?.currencyUnit || '마로'}
                  </p>
                </div>
              </div>
            </div>

            {activeFundProperties.length > 0 ? (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {activeFundProperties.map((desk) => (
                  <button
                    key={desk.id}
                    type="button"
                    onClick={() => handleOpenFundProperty(desk.id)}
                    className="min-w-[170px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <p className="truncate text-sm font-black text-slate-800">
                      {desk.label || `${desk.number || ''}번 부동산`}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-400">
                      {desk.groupName}
                    </p>
                    <p className="mt-2 text-xs font-black text-emerald-700">
                      {formatClassCurrency(desk.fundValue)} {classData?.currencyUnit || '마로'}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-400">
                아직 이 기금이 보유한 부동산이 없습니다.
              </p>
            )}
          </section>
        ) : null}

        <div data-tour="realestate-tabs" data-active-tab={activeTab}>
          <RealEstateNavigation
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>

        <main className="relative animate-fadeIn classroom-workspace" data-classroom-fit-root>
          <div
            data-tour="realestate-content"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
          />
          {loading ? (
            <SectionLoader
              message="부동산 화면을 준비하는 중입니다..."
              minHeightClassName="min-h-[420px]"
            />
          ) : activeTab !== 'classroom' && financialData.error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              부동산 원문을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
            </div>
          ) : (
            renderContent()
          )}
        </main>
        {isContractCenterOpen && !financialData.ready && (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            {financialData.error ? '계약 정보를 불러오지 못했습니다.' : '계약 정보를 불러오는 중입니다…'}
            <SharedUiButton tone="blue" kind="ghost" size="md" type="button"  onClick={() => setIsContractCenterOpen(false)}>닫기</SharedUiButton>
          </div>
        )}
        {isTeacher ? (
          <RealEstateContractCenterModal
            isOpen={isContractCenterOpen && financialData.ready}
            onClose={() => setIsContractCenterOpen(false)}
            layoutData={layoutData}
            classDisplayName={classData?.className || userData?.className || '우리 반'}
            currencyUnit={classData?.currencyUnit || '마로'}
            realEstateConfig={configData}
          />
        ) : null}
      </div>
    </AppLayout>
  );
}
