import { useMemo, useState } from "react";
import {
  getCaseClassLabel,
  getCaseTeacherLabel,
} from "../caseLibraryAuthorUtils";

export default function useCaseLibraryFilters({
  cases,
  categories,
  defaultSortKey = "latest",
  pageMeta,
  sortPosts,
}) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeSourceClassId, setActiveSourceClassId] = useState("");
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [query, setQuery] = useState("");

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const list = cases.filter((casePost) => {
      const matchesCategory =
        activeCategory === "all" || casePost.pageType === activeCategory;
      const sourceClassId = String(
        casePost.sourceClassId || casePost.classId || "",
      ).trim();
      const matchesSourceClass =
        !activeSourceClassId || sourceClassId === activeSourceClassId;
      const haystack = [
        casePost.title,
        casePost.summary,
        casePost.classLabel,
        getCaseTeacherLabel(casePost) || "",
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery =
        normalizedQuery.length === 0 || haystack.includes(normalizedQuery);

      return matchesCategory && matchesSourceClass && matchesQuery;
    });

    return sortPosts(list, sortKey);
  }, [activeCategory, activeSourceClassId, cases, query, sortKey, sortPosts]);

  const activeSourceClassLabel = useMemo(() => {
    if (!activeSourceClassId) {
      return "";
    }

    const matchedCase = cases.find(
      (casePost) =>
        String(casePost.sourceClassId || casePost.classId || "").trim() ===
        activeSourceClassId,
    );

    return matchedCase ? getCaseClassLabel(matchedCase) : "";
  }, [activeSourceClassId, cases]);

  const categoryTabs = useMemo(
    () =>
      categories.map((category) => ({
        ...category,
        badge:
          category.id === "all"
            ? cases.length
            : cases.filter((casePost) => casePost.pageType === category.id)
                .length,
      })),
    [cases, categories],
  );

  const selectedMeta = pageMeta[activeCategory] || pageMeta.all;
  const showReset =
    query.trim().length > 0 ||
    activeCategory !== "all" ||
    activeSourceClassId ||
    sortKey !== defaultSortKey;

  const resetFilters = () => {
    setQuery("");
    setActiveCategory("all");
    setActiveSourceClassId("");
    setSortKey(defaultSortKey);
  };

  return {
    activeCategory,
    activeSourceClassId,
    activeSourceClassLabel,
    categoryTabs,
    filteredCases,
    query,
    resetFilters,
    selectedMeta,
    setActiveCategory,
    setActiveSourceClassId,
    setQuery,
    setSortKey,
    showReset,
    sortKey,
  };
}
