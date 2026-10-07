import { appConfirm } from "../../../utils/appDialogs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import useStorePosQueue from "../hooks/useStorePosQueue";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import {
  getFundChannelAccess,
  getFundsAllowedForChannel,
} from "../../../domain/classFunds/fundPolicy";
import { getStoreCurrencyUnit, normalizeStoreCurrencyType } from "../utils/storeCurrency";
import { beginFirestoreSubscriptionDebug } from "../../../utils/firestoreSubscriptionDebug";
export function useStorePosModalController({
  isOpen,
  classId,
  students,
  items,
  classFunds = [],
  fundPaymentOnly = false,
  fixedFundId = "",
  onExecutePurchase,
  currencyUnit
}) {
  const { missionTokenLabel, isTeacher } = useUser();
  const BATCH_PREVIEW_LIMIT = 3;
  const createBatchDragState = () => ({
    active: false,
    shouldSelect: true,
    visitedUids: new Set()
  });
  const buildCartWithItem = (studentCart = [], item) => {
    const existing = studentCart.find(queuedItem => queuedItem.id === item.id);
    if (existing) {
      return studentCart.map(queuedItem => queuedItem.id === item.id ? {
        ...queuedItem,
        quantity: Number(queuedItem.quantity || 0) + 1
      } : queuedItem);
    }
    return [...studentCart, {
      ...item,
      quantity: 1
    }];
  };
  const formatSelectedStudentPreview = (students = []) => {
    if (students.length === 0) return "";
    const names = students.slice(0, BATCH_PREVIEW_LIMIT).map(student => student?.name || "학생").filter(Boolean);
    if (students.length <= BATCH_PREVIEW_LIMIT) {
      return names.join(", ");
    }
    return `${names.join(", ")} 외 ${students.length - BATCH_PREVIEW_LIMIT}명`;
  };
  const {
    formatClassCurrency
  } = useNumberFormat();
  const {
    showFeedback
  } = useFeedback();
  const {
    queue,
    updateQueue,
    clearQueue
  } = useStorePosQueue(classId, {
    enabled: isOpen,
    debug: {
      source: "Store.posQueue",
      role: isTeacher ? "teacher" : "delegated",
    },
  });
  const [activeUid, setActiveUid] = useState(null);
  const [batchSelectedUids, setBatchSelectedUids] = useState([]);
  const [selectionMode, setSelectionMode] = useState("single");
  const [studentSearch, setStudentSearch] = useState("");
  const [isImmediate, setIsImmediate] = useState(true);
  const [transactionType, setTransactionType] = useState("purchase");
  const [configSession, setConfigSession] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [settingsRetry, setSettingsRetry] = useState(0);
  const settingsReady = isOpen && configSession?.classId === classId && configSession?.fundPaymentOnly === fundPaymentOnly;
  const [recordAsTaxExpense, setRecordAsTaxExpense] = useState(false);
  const [paymentSource, setPaymentSource] = useState(() => fundPaymentOnly ? "classFund" : "student");
  const [selectedFundId, setSelectedFundId] = useState(fixedFundId);
  const batchDragRef = useRef(createBatchDragState());
  const availableClassFunds = useMemo(
    () => getFundsAllowedForChannel(
      classFunds.filter(fund => !fixedFundId || fund.id === fixedFundId),
      "storePurchase",
    ),
    [classFunds, fixedFundId],
  );
  const selectedFund = useMemo(
    () =>
      availableClassFunds.find(fund => fund.id === selectedFundId) ||
      availableClassFunds[0] ||
      null,
    [availableClassFunds, selectedFundId],
  );
  const isFundPayment = transactionType !== "gift" && paymentSource === "classFund";
  const selectedFundBalance = Number(selectedFund?.cashBalance || 0);
  useEffect(() => {
    if (!isOpen || !classId) return undefined;
    setConfigSession(null);
    setSettingsError("");
    let initialized = false;
    let active = true;
    const configRef = doc(db, `classes/${classId}/storeSettings/posConfig`);
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "Store.posConfig",
      pathKey: "classes/{classId}/storeSettings/posConfig",
      classId,
      role: isTeacher ? "teacher" : "delegated",
    });
    const unsubscribe = onSnapshot(configRef, snap => {
      subscriptionDebug.recordSnapshot(snap);
      // Resolve the saved mode once per opening; remote edits must not change an active sale.
      if (!active || initialized) return;
      initialized = true;
      const config = snap.exists() ? snap.data() : {};
      setIsImmediate(config.isImmediate ?? true);
      const nextTransactionType = fundPaymentOnly ? "purchase" : config.transactionType === "gift" ? "gift" : "purchase";
      setTransactionType(nextTransactionType);
      setRecordAsTaxExpense(!!config.recordAsTaxExpense);
      setConfigSession({ classId, fundPaymentOnly });
    }, () => {
      if (!active || initialized) return;
      setSettingsError("POS 설정을 불러오지 못했습니다. 다시 시도해 주세요.");
    });
    return () => {
      active = false;
      unsubscribe();
      subscriptionDebug.stop();
      setConfigSession(null);
    };
  }, [isOpen, classId, fundPaymentOnly, isTeacher, settingsRetry]);
  const handleModeToggle = async mode => {
    if (!settingsReady) return;
    setIsImmediate(mode);
    try {
      const configRef = doc(db, `classes/${classId}/storeSettings/posConfig`);
      await setDoc(configRef, {
        isImmediate: mode
      }, {
        merge: true
      });
    } catch (error) {
      console.error("POS 설정 저장 중 오류가 발생했습니다:", error);
    }
  };
  const handleTransactionTypeToggle = async nextType => {
    if (!settingsReady) return;
    const normalized = nextType === "gift" ? "gift" : "purchase";
    if (fundPaymentOnly && normalized === "gift") {
      showFeedback("기금 결제 권한에서는 무료 지급을 사용할 수 없습니다.", "warning");
      return;
    }
    setTransactionType(normalized);
    if (normalized !== "gift") {
      setRecordAsTaxExpense(false);
    } else {
      setPaymentSource("student");
    }
    try {
      const configRef = doc(db, `classes/${classId}/storeSettings/posConfig`);
      await setDoc(configRef, {
        transactionType: normalized,
        ...(normalized !== "gift" ? {
          recordAsTaxExpense: false
        } : {})
      }, {
        merge: true
      });
    } catch (error) {
      console.error("POS 거래 모드 저장 중 오류가 발생했습니다:", error);
    }
  };
  const handlePaymentSourceChange = useCallback(nextSource => {
    const normalized = nextSource === "classFund" ? "classFund" : "student";
    if (fundPaymentOnly && normalized !== "classFund") {
      setPaymentSource("classFund");
      return;
    }
    if (transactionType === "gift") {
      setPaymentSource("student");
      return;
    }
    if (normalized === "classFund" && availableClassFunds.length === 0) {
      showFeedback("상점 사용처가 연결된 기금이 없습니다.", "warning");
      return;
    }
    setPaymentSource(normalized);
    if (normalized === "classFund" && !selectedFundId) {
      setSelectedFundId(availableClassFunds[0]?.id || "");
    }
  }, [
    availableClassFunds,
    fundPaymentOnly,
    selectedFundId,
    showFeedback,
    transactionType,
  ]);
  useEffect(() => {
    if (fundPaymentOnly) {
      setPaymentSource("classFund");
      if (!availableClassFunds.length) {
        setSelectedFundId("");
        return;
      }
      setSelectedFundId(fixedFundId || availableClassFunds[0]?.id || "");
      return;
    }
    if (transactionType === "gift") {
      setPaymentSource("student");
      return;
    }
    if (!availableClassFunds.length) {
      setPaymentSource("student");
      setSelectedFundId("");
      return;
    }
    setSelectedFundId(current =>
      availableClassFunds.some(fund => fund.id === current)
        ? current
        : availableClassFunds[0]?.id || "",
    );
  }, [availableClassFunds, fixedFundId, fundPaymentOnly, transactionType]);
  const handleTaxExpenseToggle = async checked => {
    setRecordAsTaxExpense(checked);
    try {
      const configRef = doc(db, `classes/${classId}/storeSettings/posConfig`);
      await setDoc(configRef, {
        recordAsTaxExpense: checked
      }, {
        merge: true
      });
    } catch (error) {
      console.error("POS 국고 지출 옵션 저장 중 오류가 발생했습니다:", error);
    }
  };
  useEffect(() => {
    if (!isOpen) {
      setActiveUid(null);
      setBatchSelectedUids([]);
      setSelectionMode("single");
      setStudentSearch("");
      batchDragRef.current = createBatchDragState();
    }
  }, [isOpen]);
  useEffect(() => {
    const validUidSet = new Set(students.map(student => student.uid));
    setBatchSelectedUids(current => current.filter(uid => validUidSet.has(uid)));
    setActiveUid(current => current && validUidSet.has(current) ? current : null);
  }, [students]);
  const studentMap = useMemo(() => new Map(students.map(student => [student.uid, student])), [students]);
  const displayStudents = useMemo(() => students.filter(student => {
    const keyword = studentSearch.trim();
    if (!keyword) return true;
    const name = String(student?.name ?? "");
    const studentNumber = String(student?.studentNumber ?? "");
    return name.includes(keyword) || studentNumber.includes(keyword);
  }), [studentSearch, students]);
  const displayStudentUids = useMemo(() => displayStudents.map(student => student.uid), [displayStudents]);
  const isMultiSelectMode = selectionMode === "multi";
  const batchSelectedUidSet = useMemo(() => new Set(batchSelectedUids), [batchSelectedUids]);
  const batchSelectedStudents = useMemo(() => batchSelectedUids.map(uid => studentMap.get(uid)).filter(Boolean), [batchSelectedUids, studentMap]);
  const batchSelectedPreview = useMemo(() => formatSelectedStudentPreview(batchSelectedStudents), [batchSelectedStudents]);
  const allDisplayedSelected = useMemo(() => displayStudentUids.length > 0 && displayStudentUids.every(uid => batchSelectedUidSet.has(uid)), [batchSelectedUidSet, displayStudentUids]);
  const posAvailableItems = useMemo(() => items, [items]);
  const itemMap = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const mergeLatestItem = useCallback(queuedItem => ({
    ...queuedItem,
    ...(itemMap.get(queuedItem.id) || {})
  }), [itemMap]);
  const rawCurrentCart = useMemo(() => queue[activeUid] || [], [queue, activeUid]);
  const currentCart = useMemo(() => rawCurrentCart.map(item => mergeLatestItem(item)), [mergeLatestItem, rawCurrentCart]);
  const activeStudent = useMemo(() => studentMap.get(activeUid) || null, [studentMap, activeUid]);
  const activeStudentName = activeStudent?.name || "학생";
  const activeQueueByCurrency = useMemo(() => currentCart.reduce((accumulator, item) => {
    const type = normalizeStoreCurrencyType(item?.currencyType);
    const amount = (Number(item?.effectivePrice ?? item?.price ?? 0) || 0) * (Number(item?.quantity) || 0);
    accumulator[type] = Number(accumulator[type] || 0) + amount;
    return accumulator;
  }, {}), [currentCart]);
  const queueStudentCount = useMemo(() => Object.keys(queue).filter(uid => Array.isArray(queue[uid]) && queue[uid].length > 0).length, [queue]);
  const getStudentBalanceByCurrency = useCallback((studentUid, currencyType) => {
    const student = studentMap.get(studentUid);
    if (!student) return 0;
    const field = normalizeStoreCurrencyType(currencyType);
    return Number(student.assets?.[field] ?? 0);
  }, [studentMap]);
  const getQueuedAmountByCurrency = useCallback((studentUid, currencyType, targetQueue = queue) => (targetQueue?.[studentUid] || []).reduce((sum, queuedItem) => {
    const latestItem = mergeLatestItem(queuedItem);
    if (normalizeStoreCurrencyType(latestItem?.currencyType) !== currencyType) {
      return sum;
    }
    return sum + (Number(latestItem?.effectivePrice ?? latestItem?.price ?? 0) || 0) * (Number(queuedItem?.quantity) || 0);
  }, 0), [mergeLatestItem, queue]);
  const getTotalQueuedAmount = useCallback((targetQueue = queue) => Object.values(targetQueue).flat().reduce((sum, queuedItem) => {
    const latestItem = mergeLatestItem(queuedItem);
    return sum + (Number(latestItem?.effectivePrice ?? latestItem?.price ?? 0) || 0) * (Number(queuedItem?.quantity) || 0);
  }, 0), [mergeLatestItem, queue]);
  const canAddItemWithFund = useCallback((item, addQuantity = 1, targetQueue = queue) => {
    if (!isFundPayment) return true;
    if (!selectedFund) {
      showFeedback("기금 결제에 사용할 기금을 선택해 주세요.", "warning");
      return false;
    }
    if (normalizeStoreCurrencyType(item?.currencyType) !== "cash") {
      showFeedback("기금 결제는 일반 화폐 상품에만 사용할 수 있습니다.", "warning");
      return false;
    }
    const addAmount = (Number(item?.effectivePrice ?? item?.price ?? 0) || 0) * addQuantity;
    const nextAmount = getTotalQueuedAmount(targetQueue) + addAmount;
    const access = getFundChannelAccess(selectedFund, "storePurchase", {
      amount: nextAmount,
    });
    if (!access.allowed) {
      showFeedback(access.reason, "warning");
      return false;
    }
    return true;
  }, [
    getTotalQueuedAmount,
    isFundPayment,
    queue,
    selectedFund,
    showFeedback,
  ]);
  const getQueuedQuantityByItem = useCallback((itemId, targetQueue = queue) => Object.values(targetQueue).reduce((sum, studentCart) => {
    if (!Array.isArray(studentCart)) return sum;
    return sum + studentCart.reduce((cartSum, queuedItem) => {
      if (queuedItem.id !== itemId) return cartSum;
      return cartSum + (Number(queuedItem.quantity) || 0);
    }, 0);
  }, 0), [queue]);
  const getRemainingStock = useCallback((item, targetQueue = queue) => {
    const stock = Number(item?.stock);
    if (stock === -1) return Number.POSITIVE_INFINITY;
    if (!Number.isFinite(stock)) return 0;
    return stock - getQueuedQuantityByItem(item?.id, targetQueue);
  }, [getQueuedQuantityByItem, queue]);
  const setBatchStudentSelection = useCallback((uid, shouldSelect) => {
    setBatchSelectedUids(current => {
      const nextSet = new Set(current);
      if (shouldSelect) nextSet.add(uid);else nextSet.delete(uid);
      return Array.from(nextSet);
    });
    if (shouldSelect) {
      setActiveUid(current => current || uid);
    }
  }, []);
  const toggleAllDisplayedStudents = useCallback(() => {
    if (displayStudentUids.length === 0) return;
    setBatchSelectedUids(current => {
      const nextSet = new Set(current);
      const shouldSelect = displayStudentUids.some(uid => !nextSet.has(uid));
      displayStudentUids.forEach(uid => {
        if (shouldSelect) nextSet.add(uid);else nextSet.delete(uid);
      });
      return Array.from(nextSet);
    });
    setActiveUid(current => current || displayStudentUids[0] || null);
  }, [displayStudentUids]);
  const stopBatchDragSelection = useCallback(() => {
    batchDragRef.current = createBatchDragState();
  }, []);
  const handleSelectionModeChange = useCallback(mode => {
    stopBatchDragSelection();
    setSelectionMode(mode);
    if (mode === "single") {
      setActiveUid(current => current || batchSelectedUids[0] || displayStudentUids[0] || null);
    }
  }, [batchSelectedUids, displayStudentUids, stopBatchDragSelection]);
  const handleStudentRowClick = useCallback(uid => {
    if (isMultiSelectMode) return;
    setActiveUid(uid);
  }, [isMultiSelectMode]);
  const handleBatchRowPointerDown = useCallback((event, uid, isSelected) => {
    if (!isMultiSelectMode) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const shouldSelect = !isSelected;
    batchDragRef.current = {
      active: true,
      shouldSelect,
      visitedUids: new Set([uid])
    };
    setBatchStudentSelection(uid, shouldSelect);
  }, [isMultiSelectMode, setBatchStudentSelection]);
  const handleBatchRowPointerEnter = useCallback(uid => {
    if (!isMultiSelectMode) return;
    const dragState = batchDragRef.current;
    if (!dragState.active || dragState.visitedUids.has(uid)) return;
    dragState.visitedUids.add(uid);
    setBatchStudentSelection(uid, dragState.shouldSelect);
  }, [isMultiSelectMode, setBatchStudentSelection]);
  useEffect(() => {
    if (!isMultiSelectMode) {
      stopBatchDragSelection();
    }
  }, [isMultiSelectMode, stopBatchDragSelection]);
  useEffect(() => {
    window.addEventListener("pointerup", stopBatchDragSelection);
    window.addEventListener("pointercancel", stopBatchDragSelection);
    return () => {
      window.removeEventListener("pointerup", stopBatchDragSelection);
      window.removeEventListener("pointercancel", stopBatchDragSelection);
    };
  }, [stopBatchDragSelection]);
  const addSingleToCart = async item => {
    if (!activeUid) {
      showFeedback("학생을 먼저 선택해 주세요.", "warning");
      return;
    }
    const remainingStock = getRemainingStock(item);
    if (remainingStock < 1) {
      showFeedback(`'${item.name}' 상품 재고가 부족해 더 담을 수 없습니다.`, "warning");
      return;
    }
    if (!canAddItemWithFund(item)) return;
    if (transactionType !== "gift" && !isFundPayment) {
      const currencyType = normalizeStoreCurrencyType(item?.currencyType);
      const unit = getStoreCurrencyUnit(
        currencyType,
        currencyUnit,
        missionTokenLabel,
      );
      const itemPrice = Number(item?.effectivePrice ?? item?.price ?? 0);
      const queuedAmount = Number(activeQueueByCurrency[currencyType] || 0);
      const balance = getStudentBalanceByCurrency(activeUid, currencyType);
      if (queuedAmount + itemPrice > balance) {
        const shortage = queuedAmount + itemPrice - balance;
        showFeedback(`${activeStudentName}의 ${unit} 잔액이 부족합니다. (${formatClassCurrency(shortage)} ${unit} 부족)`, "warning");
        return;
      }
    }
    await updateQueue({
      ...queue,
      [activeUid]: buildCartWithItem(queue[activeUid] || [], item)
    });
  };
  const addBatchToCart = async item => {
    if (batchSelectedUids.length === 0) {
      showFeedback("다중 담기할 학생을 먼저 선택해 주세요.", "warning");
      return;
    }
    const currencyType = normalizeStoreCurrencyType(item?.currencyType);
    const unit = getStoreCurrencyUnit(
      currencyType,
      currencyUnit,
      missionTokenLabel,
    );
    const itemPrice = Number(item?.effectivePrice ?? item?.price ?? 0);
    const eligibleUids = [];
    const skippedStudents = [];
    batchSelectedUids.forEach(uid => {
      const student = studentMap.get(uid);
      if (!student) return;
      if (transactionType !== "gift" && !isFundPayment) {
        const queuedAmount = getQueuedAmountByCurrency(uid, currencyType, queue);
        const balance = getStudentBalanceByCurrency(uid, currencyType);
        if (queuedAmount + itemPrice > balance) {
          skippedStudents.push(student);
          return;
        }
      }
      eligibleUids.push(uid);
    });
    if (!canAddItemWithFund(item, eligibleUids.length)) return;
    if (eligibleUids.length === 0) {
      showFeedback(transactionType === "gift" ? "선택한 학생 정보를 확인할 수 없습니다." : `선택한 학생 모두 ${unit} 잔액이 부족해 담지 못했습니다.`, "warning");
      return;
    }
    const remainingStock = getRemainingStock(item);
    if (remainingStock < eligibleUids.length) {
      showFeedback(`'${item.name}' 상품 재고가 부족합니다. 남은 재고 ${Math.max(remainingStock, 0)}개로는 선택한 ${eligibleUids.length}명에게 동시에 담을 수 없습니다.`, "warning");
      return;
    }
    const nextQueue = {
      ...queue
    };
    eligibleUids.forEach(uid => {
      nextQueue[uid] = buildCartWithItem(nextQueue[uid] || [], item);
    });
    await updateQueue(nextQueue);
    setActiveUid(current => current || eligibleUids[0] || null);
    if (skippedStudents.length > 0) {
      showFeedback(`'${item.name}' 상품을 ${eligibleUids.length}명에게 담았고, ${skippedStudents.length}명은 ${unit} 잔액 부족으로 제외했습니다.`, "warning");
      return;
    }
    showFeedback(`'${item.name}' 상품을 선택한 ${eligibleUids.length}명에게 동시에 담았습니다.`, "success");
  };
  const updateCartQty = async (itemId, delta) => {
    if (!activeUid || delta === 0) return;
    const studentCart = queue[activeUid] || [];
    const targetQueuedItem = studentCart.find(item => item.id === itemId);
    if (!targetQueuedItem) return;
    if (delta > 0) {
      const targetItem = currentCart.find(item => item.id === itemId);
      if (!targetItem) return;
      const remainingStock = getRemainingStock(targetItem);
      if (remainingStock < delta) {
        showFeedback(`'${targetItem.name}' 상품 재고가 부족해 더 담을 수 없습니다.`, "warning");
        return;
      }
      if (!canAddItemWithFund(targetItem)) return;
      if (transactionType !== "gift" && !isFundPayment) {
        const currencyType = normalizeStoreCurrencyType(targetItem?.currencyType);
        const unit = getStoreCurrencyUnit(
          currencyType,
          currencyUnit,
          missionTokenLabel,
        );
        const queuedAmount = Number(activeQueueByCurrency[currencyType] || 0);
        const balance = getStudentBalanceByCurrency(activeUid, currencyType);
        const addCost = Number(targetItem?.effectivePrice ?? targetItem?.price ?? 0);
        if (queuedAmount + addCost > balance) {
          const shortage = queuedAmount + addCost - balance;
          showFeedback(`${activeStudentName}의 ${unit} 잔액이 부족합니다. (${formatClassCurrency(shortage)} ${unit} 부족)`, "warning");
          return;
        }
      }
    }
    const nextQuantity = Number(targetQueuedItem.quantity || 0) + delta;
    if (nextQuantity <= 0) {
      await removeFromCart(itemId);
      return;
    }
    const nextCart = studentCart.map(item => item.id === itemId ? {
      ...item,
      quantity: nextQuantity
    } : item);
    await updateQueue({
      ...queue,
      [activeUid]: nextCart
    });
  };
  const removeFromCart = async itemId => {
    if (!activeUid) return;
    const nextQueue = {
      ...queue
    };
    nextQueue[activeUid] = (queue[activeUid] || []).filter(item => item.id !== itemId);
    if (nextQueue[activeUid].length === 0) delete nextQueue[activeUid];
    await updateQueue(nextQueue);
  };
  const clearActiveStudentCart = async () => {
    if (!activeUid || currentCart.length === 0) return;
    const confirmed = (await appConfirm(`${activeStudentName} 학생 장바구니를 모두 비울까요?`));
    if (!confirmed) return;
    const nextQueue = {
      ...queue
    };
    delete nextQueue[activeUid];
    await updateQueue(nextQueue);
    showFeedback(`${activeStudentName} 학생 장바구니를 비웠습니다.`, "success");
  };
  const clearAllStudentCarts = async () => {
    if (queueStudentCount === 0) return;
    const confirmed = (await appConfirm("모든 학생의 장바구니를 모두 비울까요?"));
    if (!confirmed) return;
    await clearQueue();
    showFeedback("모든 학생 장바구니를 비웠습니다.", "success");
  };
  const handleFinalExecute = async () => {
    if (!settingsReady) {
      showFeedback("POS 설정을 확인한 뒤 실행해 주세요.", "warning");
      return;
    }
    const uidsToPay = Object.keys(queue).filter(uid => Array.isArray(queue[uid]) && queue[uid].length > 0);
    if (uidsToPay.length === 0) return;
    if (isFundPayment) {
      if (!selectedFund) {
        showFeedback("기금 결제에 사용할 기금을 선택해 주세요.", "warning");
        return;
      }
      const access = getFundChannelAccess(selectedFund, "storePurchase", {
        amount: totalQueueAmount,
      });
      if (!access.allowed) {
        showFeedback(access.reason, "warning");
        return;
      }
    }
    const remainingQueue = {
      ...queue
    };
    const failedUids = [];
    for (const uid of uidsToPay) {
      const success = await onExecutePurchase(uid, queue[uid], {
        isImmediate,
        transactionType,
        recordAsTaxExpense,
        classFundId: isFundPayment ? selectedFund?.id || "" : ""
      });
      if (success) delete remainingQueue[uid];else failedUids.push(uid);
    }
    if (failedUids.length === 0) {
      await clearQueue();
      setActiveUid(currentUid => currentUid || batchSelectedUids[0] || null);
      return;
    }
    await updateQueue(remainingQueue);
    setActiveUid(currentUid => currentUid && failedUids.includes(currentUid) ? currentUid : failedUids[0]);
    showFeedback(failedUids.length === uidsToPay.length ? "POS 처리에 실패했습니다. 장바구니를 유지했습니다." : `일부 학생 처리에 실패했습니다. ${failedUids.length}명의 장바구니를 유지했습니다.`, "warning");
  };
  const totalQueueByCurrency = useMemo(() => Object.values(queue).flat().reduce((accumulator, queuedItem) => {
    const latestItem = mergeLatestItem(queuedItem);
    const type = normalizeStoreCurrencyType(latestItem?.currencyType);
    const amount = (Number(latestItem?.effectivePrice ?? latestItem?.price ?? 0) || 0) * (Number(queuedItem?.quantity) || 0);
    accumulator[type] = Number(accumulator[type] || 0) + amount;
    return accumulator;
  }, {}), [mergeLatestItem, queue]);
  const totalQueueAmount = useMemo(() => Object.values(totalQueueByCurrency).reduce((sum, amount) => sum + Number(amount || 0), 0), [totalQueueByCurrency]);
  const batchSelectedCartSummary = useMemo(() => batchSelectedStudents.map(student => {
    const studentCart = (queue[student.uid] || []).map(queuedItem => mergeLatestItem(queuedItem));
    const totalQuantity = studentCart.reduce((sum, queuedItem) => sum + (Number(queuedItem.quantity) || 0), 0);
    return {
      student,
      cartKinds: studentCart.length,
      totalQuantity
    };
  }), [batchSelectedStudents, mergeLatestItem, queue]);
  const batchSelectedQueuedCount = useMemo(() => batchSelectedCartSummary.filter(({
    totalQuantity
  }) => totalQuantity > 0).length, [batchSelectedCartSummary]);
  return {
    formatClassCurrency,
    queue,
    activeUid,
    batchSelectedUids,
    studentSearch,
    setStudentSearch,
    isImmediate,
    transactionType,
    recordAsTaxExpense,
    paymentSource,
    settingsReady,
    settingsError,
    retrySettings: () => setSettingsRetry(value => value + 1),
    selectedFundId: selectedFund?.id || "",
    availableClassFunds,
    selectedFund,
    selectedFundBalance,
    isFundPayment,
    handleModeToggle,
    handleTransactionTypeToggle,
    handleTaxExpenseToggle,
    handlePaymentSourceChange,
    setSelectedFundId,
    displayStudents,
    isMultiSelectMode,
    batchSelectedUidSet,
    batchSelectedPreview,
    allDisplayedSelected,
    posAvailableItems,
    currentCart,
    activeStudentName,
    queueStudentCount,
    getRemainingStock,
    toggleAllDisplayedStudents,
    handleSelectionModeChange,
    handleStudentRowClick,
    handleBatchRowPointerDown,
    handleBatchRowPointerEnter,
    addSingleToCart,
    addBatchToCart,
    updateCartQty,
    removeFromCart,
    clearActiveStudentCart,
    clearAllStudentCarts,
    handleFinalExecute,
    totalQueueByCurrency,
    totalQueueAmount,
    batchSelectedCartSummary,
    batchSelectedQueuedCount
  };
}
