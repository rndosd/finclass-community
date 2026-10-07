import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUser } from "../../../contexts/UserContext";
import { sortCasePosts } from "../caseLibraryPostUtils";
import useCaseLibraryPosts from "./useCaseLibraryPosts";

function moveItem(list, fromIndex, toIndex) {
  const nextList = [...list];
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(toIndex, 0, moved);
  return nextList;
}

function parsePreselectedPostIds(searchParams) {
  const rawValue = String(searchParams.get("posts") || "").trim();
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => decodeURIComponent(value).trim())
    .filter(Boolean);
}

export default function useCaseLibraryPdfBuilder() {
  const [searchParams] = useSearchParams();
  const { classData, classId, teacherDisplayName, user, userData } = useUser();
  const { posts, loading, error } = useCaseLibraryPosts(classId);
  const authorUid = String(userData?.uid || user?.uid || "").trim();
  const didApplyPreselectionRef = useRef(false);

  const ownPosts = useMemo(() => {
    const authoredPosts = posts.filter(
      (post) => String(post.authorUid || "").trim() === authorUid,
    );

    return sortCasePosts(authoredPosts, "latest");
  }, [authorUid, posts]);

  const postMap = useMemo(
    () => new Map(ownPosts.map((post) => [post.id, post])),
    [ownPosts],
  );

  const defaultTitle = useMemo(() => {
    return "";
  }, []);

  const exportAuthorLabel = useMemo(() => {
    const teacherLabel = String(teacherDisplayName || "").trim();
    if (teacherLabel) {
      return teacherLabel;
    }

    const classLabel = String(classData?.className || classData?.name || "").trim();
    return classLabel || "담당 교사";
  }, [classData?.className, classData?.name, teacherDisplayName]);

  const [documentTitle, setDocumentTitle] = useState(defaultTitle);
  const [coverNote, setCoverNote] = useState("");
  const [introNote, setIntroNote] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [layoutOptions, setLayoutOptions] = useState({
    showSectionTitle: true,
    showSectionMeta: false,
    showCoverAuthor: false,
    showCoverDate: false,
  });
  const [selectedItems, setSelectedItems] = useState([]);

  useEffect(() => {
    setSelectedItems((currentItems) =>
      currentItems.filter((item) => postMap.has(item.postId)),
    );
  }, [postMap]);

  useEffect(() => {
    if (didApplyPreselectionRef.current) {
      return;
    }

    if (!ownPosts.length) {
      return;
    }

    const preselectedIds = parsePreselectedPostIds(searchParams);
    if (!preselectedIds.length) {
      didApplyPreselectionRef.current = true;
      return;
    }

    const nextSelectedItems = preselectedIds
      .map((postId) => postMap.get(postId))
      .filter(Boolean)
      .map((post) => ({
        postId: post.id,
        sectionTitle: post.title,
        breakAfter: true,
      }));

    if (nextSelectedItems.length > 0) {
      setSelectedItems(nextSelectedItems);
    }

    didApplyPreselectionRef.current = true;
  }, [ownPosts, postMap, searchParams]);

  const togglePostSelection = (post) => {
    setSelectedItems((currentItems) => {
      const existingIndex = currentItems.findIndex((item) => item.postId === post.id);

      if (existingIndex >= 0) {
        return currentItems.filter((item) => item.postId !== post.id);
      }

      return [
        ...currentItems,
        {
          postId: post.id,
          sectionTitle: post.title,
          breakAfter: true,
        },
      ];
    });
  };

  const selectAllPosts = () => {
    setSelectedItems(
      ownPosts.map((post) => ({
        postId: post.id,
        sectionTitle: post.title,
        breakAfter: true,
      })),
    );
  };

  const clearSelectedPosts = () => {
    setSelectedItems([]);
  };

  const updateSectionTitle = (postId, nextTitle) => {
    setSelectedItems((currentItems) =>
      currentItems.map((item) =>
        item.postId === postId ? { ...item, sectionTitle: nextTitle } : item,
      ),
    );
  };

  const toggleSectionBreakAfter = (postId) => {
    setSelectedItems((currentItems) =>
      currentItems.map((item) =>
        item.postId === postId
          ? { ...item, breakAfter: item.breakAfter === false ? true : false }
          : item,
      ),
    );
  };

  const moveSelectedPost = (postId, direction) => {
    setSelectedItems((currentItems) => {
      const currentIndex = currentItems.findIndex((item) => item.postId === postId);
      if (currentIndex < 0) {
        return currentItems;
      }

      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (nextIndex < 0 || nextIndex >= currentItems.length) {
        return currentItems;
      }

      return moveItem(currentItems, currentIndex, nextIndex);
    });
  };

  const selectedPosts = useMemo(
    () =>
      selectedItems
        .map((item) => {
          const post = postMap.get(item.postId);
          if (!post) {
            return null;
          }

          return {
            ...post,
            breakAfter: item.breakAfter !== false,
            sectionTitle: String(item.sectionTitle || "").trim() || post.title,
          };
        })
        .filter(Boolean),
    [postMap, selectedItems],
  );

  const selectedIdSet = useMemo(
    () => new Set(selectedItems.map((item) => item.postId)),
    [selectedItems],
  );

  const generatedDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  const handlePrint = () => {
    if (typeof window === "undefined") {
      return;
    }

    window.print();
  };

  const updateLayoutOption = (key, value) => {
    setLayoutOptions((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return {
    clearSelectedPosts,
    closingNote,
    coverNote,
    defaultTitle,
    documentTitle,
    error,
    exportAuthorLabel,
    generatedDateLabel,
    handlePrint,
    introNote,
    layoutOptions,
    loading,
    moveSelectedPost,
    ownPosts,
    selectedIdSet,
    selectedItems,
    selectedPosts,
    selectAllPosts,
    setClosingNote,
    setCoverNote,
    setDocumentTitle,
    setIntroNote,
    togglePostSelection,
    toggleSectionBreakAfter,
    updateLayoutOption,
    updateSectionTitle,
  };
}
