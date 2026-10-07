import { appConfirm } from "../../utils/appDialogs";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, writeBatch } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { toast } from "react-toastify";
import {
  AlertCircle,
  CheckCircle2,
  GraduationCap,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  ToggleRight,
  Zap,
} from "lucide-react";

import { db } from "../../firebase";
import AppLayout from "../../components/layout/AppLayout";
import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Card,
  Checkbox,
  PageHeader,
} from "../../components/ui";
import useDragSelection from "../../hooks/useDragSelection";
import FeaturePolicyTab from "./tabs/FeaturePolicyTab";
import { getPlanBadgeTone } from "./constants/planManager";

const EMPTY_CLASS_NAME = "(이름 없는 학급)";

const ClassListTable = memo(
  ({
    data,
    title,
    icon: Icon,
    colorClass,
    selectedIds,
    onToggleSelect,
    onSelectAll,
    onStartSelection,
    onEnterSelection,
    tokenClaims,
  }) => {
    const allSelected =
      data.length > 0 && data.every((item) => selectedIds.includes(item.id));

    return (
      <div className="flex min-w-0 flex-1 flex-col h-[calc(100vh-280px)]">
        <div className={`mb-3 flex items-center gap-2 px-1 ${colorClass}`}>
          <Icon size={18} />
          <h3 className="text-lg font-bold">
            {title} <span className="text-sm opacity-70">({data.length})</span>
          </h3>
        </div>

        <Card
          tone="slate"
          variant="elevated"
          className="flex flex-1 flex-col overflow-hidden border-0 shadow-md"
        >
          <div className="relative flex-1 overflow-y-auto scrollbar-thin">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-sm">
                <tr>
                  <th className="w-12 p-3 text-center">
                    <Checkbox
                      checked={allSelected}
                      onChange={() => onSelectAll(data, allSelected)}
                    />
                  </th>
                  <th className="p-3">학급 / 담임</th>
                  <th className="p-3 text-center">DB 플랜</th>
                  <th className="p-3 text-center">토큰 플랜</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {data.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="p-20 text-center text-slate-400">
                      표시할 학급이 없습니다.
                    </td>
                  </tr>
                ) : (
                  data.map((classItem) => {
                    const isSelected = selectedIds.includes(classItem.id);
                    const actualToken = tokenClaims[classItem.teacherUid] || "-";
                    const isSynced = classItem.planType === actualToken;

                    return (
                      <tr
                        key={classItem.id}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          onStartSelection(classItem.id, isSelected);
                        }}
                        onMouseEnter={() => onEnterSelection(classItem.id)}
                        className={`cursor-pointer select-none transition-colors ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td
                          className="p-3 text-center"
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={isSelected}
                            onChange={() => onToggleSelect(classItem.id)}
                          />
                        </td>

                        <td className="p-3">
                          <div
                            className={`font-bold ${
                              isSelected ? "text-indigo-900" : "text-slate-800"
                            }`}
                          >
                            {classItem.className}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {classItem.teacherName || "담임 없음"}{" "}
                            <span className="opacity-50">
                              ({classItem.teacherUid?.slice(0, 5)}...)
                            </span>
                          </div>
                        </td>

                        <td className="p-3 text-center">
                          <Badge color={getPlanBadgeTone(classItem.planType)}>
                            {classItem.planType}
                          </Badge>
                        </td>

                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Badge
                              variant={isSynced ? "solid" : "outline"}
                              color={getPlanBadgeTone(actualToken)}
                            >
                              {actualToken}
                            </Badge>
                            {!isSynced && classItem.teacherUid ? (
                              <AlertCircle
                                size={14}
                                className="text-amber-500"
                                title="DB 플랜과 토큰 플랜이 일치하지 않습니다."
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  },
);

const MasterPlanManager = () => {
  const [classList, setClassList] = useState([]);
  const [tokenClaims, setTokenClaims] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("management");

  const fetchTokenClaims = useCallback(async (uids) => {
    const validUids = [...new Set(uids.filter(Boolean))];
    if (validUids.length === 0) return;

    try {
      const functions = getFunctions(undefined, "asia-northeast3");
      const getClaims = httpsCallable(functions, "getTeachersAuthClaims");
      const result = await getClaims({ teacherUids: validUids });
      setTokenClaims(result.data);
    } catch (error) {
      console.error("[MasterPlanManager] token claim load error:", error);
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    setIsLoading(true);

    try {
      const classesQuery = query(collection(db, "classes"));
      const snapshot = await getDocs(classesQuery);
      const nextClasses = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data(),
          className: item.data().className || EMPTY_CLASS_NAME,
          planType: item.data().planType || "FREE",
        }))
        .sort((a, b) => a.className.localeCompare(b.className));

      setClassList(nextClasses);
      fetchTokenClaims(nextClasses.map((item) => item.teacherUid));
    } catch (error) {
      console.error("[MasterPlanManager] class load failed:", error);
      toast.error("학급 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchTokenClaims]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const selectId = useCallback((id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const deselectId = useCallback((id) => {
    setSelectedIds((prev) => prev.filter((item) => item !== id));
  }, []);

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (id) => selectedIds.includes(id),
    onSelect: selectId,
    onDeselect: deselectId,
  });

  const handleSelectionStart = useCallback(
    (id, isSelected) => {
      startDrag(id, { selected: isSelected });
    },
    [startDrag],
  );

  const handleSelectionEnter = useCallback(
    (id) => {
      enterDrag(id);
    },
    [enterDrag],
  );

  const handleSelectAll = useCallback((listData, isAllSelected) => {
    const listIds = listData.map((item) => item.id);
    setSelectedIds((prev) =>
      isAllSelected
        ? prev.filter((id) => !listIds.includes(id))
        : [...new Set([...prev, ...listIds])],
    );
  }, []);

  const { noNameList, namedList } = useMemo(() => {
    const keyword = searchTerm.toLowerCase();
    const filtered = classList.filter(
      (item) =>
        item.className?.toLowerCase().includes(keyword) ||
        item.teacherName?.toLowerCase().includes(keyword),
    );

    return {
      noNameList: filtered.filter((item) => item.className === EMPTY_CLASS_NAME),
      namedList: filtered.filter((item) => item.className !== EMPTY_CLASS_NAME),
    };
  }, [classList, searchTerm]);

  const handleBulkUpdate = async (nextPlan) => {
    if (selectedIds.length === 0) return;

    const confirmed = (await appConfirm(
      `${selectedIds.length}개 학급의 플랜을 ${nextPlan}로 변경할까요?`,
    ));
    if (!confirmed) return;

    setIsUpdating(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.update(doc(db, "classes", id), { planType: nextPlan });
      });
      await batch.commit();

      toast.success(`${nextPlan} 플랜으로 변경했습니다.`);
      setSelectedIds([]);
      setTimeout(fetchClasses, 1500);
    } catch (error) {
      console.error("[MasterPlanManager] bulk plan update failed:", error);
      toast.error("플랜 일괄 변경에 실패했습니다.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <AppLayout title="플랜 관리">
      <div className="min-h-screen select-none space-y-6 bg-[#f0f5ff] p-4 pb-40 sm:p-6 lg:p-8">
        <PageHeader
          title="학급 플랜 관리"
          subtitle="학급별 플랜을 확인하고 FREE, PLUS, PRO, AI_PRO로 일괄 변경할 수 있습니다."
          icon={Settings2}
        />

        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <Button
            type="button"
            onClick={() => setActiveTab("management")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-3 font-bold transition-all ${
              activeTab === "management"
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <GraduationCap size={18} /> 학급 플랜 관리
          </Button>
          <Button
            type="button"
            onClick={() => setActiveTab("features")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-3 font-bold transition-all ${
              activeTab === "features"
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <ToggleRight size={18} /> 기능 정책
          </Button>
        </div>

        {activeTab === "management" ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="학급명 또는 담임명을 검색하세요"
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-3 pl-11 pr-4 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <Button
                kind="outline"
                tone="slate"
                onClick={fetchClasses}
                isLoading={isLoading}
              >
                <RefreshCcw size={18} />
              </Button>
            </div>

            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
              <ClassListTable
                data={noNameList}
                title="이름 없는 학급"
                icon={AlertCircle}
                colorClass="text-rose-500"
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onSelectAll={handleSelectAll}
                onStartSelection={handleSelectionStart}
                onEnterSelection={handleSelectionEnter}
                tokenClaims={tokenClaims}
              />
              <ClassListTable
                data={namedList}
                title="학급 목록"
                icon={CheckCircle2}
                colorClass="text-emerald-600"
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onSelectAll={handleSelectAll}
                onStartSelection={handleSelectionStart}
                onEnterSelection={handleSelectionEnter}
                tokenClaims={tokenClaims}
              />
            </div>
          </div>
        ) : (
          <FeaturePolicyTab />
        )}
      </div>

      {selectedIds.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedIds.length}
          tone="slate"
          icon={ShieldCheck}
          eyebrow="플랜 일괄 변경"
          title="선택한 학급의 플랜을 한 번에 변경할 수 있습니다"
          subtitle="FREE, PLUS, PRO, AI_PRO 중 원하는 플랜으로 일괄 변경합니다."
          actions={[
            {
              key: "ai-pro",
              label: "AI_PRO",
              onClick: () => handleBulkUpdate("AI_PRO"),
              icon: Zap,
              tone: "violet",
              disabled: isUpdating,
            },
            {
              key: "pro",
              label: "PRO",
              onClick: () => handleBulkUpdate("PRO"),
              icon: Zap,
              tone: "indigo",
              disabled: isUpdating,
            },
            {
              key: "plus",
              label: "PLUS",
              onClick: () => handleBulkUpdate("PLUS"),
              icon: ShieldCheck,
              tone: "blue",
              disabled: isUpdating,
            },
            {
              key: "free",
              label: "FREE",
              onClick: () => handleBulkUpdate("FREE"),
              icon: GraduationCap,
              tone: "slate",
              kind: "outline",
              disabled: isUpdating,
            },
          ]}
          onClear={() => setSelectedIds([])}
        />
      ) : null}
    </AppLayout>
  );
};

export default MasterPlanManager;
