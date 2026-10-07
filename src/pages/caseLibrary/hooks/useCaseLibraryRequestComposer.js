import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { composerPageMeta, composerPageTypes } from "../caseLibraryRegistry";
import { buildCaseLibrarySummary } from "../caseLibraryPostUtils";
import {
  createCaseLibraryRequest,
  getCaseLibraryRequest,
  updateCaseLibraryRequest,
} from "../services/caseLibraryRequestService";

function resolveInitialPageType(searchParams) {
  const requestedPageType = String(searchParams.get("pageType") || "").trim();
  if (composerPageTypes.includes(requestedPageType)) {
    return requestedPageType;
  }

  return composerPageTypes[0] || "operation-tips";
}

export default function useCaseLibraryRequestComposer() {
  const navigate = useNavigate();
  const { requestId } = useParams();
  const [searchParams] = useSearchParams();
  const { showFeedback } = useFeedback();
  const { classData, classId, teacherDisplayName, user, userData } = useUser();
  const [pageType, setPageType] = useState(() => resolveInitialPageType(searchParams));
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [teacherNamePublic, setTeacherNamePublic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRequest, setIsLoadingRequest] = useState(() => Boolean(requestId));

  const isEditMode = Boolean(requestId);
  const pageMeta =
    composerPageMeta[pageType] || composerPageMeta["operation-tips"];
  const authorUid = String(userData?.uid || user?.uid || "").trim();

  useEffect(() => {
    if (!isEditMode) {
      setIsLoadingRequest(false);
      return undefined;
    }

    if (!classId || !requestId || !authorUid) {
      return undefined;
    }

    let isCancelled = false;
    setIsLoadingRequest(true);

    getCaseLibraryRequest({ classId, requestId })
      .then((request) => {
        if (isCancelled) {
          return;
        }

        if (!request) {
          showFeedback("수정할 사례 요청을 찾지 못했습니다.", "warning");
          navigate("/case-library/requests");
          return;
        }

        if (String(request.authorUid || "").trim() !== authorUid) {
          showFeedback("내가 작성한 요청만 수정할 수 있습니다.", "warning");
          navigate(`/case-library/requests/${requestId}`);
          return;
        }

        setPageType(
          composerPageTypes.includes(request.pageType)
            ? request.pageType
            : composerPageTypes[0] || "operation-tips",
        );
        setTitle(String(request.title || ""));
        setContent(String(request.content || ""));
        setTeacherNamePublic(
          typeof request.teacherNamePublic === "boolean"
            ? request.teacherNamePublic
            : true,
        );
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        console.error("[useCaseLibraryRequestComposer] load failed:", error);
        showFeedback(
          error?.message || "요청 정보를 불러오는 중 문제가 생겼습니다.",
          "error",
        );
        navigate("/case-library/requests");
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingRequest(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [authorUid, classId, isEditMode, navigate, requestId, showFeedback]);

  const submitButtonLabel = useMemo(
    () => (isEditMode ? "요청 수정" : "요청 등록"),
    [isEditMode],
  );

  const pageTitle = isEditMode ? "사례 요청 수정" : "사례 요청 작성";

  const handlePublish = async () => {
    if (!classId || !authorUid) {
      showFeedback("요청을 작성하려면 로그인 정보를 다시 확인해 주세요.", "warning");
      return null;
    }

    if (!title.trim()) {
      showFeedback("제목을 입력해 주세요.", "warning");
      return null;
    }

    if (!content.trim()) {
      showFeedback("요청 내용을 입력해 주세요.", "warning");
      return null;
    }

    setIsSubmitting(true);
    try {
      const classLabel = String(
        classData?.className || classData?.name || classId || "",
      ).trim();
      const authorName = String(
        teacherDisplayName || userData?.name || user?.displayName || "",
      ).trim();
      const payload = {
        pageType,
        title: title.trim(),
        content: content.trim(),
        summary: buildCaseLibrarySummary(content.trim()),
        authorUid,
        authorName: authorName || "교사",
        classLabel: classLabel || "학급",
        teacherNamePublic,
      };

      if (isEditMode) {
        await updateCaseLibraryRequest({
          classId,
          requestId,
          requestData: payload,
        });
        showFeedback("사례 요청을 수정했습니다.", "success");
        navigate(`/case-library/requests/${requestId}`);
        return true;
      }

      const createdRequestId = await createCaseLibraryRequest({
        classId,
        requestData: payload,
      });

      showFeedback("사례 요청을 등록했어요.", "success");
      navigate(`/case-library/requests/${createdRequestId}`);
      return true;
    } catch (error) {
      console.error("[useCaseLibraryRequestComposer] publish failed:", error);
      showFeedback(
        error?.message || "요청 저장 중 문제가 생겼어요. 다시 시도해 주세요.",
        "error",
      );
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    content,
    handlePublish,
    isEditMode,
    isLoadingRequest,
    isSubmitting,
    pageMeta,
    pageTitle,
    pageType,
    pageTypes: composerPageTypes,
    setContent,
    setPageType,
    setTeacherNamePublic,
    setTitle,
    submitButtonLabel,
    teacherNamePublic,
    title,
  };
}
