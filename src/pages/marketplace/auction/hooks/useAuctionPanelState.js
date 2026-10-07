import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../../firebase";
import useAuctionItems from "./useAuctionItems";
import {
  approveAuctionItem,
  closeAuction,
  createAuctionItem,
  placeAuctionBid,
} from "../services/auctionService";
import { getAuctionEndAtMs } from "../utils/auctionTiming";

const AUCTION_DEFAULT_FEE_RATE = 5;
const AUCTION_DEFAULT_ANTI_SNIPING_SECONDS = 30;
const AUCTION_MAX_ANTI_SNIPING_SECONDS = 60 * 60;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toNumber = (v, fallback = 0) => {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
};
const normalizeAntiSnipingSeconds = (value) => {
  if (value === null || value === undefined || value === "") {
    return AUCTION_DEFAULT_ANTI_SNIPING_SECONDS;
  }
  const normalized = Math.floor(toNumber(value, AUCTION_DEFAULT_ANTI_SNIPING_SECONDS));
  return clamp(normalized, 0, AUCTION_MAX_ANTI_SNIPING_SECONDS);
};
const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export default function useAuctionPanelState({
  classId,
  userData,
  isMarketplaceAdmin,
  canSettleAuction,
  showFeedback,
  enabled = true,
  pendingApprovalsEnabled = false,
  settingsEnabled = enabled,
}) {
  const [auctionFeeRate, setAuctionFeeRate] = useState(AUCTION_DEFAULT_FEE_RATE);
  const [auctionFeeEnabled, setAuctionFeeEnabled] = useState(true);
  const [auctionAntiSnipingSeconds, setAuctionAntiSnipingSeconds] = useState(
    AUCTION_DEFAULT_ANTI_SNIPING_SECONDS,
  );
  const [showAuctionSettings, setShowAuctionSettings] = useState(false);
  const [isSavingAuctionSettings, setIsSavingAuctionSettings] = useState(false);

  const [showAuctionCreateModal, setShowAuctionCreateModal] = useState(false);
  const [selectedAuctionItem, setSelectedAuctionItem] = useState(null);
  const [showAuctionBidModal, setShowAuctionBidModal] = useState(false);
  const [myPrevHold, setMyPrevHold] = useState(0);
  const [isSubmittingAuctionBid, setIsSubmittingAuctionBid] = useState(false);
  const [isCreatingAuctionItem, setIsCreatingAuctionItem] = useState(false);
  const [closingAuctionId, setClosingAuctionId] = useState("");
  const [auctionStatusFilter, setAuctionStatusFilter] = useState("active");
  const [rejectAuctionTarget, setRejectAuctionTarget] = useState(null);
  const [processingApprovalAuctionId, setProcessingApprovalAuctionId] = useState("");
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [pendingApprovalItems, setPendingApprovalItems] = useState([]);
  const [isPendingApprovalListReady, setIsPendingApprovalListReady] = useState(false);

  const { items: auctionItems, isLoading: isAuctionLoading, error: auctionLoadError } =
    useAuctionItems(classId, auctionStatusFilter, { enabled });

  const canCreateAuction = !!classId && !!userData?.uid;
  const userAuctionHold = Number(userData?.assets?.auctionHold || 0);

  const auctionItemCounts = useMemo(
    () => ({ [auctionStatusFilter]: auctionItems.length }),
    [auctionItems.length, auctionStatusFilter],
  );

  useEffect(() => {
    if (!pendingApprovalsEnabled || !classId || !isMarketplaceAdmin) {
      setPendingApprovalCount(0);
      setPendingApprovalItems([]);
      setIsPendingApprovalListReady(false);
      return;
    }

    const pendingAuctionRef = query(
      collection(db, "classes", classId, "auction"),
      where("status", "==", "pending"),
      limit(100),
    );

    setIsPendingApprovalListReady(false);
    const unsubscribe = onSnapshot(
      pendingAuctionRef,
      (snap) => {
        const nextItems = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setPendingApprovalCount(snap.size);
        setPendingApprovalItems(nextItems);
        setIsPendingApprovalListReady(true);
      },
      (error) => {
        console.error("[useAuctionPanelState] pending approval snapshot error:", error);
        setPendingApprovalCount(0);
        setPendingApprovalItems([]);
        setIsPendingApprovalListReady(true);
      },
    );

    return () => unsubscribe();
  }, [classId, isMarketplaceAdmin, pendingApprovalsEnabled]);

  useEffect(() => {
    if (!settingsEnabled || !classId) return undefined;

    const settingsRef = doc(db, "classes", classId, "auction", "settings");

    const unsub = onSnapshot(
      settingsRef,
      async (snap) => {
        if (!snap.exists()) {
          try {
            await setDoc(
              settingsRef,
              {
                sellerFeeRate: AUCTION_DEFAULT_FEE_RATE,
                feeEnabled: true,
                antiSnipingSeconds: AUCTION_DEFAULT_ANTI_SNIPING_SECONDS,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (e) {
            // Ignore permission failures; UI uses fallback defaults.
          }
          setAuctionFeeRate(AUCTION_DEFAULT_FEE_RATE);
          setAuctionFeeEnabled(true);
          setAuctionAntiSnipingSeconds(AUCTION_DEFAULT_ANTI_SNIPING_SECONDS);
          return;
        }

        const data = snap.data() || {};
        const rate =
          typeof data.sellerFeeRate === "number"
            ? data.sellerFeeRate
            : AUCTION_DEFAULT_FEE_RATE;
        const enabled =
          typeof data.feeEnabled === "boolean" ? data.feeEnabled : true;

        setAuctionFeeRate(rate);
        setAuctionFeeEnabled(enabled);
        setAuctionAntiSnipingSeconds(
          normalizeAntiSnipingSeconds(data.antiSnipingSeconds),
        );
      },
      () => {
        setAuctionFeeRate(AUCTION_DEFAULT_FEE_RATE);
        setAuctionFeeEnabled(true);
        setAuctionAntiSnipingSeconds(AUCTION_DEFAULT_ANTI_SNIPING_SECONDS);
      }
    );

    return () => unsub();
  }, [classId, settingsEnabled]);

  const handleSaveAuctionSettings = useCallback(async () => {
    if (!classId) return;

    if (!isMarketplaceAdmin) {
      showFeedback("경매 수수료 설정 권한이 없습니다.", "error");
      return;
    }

    const clamped = clamp(toNumber(auctionFeeRate, 0), 0, 100);

    setIsSavingAuctionSettings(true);
    try {
      const settingsRef = doc(db, "classes", classId, "auction", "settings");

      await setDoc(
        settingsRef,
        {
          sellerFeeRate: clamped,
          feeEnabled: !!auctionFeeEnabled,
          antiSnipingSeconds: normalizeAntiSnipingSeconds(
            auctionAntiSnipingSeconds,
          ),
          updatedAt: serverTimestamp(),
          updatedBy: {
            uid: userData?.uid || null,
            name: userData?.displayName || userData?.name || null,
          },
        },
        { merge: true }
      );

      showFeedback("경매 설정이 저장되었습니다.", "success");
      setShowAuctionSettings(false);
    } catch (e) {
      console.error("Save auction settings error:", e);
      showFeedback("경매 설정 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSavingAuctionSettings(false);
    }
  }, [
    classId,
    isMarketplaceAdmin,
    auctionFeeRate,
    auctionFeeEnabled,
    auctionAntiSnipingSeconds,
    userData?.uid,
    userData?.displayName,
    userData?.name,
    showFeedback,
  ]);

  const handleOpenAuctionCreate = useCallback(() => {
      if (!canCreateAuction) {
        showFeedback("학급 또는 사용자 정보가 없습니다.", "error");
        return;
      }
    setShowAuctionCreateModal(true);
  }, [canCreateAuction, showFeedback]);

  const handleCreateAuction = useCallback(
    async (payload) => {
      if (!classId) return;
      setIsCreatingAuctionItem(true);
      try {
        const result = await createAuctionItem(classId, payload);
        const pending = result?.status === "pending";
        showFeedback(
          pending
            ? "경매가 등록되었습니다. 선생님의 승인 후 노출됩니다."
            : "경매가 등록되었습니다.",
          "success"
        );
        setShowAuctionCreateModal(false);
      } catch (e) {
        console.error("createAuctionItem error:", e);
        showFeedback(e?.message || "경매 등록 중 오류가 발생했습니다.", "error");
      } finally {
        setIsCreatingAuctionItem(false);
      }
    },
    [classId, showFeedback]
  );

  const handleOpenAuctionBid = useCallback(
    async (item) => {
      if (!classId || !userData?.uid || !item?.id) return;

      if (item.sellerUid === userData.uid) {
        showFeedback("내가 출품한 경매에는 입찰할 수 없습니다.", "error");
        return;
      }
      if (item.auctionType !== "sealed" && item.highestBidUid === userData.uid) {
        showFeedback(
          "현재 최고입찰자입니다. 다른 입찰 후에 다시 입찰할 수 있습니다.",
          "info"
        );
        return;
      }

      const endAtMs = getAuctionEndAtMs(item);
      if (endAtMs > 0 && endAtMs <= Date.now()) {
        showFeedback("마감된 경매입니다. 정산을 진행해 주세요.", "info");
        return;
      }

      let existingHold = 0;
      try {
        const holdRef = doc(
          db,
          "classes",
          classId,
          "auction",
          item.id,
          "holds",
          userData.uid
        );
        const holdSnap = await getDoc(holdRef);
        existingHold = holdSnap.exists()
          ? Number(holdSnap.data()?.holdAmount || 0)
          : 0;
        setMyPrevHold(existingHold);
      } catch (e) {
        console.error("hold read error:", e);
        setMyPrevHold(0);
      }

      if (item.auctionType === "sealed" && existingHold > 0) {
        showFeedback("이미 블라인드 입찰을 제출했습니다.", "info");
        return;
      }

      setSelectedAuctionItem({
        ...item,
        antiSnipingSeconds: normalizeAntiSnipingSeconds(
          item.antiSnipingSeconds ?? auctionAntiSnipingSeconds,
        ),
      });
      setShowAuctionBidModal(true);
    },
    [classId, userData?.uid, auctionAntiSnipingSeconds, showFeedback]
  );

  const handleSubmitAuctionBid = useCallback(
    async (amount) => {
      if (!classId || !selectedAuctionItem?.id) return;
      setIsSubmittingAuctionBid(true);
      try {
        const result = await placeAuctionBid(
          classId,
          selectedAuctionItem.id,
          amount,
        );
        showFeedback(
          result?.sealed
            ? "블라인드 입찰이 접수되었습니다. 마감 전까지 금액은 공개되지 않습니다."
            : result?.extended
            ? `입찰이 완료되어 남은 시간이 ${result.extensionSeconds}초로 재설정되었습니다.`
            : "입찰이 완료되었습니다.",
          "success",
        );
        setShowAuctionBidModal(false);
        setSelectedAuctionItem(null);
        setMyPrevHold(0);
      } catch (e) {
        console.error("placeAuctionBid error:", e);
        showFeedback(e?.message || "입찰 처리 중 오류가 발생했습니다.", "error");
      } finally {
        setIsSubmittingAuctionBid(false);
      }
    },
    [classId, selectedAuctionItem?.id, showFeedback]
  );

  const processAuctionApproval = useCallback(
    async (itemId, approved = true, reason = "", options = {}) => {
      const { silent = false } = options;
      if (!classId || !itemId) {
        return { ok: false, message: "경매 항목 정보가 없습니다." };
      }

      setProcessingApprovalAuctionId(itemId);
      try {
        const res = await approveAuctionItem(classId, itemId, approved, reason);
        const message =
          res?.message ||
          (approved ? "경매장이 승인되었습니다." : "경매장이 반려되었습니다.");
        if (!silent) {
          showFeedback(message, "success");
        }
        return { ok: true, message };
      } catch (e) {
        console.error("approveAuctionItem error:", e);
        const message =
          e?.message ||
          (approved
            ? "경매 승인 처리에 실패했습니다."
            : "경매 반려 처리에 실패했습니다.");
        if (!silent) {
          showFeedback(message, "error");
        }
        return { ok: false, message };
      } finally {
        setProcessingApprovalAuctionId("");
      }
    },
    [classId, showFeedback]
  );

  const handleApproveAuction = useCallback(
    async (itemId) => {
      if (!classId || !itemId) return;
      setProcessingApprovalAuctionId(itemId);
      try {
        const res = await approveAuctionItem(classId, itemId, true);
        showFeedback(res?.message || "경매가 승인되었습니다.", "success");
      } catch (e) {
        console.error("approveAuctionItem error:", e);
        showFeedback(e?.message || "경매 승인 중 오류가 발생했습니다.", "error");
      } finally {
        setProcessingApprovalAuctionId("");
      }
    },
    [classId, showFeedback]
  );

  const handleRejectAuction = useCallback((item) => {
    if (!item?.id) return;
    setRejectAuctionTarget(item);
  }, []);

  const handleSubmitRejectAuction = useCallback(
    async (reason) => {
      if (!classId || !rejectAuctionTarget?.id) return;
      setProcessingApprovalAuctionId(rejectAuctionTarget.id);
      try {
        const res = await approveAuctionItem(
          classId,
          rejectAuctionTarget.id,
          false,
          reason || ""
        );
        showFeedback(res?.message || "경매가 반려되었습니다.", "success");
        setRejectAuctionTarget(null);
      } catch (e) {
        console.error("rejectAuctionItem error:", e);
        showFeedback(e?.message || "경매 반려 중 오류가 발생했습니다.", "error");
      } finally {
        setProcessingApprovalAuctionId("");
      }
    },
    [classId, rejectAuctionTarget?.id, showFeedback]
  );

  const handleCloseAuction = useCallback(
    async (item) => {
      if (!classId || !item?.id) return;
      const endAtMs = getAuctionEndAtMs(item);
      const isExpired = endAtMs > 0 && endAtMs <= Date.now();
      if (!canSettleAuction) {
        showFeedback("정산 권한이 없습니다.", "error");
        return;
      }
      const force = !isExpired;

      setClosingAuctionId(item.id);
      try {
        await closeAuction(classId, item.id, force);
        showFeedback(
          force
            ? "강제 정산이 완료되었습니다."
            : "마감 정산이 완료되었습니다.",
          "success"
        );
      } catch (e) {
        console.error("closeAuction error:", e);
        showFeedback(e?.message || "경매 정산 중 오류가 발생했습니다.", "error");
      } finally {
        setClosingAuctionId("");
      }
    },
    [classId, canSettleAuction, showFeedback]
  );

  return {
    canCreateAuction,
    userAuctionHold,
    auctionItems,
    auctionItemCounts,
    pendingApprovalCount,
    pendingApprovalItems,
    isPendingApprovalListReady,
    auctionStatusFilter,
    setAuctionStatusFilter,
    rejectAuctionTarget,
    setRejectAuctionTarget,
    processingApprovalAuctionId,
    isAuctionLoading,
    auctionLoadError,
    auctionFeeRate,
    setAuctionFeeRate,
    auctionFeeEnabled,
    setAuctionFeeEnabled,
    auctionAntiSnipingSeconds,
    setAuctionAntiSnipingSeconds,
    showAuctionSettings,
    setShowAuctionSettings,
    isSavingAuctionSettings,
    handleSaveAuctionSettings,
    showAuctionCreateModal,
    setShowAuctionCreateModal,
    selectedAuctionItem,
    setSelectedAuctionItem,
    showAuctionBidModal,
    setShowAuctionBidModal,
    myPrevHold,
    setMyPrevHold,
    isSubmittingAuctionBid,
    isCreatingAuctionItem,
    closingAuctionId,
    handleOpenAuctionCreate,
    handleCreateAuction,
    handleOpenAuctionBid,
    handleSubmitAuctionBid,
    processAuctionApproval,
    handleApproveAuction,
    handleRejectAuction,
    handleSubmitRejectAuction,
    handleCloseAuction,
  };
}
