import { appConfirm } from "../../../utils/appDialogs";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  buildAssemblySummaryCacheFromCurrentSummary,
  getAssemblyClassSummaryRef,
  getAssemblyVoteChoicesFromCachedSummary,
  getAssemblyUserSummaryRef,
  getVoteChoicesFromAssemblySummaries,
  readCachedAssemblySummary,
  requestAssemblySummaryRepair,
  writeCachedAssemblySummary,
} from "../services/assemblySummaryService";

const getCurrentVoteCounts = (source = {}) => ({
  agree: Number(source?.agree ?? source?.votes?.agree ?? 0),
  disagree: Number(source?.disagree ?? source?.votes?.disagree ?? 0),
});

const applyVoteCountDelta = (currentCounts, nextChoice, previousChoice = null) => {
  let { agree, disagree } = getCurrentVoteCounts(currentCounts);

  if (previousChoice && previousChoice !== nextChoice) {
    if (previousChoice === "agree") {
      agree = Math.max(0, agree - 1);
    }
    if (previousChoice === "disagree") {
      disagree = Math.max(0, disagree - 1);
    }
  }

  if (previousChoice !== nextChoice) {
    if (nextChoice === "agree") {
      agree += 1;
    }
    if (nextChoice === "disagree") {
      disagree += 1;
    }
  }

  return { agree, disagree };
};

const updateBillVoteCounts = (bills, billId, nextChoice, previousChoice = null) =>
  bills.map((bill) => {
    if (bill.id !== billId) {
      return bill;
    }

    const { agree, disagree } = applyVoteCountDelta(
      getCurrentVoteCounts(bill),
      nextChoice,
      previousChoice,
    );

    return {
      ...bill,
      votes: {
        ...bill?.votes,
        agree,
        disagree,
      },
    };
  });

export const useLawboard = () => {
  const { classId, userData, hasPermission, isTeacher } = useUser();
  const { showFeedback } = useFeedback();

  const [votingBills, setVotingBills] = useState([]);
  const [finishedBills, setFinishedBills] = useState([]);
  const [votedBills, setVotedBills] = useState({});
  const [isBillsLoading, setIsBillsLoading] = useState(true);
  const [isVotesLoading, setIsVotesLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(null);
  const [activeTab, setActiveTab] = useState("voting");
  const [isProposeModalOpen, setIsProposeModalOpen] = useState(false);
  const [finishedBillsLimit, setFinishedBillsLimit] = useState(10);
  const loadContextRef = useRef(null);

  const userUid = userData?.uid || null;
  const canManageAssembly = isTeacher;
  const canProposeBill = canManageAssembly || hasPermission("assembly_member");
  const isLoading = isBillsLoading || isVotesLoading;

  useEffect(() => {
    if (!classId || !userUid) {
      loadContextRef.current = null;
      setIsBillsLoading(false);
      setIsVotesLoading(false);
      setVotingBills([]);
      setFinishedBills([]);
      setVotedBills({});
      return;
    }

    const nextLoadContext = `${classId}:${userUid}`;
    const isContextChanged = loadContextRef.current !== nextLoadContext;
    loadContextRef.current = nextLoadContext;

    if (isContextChanged) {
      setIsBillsLoading(true);
    }

    let votingReady = false;
    let finishedReady = false;

    const markReady = () => {
      if (votingReady && finishedReady) {
        setIsBillsLoading(false);
      }
    };

    const votingQuery = query(
      collection(db, `classes/${classId}/assemblyBills`),
      where("status", "==", "voting"),
      orderBy("createdAt", "desc"),
    );

    const unsubscribeVoting = onSnapshot(
      votingQuery,
      (snapshot) => {
        const data = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        setVotingBills(data);
        if (!votingReady) {
          votingReady = true;
          markReady();
        }
      },
      (error) => {
        console.error("진행 중 법안 구독 오류:", error);
        showFeedback("진행 중 법안을 불러오는 중 오류가 발생했습니다.", "error");
        setVotingBills([]);
        if (!votingReady) {
          votingReady = true;
          markReady();
        }
      },
    );

    const finishedQuery = query(
      collection(db, `classes/${classId}/assemblyBills`),
      where("status", "in", ["passed", "rejected"]),
      orderBy("createdAt", "desc"),
      limit(finishedBillsLimit),
    );

    const unsubscribeFinished = onSnapshot(
      finishedQuery,
      (snapshot) => {
        const data = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        const filteredData = data.filter(
          (bill) => bill.status === "passed" || bill.status === "rejected",
        );
        setFinishedBills(filteredData);
        if (!finishedReady) {
          finishedReady = true;
          markReady();
        }
      },
      (error) => {
        console.error("종료된 법안 구독 오류:", error);
        showFeedback("종료된 법안을 불러오는 중 오류가 발생했습니다.", "error");
        setFinishedBills([]);
        if (!finishedReady) {
          finishedReady = true;
          markReady();
        }
      },
    );

    return () => {
      unsubscribeVoting();
      unsubscribeFinished();
    };
  }, [classId, userUid, finishedBillsLimit, showFeedback]);

  useEffect(() => {
    if (!classId || !userUid) {
      setVotedBills({});
      setIsVotesLoading(false);
      return undefined;
    }

    let cancelled = false;
    let classSummaryReady = false;
    let userSummaryReady = false;
    let classSummaryData = null;
    let userSummaryData = null;
    let userSummaryExists = false;
    let repairRequested = false;
    let cachedAssemblySummary = readCachedAssemblySummary(classId, userUid);

    const classSummaryRef = getAssemblyClassSummaryRef(classId);
    const userSummaryRef = getAssemblyUserSummaryRef(classId, userUid);
    const cachedVoteChoices = getAssemblyVoteChoicesFromCachedSummary(
      cachedAssemblySummary,
    );

    setVotedBills(cachedVoteChoices);
    setIsVotesLoading(false);

    const persistCachedAssemblySummary = (nextCacheValue) => {
      const normalizedValue = writeCachedAssemblySummary(
        classId,
        userUid,
        nextCacheValue,
      );
      if (normalizedValue) {
        cachedAssemblySummary = normalizedValue;
      }
      return normalizedValue;
    };

    const applyVoteSummary = (voteChoices) => {
      if (cancelled) {
        return;
      }

      setVotedBills(voteChoices || {});
      setIsVotesLoading(false);
    };

    const repairVoteSummary = async () => {
      try {
        await requestAssemblySummaryRepair({
          classId,
          studentUid: userUid,
        });

        const [repairedClassSnap, repairedUserSnap] = await Promise.all([
          getDoc(classSummaryRef),
          getDoc(userSummaryRef),
        ]);

        const repairedVoteChoices = getVoteChoicesFromAssemblySummaries({
          classSummary: repairedClassSnap.exists()
            ? repairedClassSnap.data() || {}
            : null,
          userSummary: repairedUserSnap.exists()
            ? repairedUserSnap.data() || {}
            : null,
          userSummaryExists: repairedUserSnap.exists(),
        });

        persistCachedAssemblySummary(
          buildAssemblySummaryCacheFromCurrentSummary({
            classSummary: repairedClassSnap.exists()
              ? repairedClassSnap.data() || {}
              : null,
            userSummary: repairedUserSnap.exists()
              ? repairedUserSnap.data() || {}
              : null,
            userSummaryExists: repairedUserSnap.exists(),
          }),
        );
        applyVoteSummary(repairedVoteChoices || {});
      } catch (error) {
        console.error("Failed to repair assembly vote summary:", error);
        applyVoteSummary(
          getAssemblyVoteChoicesFromCachedSummary(cachedAssemblySummary),
        );
      }
    };

    const resolveVoteSummary = () => {
      if (!classSummaryReady || !userSummaryReady || cancelled) {
        return;
      }

      const voteChoices = getVoteChoicesFromAssemblySummaries({
        classSummary: classSummaryData,
        userSummary: userSummaryData,
        userSummaryExists,
      });

      if (voteChoices !== null) {
        persistCachedAssemblySummary(
          buildAssemblySummaryCacheFromCurrentSummary({
            classSummary: classSummaryData,
            userSummary: userSummaryData,
            userSummaryExists,
          }),
        );
        applyVoteSummary(voteChoices);
        return;
      }

      if (repairRequested) {
        return;
      }

      repairRequested = true;
      void repairVoteSummary();
    };

    const unsubscribeClassSummary = onSnapshot(
      classSummaryRef,
      (snapshot) => {
        classSummaryData = snapshot.exists() ? snapshot.data() || {} : null;
        classSummaryReady = true;
        resolveVoteSummary();
      },
      (error) => {
        console.error("Failed to load assembly class summary:", error);
        classSummaryData = null;
        classSummaryReady = true;
        resolveVoteSummary();
      },
    );

    const unsubscribeUserSummary = onSnapshot(
      userSummaryRef,
      (snapshot) => {
        userSummaryExists = snapshot.exists();
        userSummaryData = userSummaryExists ? snapshot.data() || {} : null;
        userSummaryReady = true;
        resolveVoteSummary();
      },
      (error) => {
        console.error("Failed to load assembly user summary:", error);
        userSummaryExists = false;
        userSummaryData = null;
        userSummaryReady = true;
        resolveVoteSummary();
      },
    );

    return () => {
      cancelled = true;
      unsubscribeClassSummary();
      unsubscribeUserSummary();
    };
  }, [classId, userUid]);

  const loadMoreFinishedBills = () => {
    setFinishedBillsLimit((prev) => prev + 10);
  };

  const canLoadMoreFinishedBills = finishedBills.length >= finishedBillsLimit;

  const handleProposalSuccess = () => {
    setIsProposeModalOpen(false);
  };

  const handleApplyPolicy = async (billId, dangerLevel = 2) => {
    if (!classId || !billId) {
      showFeedback("필수 정보가 없습니다. 다시 로그인해 주세요.", "error");
      return;
    }

    setIsProcessing(`apply-${billId}`);
    try {
      const applyPolicy = httpsCallable(functions, "applyAssemblyPolicy");
      await applyPolicy({ classId, billId, dangerLevel });
      showFeedback("정책이 성공적으로 적용되었습니다.", "success");
    } catch (error) {
      console.error("정책 적용 실패:", error);
      showFeedback(`정책 적용 실패: ${error.message}`, "error");
    } finally {
      setIsProcessing(null);
    }
  };

  const handleReopenVoting = async (billId, billTitle) => {
    if (!(await appConfirm(`"${billTitle}" 법안의 투표를 다시 진행하시겠습니까?`))) {
      return;
    }

    if (!classId) {
      showFeedback("클래스 ID가 없습니다. 다시 로그인해 주세요.", "error");
      return;
    }

    setIsProcessing(`reopen-${billId}`);
    try {
      const reopenVoting = httpsCallable(functions, "reopenVoting");
      await reopenVoting({ classId, billId });
      setFinishedBills((prev) => prev.filter((bill) => bill.id !== billId));
      showFeedback("투표가 다시 시작되었습니다.", "success");
    } catch (error) {
      console.error("투표 재개 실패:", error);
      if (error.code === "functions/failed-precondition") {
        showFeedback(
          error.message.includes("정책")
            ? "이미 정책이 적용된 법안은 재개할 수 없습니다."
            : "종료된 법안만 재개할 수 있습니다.",
          "error",
        );
      } else {
        showFeedback(`투표 재개 실패: ${error.message}`, "error");
      }
    } finally {
      setIsProcessing(null);
    }
  };

  const handleDeleteBill = useCallback(
    async (billId, billTitle) => {
      if (!canManageAssembly) {
        showFeedback("삭제 권한이 없습니다.", "error");
        return;
      }

      if (
        !(await appConfirm(`정말로 "${billTitle}" 법안을 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))
      ) {
        return;
      }

      setIsProcessing(`delete-${billId}`);
      try {
        const deleteAssemblyBill = httpsCallable(functions, "deleteAssemblyBill");
        await deleteAssemblyBill({ classId, billId });

        setVotingBills((prev) => prev.filter((bill) => bill.id !== billId));
        setFinishedBills((prev) => prev.filter((bill) => bill.id !== billId));
        setVotedBills((prev) => {
          const next = { ...prev };
          delete next[billId];
          return next;
        });

        showFeedback("법안이 성공적으로 삭제되었습니다.", "success");
      } catch (error) {
        console.error("법안 삭제 중 오류 발생:", error);
        showFeedback(`법안 삭제에 실패했습니다: ${error.message}`, "error");
      } finally {
        setIsProcessing(null);
      }
    },
    [canManageAssembly, classId, showFeedback],
  );

  const handleVote = async (billId, choice) => {
    const previousChoice = votedBills[billId] || null;

    setIsProcessing(`vote-${billId}-${choice}`);
    try {
      const castVote = httpsCallable(functions, "castVote");
      await castVote({ classId, billId, choice });

      const nextVotedBills = {
        ...votedBills,
        [billId]: choice,
      };
      const votedOpenBillCount = votingBills.reduce(
        (count, bill) => (nextVotedBills[bill.id] ? count + 1 : count),
        0,
      );

      setVotedBills((prev) => ({
        ...prev,
        [billId]: choice,
      }));
      setVotingBills((prev) =>
        updateBillVoteCounts(prev, billId, choice, previousChoice),
      );
      setFinishedBills((prev) =>
        updateBillVoteCounts(prev, billId, choice, previousChoice),
      );
      writeCachedAssemblySummary(classId, userUid, {
        openVotingBillCount: votingBills.length,
        votedOpenBillCount,
        pendingVoteCount: Math.max(0, votingBills.length - votedOpenBillCount),
        voteChoicesByBill: nextVotedBills,
      });
      showFeedback(previousChoice ? "투표를 변경했습니다." : "투표가 완료되었습니다.", "success");
    } catch (error) {
      console.error("투표 실패:", error);
      showFeedback(`투표 중 오류: ${error.message}`, "error");
    } finally {
      setIsProcessing(null);
    }
  };

  const handleVoteVisibilityChange = useCallback(
    async (billId, field, nextValue) => {
      if (!canManageAssembly) {
        showFeedback("투표 공개 설정은 교사만 변경할 수 있습니다.", "error");
        return;
      }

      if (!classId || !billId || !["showVotersDuringVoting", "showVotersAfterClose"].includes(field)) {
        showFeedback("투표 공개 설정을 저장할 수 없습니다.", "error");
        return;
      }

      setIsProcessing(`visibility-${billId}-${field}`);
      try {
        await updateDoc(doc(db, `classes/${classId}/assemblyBills/${billId}`), {
          [field]: nextValue,
        });

        showFeedback(
          nextValue
            ? "투표자 목록 공개를 켰습니다."
            : "투표자 목록을 비공개로 돌렸습니다.",
          "success",
        );
      } catch (error) {
        console.error("Failed to update voter visibility:", error);
        showFeedback(`투표 공개 설정 저장 실패: ${error.message}`, "error");
      } finally {
        setIsProcessing(null);
      }
    },
    [canManageAssembly, classId, showFeedback],
  );

  const handleCloseVoting = async (billId) => {
    if (!(await appConfirm("이 법안의 투표를 마감하시겠습니까?"))) {
      return;
    }

    setIsProcessing(`close-${billId}`);
    try {
      const closeVoting = httpsCallable(functions, "closeVoting");
      const result = await closeVoting({ classId, billId });
      const isPassed = result.data.finalStatus === "passed";
      const policyApplied = result.data.policyApplied === true;

      showFeedback(
        policyApplied
          ? `법안이 ${isPassed ? "가결" : "부결"}되었고 경찰 규칙도 자동 등록되었습니다.`
          : `법안이 ${isPassed ? "가결" : "부결"}되었습니다.`,
        "success",
      );
    } catch (error) {
      console.error("투표 종료 실패:", error);
      showFeedback(`투표 종료 중 오류: ${error.message}`, "error");
    } finally {
      setIsProcessing(null);
    }
  };

  return {
    classId,
    isLoading,
    isProcessing,
    activeTab,
    setActiveTab,
    votingBills,
    finishedBills,
    votedBills,
    handleApplyPolicy,
    handleVote,
    handleVoteVisibilityChange,
    handleCloseVoting,
    handleReopenVoting,
    isProposeModalOpen,
    setIsProposeModalOpen,
    handleProposalSuccess,
    loadMoreFinishedBills,
    canLoadMoreFinishedBills,
    hasPermission,
    canManageAssembly,
    canProposeBill,
    handleDeleteBill,
  };
};
