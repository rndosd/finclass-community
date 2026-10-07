import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import * as newsService from "../services/newsService";

const NEWS_COLLECTION = "news";

function getNewsBaseConstraints({
  category = "popular",
  dashboardOnly = false,
  recentDays = null,
}) {
  const constraints = [];

  if (category === "popular") {
    if (recentDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - recentDays);
      constraints.push(where("createdAt", ">=", cutoff));
    }
    constraints.push(orderBy("interactionScore", "desc"), orderBy("createdAt", "desc"));
  } else if (category !== "all") {
    constraints.push(where("categoryId", "==", category), orderBy("createdAt", "desc"));
  } else {
    constraints.push(orderBy("createdAt", "desc"));
  }

  if (dashboardOnly) {
    constraints.push(where("showOnDashboard", "==", true));
  }

  return constraints;
}

function getNewsCollectionRef(classId) {
  return collection(db, `classes/${classId}/${NEWS_COLLECTION}`);
}

function createNewsQuery(newsRef, {
  category = "all",
  dashboardOnly = false,
  recentDays = null,
  pageSize = 5,
  startAfterDoc = null,
} = {}) {
  const constraints = [
    ...getNewsBaseConstraints({ category, dashboardOnly, recentDays }),
  ];

  if (startAfterDoc) {
    constraints.push(startAfter(startAfterDoc));
  }

  constraints.push(limit(pageSize));
  return query(newsRef, ...constraints);
}

function mapNewsDocs(docs) {
  return docs.map((item) => ({
    id: item.id,
    dataSource: NEWS_COLLECTION,
    ...item.data(),
  }));
}

async function loadNewsPage({
  classId,
  category = "all",
  dashboardOnly = false,
  recentDays = null,
  pageSize = 5,
  startAfterDoc = null,
}) {
  const newsRef = getNewsCollectionRef(classId);
  const snapshot = await getDocs(
    createNewsQuery(newsRef, {
      category,
      dashboardOnly,
      recentDays,
      pageSize,
      startAfterDoc,
    }),
  );

  return {
    list: mapNewsDocs(snapshot.docs),
    lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
  };
}

export function useLiveNews(
  classId,
  {
    category = "all",
    pageSize = 5,
    dashboardOnly = false,
    recentDays = null,
    live = true,
  } = {},
) {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!classId) {
      setData([]);
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const newsQuery = createNewsQuery(getNewsCollectionRef(classId), {
      category,
      dashboardOnly,
      recentDays,
      pageSize,
    });

    const applySnapshot = (snapshot) => {
      if (cancelled) return;
      setData(mapNewsDocs(snapshot.docs));
      setIsLoading(false);
      setError(null);
    };

    if (!live) {
      const loadNews = async () => {
        try {
          const snapshot = await getDocs(newsQuery);
          applySnapshot(snapshot);
        } catch (nextError) {
          if (cancelled) return;
          setError(nextError);
          setIsLoading(false);
        }
      };

      void loadNews();

      return () => {
        cancelled = true;
      };
    }

    const unsubscribe = onSnapshot(
      newsQuery,
      (snapshot) => applySnapshot(snapshot),
      (nextError) => {
        if (cancelled) return;
        setError(nextError);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [classId, category, dashboardOnly, pageSize, recentDays, live]);

  return {
    data,
    isLoading,
    error,
    isError: !!error,
  };
}

export function useInfiniteNews(
  classId,
  { category = "popular", pageSize = 10, dashboardOnly = false } = {},
) {
  return useInfiniteQuery({
    queryKey: ["news", "list", classId, { category, dashboardOnly }],
    queryFn: async ({ pageParam = null }) =>
      loadNewsPage({
        classId,
        category,
        dashboardOnly,
        pageSize,
        startAfterDoc: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.lastDoc || undefined,
    enabled: !!classId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useTopNews(classId) {
  return useLiveNews(classId, {
    category: "popular",
    pageSize: 5,
    recentDays: 7,
  });
}

export function useLiveComments(classId, newsId, { liveLimit = 7 } = {}) {
  const [list, setList] = useState([]);
  const [oldestDoc, setOldestDoc] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!classId || !newsId) {
      setList([]);
      setOldestDoc(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const ref = collection(db, `classes/${classId}/news/${newsId}/comments`);
    const q = query(ref, orderBy("createdAt", "desc"), limit(liveLimit));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setList(next);
        setOldestDoc(snapshot.docs[snapshot.docs.length - 1] || null);
        setIsLoading(false);
      },
      () => {
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, newsId, liveLimit]);

  return { list, oldestDoc, isLoading };
}

export function useInfiniteComments(
  classId,
  newsId,
  { startAfterDoc = null, enabled = true, pageSize = 7 } = {},
) {
  return useInfiniteQuery({
    queryKey: ["news", "comments", classId, newsId, startAfterDoc?.id || "none", pageSize],
    queryFn: async ({ pageParam = null }) => {
      const ref = collection(db, `classes/${classId}/news/${newsId}/comments`);

      const constraints = [orderBy("createdAt", "desc")];
      if (pageParam) {
        constraints.push(startAfter(pageParam));
      } else if (startAfterDoc) {
        constraints.push(startAfter(startAfterDoc));
      }
      constraints.push(limit(pageSize));

      const q = query(ref, ...constraints);

      const snapshot = await getDocs(q);
      return {
        list: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
        lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.lastDoc || undefined,
    enabled: !!classId && !!newsId && enabled,
  });
}

export function useNewsActions(classId) {
  const queryClient = useQueryClient();

  const invalidate = (newsId) => {
    queryClient.invalidateQueries({ queryKey: ["news", "list", classId] });
    queryClient.invalidateQueries({ queryKey: ["news", "top", classId] });
    if (newsId) {
      queryClient.invalidateQueries({ queryKey: ["news", "comments", classId, newsId] });
    }
  };

  const createMutation = useMutation({
    mutationFn: newsService.addNews,
    onSuccess: () => invalidate(),
  });

  const editMutation = useMutation({
    mutationFn: newsService.updateNews,
    onSuccess: (_, variables) => invalidate(variables.newsId),
  });

  const removeMutation = useMutation({
    mutationFn: newsService.deleteNews,
    onSuccess: () => invalidate(),
  });

  const addCommentMutation = useMutation({
    mutationFn: newsService.addComment,
    onSuccess: (_, variables) => invalidate(variables.newsId),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: newsService.deleteComment,
    onSuccess: (_, variables) => invalidate(variables.newsId),
  });

  return {
    createNews: createMutation.mutateAsync,
    editNews: editMutation.mutateAsync,
    removeNews: removeMutation.mutateAsync,
    addComment: addCommentMutation.mutateAsync,
    deleteComment: deleteCommentMutation.mutateAsync,
    isLoading:
      createMutation.isPending ||
      editMutation.isPending ||
      addCommentMutation.isPending,
  };
}
