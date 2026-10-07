import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db } from "../../../firebase";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { createFinancialRequestTracker } from "../../../utils/financialRequests";

const HISTORY_LIMIT = 100;
const createPurchaseRequestTracker = () => createFinancialRequestTracker({
  // Maintenance can intervene after an earlier request already committed.
  retainRequestOnError: (error) => error?.details?.reason === "class-maintenance",
});

const normalizeMarketplacePrice = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
};

const normalizeMarketplaceStock = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.trunc(num));
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const sortItemsForStatus = (items, statusFilter) => {
  const list = [...items];

  switch (statusFilter) {
    case "active":
      return list.sort(
        (a, b) =>
          toMillis(b.createdAt || b.approvedAt) -
          toMillis(a.createdAt || a.approvedAt),
      );
    case "sold":
      return list.sort(
        (a, b) =>
          toMillis(b.soldAt || b.createdAt) - toMillis(a.soldAt || a.createdAt),
      );
    case "rejected":
      return list.sort(
        (a, b) =>
          toMillis(b.rejectedAt || b.createdAt) -
          toMillis(a.rejectedAt || a.createdAt),
      );
    case "pending":
    default:
      return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }
};

const buildMarketplaceQuery = (itemsRef, requestedStatus) => {
  switch (requestedStatus) {
    case "sold":
      return query(itemsRef, where("status", "==", "sold"), limit(HISTORY_LIMIT));
    case "pending":
      return query(itemsRef, where("status", "==", "pending"), limit(HISTORY_LIMIT));
    case "rejected":
      return query(
        itemsRef,
        where("status", "==", "rejected"),
        limit(HISTORY_LIMIT),
      );
    case "active":
    default:
      return query(itemsRef, where("status", "==", "active"));
  }
};

export const useMarketplace = ({
  enabled = true,
  pendingApprovalsEnabled = false,
  statusFilter = "active",
  autoApproveEnabled = false,
} = {}) => {
  const { userData, classId, classData, isTeacher, hasPermission } = useUser();
  const { showFeedback } = useFeedback();
  const purchaseRequestsRef = useRef(createPurchaseRequestTracker());

  useEffect(() => {
    purchaseRequestsRef.current = createPurchaseRequestTracker();
  }, [classId, userData?.uid]);
  const [items, setItems] = useState([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [pendingApprovalItems, setPendingApprovalItems] = useState([]);
  const [isPendingApprovalListReady, setIsPendingApprovalListReady] = useState(false);
  const [processingApprovalItemId, setProcessingApprovalItemId] = useState("");
  const [loading, setLoading] = useState(true);

  const isMarketplaceAdmin = hasPermission("marketplace_admin") || isTeacher;
  const functions = getFunctions(undefined, "asia-northeast3");

  useEffect(() => {
    if (!enabled || !classId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const itemsRef = collection(db, "classes", classId, "marketplace");
    const unsubscribe = onSnapshot(
      buildMarketplaceQuery(itemsRef, statusFilter),
      (snapshot) => {
        const itemsData = sortItemsForStatus(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })),
          statusFilter,
        );
        setItems(itemsData);
        setLoading(false);
      },
      (error) => {
        console.error("[useMarketplace] snapshot error:", error);
        setItems([]);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, enabled, statusFilter]);

  useEffect(() => {
    if (!pendingApprovalsEnabled || !classId || !isMarketplaceAdmin) {
      setPendingApprovalCount(0);
      setPendingApprovalItems([]);
      setIsPendingApprovalListReady(false);
      return;
    }

    setIsPendingApprovalListReady(false);
    const itemsRef = collection(db, "classes", classId, "marketplace");
    const unsubscribe = onSnapshot(
      query(itemsRef, where("status", "==", "pending"), limit(HISTORY_LIMIT)),
      (snapshot) => {
        const nextItems = sortItemsForStatus(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })),
          "pending",
        );
        setPendingApprovalCount(snapshot.size);
        setPendingApprovalItems(nextItems);
        setIsPendingApprovalListReady(true);
      },
      (error) => {
        console.error("[useMarketplace] pending approval snapshot error:", error);
        setPendingApprovalCount(0);
        setPendingApprovalItems([]);
        setIsPendingApprovalListReady(true);
      },
    );

    return () => unsubscribe();
  }, [classId, isMarketplaceAdmin, pendingApprovalsEnabled]);

  const submitItem = async (itemData) => {
    try {
      const itemsRef = collection(db, "classes", classId, "marketplace");
      const shouldAutoApprove =
        Boolean(isMarketplaceAdmin) || Boolean(autoApproveEnabled);

      await addDoc(itemsRef, {
        ...itemData,
        itemIcon: String(itemData?.itemIcon || "auto").trim() || "auto",
        price: normalizeMarketplacePrice(itemData?.price),
        stock: normalizeMarketplaceStock(itemData?.stock),
        initialStock: normalizeMarketplaceStock(itemData?.stock),
        soldQuantity: 0,
        sellerId: userData.uid,
        sellerName: userData.name,
        approved: shouldAutoApprove,
        status: shouldAutoApprove ? "active" : "pending",
        approvedAt: shouldAutoApprove ? serverTimestamp() : null,
        approvedBy: shouldAutoApprove
          ? isMarketplaceAdmin
            ? userData.uid
            : "system_auto"
          : null,
        createdAt: serverTimestamp(),
      });

      showFeedback(
        shouldAutoApprove
          ? "물건이 바로 등록되었습니다."
          : "물건이 등록되었습니다. 승인 후 목록에 표시됩니다.",
        "success",
      );
      return true;
    } catch (error) {
      console.error("[useMarketplace] submit item failed:", error);
      showFeedback("물건 등록 중 오류가 발생했습니다.", "error");
      return false;
    }
  };

  const updateItem = async (itemId, itemData) => {
    if (!classId || !itemId || !isMarketplaceAdmin) {
      showFeedback("중고시장 상품을 수정할 권한이 없습니다.", "error");
      return false;
    }

    try {
      const itemRef = doc(db, "classes", classId, "marketplace", itemId);
      await updateDoc(itemRef, {
        title: String(itemData?.title || "").trim(),
        description: String(itemData?.description || "").trim(),
        category: itemData?.category || "",
        itemIcon: String(itemData?.itemIcon || "auto").trim() || "auto",
        price: normalizeMarketplacePrice(itemData?.price),
        stock: normalizeMarketplaceStock(itemData?.stock),
        updatedAt: serverTimestamp(),
        updatedBy: userData.uid,
        updatedByName: userData.name || null,
      });

      showFeedback("중고시장 상품 정보가 수정되었습니다.", "success");
      return true;
    } catch (error) {
      console.error("[useMarketplace] update item failed:", error);
      showFeedback("중고시장 상품 수정 중 오류가 발생했습니다.", "error");
      return false;
    }
  };

  const approveItem = async (
    itemId,
    approved = true,
    reason = "",
    options = {},
  ) => {
    const { silent = false } = options;
    setProcessingApprovalItemId(itemId || "");

    try {
      const approveFunction = httpsCallable(functions, "approveMarketplaceItem");
      const result = await approveFunction({
        itemId,
        classId,
        approved,
        reason,
      });

      const message = result?.data?.message || "";
      if (!silent && message) {
        showFeedback(message, "success");
      }
      return { ok: true, message };
    } catch (error) {
      console.error("[useMarketplace] approve item failed:", error);
      const message =
        error?.message ||
        (approved ? "승인 처리에 실패했습니다." : "반려 처리에 실패했습니다.");
      if (!silent) {
        showFeedback(message, "error");
      }
      return { ok: false, message };
    } finally {
      setProcessingApprovalItemId("");
    }
  };

  const purchaseItem = async (item) => {
    if (!userData || userData.uid === item.sellerId) return;

    try {
      const purchaseFunction = httpsCallable(functions, "purchaseMarketplaceItem");
      const itemId = item.id;
      const result = await purchaseRequestsRef.current.run(itemId, async (clientRequestId) => {
        const response = await purchaseFunction({ itemId, classId, clientRequestId });
        return response.data;
      });

      showFeedback(result.message, "success");
    } catch (error) {
      console.error("[useMarketplace] purchase item failed:", error);
      showFeedback(error.message || "구매 처리에 실패했습니다.", "error");
    }
  };

  const deleteItem = async (itemId) => {
    if (!classId || !itemId) {
      throw new Error("삭제할 항목 정보가 없습니다.");
    }

    try {
      const itemToDelete = items.find((item) => item.id === itemId);
      if (!itemToDelete) {
        throw new Error("삭제할 물건을 찾을 수 없습니다.");
      }

      const isOwner = userData?.uid === itemToDelete.sellerId;
      const isSold = itemToDelete.status === "sold";

      if (!((isOwner && !isSold) || isMarketplaceAdmin)) {
        throw new Error("삭제 권한이 없습니다.");
      }

      const itemRef = doc(db, "classes", classId, "marketplace", itemId);
      await deleteDoc(itemRef);
      return true;
    } catch (error) {
      console.error("[useMarketplace] delete item failed:", error);
      throw error;
    }
  };

  const markSaleAlertsAsSeen = useCallback(async () => {
    if (!classId || !userData?.uid || isMarketplaceAdmin) {
      return;
    }

    try {
      const markSeenFunction = httpsCallable(
        functions,
        "markMarketplaceSaleAlertsSeen",
      );
      await markSeenFunction({ classId });
    } catch (error) {
      console.error("[useMarketplace] mark sale alerts as seen failed:", error);
    }
  }, [classId, functions, isMarketplaceAdmin, userData?.uid]);

  return {
    items,
    loading,
    pendingApprovalCount,
    pendingApprovalItems,
    isPendingApprovalListReady,
    processingApprovalItemId,
    userData,
    classData,
    isTeacher,
    submitItem,
    updateItem,
    approveItem,
    purchaseItem,
    deleteItem,
    markSaleAlertsAsSeen,
  };
};
