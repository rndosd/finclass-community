export const caseSortOptions = [
  { id: "latest", label: "날짜순" },
  { id: "views", label: "많이 본 순" },
  { id: "recommended", label: "추천순" },
];

export function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCaseLibrarySummary(input, maxLength = 180) {
  const plainText = stripHtml(input);
  if (!plainText) {
    return "";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}...`;
}

export function buildCaseLibraryPostRouteId(casePost = {}) {
  const summaryId = String(casePost.summaryId || "").trim();
  if (summaryId) {
    return summaryId;
  }

  const sourceClassId = String(
    casePost.sourceClassId || casePost.classId || "",
  ).trim();
  const postId = String(casePost.postId || casePost.id || "").trim();

  if (!postId) {
    return "";
  }

  return sourceClassId ? `${sourceClassId}__${postId}` : postId;
}

export function buildCaseLibraryPostDetailPath(casePost = {}) {
  const routeId = buildCaseLibraryPostRouteId(casePost);
  return routeId ? `/case-library/${encodeURIComponent(routeId)}` : "/case-library";
}

export function parseCaseLibraryPostRouteId(routeId) {
  const normalizedRouteId = String(routeId || "").trim();
  if (!normalizedRouteId) {
    return {
      isComposite: false,
      postId: "",
      routeId: "",
      sourceClassId: "",
      summaryId: "",
    };
  }

  const separatorIndex = normalizedRouteId.indexOf("__");
  if (separatorIndex <= 0) {
    return {
      isComposite: false,
      postId: normalizedRouteId,
      routeId: normalizedRouteId,
      sourceClassId: "",
      summaryId: "",
    };
  }

  const sourceClassId = normalizedRouteId.slice(0, separatorIndex).trim();
  const postId = normalizedRouteId.slice(separatorIndex + 2).trim();

  if (!sourceClassId || !postId) {
    return {
      isComposite: false,
      postId: normalizedRouteId,
      routeId: normalizedRouteId,
      sourceClassId: "",
      summaryId: "",
    };
  }

  return {
    isComposite: true,
    postId,
    routeId: normalizedRouteId,
    sourceClassId,
    summaryId: normalizedRouteId,
  };
}

function resolveDateValue(value) {
  if (!value) {
    return null;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) {
    return null;
  }

  return nextDate;
}

function getTimeValue(value) {
  return resolveDateValue(value)?.getTime() || 0;
}

function getInteractionScore(casePost) {
  return (
    (Number(casePost?.saveCount) || 0) + (Number(casePost?.recommendCount) || 0)
  );
}

function getPostSortTimeValue(casePost) {
  return getTimeValue(
    casePost?.createdAt || casePost?.publishedAt || casePost?.updatedAt,
  );
}

export function sortCasePosts(posts, sortKey = "latest") {
  const list = [...(posts || [])];

  if (sortKey === "latest") {
    return list.sort(
      (left, right) => getPostSortTimeValue(right) - getPostSortTimeValue(left),
    );
  }

  if (sortKey === "views") {
    return list.sort((left, right) => {
      const viewDelta =
        (Number(right.viewCount) || 0) - (Number(left.viewCount) || 0);
      if (viewDelta !== 0) {
        return viewDelta;
      }

      const recommendDelta =
        (Number(right.recommendCount) || 0) - (Number(left.recommendCount) || 0);
      if (recommendDelta !== 0) {
        return recommendDelta;
      }

      return getPostSortTimeValue(right) - getPostSortTimeValue(left);
    });
  }

  if (sortKey === "featured") {
    return list.sort((left, right) => {
      if (Boolean(left.featured) !== Boolean(right.featured)) {
        return left.featured ? -1 : 1;
      }

      const interactionDelta = getInteractionScore(right) - getInteractionScore(left);
      if (interactionDelta !== 0) {
        return interactionDelta;
      }

      return getPostSortTimeValue(right) - getPostSortTimeValue(left);
    });
  }

  if (sortKey === "recommended") {
    return list.sort((left, right) => {
      const recommendDelta =
        (Number(right.recommendCount) || 0) - (Number(left.recommendCount) || 0);
      if (recommendDelta !== 0) {
        return recommendDelta;
      }

      const viewDelta =
        (Number(right.viewCount) || 0) - (Number(left.viewCount) || 0);
      if (viewDelta !== 0) {
        return viewDelta;
      }

      return getPostSortTimeValue(right) - getPostSortTimeValue(left);
    });
  }

  return list.sort(
    (left, right) => getPostSortTimeValue(right) - getPostSortTimeValue(left),
  );
}

export function formatCaseDate(value) {
  const resolvedDate = resolveDateValue(value);
  if (!resolvedDate) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(resolvedDate);
}

export function formatCaseDateTime(value) {
  const resolvedDate = resolveDateValue(value);
  if (!resolvedDate) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(resolvedDate);
}
