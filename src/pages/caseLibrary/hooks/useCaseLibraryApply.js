import { useMemo, useState } from "react";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { isCaseLibraryTemplateVisible } from "../caseLibraryAccess";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import {
  applyCaseLibraryTemplatePayload,
  hasCaseLibraryTemplateAdapter,
} from "../caseLibraryTemplateAdapters";
import useResolvedCaseLibraryPost from "./useResolvedCaseLibraryPost";

function buildTemplateApplySummary(result = {}) {
  if (result?.pageType === "police") {
    return [
      result?.rulesCreated ? `규칙 ${result.rulesCreated}개 추가` : null,
      result?.rulesUpdated ? `규칙 ${result.rulesUpdated}개 갱신` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  if (result?.pageType === "bank") {
    return [
      result?.depositProductsCreated
        ? `예금 상품 ${result.depositProductsCreated}개 추가`
        : null,
      result?.depositProductsUpdated
        ? `예금 상품 ${result.depositProductsUpdated}개 갱신`
        : null,
      result?.loanProductsCreated
        ? `대출 상품 ${result.loanProductsCreated}개 추가`
        : null,
      result?.loanProductsUpdated
        ? `대출 상품 ${result.loanProductsUpdated}개 갱신`
        : null,
      result?.subscriptionProductsCreated
        ? `청약 상품 ${result.subscriptionProductsCreated}개 추가`
        : null,
      result?.subscriptionProductsUpdated
        ? `청약 상품 ${result.subscriptionProductsUpdated}개 갱신`
        : null,
      result?.generalPoliciesApplied
        ? `운영 설정 ${result.generalPoliciesApplied}개 반영`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  if (result?.pageType === "store") {
    return [
      result?.categoriesCreated
        ? `카테고리 ${result.categoriesCreated}개 추가`
        : null,
      result?.categoriesUpdated
        ? `카테고리 ${result.categoriesUpdated}개 갱신`
        : null,
      result?.itemsCreated ? `상품 ${result.itemsCreated}개 추가` : null,
      result?.itemsUpdated ? `상품 ${result.itemsUpdated}개 갱신` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  if (result?.pageType === "tax") {
    return [
      result?.taxRulesCreated
        ? `세금 규칙 ${result.taxRulesCreated}개 추가`
        : null,
      result?.taxRulesUpdated
        ? `세금 규칙 ${result.taxRulesUpdated}개 갱신`
        : null,
      result?.autoTaxPolicyApplied ? "자동 세금 설정 반영" : null,
      result?.incomeSettlementPoliciesApplied
        ? `소득 정산 정책 ${result.incomeSettlementPoliciesApplied}개 반영`
        : null,
      result?.taxRulesSkipped ? `건너뜀 ${result.taxRulesSkipped}개` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  if (result?.pageType === "credentials") {
    return [
      result?.titleDefinitionsCreated
        ? `칭호 ${result.titleDefinitionsCreated}개 추가`
        : null,
      result?.titleDefinitionsUpdated
        ? `칭호 ${result.titleDefinitionsUpdated}개 갱신`
        : null,
      result?.titleGradesApplied ? `등급 ${result.titleGradesApplied}개 반영` : null,
      result?.titleCategoriesApplied
        ? `카테고리 ${result.titleCategoriesApplied}개 반영`
        : null,
      result?.titleCollectionStagesApplied
        ? `수집 단계 ${result.titleCollectionStagesApplied}개 반영`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  return "";
}

export default function useCaseLibraryApply(caseId) {
  const { showFeedback } = useFeedback();
  const { classData, classId } = useUser();
  const [isApplying, setIsApplying] = useState(false);
  const { casePost, loading, error } = useResolvedCaseLibraryPost(caseId);

  const pageMeta = useMemo(
    () => caseLibraryPageMeta[casePost?.pageType] || caseLibraryPageMeta.all,
    [casePost],
  );

  const classLabel = useMemo(() => {
    const resolvedLabel = String(
      classData?.className || classData?.name || classId || "",
    ).trim();

    return resolvedLabel || "현재 학급";
  }, [classData?.className, classData?.name, classId]);

  const templateRuntimeSupported = Boolean(
    casePost?.pageType &&
      isCaseLibraryTemplateVisible(casePost.pageType) &&
      hasCaseLibraryTemplateAdapter(casePost.pageType),
  );
  const canApplyTemplate = Boolean(
    casePost?.template && casePost?.templatePayload && templateRuntimeSupported,
  );

  const handleApply = async () => {
    if (!casePost?.template) {
      showFeedback("이 글에는 적용 가능한 템플릿이 없습니다.", "warning");
      return null;
    }

    if (!templateRuntimeSupported) {
      showFeedback("이 페이지는 아직 템플릿 적용을 지원하지 않습니다.", "warning");
      return null;
    }

    if (!casePost.templatePayload) {
      showFeedback(
        "템플릿 데이터가 없어 적용할 수 없습니다. 글 작성 시 템플릿을 함께 첨부했는지 확인해 주세요.",
        "warning",
      );
      return null;
    }

    setIsApplying(true);

    try {
      const result = await applyCaseLibraryTemplatePayload({
        classId,
        pageType: casePost.pageType,
        templatePayload: casePost.templatePayload,
        applyMode: "merge",
      });

      const summary = buildTemplateApplySummary(result);
      showFeedback(
        summary
          ? `템플릿을 적용했습니다. ${summary}`
          : "템플릿을 적용했습니다.",
        "success",
      );

      return result;
    } catch (nextError) {
      console.error("[useCaseLibraryApply] apply failed:", nextError);
      showFeedback(
        nextError?.message || "템플릿 적용 중 오류가 발생했습니다.",
        "error",
      );
      return null;
    } finally {
      setIsApplying(false);
    }
  };

  return {
    canApplyTemplate,
    casePost,
    classLabel,
    error,
    handleApply,
    isApplying,
    loading,
    pageMeta,
    templateRuntimeSupported,
  };
}
