import { formatCaseDate } from "./caseLibraryPostUtils";

function getTimeValue(value) {
  if (!value) {
    return 0;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }

  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) {
    return 0;
  }

  return nextDate.getTime();
}

export const caseRequestSortOptions = [
  { id: "featured", label: "\uB2F5\uBCC0 \uB300\uAE30\uC21C" },
  { id: "latest", label: "\uCD5C\uC2E0\uC21C" },
  { id: "recommended", label: "\uACF5\uAC10\uC21C" },
];

export function buildCaseLibraryRequestDetailPath(requestId, sourceClassId = "") {
  const normalizedRequestId = String(requestId || "").trim();
  const normalizedSourceClassId = String(sourceClassId || "").trim();

  if (!normalizedRequestId) {
    return "/case-library/requests";
  }

  if (!normalizedSourceClassId) {
    return `/case-library/requests/${normalizedRequestId}`;
  }

  const params = new URLSearchParams({
    sourceClassId: normalizedSourceClassId,
  });

  return `/case-library/requests/${normalizedRequestId}?${params.toString()}`;
}

export function getCaseRequestStatus(request) {
  const linkedCaseCount = Number(request?.linkedCaseCount || 0);
  const commentCount = Number(request?.commentCount || 0);

  if (linkedCaseCount > 0) {
    return {
      id: "resolved",
      label: "\uC0AC\uB840 \uB4F1\uB85D\uB428",
      tone: "emerald",
    };
  }

  if (commentCount > 0) {
    return {
      id: "commented",
      label: "\uB2F5\uBCC0 \uB4F1\uB85D\uB428",
      tone: "blue",
    };
  }

  return {
    id: "waiting",
    label: "\uB2F5\uBCC0 \uB300\uAE30",
    tone: "amber",
  };
}

export function sortCaseRequests(requests, sortKey = "featured") {
  const list = [...(requests || [])];

  if (sortKey === "latest") {
    return list.sort(
      (left, right) => getTimeValue(right.createdAt) - getTimeValue(left.createdAt),
    );
  }

  if (sortKey === "recommended") {
    return list.sort(
      (left, right) =>
        (Number(right.interestCount) || 0) - (Number(left.interestCount) || 0),
    );
  }

  return list.sort((left, right) => {
    const leftStatus = getCaseRequestStatus(left);
    const rightStatus = getCaseRequestStatus(right);

    const rankMap = {
      waiting: 0,
      commented: 1,
      resolved: 2,
    };

    const statusDelta =
      (rankMap[leftStatus.id] || 0) - (rankMap[rightStatus.id] || 0);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const interestDelta =
      (Number(right.interestCount) || 0) - (Number(left.interestCount) || 0);
    if (interestDelta !== 0) {
      return interestDelta;
    }

    return getTimeValue(right.createdAt) - getTimeValue(left.createdAt);
  });
}

export function buildCaseRequestMetaLine(request) {
  const detailParts = [];

  if (Number(request?.commentCount || 0) > 0) {
    detailParts.push(
      `\uB2F5\uBCC0 ${Number(request?.commentCount || 0)}`,
    );
  }

  if (Number(request?.linkedCaseCount || 0) > 0) {
    detailParts.push(
      `\uC5F0\uACB0 \uC0AC\uB840 ${Number(request?.linkedCaseCount || 0)}`,
    );
  }

  if (detailParts.length === 0) {
    detailParts.push(
      "\uC544\uC9C1 \uB2F5\uBCC0\uC774 \uC5C6\uC5B4\uC694",
    );
  }

  return `${formatCaseDate(request.updatedAt || request.createdAt)} \u00B7 ${detailParts.join(" \u00B7 ")}`;
}
