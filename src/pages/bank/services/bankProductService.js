import { db } from "../../../firebase";
import {
  collectionGroup,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

export const BANK_PRODUCT_FIELD_KEY = {
  deposit: "depositProducts",
  loan: "loanProducts",
};

export const normalizeBankProduct = (tab, product = {}) => {
  const hasAllowedStudents =
    Array.isArray(product.allowedStudentUids) &&
    product.allowedStudentUids.length > 0;
  const eligibilityMode =
    product.eligibilityMode === "students" ||
    (product.eligibilityMode === "both" && hasAllowedStudents)
      ? "students"
      : "tier";
  const allowedStudentUids = Array.from(
    new Set(
      (
        eligibilityMode === "students" &&
        Array.isArray(product.allowedStudentUids)
          ? product.allowedStudentUids
          : []
      )
        .map((uid) => String(uid || "").trim())
        .filter(Boolean),
    ),
  );
  const base = {
    id: product.id,
    label: (product.label || "").trim(),
    days: Math.max(1, Number(product.days) || 7),
    active: product.active ?? true,
    eligibilityMode,
    allowedStudentUids,
    minCreditScore:
      eligibilityMode === "tier" &&
      product.minCreditScore !== "" &&
      product.minCreditScore != null
        ? Math.max(0, Number(product.minCreditScore))
        : null,
  };

  if (tab === "deposit") {
    return {
      ...base,
      rate: Math.max(0, Number(product.rate) || 0),
      maxDepositProductLimit:
        product.maxDepositProductLimit !== "" &&
        product.maxDepositProductLimit != null
          ? Number(product.maxDepositProductLimit)
          : null,
      useTierRateAdjustment: product.useTierRateAdjustment !== false,
      earlyTerminationBlocked: product.earlyTerminationBlocked === true,
    };
  }

  return {
    ...base,
    periodRate: Math.max(0, Number(product.periodRate) || 0),
    maxLoanProductLimit:
      product.maxLoanProductLimit !== "" && product.maxLoanProductLimit != null
        ? Number(product.maxLoanProductLimit)
        : null,
    useTierRateAdjustment: product.useTierRateAdjustment !== false,
    overdueRate: Math.max(0, Number(product.overdueRate) || 0),
  };
};

export async function createBankProduct(classId, tab, product) {
  const settingsRef = doc(db, "classes", classId, "bank", "settings");
  const field = BANK_PRODUCT_FIELD_KEY[tab];
  const toCreate = normalizeBankProduct(tab, product);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef);
    const data = snap.exists() ? snap.data() : {};
    const arr = Array.isArray(data[field]) ? data[field] : [];
    if (arr.some((item) => item.id === toCreate.id)) {
      throw new Error("이미 존재하는 상품 ID입니다.");
    }
    tx.set(
      settingsRef,
      { [field]: [...arr, toCreate], updatedAt: serverTimestamp() },
      { merge: true },
    );
  });

  return toCreate.id;
}

export async function upsertBankProduct(classId, tab, product) {
  const settingsRef = doc(db, "classes", classId, "bank", "settings");
  const field = BANK_PRODUCT_FIELD_KEY[tab];
  const toSave = normalizeBankProduct(tab, product);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef);
    const data = snap.exists() ? snap.data() : {};
    const arr = Array.isArray(data[field]) ? data[field] : [];
    const idx = arr.findIndex((item) => item.id === toSave.id);
    const next =
      idx === -1
        ? [...arr, toSave]
        : arr.map((item, index) => (index === idx ? toSave : item));

    tx.set(
      settingsRef,
      { [field]: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}

export async function deleteBankProduct(classId, tab, productId) {
  if (tab === "deposit") {
    const pendingSavingsQuery = query(
      collectionGroup(db, "savings"),
      where("classId", "==", classId),
    );
    const pendingSavingsSnapshot = await getDocs(pendingSavingsQuery);
    const pendingCount = pendingSavingsSnapshot.docs.filter((docSnap) => {
      const data = docSnap.data() || {};
      return (
        String(data.productId || "") === String(productId) &&
        data.status === "pending"
      );
    }).length;

    if (pendingCount > 0) {
      throw new Error(
        `승인 대기 중인 예금 신청 ${pendingCount}건이 있어 삭제할 수 없습니다. 먼저 처리해주세요.`,
      );
    }
  }

  const settingsRef = doc(db, "classes", classId, "bank", "settings");
  const field = BANK_PRODUCT_FIELD_KEY[tab];

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef);
    const data = snap.exists() ? snap.data() : {};
    const arr = Array.isArray(data[field]) ? data[field] : [];
    const next = arr.filter((item) => item.id !== productId);
    tx.set(
      settingsRef,
      { [field]: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}

export async function reorderBankProducts(classId, tab, orderedIds) {
  const settingsRef = doc(db, "classes", classId, "bank", "settings");
  const field = BANK_PRODUCT_FIELD_KEY[tab];
  const normalizedIds = orderedIds.map((id) => String(id));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef);
    const data = snap.exists() ? snap.data() : {};
    const arr = Array.isArray(data[field]) ? data[field] : [];
    const productMap = new Map(arr.map((item) => [String(item.id), item]));
    const reordered = normalizedIds
      .map((id) => productMap.get(id))
      .filter(Boolean);
    const leftovers = arr.filter(
      (item) => !normalizedIds.includes(String(item.id)),
    );

    tx.set(
      settingsRef,
      { [field]: [...reordered, ...leftovers], updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}
