import React, { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  AcademicCapIcon,
  BanknotesIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  CurrencyDollarIcon,
  HashtagIcon,
} from "@heroicons/react/24/outline";

import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import {
  normalizeNumberFormatSettings,
  useNumberFormat,
} from "../../../contexts/NumberFormatContext";
import {
  normalizeBankMoneyFormatSettings,
} from "../../../utils/bankMoney";
import {
  normalizeStockDisplaySettings,
} from "../../../utils/stockFormat";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  Button,
  CardSkeleton,
  InputField,
  Modal,
  SurfaceLoader,
  ToggleSwitch,
  Tabs,
} from "../../../components/ui";
import {
  normalizeMissionTokenLabel,
  resolveMissionTokenLabel,
} from "../../../utils/missionTokenLabel";

const TAB_ITEMS = [
  { id: "info", label: "기본 정보", icon: AcademicCapIcon },
  { id: "general", label: "일반 숫자", icon: HashtagIcon },
  { id: "bank", label: "은행 숫자", icon: BanknotesIcon },
  { id: "stock", label: "주식 숫자", icon: ChartBarIcon },
];

const GENERAL_NUMBER_OPTIONS = [
  { id: "tens", label: "10 단위", sub: "1,238 -> 1,230" },
  { id: "ones", label: "1 단위", sub: "1,234.9 -> 1,234" },
  { id: "first", label: "소수 첫째 자리", sub: "1.567 -> 1.5" },
  { id: "second", label: "소수 둘째 자리", sub: "1.567 -> 1.56" },
  { id: "third", label: "소수 셋째 자리", sub: "1.5678 -> 1.567" },
];

const STOCK_DIGIT_FIELDS = [
  {
    key: "moneyFractionDigits",
    label: "FIN 금액 소수 자리수",
    description: "매수·매도 견적, 포트폴리오 금액, 거래 금액에 사용됩니다.",
  },
  {
    key: "priceFractionDigits",
    label: "주가 소수 자리수",
    description: "종목 카드와 매수·매도 시세 표시 기준입니다.",
  },
  {
    key: "quantityFractionDigits",
    label: "주식 수량 소수점 자리",
    description: "소수점 주식 보유 수량과 거래 수량을 몇 자리까지 보여줄지 정합니다.",
  },
  {
    key: "classCurrencyFractionDigits",
    label: "학급 화폐 소수 자리수",
    description: "주식 화면에서 학급 화폐로 환산한 금액 표시 기준입니다.",
  },
  {
    key: "exchangeRateFractionDigits",
    label: "환율 소수 자리수",
    description: "주식 환전 화면과 환율 표시 기준입니다.",
  },
  {
    key: "percentFractionDigits",
    label: "수익률 소수 자리수",
    description: "등락률과 수익률 표시 기준입니다.",
  },
];

const STOCK_TOGGLE_FIELDS = [
  {
    key: "useCompactNotation",
    label: "큰 수 축약 표기 사용",
    description: "예: 1,250,000 -> 125만",
  },
  {
    key: "showLessThanThreshold",
    label: "아주 작은 값은 별도 표시",
    description: "예: 0보다 크지만 표시 자리수보다 작으면 <0.01",
  },
];

const FRACTION_DIGIT_OPTIONS = [0, 1, 2, 3, 4];

const normalizeSchoolName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s*(?:\uCD08\uB4F1\uD559\uAD50|\uCD08)+\s*$/u, "");

const buildClassDocId = ({ schoolName = "", grade = "", classNum = "" }) => {
  const normalizedSchoolName = normalizeSchoolName(schoolName);
  const normalizedGrade = String(grade || "").trim();
  const normalizedClassNum = String(classNum || "").trim();

  if (!normalizedSchoolName || !normalizedGrade || !normalizedClassNum) {
    return "";
  }

  return `${normalizedSchoolName}\uCD08 ${normalizedGrade}-${normalizedClassNum}`;
};

const parseClassDocId = (value) => {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");

  if (!normalized) {
    return { schoolName: "", grade: "", classNum: "" };
  }

  const strictMatch = normalized.match(
    /^(.+)(?:\uCD08\uB4F1\uD559\uAD50|\uCD08)\s*([^-]+)\s*-\s*(.+)$/u,
  );

  if (strictMatch) {
    return {
      schoolName: normalizeSchoolName(strictMatch[1]),
      grade: strictMatch[2].trim(),
      classNum: strictMatch[3].trim(),
    };
  }

  const markerIndex = normalized.lastIndexOf("\uCD08");
  if (markerIndex < 0) {
    return { schoolName: "", grade: "", classNum: "" };
  }

  const schoolName = normalizeSchoolName(normalized.slice(0, markerIndex));
  const classPart = normalized.slice(markerIndex + 1).trim();
  const separatorIndex = classPart.indexOf("-");

  if (separatorIndex < 0) {
    return { schoolName, grade: "", classNum: "" };
  }

  return {
    schoolName,
    grade: classPart.slice(0, separatorIndex).trim(),
    classNum: classPart.slice(separatorIndex + 1).trim(),
  };
};

const createInfoSnapshot = ({
  schoolName = "",
  grade = "",
  classNum = "",
  className = "",
  teacherDisplayName = "",
  currencyUnit = "원",
  missionTokenLabel = "",
} = {}) => ({
  schoolName: String(schoolName || "").trim(),
  grade: String(grade || "").trim(),
  classNum: String(classNum || "").trim(),
  className: String(className || "").trim(),
  teacherDisplayName: String(teacherDisplayName || "").trim(),
  currencyUnit: String(currencyUnit || "").trim() || "원",
  missionTokenLabel: String(missionTokenLabel || "").trim(),
});

const isSameSnapshot = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

const SectionCard = ({ title, description, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3">
      <div className="text-xs font-bold text-slate-700">{title}</div>
      {description ? (
        <div className="mt-1 text-[11px] text-slate-500">{description}</div>
      ) : null}
    </div>
    {children}
  </div>
);



export default function ClassSettingsModal({ isOpen, onClose }) {
  const { classId } = useUser();
  const { setFormatSettings } = useNumberFormat();
  const { showFeedback } = useFeedback();

  const [activeTab, setActiveTab] = useState("info");
  const [schoolName, setSchoolName] = useState("");
  const [grade, setGrade] = useState("");
  const [classNum, setClassNum] = useState("");
  const [className, setClassName] = useState("");
  const [teacherDisplayName, setTeacherDisplayName] = useState("");
  const [currencyUnit, setCurrencyUnit] = useState("원");
  const [missionTokenLabel, setMissionTokenLabel] = useState(
    normalizeMissionTokenLabel(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [numberFormatSettings, setNumberFormatSettings] = useState(
    normalizeNumberFormatSettings(),
  );
  const [bankMoneyFormatSettings, setBankMoneyFormatSettings] = useState(
    normalizeBankMoneyFormatSettings(),
  );
  const [stockDisplayFormatSettings, setStockDisplayFormatSettings] = useState(
    normalizeStockDisplaySettings(),
  );
  const [savedTabSnapshots, setSavedTabSnapshots] = useState({
    info: createInfoSnapshot(),
    general: normalizeNumberFormatSettings(),
    bank: normalizeBankMoneyFormatSettings(),
    stock: normalizeStockDisplaySettings(),
  });
  const [needsInfoBackfill, setNeedsInfoBackfill] = useState(false);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);

  const currentInfoSnapshot = createInfoSnapshot({
    schoolName,
    grade,
    classNum,
    className,
    teacherDisplayName,
    currencyUnit,
    missionTokenLabel,
  });
  const currentGeneralSnapshot =
    normalizeNumberFormatSettings(numberFormatSettings);
  const currentBankSnapshot =
    normalizeBankMoneyFormatSettings(bankMoneyFormatSettings);
  const currentStockSnapshot =
    normalizeStockDisplaySettings(stockDisplayFormatSettings);
  const tabStatusMap = {
    info: {
      isDirty: !isSameSnapshot(currentInfoSnapshot, savedTabSnapshots.info),
      needsBackfill: needsInfoBackfill,
    },
    general: {
      isDirty: !isSameSnapshot(
        currentGeneralSnapshot,
        savedTabSnapshots.general,
      ),
    },
    bank: {
      isDirty: !isSameSnapshot(currentBankSnapshot, savedTabSnapshots.bank),
    },
    stock: {
      isDirty: !isSameSnapshot(currentStockSnapshot, savedTabSnapshots.stock),
    },
  };
  const activeTabStatus = tabStatusMap[activeTab] || { isDirty: false };
  const infoFieldLabels = {
    schoolName: "학교 이름", grade: "학년", classNum: "반", className: "학급 이름",
    teacherDisplayName: "선생님 이름", currencyUnit: "학급 화폐 단위", missionTokenLabel: "토큰 표시 이름",
  };
  const currentSnapshots = {
    info: currentInfoSnapshot, general: currentGeneralSnapshot,
    bank: currentBankSnapshot, stock: currentStockSnapshot,
  };
  const fieldLabels = {
    info: infoFieldLabels,
    general: { largeNumberDisplay: "큰 숫자 표시 자리", smallDecimalPlaces: "1 미만 소수 표시", useCompactNotation: "큰 숫자 축약 표기" },
    bank: { fractionDigits: "은행 기본 소수 자리", showLessThanThreshold: "아주 작은 금액 표시" },
    stock: Object.fromEntries([...STOCK_DIGIT_FIELDS, ...STOCK_TOGGLE_FIELDS].map(({ key, label }) => [key, label])),
  };
  const unsavedChanges = TAB_ITEMS.filter((tab) => tabStatusMap[tab.id].isDirty).map((tab) => ({
    ...tab,
    fields: Object.keys(currentSnapshots[tab.id])
      .filter((key) => currentSnapshots[tab.id][key] !== savedTabSnapshots[tab.id][key])
      .map((key) => fieldLabels[tab.id][key] || tab.label),
  }));
  const handleClose = () => {
    if (isSaving) return;
    if (!isLoading && unsavedChanges.length > 0) {
      setIsDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const getClassDocRefs = useCallback(() => {
    return {
      classDocRef: doc(db, "classes", classId),
      bankSettingsRef: doc(db, "classes", classId, "bank", "settings"),
      stockMarketRef: doc(db, "classes", classId, "config", "stockMarket"),
    };
  }, [classId]);

  const fetchSettings = useCallback(async () => {
    if (!classId) return;
    setIsLoading(true);

    try {
      const { classDocRef, bankSettingsRef, stockMarketRef } = getClassDocRefs();

      const [classDocSnap, bankSettingsSnap, stockMarketSnap] = await Promise.all([
        getDoc(classDocRef),
        getDoc(bankSettingsRef),
        getDoc(stockMarketRef),
      ]);

      if (classDocSnap.exists()) {
        const data = classDocSnap.data() || {};
        const parsedClassInfo = parseClassDocId(data.classDocId);
        const nextInfoSnapshot = createInfoSnapshot({
          schoolName: data.schoolName ?? parsedClassInfo.schoolName,
          grade: data.grade ?? parsedClassInfo.grade,
          classNum: data.classNum ?? parsedClassInfo.classNum,
          className: data.className || "",
          teacherDisplayName: data.teacherDisplayName || data.teacherName || "",
          currencyUnit: data.currencyUnit || "원",
          missionTokenLabel: resolveMissionTokenLabel(data),
        });
        const nextGeneralSnapshot = normalizeNumberFormatSettings(
          data.numberFormat,
        );

        setSchoolName(nextInfoSnapshot.schoolName);
        setGrade(nextInfoSnapshot.grade);
        setClassNum(nextInfoSnapshot.classNum);
        setClassName(nextInfoSnapshot.className);
        setTeacherDisplayName(nextInfoSnapshot.teacherDisplayName);
        setCurrencyUnit(nextInfoSnapshot.currencyUnit);
        setMissionTokenLabel(nextInfoSnapshot.missionTokenLabel);
        setNumberFormatSettings(nextGeneralSnapshot);
        setNeedsInfoBackfill(
          !(
            String(data.schoolName ?? "").trim() &&
            String(data.grade ?? "").trim() &&
            String(data.classNum ?? "").trim()
          ) &&
            Boolean(
              nextInfoSnapshot.schoolName &&
                nextInfoSnapshot.grade &&
                nextInfoSnapshot.classNum,
            ),
        );

        setSavedTabSnapshots((prev) => ({
          ...prev,
          info: nextInfoSnapshot,
          general: nextGeneralSnapshot,
        }));
      }

      const nextBankSnapshot = normalizeBankMoneyFormatSettings(
        bankSettingsSnap.data()?.moneyFormat,
      );
      const nextStockSnapshot = normalizeStockDisplaySettings(
        stockMarketSnap.data()?.displayFormat,
      );

      setBankMoneyFormatSettings(nextBankSnapshot);
      setStockDisplayFormatSettings(nextStockSnapshot);
      setSavedTabSnapshots((prev) => ({
        ...prev,
        bank: nextBankSnapshot,
        stock: nextStockSnapshot,
      }));
    } catch (_error) {
      showFeedback("학급 설정을 불러오는 중 오류가 발생했습니다.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [classId, getClassDocRefs, showFeedback]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab("info");
    setIsDiscardConfirmOpen(false);
    fetchSettings();
  }, [fetchSettings, isOpen]);

  const handleSave = async () => {
    if (!classId) {
      showFeedback("학급 정보를 찾을 수 없습니다. 다시 시도해주세요.", "error");
      return;
    }

    setIsSaving(true);

    try {
      const { classDocRef, bankSettingsRef, stockMarketRef } = getClassDocRefs();

      if (activeTab === "info") {
        const missingFields = [];

        if (!schoolName.trim()) missingFields.push("학교 이름");
        if (!String(grade).trim()) missingFields.push("학년");
        if (!String(classNum).trim()) missingFields.push("반");
        if (!className.trim()) missingFields.push("학급 이름");

        if (missingFields.length > 0) {
          showFeedback(
            `${missingFields.join(", ")}을(를) 확인해주세요.`,
            "warning",
          );
          return;
        }

        const normalizedSchoolName = normalizeSchoolName(schoolName);
        const normalizedGrade = String(grade).trim();
        const normalizedClassNum = String(classNum).trim();
        const normalizedMissionTokenLabel = normalizeMissionTokenLabel(
          currentInfoSnapshot.missionTokenLabel,
        );
        const combinedClassDocId = buildClassDocId({
          schoolName: normalizedSchoolName,
          grade: normalizedGrade,
          classNum: normalizedClassNum,
        });

        await setDoc(
          classDocRef,
          {
            schoolName: normalizedSchoolName,
            grade: normalizedGrade,
            classNum: normalizedClassNum,
            classDocId: combinedClassDocId,
            className: currentInfoSnapshot.className,
            teacherDisplayName: currentInfoSnapshot.teacherDisplayName,
            teacherName: currentInfoSnapshot.teacherDisplayName,
            currencyUnit: currentInfoSnapshot.currencyUnit,
            missionTokenLabel: normalizedMissionTokenLabel,
            updatedAt: new Date(),
          },
          { merge: true },
        );

        setMissionTokenLabel(normalizedMissionTokenLabel);
        setSavedTabSnapshots((prev) => ({
          ...prev,
          info: {
            ...currentInfoSnapshot,
            missionTokenLabel: normalizedMissionTokenLabel,
          },
        }));
        setNeedsInfoBackfill(false);
        showFeedback("기본 정보가 저장되었습니다.", "success");
        return;
      }

      if (activeTab === "general") {
        await setDoc(
          classDocRef,
          {
            numberFormat: currentGeneralSnapshot,
            updatedAt: new Date(),
          },
          { merge: true },
        );

        setSavedTabSnapshots((prev) => ({
          ...prev,
          general: currentGeneralSnapshot,
        }));
        setFormatSettings(currentGeneralSnapshot);
        showFeedback("일반 숫자 설정이 저장되었습니다.", "success");
        return;
      }

      if (activeTab === "bank") {
        await setDoc(
          bankSettingsRef,
          {
            moneyFormat: currentBankSnapshot,
            updatedAt: new Date(),
          },
          { merge: true },
        );

        setSavedTabSnapshots((prev) => ({
          ...prev,
          bank: currentBankSnapshot,
        }));
        showFeedback("은행 숫자 설정이 저장되었습니다.", "success");
        return;
      }

      if (activeTab === "stock") {
        await setDoc(
          stockMarketRef,
          {
            displayFormat: currentStockSnapshot,
            updatedAt: new Date(),
          },
          { merge: true },
        );

        setSavedTabSnapshots((prev) => ({
          ...prev,
          stock: currentStockSnapshot,
        }));
        showFeedback("주식 숫자 설정이 저장되었습니다.", "success");
      }
    } catch (_error) {
      showFeedback("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const renderInfoTab = () => (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <AcademicCapIcon className="h-5 w-5 text-indigo-600" />
          학급 체계 정보
        </h3>

        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-5">
          <div className="space-y-1.5 md:col-span-2">
            <label className="ml-1 text-xs font-bold text-slate-500">
              학교 이름
            </label>
            <div className="flex shadow-sm">
              <input
                type="text"
                value={schoolName}
                onChange={(event) => setSchoolName(event.target.value)}
                placeholder="학교명"
                className="flex-1 rounded-l-xl border border-blue-200 bg-slate-50 p-2.5 text-sm outline-none transition-all focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="inline-flex items-center rounded-r-xl border border-l-0 border-slate-300 bg-slate-100 px-3 text-xs font-bold text-slate-600">
                초등학교
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 text-xs font-bold text-slate-500">
              학년
            </label>
            <input
              type="number"
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
              placeholder="6"
              className="w-full rounded-xl border border-blue-200 bg-slate-50 p-2.5 text-sm outline-none transition-all focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 text-xs font-bold text-slate-500">
              반
            </label>
            <input
              type="number"
              value={classNum}
              onChange={(event) => setClassNum(event.target.value)}
              placeholder="3"
              className="w-full rounded-xl border border-blue-200 bg-slate-50 p-2.5 text-sm outline-none transition-all focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 text-xs font-bold text-slate-500">
              선생님 이름
            </label>
            <InputField
              value={teacherDisplayName}
              onChange={(event) => setTeacherDisplayName(event.target.value)}
              placeholder="선생님"
              className="bg-slate-50"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4" data-tour="admin-class-operation">
        <h3 className="flex items-center gap-2 border-t pt-6 text-sm font-bold text-slate-900">
          <CurrencyDollarIcon className="h-5 w-5 text-emerald-600" />
          학급 운영 정보
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="ml-1 text-xs font-bold text-slate-500">
              학급 이름
            </label>
            <InputField
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="6학년 행복반"
              className="bg-slate-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 text-xs font-bold text-slate-500">
              학급 화폐 단위
            </label>
            <InputField
              value={currencyUnit}
              onChange={(event) => setCurrencyUnit(event.target.value)}
              placeholder="예: 원, 코인"
              className="bg-slate-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 text-xs font-bold text-slate-500">
              토큰 표시 이름
            </label>
            <InputField
              value={missionTokenLabel}
              onChange={(event) => setMissionTokenLabel(event.target.value)}
              placeholder="예: 배움토큰"
              className="bg-slate-50"
            />
          </div>
        </div>
      </section>
    </div>
  );

  const renderGeneralNumberTab = () => (
    <div
      className="space-y-4"
      data-tour="admin-number-format"
    >
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <HashtagIcon className="h-5 w-5 text-blue-600" />
        일반 숫자·금액 표시 방식
      </h3>

      <p className="text-xs text-slate-500">일반 화면의 잔액·가격·합계에도 적용됩니다. 은행·주식은 각 전용 설정을 따르며, 표시 설정은 실제 계산·저장 금액을 바꾸지 않습니다.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GENERAL_NUMBER_OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition-all ${
              numberFormatSettings.largeNumberDisplay === option.id
                ? "border-indigo-500 bg-indigo-50"
                : "border-slate-100 hover:bg-slate-50"
            }`}
          >
            <input
              type="radio"
              name="largeDisplay"
              checked={numberFormatSettings.largeNumberDisplay === option.id}
              onChange={() =>
                setNumberFormatSettings((prev) => ({
                  ...prev,
                  largeNumberDisplay: option.id,
                }))
              }
              className="h-4 w-4 accent-indigo-600"
            />
            <div>
              <div className="text-xs font-bold text-slate-900">
                {option.label}
              </div>
              <div className="text-[10px] text-slate-500">
                {option.sub}
              </div>
            </div>
          </label>
        ))}
      </div>

      <SectionCard
        title="큰 숫자 축약 표기"
        description="예: 15,000 -> 1.5만 / 250,000,000 -> 2.5억"
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="text-xs font-bold text-slate-600">
            일반 화면에 숫자 축약 표기를 적용합니다.
          </div>
          <ToggleSwitch
            id="compact-number-format"
            checked={numberFormatSettings.useCompactNotation !== false}
            onChange={(checked) =>
              setNumberFormatSettings((prev) => ({
                ...prev,
                useCompactNotation: checked,
              }))
            }
            label={
              numberFormatSettings.useCompactNotation !== false
                ? "사용"
                : "사용 안 함"
            }
            srLabel="큰 숫자 축약 표기"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="1 미만 소수 표시"
        description="0.xxx 형태의 작은 숫자와 금액을 몇 자리까지 보여줄지 정합니다."
      >
        <select
          value={numberFormatSettings.smallDecimalPlaces}
          onChange={(event) =>
            setNumberFormatSettings((prev) => ({
              ...prev,
              smallDecimalPlaces: Number(event.target.value),
            }))
          }
          className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value={0}>정수 (0)</option>
          <option value={1}>1자리 (0.x)</option>
          <option value={2}>2자리 (0.xx)</option>
          <option value={3}>3자리 (0.xxx)</option>
        </select>
      </SectionCard>
    </div>
  );

  const renderBankNumberTab = () => (
    <div
      className="space-y-4"
      data-tour="admin-bank-money-format"
    >
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <BanknotesIcon className="h-5 w-5 text-emerald-600" />
        은행 금액 표시 방식
      </h3>

      <SectionCard
        title="은행 기본 소수 자리"
        description="예금 이자, 만기 수령, 대출 상환, 은행 상세 금액에 적용됩니다."
      >
        <select
          value={bankMoneyFormatSettings.fractionDigits}
          onChange={(event) =>
            setBankMoneyFormatSettings((prev) => ({
              ...prev,
              fractionDigits: Number(event.target.value),
            }))
          }
          className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {FRACTION_DIGIT_OPTIONS.slice(0, 4).map((value) => (
            <option key={value} value={value}>
              {value}자리
            </option>
          ))}
        </select>
      </SectionCard>

      <SectionCard
        title="아주 작은 금액 별도 표시"
        description={`현재 자리수로 0처럼 보이는 값은 ${
          bankMoneyFormatSettings.fractionDigits > 0
            ? `<0.${"0".repeat(
                Math.max(0, bankMoneyFormatSettings.fractionDigits - 1),
              )}1`
            : "<1"
        } 처럼 표시할 수 있습니다.`}
      >
        <div className="flex justify-end">
          <ToggleSwitch
            checked={bankMoneyFormatSettings.showLessThanThreshold !== false}
            onChange={(checked) =>
              setBankMoneyFormatSettings((prev) => ({
                ...prev,
                showLessThanThreshold: checked,
              }))
            }
            label={
              bankMoneyFormatSettings.showLessThanThreshold !== false
                ? "사용"
                : "사용 안 함"
            }
            srLabel="아주 작은 금액 별도 표시"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="끝자리 0 표시"
        description="은행 금액은 끝자리 0을 항상 숨기도록 고정되어 있습니다. 예: 1.20 -> 1.2"
      />
    </div>
  );

  const renderStockNumberTab = () => (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <ChartBarIcon className="h-5 w-5 text-violet-600" />
        주식 숫자 표시 방식
      </h3>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
        <div className="mb-4">
          <div className="text-xs font-bold text-slate-700">
            주식 전용 표시 설정
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            주식 탭, 포트폴리오, 매수·매도 견적, 환전 화면에만 적용됩니다.
            끝자리 0 숨기기는 항상 적용됩니다.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {STOCK_DIGIT_FIELDS.map(({ key, label, description }) => (
            <SectionCard
              key={key}
              title={label}
              description={description}
            >
              <select
                value={stockDisplayFormatSettings[key]}
                onChange={(event) =>
                  setStockDisplayFormatSettings((prev) => ({
                    ...prev,
                    [key]: Number(event.target.value),
                  }))
                }
                className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-violet-500"
              >
                {FRACTION_DIGIT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}자리
                  </option>
                ))}
              </select>
            </SectionCard>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {STOCK_TOGGLE_FIELDS.map(({ key, label, description }) => (
            <label
              key={key}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-700">
                  {label}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {description}
                </div>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={stockDisplayFormatSettings[key]}
                onChange={(event) =>
                  setStockDisplayFormatSettings((prev) => ({
                    ...prev,
                    [key]: event.target.checked,
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const renderActiveTab = () => {
    if (activeTab === "general") return renderGeneralNumberTab();
    if (activeTab === "bank") return renderBankNumberTab();
    if (activeTab === "stock") return renderStockNumberTab();
    return renderInfoTab();
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="학급 기본 설정"
      icon={Cog6ToothIcon}
      size="2xl"
    >
      <div className="space-y-6 px-1 py-1">
        <SurfaceLoader
          loading={isLoading}
          minHeightClassName="min-h-[28rem]"
          className="rounded-3xl"
          skeleton={
            <div className="space-y-4 p-1">
              <CardSkeleton bare className="min-h-[5.5rem]" />
              <CardSkeleton bare className="min-h-[20rem]" />
            </div>
          }
        >
          <div className="min-w-0 space-y-6">
            <div className="sticky top-0 z-10 -mx-1 border-b border-slate-200 bg-white/95 px-2 pt-2 backdrop-blur">
              <Tabs ariaLabel="학급 기본 설정 업무" idPrefix="class-settings" tabs={TAB_ITEMS.map(tab=>({...tab,label:<><span>{tab.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tabStatusMap[tab.id]?.isDirty || tabStatusMap[tab.id]?.needsBackfill ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{tabStatusMap[tab.id]?.isDirty ? "저장 필요" : tabStatusMap[tab.id]?.needsBackfill ? "정보 보완 필요" : "저장됨"}</span></>}))} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="md" />
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-[11px]">
                <span className="text-slate-500">
                  저장 버튼은 현재 보고 있는 탭의 내용만 저장합니다.
                </span>
                <span
                  className={
                    activeTabStatus.isDirty || activeTabStatus.needsBackfill
                      ? "font-bold text-amber-600"
                      : "font-bold text-emerald-600"
                  }
                >
                  {activeTabStatus.isDirty
                    ? "이 탭에 저장되지 않은 변경이 있습니다."
                    : activeTabStatus.needsBackfill
                      ? "기존 학급 정보에서 학교·학년·반을 가져왔습니다. 확인 후 저장해 주세요."
                      : "이 탭은 저장된 상태입니다."}
                </span>
              </div>
            </div>

            {renderActiveTab()}
          </div>
        </SurfaceLoader>

        <div className="flex justify-end gap-3 border-t pt-6">
          <Button variant="secondary" onClick={handleClose} disabled={isSaving}>
            취소
          </Button>
          <Button size="md"
            color="blue"
            onClick={handleSave}
            disabled={isLoading || isSaving || !(activeTabStatus.isDirty || activeTabStatus.needsBackfill)}
            isLoading={isSaving}
            
            data-tour="admin-settings-save"
          >
            {activeTabStatus.isDirty || activeTabStatus.needsBackfill ? "현재 탭 저장" : "저장됨"}
          </Button>
        </div>
      </div>
    </Modal>
    <Modal
      isOpen={isOpen && isDiscardConfirmOpen}
      onClose={() => setIsDiscardConfirmOpen(false)}
      title="저장하지 않고 닫을까요?"
      size="sm"
    >
      <p className="text-sm leading-6 text-slate-600">아래 변경 내용은 저장되지 않았습니다.</p>
      <ul className="my-4 space-y-2 text-sm text-slate-800">
        {unsavedChanges.map((tab) => <li key={tab.id}><strong>{tab.label}</strong>: {tab.fields.join(", ")}</li>)}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setIsDiscardConfirmOpen(false)}>계속 수정</Button>
        <Button color="red" onClick={() => { setIsDiscardConfirmOpen(false); onClose(); }}>저장 없이 닫기</Button>
      </div>
    </Modal>
    </>
  );
}
