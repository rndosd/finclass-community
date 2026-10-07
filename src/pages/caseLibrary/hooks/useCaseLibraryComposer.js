import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import {
  buildCaseLibraryTemplateMeta,
  composerPageMeta,
  composerPageTypes,
  composerTemplateScopes,
  getCaseLibraryPageConfig,
  getDefaultTemplateScopeIds,
} from "../caseLibraryRegistry";
import {
  exportCaseLibraryTemplatePayload,
  hasCaseLibraryTemplateAdapter,
} from "../caseLibraryTemplateAdapters";
import {
  buildCaseLibraryPostDetailPath,
  buildCaseLibrarySummary,
  stripHtml,
} from "../caseLibraryPostUtils";
import {
  clearCaseLibraryDraft,
  loadCaseLibraryDraft,
  saveCaseLibraryDraft,
} from "../services/caseLibraryDraftService";
import { getCaseLibraryRequest } from "../services/caseLibraryRequestService";
import useCaseLibraryPosts, {
  createCaseLibraryPost,
  updateCaseLibraryPost,
} from "./useCaseLibraryPosts";

function sanitizeScopeIds(scopeIds, allowedScopeIds) {
  if (!Array.isArray(scopeIds)) {
    return [];
  }

  return scopeIds.filter((scopeId) => allowedScopeIds.has(scopeId));
}

function resolveInitialPageType(searchParams) {
  const requestedPageType = String(searchParams.get("pageType") || "").trim();
  if (composerPageTypes.includes(requestedPageType)) {
    return requestedPageType;
  }

  return composerPageTypes[0] || "operation-tips";
}

export default function useCaseLibraryComposer() {
  const navigate = useNavigate();
  const { caseId } = useParams();
  const [searchParams] = useSearchParams();
  const { showFeedback } = useFeedback();
  const { classData, classId, teacherDisplayName, user, userData } = useUser();
  const { posts } = useCaseLibraryPosts(classId);
  const [pageType, setPageType] = useState(() => resolveInitialPageType(searchParams));
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [teacherNamePublic, setTeacherNamePublic] = useState(true);
  const [attachTemplate, setAttachTemplate] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState([]);
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [linkedRequest, setLinkedRequest] = useState(null);

  const authorUid = String(userData?.uid || user?.uid || "").trim();
  const isEditing = Boolean(caseId);
  const linkedRequestId = String(searchParams.get("requestId") || "").trim();
  const linkedRequestClassId = String(
    searchParams.get("requestClassId") || classId || "",
  ).trim();
  const editingPost = useMemo(
    () => (isEditing ? posts.find((post) => post.id === caseId) || null : null),
    [caseId, isEditing, posts],
  );
  const canEditPost =
    !isEditing ||
    (editingPost &&
      String(editingPost.authorUid || "").trim() === authorUid &&
      String(editingPost.classId || "") === String(classId || ""));

  useEffect(() => {
    if (!isEditing || !editingPost) {
      return;
    }

    if (!canEditPost) {
      showFeedback("내가 작성한 글만 수정할 수 있습니다.", "warning");
      navigate(buildCaseLibraryPostDetailPath(editingPost));
    }
  }, [canEditPost, editingPost, isEditing, navigate, showFeedback]);

  const pageConfig = useMemo(
    () =>
      getCaseLibraryPageConfig(pageType) ||
      getCaseLibraryPageConfig(resolveInitialPageType(searchParams)),
    [pageType, searchParams],
  );
  const fallbackPageType = resolveInitialPageType(searchParams);
  const pageMeta = composerPageMeta[pageType] || composerPageMeta[fallbackPageType];
  const templateSupported = Boolean(pageConfig?.templateEnabled);
  const templateRuntimeSupported = Boolean(
    templateSupported && hasCaseLibraryTemplateAdapter(pageType),
  );
  const scopeOptions = useMemo(
    () => (templateSupported ? composerTemplateScopes[pageType] || [] : []),
    [pageType, templateSupported],
  );

  useEffect(() => {
    if (isEditing || !linkedRequestClassId || !linkedRequestId) {
      setLinkedRequest(null);
      return undefined;
    }

    let cancelled = false;

    async function loadLinkedRequest() {
      try {
        const request = await getCaseLibraryRequest({
          classId: linkedRequestClassId,
          requestId: linkedRequestId,
        });

        if (cancelled) {
          return;
        }

        setLinkedRequest(request);

        if (request?.pageType) {
          setPageType((currentPageType) =>
            currentPageType === fallbackPageType ? request.pageType : currentPageType,
          );
        }

        if (request?.title) {
          setTitle((currentTitle) => currentTitle || request.title);
        }
      } catch (error) {
        console.error("[useCaseLibraryComposer] linked request load failed:", error);
      }
    }

    loadLinkedRequest();

    return () => {
      cancelled = true;
    };
  }, [fallbackPageType, isEditing, linkedRequestClassId, linkedRequestId]);

  useEffect(() => {
    if (!isEditing || !editingPost) {
      return;
    }

    setPageType(editingPost.pageType || fallbackPageType);
    setTitle(String(editingPost.title || ""));
    setContent(String(editingPost.bodyHtml || ""));
    setTeacherNamePublic(
      typeof editingPost.teacherNamePublic === "boolean"
        ? editingPost.teacherNamePublic
        : true,
    );
    setAttachTemplate(Boolean(editingPost.templateEnabled && editingPost.template));
    setSelectedScopes(
      Array.isArray(editingPost.templateScopeIds)
        ? editingPost.templateScopeIds
        : [],
    );
  }, [editingPost, fallbackPageType, isEditing]);

  useEffect(() => {
    if (isEditing) {
      return undefined;
    }

    let cancelled = false;

    async function hydrateDraft() {
      if (!classId || !authorUid) {
        return;
      }

      try {
        const draft = await loadCaseLibraryDraft(classId, authorUid);
        if (!draft || cancelled) {
          return;
        }

        const nextPageType = composerPageTypes.includes(draft.pageType)
          ? draft.pageType
          : fallbackPageType;
        const nextScopeOptions = composerTemplateScopes[nextPageType] || [];
        const allowedScopeIds = new Set(nextScopeOptions.map((scope) => scope.id));

        setPageType(nextPageType);
        setTitle(String(draft.title || ""));
        setContent(String(draft.content || ""));
        setTeacherNamePublic(
          typeof draft.teacherNamePublic === "boolean"
            ? draft.teacherNamePublic
            : true,
        );
        setAttachTemplate(Boolean(draft.attachTemplate));
        setSelectedScopes(sanitizeScopeIds(draft.selectedScopes, allowedScopeIds));

        showFeedback("임시저장된 글을 불러왔습니다.", "info");
      } catch (error) {
        console.error("[useCaseLibraryComposer] draft load failed:", error);
      }
    }

    hydrateDraft();

    return () => {
      cancelled = true;
    };
  }, [authorUid, classId, fallbackPageType, isEditing, showFeedback]);

  useEffect(() => {
    if (!templateSupported || !templateRuntimeSupported) {
      setAttachTemplate(false);
      setSelectedScopes([]);
      return;
    }

    if (!attachTemplate) {
      return;
    }

    setSelectedScopes((previousScopes) => {
      const allowedScopeIds = new Set(scopeOptions.map((scope) => scope.id));
      const nextScopes = previousScopes.filter((scopeId) =>
        allowedScopeIds.has(scopeId),
      );

      if (nextScopes.length > 0) {
        return nextScopes;
      }

      return getDefaultTemplateScopeIds(pageType);
    });
  }, [
    attachTemplate,
    pageType,
    scopeOptions,
    templateRuntimeSupported,
    templateSupported,
  ]);

  const handleTemplateToggle = (nextValue) => {
    if (!templateSupported) {
      return;
    }

    if (!templateRuntimeSupported) {
      showFeedback("이 페이지는 아직 템플릿 첨부를 지원하지 않습니다.", "info");
      return;
    }

    setAttachTemplate(nextValue);
    setSelectedScopes(nextValue ? getDefaultTemplateScopeIds(pageType) : []);
  };

  const toggleScope = (scopeId) => {
    const scope = scopeOptions.find((item) => item.id === scopeId);
    if (!scope || scope.required) {
      return;
    }

    setSelectedScopes((previousScopes) =>
      previousScopes.includes(scopeId)
        ? previousScopes.filter((item) => item !== scopeId)
        : [...previousScopes, scopeId],
    );
  };

  const plainTextBody = useMemo(() => stripHtml(content), [content]);
  const previewTitle = title.trim() || `${pageMeta.label} 운영사례 제목`;
  const bodyPreview =
    buildCaseLibrarySummary(plainTextBody, 220) ||
    "본문을 작성하면 미리보기에서 요약이 표시됩니다.";
  const publishDisabled = isEditorUploading || isPublishing || isDraftSaving;

  const handleSaveDraft = async () => {
    if (isEditing) {
      showFeedback("수정 중인 글은 임시저장을 지원하지 않습니다.", "info");
      return;
    }

    if (isEditorUploading) {
      showFeedback("이미지 업로드가 끝난 뒤에 임시저장을 해 주세요.", "warning");
      return;
    }

    if (!classId || !authorUid) {
      showFeedback("임시저장에 필요한 사용자 정보를 찾지 못했습니다.", "warning");
      return;
    }

    setIsDraftSaving(true);
    try {
      await saveCaseLibraryDraft({
        classId,
        uid: authorUid,
        draftData: {
          pageType,
          title: title.trim(),
          content,
          teacherNamePublic,
          attachTemplate:
            templateSupported && templateRuntimeSupported ? attachTemplate : false,
          selectedScopes:
            attachTemplate && templateSupported && templateRuntimeSupported
              ? selectedScopes
              : [],
        },
      });
      showFeedback("임시저장했습니다.", "success");
    } catch (error) {
      console.error("[useCaseLibraryComposer] draft save failed:", error);
      showFeedback(error?.message || "임시저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsDraftSaving(false);
    }
  };

  const handlePublish = async () => {
    if (isEditorUploading) {
      showFeedback("이미지 업로드가 끝난 뒤에 게시해 주세요.", "warning");
      return;
    }

    if (!classId) {
      showFeedback("학급 정보가 없어 운영사례를 게시할 수 없습니다.", "error");
      return;
    }

    if (!canEditPost) {
      showFeedback("내가 작성한 글만 수정할 수 있습니다.", "warning");
      return;
    }

    if (!title.trim()) {
      showFeedback("제목을 입력해 주세요.", "warning");
      return;
    }

    if (!plainTextBody.trim()) {
      showFeedback("본문을 입력해 주세요.", "warning");
      return;
    }

    if (attachTemplate && selectedScopes.length === 0) {
      showFeedback("템플릿에 포함할 항목을 선택해 주세요.", "warning");
      return;
    }

    if (attachTemplate && !templateRuntimeSupported) {
      showFeedback("이 페이지는 아직 템플릿 첨부를 지원하지 않습니다.", "warning");
      return;
    }

    const classLabel = String(
      classData?.className || classData?.name || classId || "",
    ).trim();
    const authorName = String(
      teacherDisplayName || userData?.name || user?.displayName || "",
    ).trim();
    const templateMeta =
      attachTemplate && templateSupported
        ? buildCaseLibraryTemplateMeta(pageType, selectedScopes)
        : null;

    setIsPublishing(true);

    try {
      const templatePayload =
        templateMeta && templateRuntimeSupported
          ? await exportCaseLibraryTemplatePayload({
              classId,
              pageType,
              scopeIds: templateMeta.scopeIds,
            })
          : null;

      const payload = {
        pageType,
        postKind: templateMeta ? "template" : "post",
        requestId: isEditing
          ? String(editingPost?.requestId || linkedRequestId || "").trim()
          : linkedRequestId,
        title: title.trim(),
        bodyHtml: content,
        bodyText: plainTextBody,
        summary: buildCaseLibrarySummary(plainTextBody),
        authorUid,
        authorName: authorName || "교사",
        classLabel: classLabel || "학급",
        teacherNamePublic,
        templateEnabled: Boolean(templateMeta),
        templateScopeIds: templateMeta?.scopeIds || [],
        template: templateMeta
          ? {
              includedScopes: templateMeta.includedScopes,
              excludedScopes: templateMeta.excludedScopes,
              targetHint: templateMeta.targetHint,
            }
          : null,
        templatePayload,
      };

      if (isEditing && caseId) {
        await updateCaseLibraryPost({
          classId,
          postId: caseId,
          postData: payload,
        });
        showFeedback("운영사례를 수정했습니다.", "success");
        navigate(
          buildCaseLibraryPostDetailPath({
            classId,
            id: caseId,
          }),
        );
        return;
      }

      const postId = await createCaseLibraryPost({ classId, postData: payload });

      try {
        await clearCaseLibraryDraft(classId, authorUid);
      } catch (draftError) {
        console.error("[useCaseLibraryComposer] draft clear failed:", draftError);
      }

      showFeedback("운영사례를 게시했습니다.", "success");
      navigate(
        buildCaseLibraryPostDetailPath({
          classId,
          id: postId,
        }),
      );
    } catch (error) {
      console.error("[useCaseLibraryComposer] publish failed:", error);
      showFeedback(error?.message || "게시 중 오류가 발생했습니다.", "error");
    } finally {
      setIsPublishing(false);
    }
  };

  return {
    attachTemplate,
    bodyPreview,
    content,
    canEditPost,
    handlePublish,
    handleSaveDraft,
    handleTemplateToggle,
    isEditing,
    isDraftSaving,
    isEditorUploading,
    isPublishing,
    pageMeta,
    pageType,
    pageTypes: composerPageTypes,
    previewTitle,
    publishDisabled,
    scopeOptions,
    selectedScopes,
    setContent,
    setIsEditorUploading,
    setPageType,
    setTeacherNamePublic,
    setTitle,
    teacherNamePublic,
    templateRuntimeSupported,
    templateSupported,
    title,
    toggleScope,
    linkedRequest,
  };
}
