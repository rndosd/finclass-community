import { useCallback, useMemo, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { retainFirebaseSubscriptionProducts, retainOrFetchFirebaseSubscriptionParticipations } from "./subscriptionFirebaseAdapter";
const fetchSelfhostSubscriptionParticipations = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
const fetchSelfhostSubscriptionProducts = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
const normalizeUidList = uids => {
  if (!Array.isArray(uids)) return [];
  return Array.from(new Set(uids.map(uid => String(uid || "").trim()).filter(Boolean)));
};
const toDayjsOrNull = value => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return dayjs(value.toDate());
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
};
const toSortMillis = value => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};
const sortProductsByNewest = (items = []) => [...items].sort((a, b) => {
  const bTime = toSortMillis(b?.createdAt) || toSortMillis(b?.updatedAt);
  const aTime = toSortMillis(a?.createdAt) || toSortMillis(a?.updatedAt);
  if (bTime !== aTime) return bTime - aTime;
  return String(b?.id || "").localeCompare(String(a?.id || ""));
});
export default function useSubscription(classId, uid, role = "student", {
  includeProducts = true,
  includeParticipations = true,
  participationsOverride = null,
  participationsMode = "realtime",
  provider = "firebase",
  token = "",
  apiBase = ""
} = {}) {
  const queryClient = useQueryClient();
  const isSelfhost = false;
  const productsKey = useMemo(() => ["subscriptionProducts", classId], [apiBase, classId, false]);
  const participationsKey = useMemo(() => ["myParticipations", classId, uid], [apiBase, classId, false, uid]);
  const [loadedState, setLoadedState] = useState({
    products: !includeProducts,
    participations: !includeParticipations
  });
  const [readErrors, setReadErrors] = useState({});
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => {
    setReadErrors({});
    setLoadedState({
      products: !includeProducts,
      participations: !includeParticipations
    });
    setRetryCount(count => count + 1);
  }, [includeParticipations, includeProducts]);
  useEffect(() => {
    setReadErrors(prev => ({
      ...prev,
      products: false
    }));
    setLoadedState(prev => ({
      ...prev,
      products: !includeProducts
    }));
    if (false || !includeProducts || !classId || !uid) return undefined;
    return retainFirebaseSubscriptionProducts({
      classId,
      queryClient,
      productsKey,
      onError: () => setReadErrors(prev => ({
        ...prev,
        products: true
      })),
      onSuccess: () => setReadErrors(prev => ({
        ...prev,
        products: false
      })),
      onLoaded: () => {
        setLoadedState(prev => prev.products ? prev : {
          ...prev,
          products: true
        });
      }
    });
  }, [classId, includeProducts, false, productsKey, queryClient, uid, retryCount]);
  useEffect(() => {
    setReadErrors(prev => ({
      ...prev,
      participations: false
    }));
    setLoadedState(prev => ({
      ...prev,
      participations: !includeParticipations
    }));
    if (false || !includeParticipations || !classId || !uid) return undefined;
    return retainOrFetchFirebaseSubscriptionParticipations({
      classId,
      uid,
      queryClient,
      participationsKey,
      participationsMode,
      onError: () => setReadErrors(prev => ({
        ...prev,
        participations: true
      })),
      onSuccess: () => setReadErrors(prev => ({
        ...prev,
        participations: false
      })),
      onLoaded: () => {
        setLoadedState(prev => prev.participations ? prev : {
          ...prev,
          participations: true
        });
      }
    });
  }, [classId, includeParticipations, false, participationsKey, participationsMode, queryClient, uid, retryCount]);
  const selfhostProducts = useQuery({
    queryKey: ["subscriptionProductsFetch", "selfhost", apiBase, classId],
    queryFn: () => fetchSelfhostSubscriptionProducts({
      classId,
      token,
      apiBase
    }),
    enabled: false && includeProducts && !!classId && !!uid && !!token,
    staleTime: 5 * 60 * 1000,
    gcTime: Infinity
  });
  const selfhostParticipations = useQuery({
    queryKey: ["subscriptionParticipationsFetch", "selfhost", apiBase, classId, uid],
    queryFn: () => fetchSelfhostSubscriptionParticipations({
      classId,
      uid,
      token,
      apiBase
    }),
    enabled: false && includeParticipations && !!classId && !!uid && !!token,
    staleTime: 5 * 60 * 1000,
    gcTime: Infinity
  });
  useEffect(() => {
    if (!false) return;
    if (includeProducts && selfhostProducts.data) {
      queryClient.setQueryData(productsKey, selfhostProducts.data);
    }
    if (includeParticipations && selfhostParticipations.data) {
      queryClient.setQueryData(participationsKey, selfhostParticipations.data);
    }
    setLoadedState({
      products: !includeProducts || Boolean(selfhostProducts.data),
      participations: !includeParticipations || Boolean(selfhostParticipations.data)
    });
  }, [includeParticipations, includeProducts, false, participationsKey, productsKey, queryClient, selfhostParticipations.data, selfhostProducts.data]);
  const {
    data: products = []
  } = useQuery({
    queryKey: productsKey,
    queryFn: () => queryClient.getQueryData(productsKey) ?? [],
    staleTime: Infinity
  });
  const {
    data: cachedParticipations = {}
  } = useQuery({
    queryKey: participationsKey,
    queryFn: () => queryClient.getQueryData(participationsKey) ?? {},
    staleTime: Infinity
  });
  const participations = useMemo(() => participationsOverride ?? cachedParticipations ?? {}, [cachedParticipations, participationsOverride]);
  const visibleProducts = useMemo(() => {
    if (!includeProducts) return [];
    if (!Array.isArray(products)) return [];
    const normalizedRole = String(role || "").trim().toLowerCase();
    const normalizedUid = String(uid || "").trim();
    const canSeeAllProducts = normalizedRole === "teacher" || normalizedRole === "admin";
    const filteredProducts = canSeeAllProducts || !normalizedUid ? products : products.filter(product => {
      if (participations?.[product.id]) return true;
      const targetStudents = normalizeUidList(product?.targetStudents);
      if (targetStudents.length === 0) return true;
      return targetStudents.includes(normalizedUid);
    });
    return sortProductsByNewest(filteredProducts);
  }, [includeProducts, participations, products, role, uid]);
  const alerts = useMemo(() => {
    const now = dayjs();
    let isPaymentDue = false;
    let isMaturityDue = false;
    let hasUncheckedResult = false;
    const productMap = new Map((products || []).map(product => [String(product.id), product]));
    Object.entries(participations || {}).forEach(([productId, participation]) => {
      if (!participation || participation.isWithdrawn || participation.isTerminated) {
        return;
      }
      const linkedProduct = productMap.get(String(productId));
      const endDate = toDayjsOrNull(participation.productEndDate) || toDayjsOrNull(linkedProduct?.endDate);
      const isExpired = endDate && now.isAfter(endDate);
      if (isExpired) {
        isMaturityDue = true;
      } else {
        const nextDate = toDayjsOrNull(participation.nextPaymentDate);
        if (nextDate && (now.isAfter(nextDate) || now.isSame(nextDate, "day"))) {
          isPaymentDue = true;
        }
      }
      if (participation.hasNewResult) {
        hasUncheckedResult = true;
      }
    });
    return {
      hasAction: isPaymentDue || isMaturityDue || hasUncheckedResult,
      isPaymentDue,
      isMaturityDue,
      hasUncheckedResult,
      count: (isPaymentDue ? 1 : 0) + (isMaturityDue ? 1 : 0)
    };
  }, [participations, products]);
  return {
    hasReadError: !false && Object.values(readErrors).some(Boolean),
    retry,
    products: visibleProducts,
    participations,
    alerts,
    isLoading: !!classId && !!uid && (includeProducts && !loadedState.products || includeParticipations && !loadedState.participations)
  };
}
