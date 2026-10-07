import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Gauge,
  HandHeart,
  RefreshCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { db } from "../../../firebase";
import { Badge, Button, Card, Spinner, Tabs } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { mainNavItems } from "../../../config/navConfig";
import {
  INITIAL_PLAN_FEATURES,
  PAGE_ORDER,
  PLAN_KEYS,
  PATH_TO_SERVICE as PATH_TO_PAGE_KEY,
  getPlanBadgeTone,
  mergePlanConfig,
} from "../constants/planManager";

const PAGE_LABELS = {
  bank: "은행",
  stock: "주식",
  mission: "미션",
  credentials: "칭호",
  realestate: "부동산",
  assetManager: "학급경제관리",
  arcade: "아케이드",
  police: "경찰",
  store: "상점",
  tax: "세금",
  labor: "노동",
  news: "뉴스",
  credit: "신용등급",
  donation: "기부",
  assembly: "의회",
  jobBoard: "직업게시판",
  marketplace: "마켓",
};

PAGE_LABELS.caseLibrary = "\uAC00\uC774\uB4DC\uBD81";

const LIMIT_LABELS = {
  maxStudents: "최대 학생 수",
  maxMissions: "최대 미션 수",
};

const PAGE_ICONS = mainNavItems.reduce((acc, item) => {
  const pageKey = PATH_TO_PAGE_KEY[item.path];
  if (pageKey && item.icon) {
    acc[pageKey] = item.icon;
  }
  return acc;
}, {});
PAGE_ICONS.donation = HandHeart;

PAGE_ICONS.caseLibrary = BookOpen;

const POLICY_SECTIONS = [
  {
    key: "accessible",
    title: "페이지 접근",
    description: "각 플랜에서 해당 페이지에 접근할 수 있는지 설정합니다.",
  },
  {
    key: "activityLog",
    title: "활동로그",
    description:
      "핵심 데이터는 항상 저장하고, activityLogs 기록 여부만 on/off로 관리합니다.",
  },
  {
    key: "creditLog",
    title: "신용로그",
    description:
      "핵심 데이터는 항상 저장하고, creditLogs 기록 여부만 on/off로 관리합니다.",
  },
];

const POLICY_TAB_ICONS = {
  accessible: CheckCircle2,
  activityLog: Activity,
  creditLog: Gauge,
};

const CELL_TONE_CLASS = {
  FREE: {
    active:
      "border-slate-300 bg-slate-800 text-white shadow-sm shadow-slate-300/30",
    inactive: "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
  },
  PLUS: {
    active:
      "border-blue-300 bg-blue-600 text-white shadow-sm shadow-blue-200/40",
    inactive: "border-blue-100 bg-white text-blue-700 hover:border-blue-300",
  },
  PRO: {
    active:
      "border-indigo-300 bg-indigo-600 text-white shadow-sm shadow-indigo-200/40",
    inactive:
      "border-indigo-100 bg-white text-indigo-700 hover:border-indigo-300",
  },
};

const EMPTY_PAGE_POLICY = {
  accessible: false,
  activityLog: false,
  creditLog: false,
};

const getPolicyValue = (config, planKey, pageKey, policyKey) =>
  Boolean(config?.[planKey]?.pages?.[pageKey]?.[policyKey]);

const FeaturePolicyTab = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(null);
  const [activePolicyTab, setActivePolicyTab] = useState(
    POLICY_SECTIONS[0]?.key || "accessible",
  );
  const { showFeedback } = useFeedback();

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "system", "planConfig"));
        setConfig(
          mergePlanConfig(snap.exists() ? snap.data() : INITIAL_PLAN_FEATURES),
        );
      } catch (error) {
        console.error(error);
        showFeedback("플랜 정책을 불러오지 못했습니다.", "error");
        setConfig(mergePlanConfig(INITIAL_PLAN_FEATURES));
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [showFeedback]);

  const handlePageToggle = (planKey, pageKey, policyKey) => {
    if (!config) return;

    setConfig((prev) => {
      const prevPlan = prev[planKey] || INITIAL_PLAN_FEATURES[planKey];
      const prevPage = prevPlan.pages?.[pageKey] || EMPTY_PAGE_POLICY;
      const nextValue = !prevPage[policyKey];
      const nextPage = {
        ...prevPage,
        [policyKey]: nextValue,
      };

      if (policyKey === "accessible" && nextValue === false) {
        nextPage.activityLog = false;
        nextPage.creditLog = false;
      }

      return mergePlanConfig({
        ...prev,
        [planKey]: {
          ...prevPlan,
          pages: {
            ...(prevPlan.pages || {}),
            [pageKey]: nextPage,
          },
        },
      });
    });
  };

  const handleLimitChange = (planKey, limitKey, value) => {
    if (!config) return;

    setConfig((prev) =>
      mergePlanConfig({
        ...prev,
        [planKey]: {
          ...prev[planKey],
          limits: {
            ...prev[planKey].limits,
            [limitKey]: Number(value),
          },
        },
      }),
    );
  };

  const handleReset = () => {
    setConfig(mergePlanConfig(INITIAL_PLAN_FEATURES));
  };

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    try {
      const nextConfig = mergePlanConfig(config);
      await setDoc(doc(db, "system", "planConfig"), nextConfig);
      setConfig(nextConfig);
      showFeedback("플랜 정책을 저장했습니다.", "success");
    } catch (error) {
      console.error(error);
      showFeedback("플랜 정책 저장에 실패했습니다.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="p-20 text-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const activePolicySection =
    POLICY_SECTIONS.find((section) => section.key === activePolicyTab) ||
    POLICY_SECTIONS[0];

  const policyTabs = POLICY_SECTIONS.map((section) => ({
    id: section.key,
    label: section.title,
    icon: POLICY_TAB_ICONS[section.key],
  }));

  return (
    <div className="space-y-6 pb-32 animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-start gap-4 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
        <div className="rounded-xl bg-indigo-50 p-2">
          <ShieldAlert className="text-indigo-600" size={24} />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-slate-900">플랜 정책 매트릭스</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            세로축은 페이지, 가로축은 플랜입니다. 페이지 접근, 활동 로그, 신용로그를
            각각 분리해서 관리할 수 있고, 페이지 접근이 꺼지면 해당 페이지의 로그는
            자동으로 off 됩니다.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          icon={RefreshCcw}
        >
          기본값 복원
        </Button>
      </div>

      <Card noPadding variant="elevated" tone="white" className="border-0">
        <Card.Content className="gap-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-900">
                정책 탭
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                페이지 접근, 활동 로그, 신용로그를 탭으로 나눠서 플랜별 매트릭스를
                관리합니다.
              </p>
            </div>
            <Badge tone="indigo">{activePolicySection.title}</Badge>
          </div>

          <Tabs
            tabs={policyTabs}
            activeTab={activePolicyTab}
            onTabChange={setActivePolicyTab}
            variant="underline"
            size="md"
            className="w-full"
            fullWidth
            idPrefix="feature-policy"
          />
        </Card.Content>
      </Card>

      <PolicyMatrixCard
        config={config}
        policyKey={activePolicySection.key}
        title={activePolicySection.title}
        description={activePolicySection.description}
        onToggle={handlePageToggle}
      />

      <LimitMatrixCard config={config} onChange={handleLimitChange} />

      <div className="fixed bottom-10 left-1/2 z-[110] w-full max-w-xs -translate-x-1/2 px-4">
        <Button
          size="lg"
          tone="blue"
          onClick={handleSave}
          isLoading={saving}
          icon={Save}
          className="w-full"
        >
          정책 저장
        </Button>
      </div>
    </div>
  );
};

const PolicyMatrixCard = ({
  config,
  policyKey,
  title,
  description,
  onToggle,
}) => {
  return (
    <Card noPadding variant="elevated" tone="white" className="border-0">
      <Card.Content className="gap-5">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-900">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-[760px] w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  페이지
                </th>
                {PLAN_KEYS.map((planKey) => (
                  <th
                    key={planKey}
                    className="border-b border-slate-200 px-4 py-3 text-center"
                  >
                    <Badge tone={getPlanBadgeTone(planKey)}>{planKey}</Badge>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {PAGE_ORDER.map((pageKey) => {
                const Icon = PAGE_ICONS[pageKey] || ShieldCheck;

                return (
                  <tr key={pageKey}>
                    <td className="sticky left-0 z-[1] bg-white px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                          <Icon size={18} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {PAGE_LABELS[pageKey] || pageKey}
                          </p>
                          <p className="text-xs text-slate-400">{pageKey}</p>
                        </div>
                      </div>
                    </td>

                    {PLAN_KEYS.map((planKey) => {
                      const accessible = getPolicyValue(
                        config,
                        planKey,
                        pageKey,
                        "accessible",
                      );
                      const supportsPolicy =
                        pageKey !== "caseLibrary" || policyKey === "accessible";
                      const isDisabled =
                        !supportsPolicy ||
                        (policyKey !== "accessible" && accessible !== true);
                      const isActive = getPolicyValue(
                        config,
                        planKey,
                        pageKey,
                        policyKey,
                      );
                      const toneClass =
                        CELL_TONE_CLASS[planKey] || CELL_TONE_CLASS.FREE;

                      return (
                        <td key={planKey} className="px-4 py-4 text-center">
                          <button
                            type="button"
                            disabled={isDisabled}
                            onClick={() => {
                              if (isDisabled) return;
                              onToggle(planKey, pageKey, policyKey);
                            }}
                            className={`inline-flex min-w-[92px] items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-all ${
                              isDisabled
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                : isActive
                                  ? toneClass.active
                                  : toneClass.inactive
                            }`}
                          >
                            {isActive ? (
                              <CheckCircle2 size={16} className="shrink-0" />
                            ) : (
                              <XCircle size={16} className="shrink-0" />
                            )}
                            {isDisabled ? "잠김" : isActive ? "ON" : "OFF"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card.Content>
    </Card>
  );
};

const LimitMatrixCard = ({ config, onChange }) => {
  const limitKeys = Object.keys(config?.FREE?.limits || {});

  return (
    <Card noPadding variant="elevated" tone="white" className="border-0">
      <Card.Content className="gap-5">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-900">
            플랜 제한
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            학생 수와 미션 수 같은 상한값을 플랜별로 따로 관리합니다.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-[760px] w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  항목
                </th>
                {PLAN_KEYS.map((planKey) => (
                  <th
                    key={planKey}
                    className="border-b border-slate-200 px-4 py-3 text-center"
                  >
                    <Badge tone={getPlanBadgeTone(planKey)}>{planKey}</Badge>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {limitKeys.map((limitKey) => (
                <tr key={limitKey}>
                  <td className="px-4 py-4">
                    <p className="text-sm font-bold text-slate-900">
                      {LIMIT_LABELS[limitKey] || limitKey}
                    </p>
                    <p className="text-xs text-slate-400">{limitKey}</p>
                  </td>

                  {PLAN_KEYS.map((planKey) => (
                    <td key={planKey} className="px-4 py-4 text-center">
                      <input
                        type="number"
                        value={config?.[planKey]?.limits?.[limitKey] ?? 0}
                        onChange={(event) =>
                          onChange(planKey, limitKey, event.target.value)
                        }
                        className="w-28 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-center text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-blue-500/20"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card.Content>
    </Card>
  );
};

export default FeaturePolicyTab;
