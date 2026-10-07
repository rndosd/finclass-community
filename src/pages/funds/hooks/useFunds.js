import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";

import { db } from "../../../firebase";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  reviewFundApplication,
  deleteFund,
  submitFundApplication,
  submitFundOrder,
  submitFundRebalance,
  submitFundReport,
  updateFundProfile,
  updateFundReport,
} from "../services/fundService";
import { isFundReportOverdue } from "../utils/fundReportStatus";

const mapDoc = (docSnap) => ({
  id: docSnap.id,
  ...docSnap.data(),
});

function chunkValues(values = [], size = 10) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function useMinuteTimestamp(enabled = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, [enabled]);

  return now;
}

function useLiveCollection(queryKey, sourceQuery, enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !sourceQuery) return undefined;

    const unsub = onSnapshot(
      sourceQuery,
      (snapshot) => {
        queryClient.setQueryData(queryKey, snapshot.docs.map(mapDoc));
      },
      (error) => {
        console.error("[useLiveCollection] Listener error:", error);
      },
    );

    return () => unsub();
  }, [enabled, queryClient, queryKey, sourceQuery]);

  return useQuery({
    queryKey,
    queryFn: () => queryClient.getQueryData(queryKey) || [],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function useLiveCollectionUnion(queryKey, sourceQueries = [], enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;

    if (!sourceQueries.length) {
      queryClient.setQueryData(queryKey, []);
      return undefined;
    }

    const snapshotsByIndex = {};
    const emit = () => {
      const merged = new Map();
      Object.values(snapshotsByIndex).forEach((docs) => {
        docs.forEach((doc) => merged.set(doc.id, doc));
      });
      queryClient.setQueryData(queryKey, Array.from(merged.values()));
    };

    const unsubs = sourceQueries.map((sourceQuery, index) =>
      onSnapshot(
        sourceQuery,
        (snapshot) => {
          snapshotsByIndex[index] = snapshot.docs.map(mapDoc);
          emit();
        },
        (error) => {
          console.error("[useLiveCollectionUnion] Listener error:", error);
        },
      ),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [enabled, queryClient, queryKey, sourceQueries]);

  return useQuery({
    queryKey,
    queryFn: () => queryClient.getQueryData(queryKey) || [],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useFunds(classId) {
  const queryKey = useMemo(() => ["funds", classId, "all"], [classId]);
  const sourceQuery = useMemo(() => {
    if (!classId) return null;
    return query(collection(db, `classes/${classId}/funds`), orderBy("createdAt", "desc"));
  }, [classId]);

  const result = useLiveCollection(queryKey, sourceQuery, !!classId);
  const now = useMinuteTimestamp(!!classId);
  const funds = useMemo(
    () =>
      (result.data || [])
        .filter((fund) => !fund.deletedAt)
        .map((fund) => ({
          ...fund,
          reportOverdue: isFundReportOverdue(fund, now),
        })),
    [now, result.data],
  );

  return {
    ...result,
    funds,
  };
}

export function useFundNavHistory(classId, fundId) {
  const queryKey = useMemo(() => ["fundNavHistory", classId, fundId], [classId, fundId]);
  const sourceQuery = useMemo(() => {
    if (!classId || !fundId) return null;
    return query(
      collection(db, `classes/${classId}/funds/${fundId}/navHistory`),
      orderBy("dateKey", "asc"),
    );
  }, [classId, fundId]);

  const result = useLiveCollection(queryKey, sourceQuery, !!classId && !!fundId);
  const navHistory = useMemo(
    () =>
      [...(result.data || [])].sort((left, right) =>
        String(left.dateKey || left.id || "").localeCompare(
          String(right.dateKey || right.id || ""),
        ),
      ),
    [result.data],
  );

  return {
    ...result,
    navHistory,
  };
}

export function useFundApplications(classId) {
  const queryKey = useMemo(() => ["fundApplications", classId, "all"], [classId]);
  const sourceQuery = useMemo(() => {
    if (!classId) return null;
    return query(
      collection(db, `classes/${classId}/fundApplications`),
      orderBy("submittedAt", "desc"),
    );
  }, [classId]);

  const result = useLiveCollection(queryKey, sourceQuery, !!classId);

  return {
    ...result,
    applications: result.data || [],
  };
}

export function useFundReports(classId) {
  const queryKey = useMemo(() => ["fundReports", classId, "all"], [classId]);
  const sourceQuery = useMemo(() => {
    if (!classId) return null;
    return query(
      collection(db, `classes/${classId}/fundReports`),
      orderBy("submittedAt", "desc"),
    );
  }, [classId]);

  const result = useLiveCollection(queryKey, sourceQuery, !!classId);

  return {
    ...result,
    reports: result.data || [],
  };
}

export function useFundPositions(classId, uid) {
  const queryKey = useMemo(() => ["fundPositions", classId, uid], [classId, uid]);
  const sourceQuery = useMemo(() => {
    if (!classId || !uid) return null;
    return query(
      collection(db, `classes/${classId}/fundPositions`),
      where("studentUid", "==", uid),
    );
  }, [classId, uid]);

  const result = useLiveCollection(queryKey, sourceQuery, !!classId && !!uid);
  const positions = useMemo(
    () =>
      [...(result.data || [])].sort((left, right) =>
        String(left.fundName || "").localeCompare(String(right.fundName || "")),
      ),
    [result.data],
  );

  return {
    ...result,
    positions,
  };
}

export function useMyFundOrders(classId, uid) {
  const queryKey = useMemo(() => ["fundOrders", classId, uid], [classId, uid]);
  const sourceQuery = useMemo(() => {
    if (!classId || !uid) return null;
    return query(
      collection(db, `classes/${classId}/fundOrders`),
      where("studentUid", "==", uid),
    );
  }, [classId, uid]);

  const result = useLiveCollection(queryKey, sourceQuery, !!classId && !!uid);
  const orders = useMemo(
    () =>
      [...(result.data || [])].sort((left, right) => {
        const leftTime =
          left.submittedAt?.toMillis?.() ||
          new Date(left.submittedAt || 0).getTime() ||
          0;
        const rightTime =
          right.submittedAt?.toMillis?.() ||
          new Date(right.submittedAt || 0).getTime() ||
          0;
        return rightTime - leftTime;
      }),
    [result.data],
  );

  return {
    ...result,
    orders,
  };
}

export function useManagedFundPositions(classId, fundIds = []) {
  const normalizedFundIds = useMemo(
    () => [...new Set((fundIds || []).filter(Boolean))].sort(),
    [fundIds],
  );
  const queryKey = useMemo(
    () => ["managedFundPositions", classId, normalizedFundIds.join("|")],
    [classId, normalizedFundIds],
  );
  const sourceQueries = useMemo(() => {
    if (!classId || normalizedFundIds.length === 0) return [];
    return chunkValues(normalizedFundIds).map((chunk) =>
      query(
        collection(db, `classes/${classId}/fundPositions`),
        where("fundId", "in", chunk),
      ),
    );
  }, [classId, normalizedFundIds]);

  const result = useLiveCollectionUnion(
    queryKey,
    sourceQueries,
    !!classId && normalizedFundIds.length > 0,
  );
  const positions = useMemo(
    () =>
      [...(result.data || [])].sort((left, right) =>
        `${left.fundName || ""}-${left.studentName || ""}`.localeCompare(
          `${right.fundName || ""}-${right.studentName || ""}`,
        ),
      ),
    [result.data],
  );

  return {
    ...result,
    positions,
  };
}

export function useManagedFundOrders(classId, fundIds = []) {
  const normalizedFundIds = useMemo(
    () => [...new Set((fundIds || []).filter(Boolean))].sort(),
    [fundIds],
  );
  const queryKey = useMemo(
    () => ["managedFundOrders", classId, normalizedFundIds.join("|")],
    [classId, normalizedFundIds],
  );
  const sourceQueries = useMemo(() => {
    if (!classId || normalizedFundIds.length === 0) return [];
    return chunkValues(normalizedFundIds).map((chunk) =>
      query(
        collection(db, `classes/${classId}/fundOrders`),
        where("fundId", "in", chunk),
      ),
    );
  }, [classId, normalizedFundIds]);

  const result = useLiveCollectionUnion(
    queryKey,
    sourceQueries,
    !!classId && normalizedFundIds.length > 0,
  );
  const orders = useMemo(
    () =>
      [...(result.data || [])].sort((left, right) => {
        const leftTime =
          left.submittedAt?.toMillis?.() ||
          new Date(left.submittedAt || 0).getTime() ||
          0;
        const rightTime =
          right.submittedAt?.toMillis?.() ||
          new Date(right.submittedAt || 0).getTime() ||
          0;
        return rightTime - leftTime;
      }),
    [result.data],
  );

  return {
    ...result,
    orders,
  };
}

export function useFundActions(classId, uid) {
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["funds", classId] });
    queryClient.invalidateQueries({ queryKey: ["fundNavHistory", classId] });
    queryClient.invalidateQueries({ queryKey: ["fundApplications", classId] });
    queryClient.invalidateQueries({ queryKey: ["fundReports", classId] });
    queryClient.invalidateQueries({ queryKey: ["fundPositions", classId] });
    queryClient.invalidateQueries({ queryKey: ["managedFundPositions", classId] });
    queryClient.invalidateQueries({ queryKey: ["fundOrders", classId] });
    queryClient.invalidateQueries({ queryKey: ["managedFundOrders", classId] });
  };

  const submitApplicationMutation = useMutation({
    mutationFn: (application) => submitFundApplication(classId, application),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "펀드 신청서 제출에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(
        res?.data?.message || "펀드 개설 신청서를 제출했습니다.",
        "success",
      );
    },
    onError: (err) => {
      showFeedback(err?.message || "펀드 신청서 제출에 실패했습니다.", "error");
    },
  });

  const reviewApplicationMutation = useMutation({
    mutationFn: ({ applicationId, decision, reviewNote }) =>
      reviewFundApplication(classId, applicationId, decision, reviewNote),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "펀드 신청 심사 처리에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(
        res?.data?.message || "펀드 신청서를 심사했습니다.",
        "success",
      );
    },
    onError: (err) => {
      showFeedback(err?.message || "펀드 신청 심사 처리에 실패했습니다.", "error");
    },
  });

  const submitOrderMutation = useMutation({
    mutationFn: (payload) => submitFundOrder(classId, payload),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "펀드 주문 접수에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(
        res?.data?.message || "펀드 주문이 접수되었습니다.",
        "success",
      );
    },
    onError: (err) => {
      showFeedback(err?.message || "펀드 주문 접수에 실패했습니다.", "error");
    },
  });

  const submitRebalanceMutation = useMutation({
    mutationFn: (payload) => submitFundRebalance(classId, payload),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "펀드 리밸런싱 저장에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(
        res?.data?.message || "펀드 리밸런싱을 저장했습니다.",
        "success",
      );
    },
    onError: (err) => {
      showFeedback(err?.message || "펀드 리밸런싱 저장에 실패했습니다.", "error");
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (payload) => updateFundProfile(classId, payload),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "펀드 소개 수정에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(res?.data?.message || "펀드 소개를 수정했습니다.", "success");
    },
    onError: (err) => {
      showFeedback(err?.message || "펀드 소개 수정에 실패했습니다.", "error");
    },
  });

  const submitReportMutation = useMutation({
    mutationFn: (payload) => submitFundReport(classId, payload),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "운용 보고서 제출에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(
        res?.data?.message || "운용 보고서를 제출했습니다.",
        "success",
      );
    },
    onError: (err) => {
      showFeedback(err?.message || "운용 보고서 제출에 실패했습니다.", "error");
    },
  });

  const updateReportMutation = useMutation({
    mutationFn: (payload) => updateFundReport(classId, payload),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "운용 보고서 수정에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(
        res?.data?.message || "운용 보고서를 수정했습니다.",
        "success",
      );
    },
    onError: (err) => {
      showFeedback(err?.message || "운용 보고서 수정에 실패했습니다.", "error");
    },
  });

  const deleteFundMutation = useMutation({
    mutationFn: (fundId) => deleteFund(classId, fundId),
    onSuccess: (res) => {
      if (!res?.success) {
        showFeedback(res?.message || "펀드 삭제에 실패했습니다.", "error");
        return;
      }
      invalidate();
      showFeedback(res?.data?.message || "펀드를 삭제했습니다.", "success");
    },
    onError: (err) => {
      showFeedback(err?.message || "펀드 삭제에 실패했습니다.", "error");
    },
  });

  return {
    submitApplication: submitApplicationMutation.mutateAsync,
    reviewApplication: reviewApplicationMutation.mutateAsync,
    submitRebalance: submitRebalanceMutation.mutateAsync,
    updateProfile: updateProfileMutation.mutateAsync,
    submitReport: submitReportMutation.mutateAsync,
    updateReport: updateReportMutation.mutateAsync,
    submitOrder: submitOrderMutation.mutateAsync,
    deleteFund: deleteFundMutation.mutateAsync,
    isSubmittingApplication: submitApplicationMutation.isPending,
    isReviewingApplication: reviewApplicationMutation.isPending,
    isSubmittingRebalance: submitRebalanceMutation.isPending,
    isUpdatingProfile: updateProfileMutation.isPending,
    isSubmittingReport: submitReportMutation.isPending,
    isUpdatingReport: updateReportMutation.isPending,
    isSubmittingOrder: submitOrderMutation.isPending,
    isDeletingFund: deleteFundMutation.isPending,
    activeUid: uid,
  };
}
