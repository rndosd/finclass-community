import React, { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  Briefcase,
  ChevronRight,
  Gamepad2,
  Landmark,
  PiggyBank,
  Receipt,
  Save,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";

import { Badge, Button, Spinner } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { db } from "../../../firebase";
import { getTaxPolicy } from "../../../utils/taxPolicy";

const clone = (value) => JSON.parse(JSON.stringify(value));

const toDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
};

const WITHHOLDING_ITEMS = [
  ["payrollSalary", "정기 급여", Receipt],
  ["payrollBonus", "성과급", Sparkles],
  ["incentivePayment", "인센티브", Sparkles],
  ["depositInterest", "예금 이자", PiggyBank],
  ["stockDividend", "주식 배당", Landmark],
  ["missionReward", "과제 보상", Briefcase],
  ["jobBoardReward", "잡보드 보상", Briefcase],
  ["policeReward", "경찰 상금", ShieldCheck],
  ["arcadePrize", "놀이터 상금", Gamepad2],
  ["assetAdjustment", "자산 수동 추가", Wallet],
];

const preparePolicy = (classData) => {
  const policy = clone(getTaxPolicy(classData));
  policy.periodIncomeSettlement = {
    enabled: false,
    activationDateKey: null,
    dailyAggregationEnabled: false,
    scheduleEnabled: false,
    sourceKeys: [],
    ...(policy.periodIncomeSettlement || {}),
  };
  policy.monthEndSettlement = {
    ...(policy.monthEndSettlement || {}),
    enabled: policy.monthEndSettlement?.enabled === true,
  };
  Object.values(policy.withholding || {}).forEach((item) => {
    item.taxRate = String(item.enabled === true ? Number(item.taxRate || 0) : 0);
  });
  return policy;
};

const SettingRow = ({ title, description, children }) => (
  <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0 pr-4">
      <p className="text-sm font-black text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      ) : null}
    </div>
    <div className="shrink-0 sm:min-w-[210px] sm:text-right">{children}</div>
  </div>
);

export default function TaxPolicyMasterDetail({ classId, classData, userData }) {
  const { showFeedback } = useFeedback();
  const [savedPolicy, setSavedPolicy] = useState(() => preparePolicy(classData));
  const [formPolicy, setFormPolicy] = useState(() => preparePolicy(classData));
  const [selectedKey, setSelectedKey] = useState(`withholding.${WITHHOLDING_ITEMS[0][0]}`);
  const [isSaving, setIsSaving] = useState(false);
  const [bulkTaxRate, setBulkTaxRate] = useState("10");

  useEffect(() => {
    const next = preparePolicy(classData);
    setSavedPolicy(next);
    setFormPolicy(next);
  }, [classData]);

  const isDirty = useMemo(
    () => JSON.stringify(savedPolicy) !== JSON.stringify(formPolicy),
    [formPolicy, savedPolicy],
  );

  const update = (path, value) => {
    setFormPolicy((previous) => {
      const next = clone(previous);
      let cursor = next;
      for (let index = 0; index < path.length - 1; index += 1) {
        cursor = cursor[path[index]];
      }
      cursor[path[path.length - 1]] = value;
      return next;
    });
  };

  const applyBulkWithholding = () => {
    const taxRate = Math.min(100, Math.max(0, Number(bulkTaxRate || 0)));
    setBulkTaxRate(String(taxRate));
    setFormPolicy((previous) => {
      const next = clone(previous);
      WITHHOLDING_ITEMS.forEach(([key]) => {
        next.withholding[key].taxRate = String(taxRate);
      });
      return next;
    });
    showFeedback("모든 원천징수 항목에 적용했습니다.", "success");
  };

  const items = useMemo(() => {
    return WITHHOLDING_ITEMS.map(([key, title, icon]) => {
      const withholding = formPolicy.withholding[key];
      const taxRate = Number(withholding.taxRate || 0);
      return {
        key: `withholding.${key}`,
        title,
        icon,
        summary: taxRate > 0 ? `${taxRate}%` : "미적용",
        active: taxRate > 0,
      };
    });
  }, [formPolicy]);

  const selectedItem = items.find((item) => item.key === selectedKey) || items[0];

  const renderDetail = () => {
    const sourceKey = selectedKey.split(".")[1];
    const withholding = formPolicy.withholding[sourceKey];
    return (
      <SettingRow
        title="세율"
        description="지급액에서 원천징수할 비율입니다. 0%로 설정하면 적용하지 않습니다."
      >
        <div className="relative">
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={withholding.taxRate}
            onChange={(event) =>
              update(["withholding", sourceKey, "taxRate"], event.target.value)
            }
            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 pr-9 text-right text-sm font-bold"
          />
          <span className="absolute right-3 top-2 text-sm font-bold text-slate-400">%</span>
        </div>
      </SettingRow>
    );
  };

  const handleSave = async () => {
    if (!classId || !isDirty || isSaving) return;
    const next = clone(formPolicy);
    next.version = 1;
    next.periodIncomeSettlement.enabled = true;
    next.periodIncomeSettlement.activationDateKey =
      next.periodIncomeSettlement.activationDateKey || toDateKey();
    next.periodIncomeSettlement.dailyAggregationEnabled = true;
    next.periodIncomeSettlement.scheduleEnabled = true;
    next.periodIncomeSettlement.sourceKeys = [];
    Object.values(next.withholding || {}).forEach((item) => {
      item.taxRate = Math.min(100, Math.max(0, Number(item.taxRate || 0)));
      item.enabled = item.taxRate > 0;
      item.exemptionAmount = 0;
      item.monthEndSettlementEnabled = true;
      item.enabledFrom = null;
    });
    delete next.incomeSettlement;

    setIsSaving(true);
    try {
      await updateDoc(doc(db, "classes", classId), {
        taxPolicy: {
          ...next,
          updatedAt: serverTimestamp(),
          updatedBy: userData?.uid || null,
        },
        "taxSettings.storeMode": next.treasury.store.mode,
        "settings.payrollTaxMode": next.treasury.payroll.mode,
      });
      const saved = preparePolicy({ taxPolicy: next });
      setSavedPolicy(saved);
      setFormPolicy(saved);
      showFeedback("세금 정책을 저장했습니다.", "success");
    } catch (error) {
      console.error("tax policy save failed", error);
      showFeedback(error?.message || "세금 정책을 저장하지 못했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-h-[650px] lg:grid-cols-[minmax(520px,1.2fr)_minmax(360px,0.8fr)]">
        <aside className="border-b border-slate-200 bg-slate-50/60 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-black text-slate-900">정책 목록</p>
            <p className="mt-1 text-xs text-slate-500">항목을 선택해 상세 설정을 변경하세요.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:flex-nowrap">
            <p className="mr-auto whitespace-nowrap text-xs font-black text-slate-700">
              원천징수 일괄 설정
            </p>
            <div className="relative w-24 shrink-0">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={bulkTaxRate}
                onChange={(event) => setBulkTaxRate(event.target.value)}
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 pr-8 text-right text-sm font-bold"
                aria-label="전체 원천징수 세율"
              />
              <span className="absolute right-3 top-2 text-sm font-bold text-slate-400">%</span>
            </div>
            <Button kind="soft" tone="blue" size="sm" onClick={applyBulkWithholding}>
              전체 적용
            </Button>
          </div>
          <div className="grid max-h-[360px] grid-cols-1 gap-2 overflow-y-auto p-2 sm:grid-cols-2 lg:max-h-[500px]">
            {items.map((item) => {
              const Icon = item.icon;
              const selected = item.key === selectedKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedKey(item.key)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    selected
                      ? "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-100"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    selected ? "bg-white text-indigo-600" : "bg-white text-slate-500"
                  } ring-1 ring-slate-200/80`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black">{item.title}</span>
                    <span className={`mt-0.5 block text-xs ${item.active ? "text-indigo-600" : "text-slate-400"}`}>
                      {item.summary}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-xl font-black text-slate-900">{selectedItem.title}</h3>
                <Badge tone={selectedItem.active ? "emerald" : "slate"}>
                  {selectedItem.summary}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">세율이 0%보다 크면 자동으로 적용됩니다.</p>
            </div>
          </header>

          <div className="flex-1">{renderDetail()}</div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
            <span className={`text-xs font-bold ${isDirty ? "text-amber-600" : "text-slate-400"}`}>
              {isDirty ? "저장하지 않은 변경사항이 있습니다." : "모든 변경사항이 저장되었습니다."}
            </span>
            <div className="flex gap-2">
              {isDirty ? (
                <Button
                  type="button"
                  kind="ghost"
                  tone="slate"
                  size="sm"
                  onClick={() => setFormPolicy(clone(savedPolicy))}
                  disabled={isSaving}
                >
                  되돌리기
                </Button>
              ) : null}
              <Button
                type="button"
                kind="solid"
                tone="blue"
                size="sm"
                onClick={handleSave}
                disabled={!isDirty || isSaving}
              >
                {isSaving ? (
                  <Spinner size="xs" className="mr-2" />
                ) : (
                  <Save className="mr-1 h-4 w-4" />
                )}
                변경사항 저장
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
