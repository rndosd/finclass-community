import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { db, functions } from '../../../firebase';
import { getTaxBillOverdueDays, isTaxBillOverdue } from '../../../utils/taxBillUtils';
import {
  addCalendarDaysInKST,
  endOfDayInKST,
  formatDateInKST,
  formatDateKeyInKST,
  parseDateKeyAsKST,
  startOfDayInKST,
  toDate,
} from '../../../utils/kstDate';
import {
  DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS,
  MAX_HOLDING_TAX_PERIOD_DAYS,
  buildHoldingTaxPeriod,
  buildMissingHoldingTaxRanges,
  calculateDeskHoldingTaxPreview,
  formatDateRangeLabel,
  formatHoldingStartedAt,
  getDefaultHoldingTaxSelection,
  getDeskStatus,
  getHoldingDays,
  getStudentLabel,
  isBillPaid,
} from './HoldingTaxStatusTab.utils';
import { toViewerLayoutGroups } from '../utils/deskSummary';

const getHoldingStatusBillSortMs = (bill) =>
  toDate(bill?.issuedAt)?.getTime() || toDate(bill?.dueDate)?.getTime() || 0;

const selectHoldingStatusBill = (summary, periodKey) => {
  if (!summary || typeof summary !== 'object') return null;

  const overdueBill = summary.overdueBill || null;
  if (overdueBill) return overdueBill;

  const billsByPeriod =
    summary.billsByPeriod && typeof summary.billsByPeriod === 'object'
      ? summary.billsByPeriod
      : {};
  const periodBill = periodKey ? billsByPeriod[periodKey] || null : null;

  if (!periodBill) return null;
  return {
    ...periodBill,
    periodKey: periodBill.periodKey || periodKey,
  };
};

export function useHoldingTaxStatusTabController({
  classId,
  layoutData,
  configData,
  students = [],
  enableBillDetails = true,
}) {
  const {
    showFeedback
  } = useFeedback();

  const [isIssuing, setIsIssuing] = useState(false);

  const [isBillsReady, setIsBillsReady] = useState(false);

  const [isRunsReady, setIsRunsReady] = useState(false);

  const [holdingTaxStatusByStudent, setHoldingTaxStatusByStudent] = useState(new Map());

  const [holdingTaxRuns, setHoldingTaxRuns] = useState([]);

  const [selectedDeskId, setSelectedDeskId] = useState(null);

  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);

  const [periodStartKey, setPeriodStartKey] = useState('');

  const [periodEndKey, setPeriodEndKey] = useState('');

  const [dueDateKey, setDueDateKey] = useState('');

  const isSystemEnabled = configData?.enabled !== false;

  const holdingTaxEnabled = configData?.holdingTaxEnabled === true;

  const holdingTaxRate = Number.isFinite(Number(configData?.holdingTaxRate)) ? Number(configData.holdingTaxRate) : 0;

  const holdingTaxCutoverAt = useMemo(() => startOfDayInKST(configData?.holdingTaxCutoverAt || new Date()) || startOfDayInKST(new Date()), [configData?.holdingTaxCutoverAt]);

  const defaultHoldingTaxSelection = useMemo(() => getDefaultHoldingTaxSelection(holdingTaxCutoverAt), [holdingTaxCutoverAt]);

  const todayStart = useMemo(() => startOfDayInKST(new Date()) || new Date(), []);

  const todayKey = useMemo(() => formatDateKeyInKST(todayStart), [todayStart]);

  const cutoverKey = useMemo(() => formatDateKeyInKST(holdingTaxCutoverAt), [holdingTaxCutoverAt]);

  useEffect(() => {
    const parsedStart = parseDateKeyAsKST(periodStartKey);
    if (!periodStartKey || !parsedStart || parsedStart.getTime() < holdingTaxCutoverAt.getTime()) {
      setPeriodStartKey(defaultHoldingTaxSelection.periodStartKey);
    }
    if (!periodEndKey) {
      setPeriodEndKey(defaultHoldingTaxSelection.periodEndKey);
    }
    if (!dueDateKey) {
      setDueDateKey(defaultHoldingTaxSelection.dueDateKey);
    }
  }, [defaultHoldingTaxSelection, dueDateKey, holdingTaxCutoverAt, periodEndKey, periodStartKey]);

  const selectedPeriod = useMemo(() => {
    const periodStartDate = parseDateKeyAsKST(periodStartKey) || parseDateKeyAsKST(defaultHoldingTaxSelection.periodStartKey) || holdingTaxCutoverAt;
    const periodEndDate = parseDateKeyAsKST(periodEndKey) || periodStartDate;
    return buildHoldingTaxPeriod(periodStartDate, periodEndDate);
  }, [defaultHoldingTaxSelection.periodStartKey, holdingTaxCutoverAt, periodEndKey, periodStartKey]);

  const selectedDueDate = useMemo(() => {
    const parsedDueDate = parseDateKeyAsKST(dueDateKey);
    const fallbackDueDate = addCalendarDaysInKST(selectedPeriod.periodEnd, DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS) || selectedPeriod.periodEnd;
    return endOfDayInKST(parsedDueDate || fallbackDueDate);
  }, [dueDateKey, selectedPeriod.periodEnd]);

  const holdingTaxCutoverLabel = useMemo(() => formatDateInKST(holdingTaxCutoverAt), [holdingTaxCutoverAt]);

  const periodValidationMessage = useMemo(() => {
    if (!selectedPeriod.periodStart || !selectedPeriod.periodEnd) {
      return '과세 기간을 확인해 주세요.';
    }
    if (selectedPeriod.periodStart.getTime() < holdingTaxCutoverAt.getTime()) {
      return `과세 시작일은 ${holdingTaxCutoverLabel} 이후로 설정해 주세요.`;
    }
    if (selectedPeriod.periodEnd.getTime() < selectedPeriod.periodStart.getTime()) {
      return '과세 종료일은 시작일보다 빠를 수 없습니다.';
    }
    if (selectedPeriod.periodEnd.getTime() > todayStart.getTime()) {
      return '미래 날짜는 과세 종료일로 선택할 수 없습니다.';
    }
    if (selectedPeriod.periodDays > MAX_HOLDING_TAX_PERIOD_DAYS) {
      return '과세 기간은 최대 28일까지 설정할 수 있습니다.';
    }
    if (!selectedDueDate) {
      return '납부 기한을 확인해 주세요.';
    }
    const periodEndBoundary = endOfDayInKST(selectedPeriod.periodEnd);
    if (periodEndBoundary && selectedDueDate.getTime() < periodEndBoundary.getTime()) {
      return '납부 기한은 과세 종료일보다 빠를 수 없습니다.';
    }
    return null;
  }, [holdingTaxCutoverAt, holdingTaxCutoverLabel, selectedDueDate, selectedPeriod, todayStart]);

  const acquisitionTaxRate = configData?.acquisitionTaxEnabled === false ? 0 : Number.isFinite(Number(configData?.acquisitionTaxRate)) ? Number(configData.acquisitionTaxRate) : 0;

  const capitalGainsTaxRate = configData?.capitalGainsTaxEnabled === false ? 0 : Number.isFinite(Number(configData?.capitalGainsTaxRate)) ? Number(configData.capitalGainsTaxRate) : 0;

  const rentLimitEnabled = configData?.rentLimitEnabled !== false;

  const rentLimitRate = Number.isFinite(Number(configData?.rentLimitRate)) ? Number(configData.rentLimitRate) : 0;

  const officialPriceRatio = Number.isFinite(Number(configData?.officialPriceRatio)) ? Number(configData.officialPriceRatio) : 70;

  const saleTemplate = typeof configData?.saleTemplate === 'string' ? configData.saleTemplate : '';

  const saleSpecialTerms = typeof configData?.saleSpecialTerms === 'string' ? configData.saleSpecialTerms : '';

  useEffect(() => {
    if (!enableBillDetails || !classId) {
      setHoldingTaxStatusByStudent(new Map());
      setIsBillsReady(!enableBillDetails);
      return undefined;
    }

    setIsBillsReady(false);

    const statusQuery = query(
      collection(db, `classes/${classId}/real_estate/holding_tax_status/byStudent`),
    );
    const unsubscribe = onSnapshot(statusQuery, snapshot => {
      const nextMap = new Map();

      snapshot.docs.forEach(docSnapshot => {
        nextMap.set(docSnapshot.id, docSnapshot.data() || {});
      });

      setHoldingTaxStatusByStudent(nextMap);
      setIsBillsReady(true);
    }, error => {
      console.error('[HoldingTaxStatusTab] summary subscribe failed:', error);
      setHoldingTaxStatusByStudent(new Map());
      setIsBillsReady(true);
    });
    return () => unsubscribe();
  }, [classId, enableBillDetails]);

  const currentBillsByStudent = useMemo(() => {
    const nextMap = new Map();

    holdingTaxStatusByStudent.forEach((summary, studentUid) => {
      const bill = selectHoldingStatusBill(summary, selectedPeriod.periodKey);
      if (!bill) return;

      const existing = nextMap.get(studentUid);
      if (!existing || getHoldingStatusBillSortMs(bill) >= getHoldingStatusBillSortMs(existing)) {
        nextMap.set(studentUid, bill);
      }
    });

    return nextMap;
  }, [holdingTaxStatusByStudent, selectedPeriod.periodKey]);

  useEffect(() => {
    if (!classId) {
      setHoldingTaxRuns([]);
      setIsRunsReady(true);
      return undefined;
    }
    setIsRunsReady(false);
    const runsQuery = query(collection(db, `classes/${classId}/real_estate/holding_tax_runs/runs`), orderBy('periodStart', 'asc'));
    const unsubscribe = onSnapshot(runsQuery, snapshot => {
      setHoldingTaxRuns(snapshot.docs.map(docSnapshot => ({
        id: docSnapshot.id,
        ...docSnapshot.data()
      })));
      setIsRunsReady(true);
    }, error => {
      console.error('[HoldingTaxStatusTab] runs subscribe failed:', error);
      setHoldingTaxRuns([]);
      setIsRunsReady(true);
    });
    return () => unsubscribe();
  }, [classId]);

  const missingIssuedRanges = useMemo(() => buildMissingHoldingTaxRanges({
    runs: holdingTaxRuns,
    cutoverAt: holdingTaxCutoverAt,
    todayAt: todayStart
  }), [holdingTaxCutoverAt, holdingTaxRuns, todayStart]);

  const firstMissingIssuedRange = missingIssuedRanges[0] || null;

  const missingIssuedRangeSummary = useMemo(() => {
    if (!firstMissingIssuedRange) return '';
    const extraCount = Math.max(0, missingIssuedRanges.length - 1);
    return extraCount > 0 ? `${firstMissingIssuedRange.label} / ${firstMissingIssuedRange.days}일 / 추가 ${extraCount}개 구간` : `${firstMissingIssuedRange.label} / ${firstMissingIssuedRange.days}일`;
  }, [firstMissingIssuedRange, missingIssuedRanges.length]);

  const hasMissingIssuedRanges = isSystemEnabled && holdingTaxEnabled && isRunsReady && missingIssuedRanges.length > 0;

  const studentMap = useMemo(() => {
    const nextMap = new Map();
    (students || []).forEach(student => nextMap.set(student.uid, student));
    return nextMap;
  }, [students]);

  const summaryGroups = useMemo(
    () => toViewerLayoutGroups(layoutData?.groups),
    [layoutData?.groups],
  );

  const groups = useMemo(() => {
    return summaryGroups.map(group => ({
      ...group,
      desks: (group?.desks || []).map(desk => {
        const hasOwner = Boolean(desk?.ownerId);
        const preview = hasOwner ? calculateDeskHoldingTaxPreview({
          desk,
          holdingTaxRate,
          cutoverAt: holdingTaxCutoverAt,
          periodStart: selectedPeriod.periodStart,
          periodEnd: selectedPeriod.periodEnd
        }) : {
          officialPrice: Math.max(0, Number(desk?.price || 0)),
          ownerSinceAt: null,
          taxableStartAt: null,
          holdingDaysInPeriod: 0,
          expectedTax: 0
        };
        const bill = enableBillDetails && hasOwner ? currentBillsByStudent.get(desk.ownerId) || null : null;
        const billIsOverdue = bill ? isTaxBillOverdue(bill) : false;
        const billOverdueDays = bill ? getTaxBillOverdueDays(bill) : 0;
        const holdingDays = hasOwner ? getHoldingDays(preview.ownerSinceAt) : null;
        const ownerStudent = hasOwner ? studentMap.get(desk.ownerId) : null;
        const ownerName = hasOwner ? desk?.ownerName || getStudentLabel(ownerStudent) : '국가';
        const occupantName = desk?.studentId ? desk.studentName || '이름 없음' : '공실';
        return {
          ...desk,
          ownerNameResolved: ownerName,
          occupantNameResolved: occupantName,
          officialPrice: preview.officialPrice,
          expectedTax: preview.expectedTax,
          taxableHoldingDays: preview.holdingDaysInPeriod,
          taxableStartedAt: preview.taxableStartAt,
          taxableStartedLabel: hasOwner ? formatHoldingStartedAt(preview.taxableStartAt) : '-',
          bill,
          billIsOverdue,
          billOverdueDays,
          holdingDays,
          holdingStartedAt: preview.ownerSinceAt || null,
          holdingStartedLabel: hasOwner ? formatHoldingStartedAt(preview.ownerSinceAt) : '-',
          status: getDeskStatus({
            isSystemEnabled,
            holdingTaxEnabled,
            expectedTax: preview.expectedTax,
            bill,
            hasOwner,
            isOverdue: billIsOverdue,
            showBillState: enableBillDetails
          })
        };
      })
    }));
  }, [currentBillsByStudent, enableBillDetails, holdingTaxCutoverAt, holdingTaxEnabled, holdingTaxRate, isSystemEnabled, selectedPeriod.periodEnd, selectedPeriod.periodStart, studentMap, summaryGroups]);

  const ownedDeskMap = useMemo(() => {
    const nextMap = new Map();
    groups.forEach(group => {
      (group?.desks || []).forEach(desk => {
        if (desk?.isActive === false || !desk?.ownerId) return;
        if (!nextMap.has(desk.ownerId)) nextMap.set(desk.ownerId, []);
        nextMap.get(desk.ownerId).push(desk);
      });
    });
    return nextMap;
  }, [groups]);

  const rows = useMemo(() => {
    return (students || []).map(student => {
      const ownedDesks = ownedDeskMap.get(student.uid) || [];
      const totalOfficialPrice = ownedDesks.reduce((sum, desk) => sum + desk.officialPrice, 0);
      const expectedTax = ownedDesks.reduce((sum, desk) => sum + desk.expectedTax, 0);
      const holdingDaysList = ownedDesks.map(desk => desk.holdingDays).filter(value => Number.isFinite(value));
      const longestHoldingDays = holdingDaysList.length > 0 ? Math.max(...holdingDaysList) : null;
      const shortestHoldingDays = holdingDaysList.length > 0 ? Math.min(...holdingDaysList) : null;
      const bill = enableBillDetails ? currentBillsByStudent.get(student.uid) || null : null;
      const isOverdue = bill ? isTaxBillOverdue(bill) : false;
      const overdueDays = bill ? getTaxBillOverdueDays(bill) : 0;
      return {
        studentUid: student.uid,
        studentName: getStudentLabel(student),
        deskCount: ownedDesks.length,
        totalOfficialPrice,
        expectedTax,
        bill,
        isOverdue,
        overdueDays,
        status: getDeskStatus({
          isSystemEnabled,
          holdingTaxEnabled,
          expectedTax,
          bill,
          hasOwner: ownedDesks.length > 0,
          isOverdue,
          showBillState: enableBillDetails
        }),
        longestHoldingDays,
        shortestHoldingDays
      };
    }).sort((a, b) => {
      if (Number(b.isOverdue) !== Number(a.isOverdue)) return Number(b.isOverdue) - Number(a.isOverdue);
      if (b.expectedTax !== a.expectedTax) return b.expectedTax - a.expectedTax;
      return a.studentName.localeCompare(b.studentName, 'ko-KR');
    });
  }, [currentBillsByStudent, enableBillDetails, holdingTaxEnabled, isSystemEnabled, ownedDeskMap, students]);

  const summary = useMemo(() => {
    const taxableRows = rows.filter(row => row.expectedTax > 0);
    const issuedRows = taxableRows.filter(row => Boolean(row.bill));
    const pendingRows = issuedRows.filter(row => row.bill && !isBillPaid(row.bill) && !row.isOverdue);
    const overdueRows = issuedRows.filter(row => row.isOverdue);
    return {
      ownerCount: rows.filter(row => row.deskCount > 0).length,
      taxableCount: taxableRows.length,
      totalOfficialPrice: rows.reduce((sum, row) => sum + row.totalOfficialPrice, 0),
      totalExpectedTax: rows.reduce((sum, row) => sum + row.expectedTax, 0),
      issuedCount: issuedRows.length,
      pendingCount: pendingRows.length,
      overdueCount: overdueRows.length
    };
  }, [rows]);

  const spotlightRows = useMemo(() => rows.filter(row => row.deskCount > 0).slice(0, 3), [rows]);

  const allVisibleDesks = useMemo(() => groups.flatMap(group => group.desks || []).filter(desk => desk?.isActive !== false), [groups]);

  useEffect(() => {
    if (allVisibleDesks.length === 0) {
      setSelectedDeskId(null);
      return;
    }
    if (allVisibleDesks.some(desk => desk.id === selectedDeskId)) return;
    const defaultDesk = allVisibleDesks.find(desk => desk.ownerId) || allVisibleDesks[0] || null;
    setSelectedDeskId(defaultDesk?.id || null);
  }, [allVisibleDesks, selectedDeskId]);

  const selectedDesk = useMemo(() => allVisibleDesks.find(desk => desk.id === selectedDeskId) || null, [allVisibleDesks, selectedDeskId]);

  const handleDeskCardClick = desk => {
    if (!desk) return;
    if (selectedDeskId === desk.id) {
      setIsTradeModalOpen(true);
      return;
    }
    setSelectedDeskId(desk.id);
  };

  const handleOpenSelectedDesk = () => {
    if (selectedDesk) setIsTradeModalOpen(true);
  };

  const handleApplyMissingRange = () => {
    if (!firstMissingIssuedRange) return;
    setPeriodStartKey(formatDateKeyInKST(firstMissingIssuedRange.start));
    setPeriodEndKey(formatDateKeyInKST(firstMissingIssuedRange.end));
    const suggestedDueDate = addCalendarDaysInKST(firstMissingIssuedRange.end, DEFAULT_HOLDING_TAX_DUE_OFFSET_DAYS) || firstMissingIssuedRange.end;
    setDueDateKey(formatDateKeyInKST(suggestedDueDate));
    showFeedback(`${formatDateRangeLabel(firstMissingIssuedRange.start, firstMissingIssuedRange.end)} \uB204\uB77D \uAE30\uAC04\uC744 \uBC1C\uAE09 \uAD6C\uAC04\uC73C\uB85C \uCC44\uC6E0\uC2B5\uB2C8\uB2E4.`, 'info');
  };

  const handleIssueBills = async () => {
    if (!classId || isIssuing || !isSystemEnabled || !holdingTaxEnabled) return;
    if (periodValidationMessage) {
      showFeedback(periodValidationMessage, 'warning');
      return;
    }
    setIsIssuing(true);
    try {
      const issueRealEstateHoldingTaxBills = httpsCallable(functions, 'issueRealEstateHoldingTaxBills');
      const result = await issueRealEstateHoldingTaxBills({
        classId,
        periodStart: periodStartKey,
        periodEnd: periodEndKey,
        dueDate: dueDateKey
      });
      const payload = result.data || {};
      const issuedCount = Number(payload.issuedCount || 0);
      const existingCount = Number(payload.existingCount || 0);
      const skippedCount = Number(payload.skippedCount || 0);
      if (issuedCount > 0) showFeedback(`${selectedPeriod.label} 보유세 고지서 ${issuedCount}건을 발급했습니다.`, 'success');else if (existingCount > 0) showFeedback(`${selectedPeriod.label} 보유세는 이미 발급되어 있습니다.`, 'info');else if (skippedCount > 0) showFeedback('과세 대상이 없어 발급할 보유세가 없습니다.', 'info');else showFeedback('발급할 보유세가 없습니다.', 'info');
    } catch (error) {
      console.error('[HoldingTaxStatusTab] issue failed:', error);
      showFeedback(error.details || error.message || '\uBCF4\uC720\uC138 \uACE0\uC9C0\uC11C \uBC1C\uAE09 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    } finally {
      setIsIssuing(false);
    }
  };

  const selectedDeskBillIssuedAt = selectedDesk?.bill?.issuedAt ? formatDateInKST(selectedDesk.bill.issuedAt) : '미발급';

  const selectedDeskBillDueAt = selectedDesk?.bill?.dueDate ? formatDateInKST(selectedDesk.bill.dueDate) : '-';

  const selectedDueDateLabel = selectedDueDate ? formatDateInKST(selectedDueDate) : '-';

  return {
    acquisitionTaxRate,
    capitalGainsTaxRate,
    cutoverKey,
    dueDateKey,
    groups,
    handleApplyMissingRange,
    handleDeskCardClick,
    handleIssueBills,
    handleOpenSelectedDesk,
    hasMissingIssuedRanges,
    holdingTaxCutoverLabel,
    holdingTaxEnabled,
    holdingTaxRate,
    isBillDetailsEnabled: enableBillDetails,
    isBillsReady,
    isIssuing,
    isSystemEnabled,
    isTradeModalOpen,
    missingIssuedRangeSummary,
    officialPriceRatio,
    periodEndKey,
    periodStartKey,
    periodValidationMessage,
    rentLimitEnabled,
    rentLimitRate,
    rows,
    saleTemplate,
    saleSpecialTerms,
    selectedDesk,
    selectedDeskBillDueAt,
    selectedDeskBillIssuedAt,
    selectedDeskId,
    selectedDueDateLabel,
    selectedPeriod,
    setDueDateKey,
    setIsTradeModalOpen,
    setPeriodEndKey,
    setPeriodStartKey,
    spotlightRows,
    summary,
    todayKey,
  };
}
