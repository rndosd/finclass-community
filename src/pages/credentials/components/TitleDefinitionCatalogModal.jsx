import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { Download, LayoutGrid, List, Medal, Pencil, Plus, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx";

import { db } from "../../../firebase";
import {
  Badge,
  BulkActionFloatingBar,
  Button,
  InputField,
  Modal,
  SelectField,
  Spinner,
  ToggleSwitch,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import useDragSelection from "../../../hooks/useDragSelection";
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
  XLSX_IMPORT_ACCEPT,
} from "../../../utils/safeXlsxImport";
import TitleDefinitionListTable from "./TitleDefinitionListTable";
import TitleDefinitionNameplateGrid from "./TitleDefinitionNameplateGrid";
import TitleStyleDesignerModal from "./TitleStyleDesignerModal";
import {
  DEFAULT_TITLE_GRADES,
  TITLE_REVEAL_VISIBILITY_OPTIONS,
  EmptyState,
  TitleShowcaseCard,
  commitWriteOperations,
  deriveLegacyTitleRevealMode,
  formatDexNumber,
  getTitleCategoryLabel,
  normalizeTitleRevealConfig,
  normalizeUploadLookupKey,
  parsePositiveInteger,
  resolveTitleGradeFromUpload,
} from "../CredentialsPage.parts";
import { deleteTitleDefinitionsWithCleanup } from "../credentialTeacherSummary";

const KEEP_VALUE = "__keep__";
const getRevealVisibilityLabel = (value) =>
  TITLE_REVEAL_VISIBILITY_OPTIONS.find((item) => item.value === value)?.label ||
  value;

function TitleDefinitionCatalogModal({
  open,
  onClose,
  embedded = false,
  items,
  isLoading,
  onCreate,
  onEdit,
  titleGrades,
  titleCategoryOptions = [],
  ownedTitleCountByDefinition = {},
  requestCountByDefinition = {},
  cleanupLoading = false,
  onRebuildTeacherSummary,
  canDeleteDefinitions = false,
}) {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();
  const fileInputRef = useRef(null);

  const [fileName, setFileName] = useState("");
  const [rowsToImport, setRowsToImport] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedDefinitionIds, setSelectedDefinitionIds] = useState([]);
  const [deleteDialogState, setDeleteDialogState] = useState({
    open: false,
    ids: [],
    mode: "selected",
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [bulkUploadRevealConfig, setBulkUploadRevealConfig] = useState({
    name: "hidden",
    condition: "public",
    nameplate: "hidden",
  });
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [dangerPanelOpen, setDangerPanelOpen] = useState(false);
  const [definitionSearch, setDefinitionSearch] = useState("");
  const [definitionGradeFilter, setDefinitionGradeFilter] = useState("all");
  const [definitionCategoryFilter, setDefinitionCategoryFilter] = useState("all");
  const [definitionStatusFilter, setDefinitionStatusFilter] = useState("all");
  const [definitionViewMode, setDefinitionViewMode] = useState("list");
  const [listSortMode, setListSortMode] = useState("display-order-asc");
  const [styleApplyState, setStyleApplyState] = useState({
    open: false,
    ids: [],
  });
  const [bulkEditState, setBulkEditState] = useState({
    open: false,
    revealConfig: {
      name: KEEP_VALUE,
      condition: KEEP_VALUE,
      nameplate: KEEP_VALUE,
    },
    gradeId: "__keep__",
    categoryId: "__keep__",
  });
  const [bulkEditSubmitting, setBulkEditSubmitting] = useState(false);

  const defaultGradeId = titleGrades[0]?.id || DEFAULT_TITLE_GRADES[0].id;
  const issuerName =
    userData?.name || userData?.teacherDisplayName || userData?.uid || "교사";

  const nextImportDisplayOrderBase = useMemo(
    () =>
      items.reduce(
        (maxValue, item) =>
          Math.max(maxValue, parsePositiveInteger(item.displayOrder) || 0),
        0,
      ) + 1,
    [items],
  );

  const selectedDefinitionItems = useMemo(
    () => items.filter((item) => selectedDefinitionIds.includes(item.id)),
    [items, selectedDefinitionIds],
  );
  const styleApplyItems = useMemo(
    () => items.filter((item) => styleApplyState.ids.includes(item.id)),
    [items, styleApplyState.ids],
  );

  const filteredDefinitionItems = useMemo(() => {
    const searchValue = definitionSearch.trim().toLowerCase();

    return items.filter((item) => {
      if (
        definitionGradeFilter !== "all" &&
        String(item?.gradeId || item?.rarity || "") !== definitionGradeFilter
      ) {
        return false;
      }

      if (
        definitionCategoryFilter !== "all" &&
        String(item?.categoryId || item?.category || "") !== definitionCategoryFilter
      ) {
        return false;
      }

      if (definitionStatusFilter === "visible" && item?.isVisible === false) {
        return false;
      }

      if (definitionStatusFilter === "hidden" && item?.isVisible !== false) {
        return false;
      }

      if (definitionStatusFilter === "inactive" && item?.isActive !== false) {
        return false;
      }

      if (!searchValue) return true;

      return [
        item?.name,
        item?.description,
        item?.acquisitionCondition,
        item?.categoryLabel,
        item?.category,
        item?.displayOrder,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(searchValue));
    });
  }, [
    definitionCategoryFilter,
    definitionGradeFilter,
    definitionSearch,
    definitionStatusFilter,
    items,
  ]);

  const allDefinitionsSelected = useMemo(
    () =>
      filteredDefinitionItems.length > 0 &&
      filteredDefinitionItems.every((item) => selectedDefinitionIds.includes(item.id)),
    [filteredDefinitionItems, selectedDefinitionIds],
  );

  const deleteImpact = useMemo(() => {
    const deleteIdSet = new Set(deleteDialogState.ids);
    return {
      definitionCount: deleteDialogState.ids.length,
      ownedTitleCount: Object.entries(ownedTitleCountByDefinition).reduce(
        (count, [definitionId, ownedCount]) =>
          deleteIdSet.has(definitionId)
            ? count + Number(ownedCount || 0)
            : count,
        0,
      ),
      requestCount: Object.entries(requestCountByDefinition).reduce(
        (count, [definitionId, requestCount]) =>
          deleteIdSet.has(definitionId)
            ? count + Number(requestCount || 0)
            : count,
        0,
      ),
    };
  }, [deleteDialogState.ids, ownedTitleCountByDefinition, requestCountByDefinition]);

  const displayedListItems = useMemo(() => {
    const sortedItems = [...filteredDefinitionItems];

    if (listSortMode === "category-asc" || listSortMode === "category-desc") {
      const direction = listSortMode === "category-desc" ? -1 : 1;
      return sortedItems.sort(
        (left, right) =>
          String(left?.categoryLabel || left?.category || "미분류").localeCompare(
            String(right?.categoryLabel || right?.category || "미분류"),
            "ko",
          ) *
            direction ||
          (parsePositiveInteger(left?.displayOrder) ?? Number.MAX_SAFE_INTEGER) -
            (parsePositiveInteger(right?.displayOrder) ?? Number.MAX_SAFE_INTEGER) ||
          String(left?.name || "").localeCompare(String(right?.name || ""), "ko"),
      );
    }

    if (listSortMode === "grade-asc" || listSortMode === "grade-desc") {
      const direction = listSortMode === "grade-desc" ? -1 : 1;
      return sortedItems.sort(
        (left, right) =>
          ((Number(left?.gradeOrder) || Number.MAX_SAFE_INTEGER) -
            (Number(right?.gradeOrder) || Number.MAX_SAFE_INTEGER)) *
            direction ||
          (parsePositiveInteger(left?.displayOrder) ?? Number.MAX_SAFE_INTEGER) -
            (parsePositiveInteger(right?.displayOrder) ?? Number.MAX_SAFE_INTEGER) ||
          String(left?.name || "").localeCompare(String(right?.name || ""), "ko"),
      );
    }

    if (listSortMode === "display-order-desc") {
      return sortedItems.sort(
        (left, right) =>
          (parsePositiveInteger(right?.displayOrder) ?? Number.MIN_SAFE_INTEGER) -
            (parsePositiveInteger(left?.displayOrder) ?? Number.MIN_SAFE_INTEGER) ||
          String(left?.name || "").localeCompare(String(right?.name || ""), "ko"),
      );
    }

    return filteredDefinitionItems;
  }, [filteredDefinitionItems, listSortMode]);

  const importCounts = useMemo(
    () => ({
      created: rowsToImport.filter((item) => item.status === "new").length,
      updated: rowsToImport.filter((item) => item.status === "update").length,
      invalid: rowsToImport.filter((item) => item.status === "invalid").length,
    }),
    [rowsToImport],
  );

  useEffect(() => {
    if (open) return;
    setFileName("");
    setRowsToImport([]);
    setIsProcessing(false);
    setIsUploading(false);
    setSelectedDefinitionIds([]);
    setDeleteDialogState({
      open: false,
      ids: [],
      mode: "selected",
    });
    setIsDeleting(false);
    setIsSavingOrder(false);
    setBulkUploadRevealConfig({
      name: "hidden",
      condition: "public",
      nameplate: "hidden",
    });
    setImportPanelOpen(false);
    setDangerPanelOpen(false);
    setDefinitionSearch("");
    setDefinitionGradeFilter("all");
    setDefinitionCategoryFilter("all");
    setDefinitionStatusFilter("all");
    setDefinitionViewMode("list");
    setListSortMode("display-order-asc");
    setStyleApplyState({
      open: false,
      ids: [],
    });
    setBulkEditState({
      open: false,
      revealConfig: {
        name: KEEP_VALUE,
        condition: KEEP_VALUE,
        nameplate: KEEP_VALUE,
      },
      gradeId: "__keep__",
      categoryId: "__keep__",
    });
    setBulkEditSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = null;
  }, [open]);

  useEffect(() => {
    const validIds = new Set(items.map((item) => item.id));
    setSelectedDefinitionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [items]);

  const isDefinitionSelected = (entry) => {
    const targetId = typeof entry === "string" ? entry : entry?.id;
    return selectedDefinitionIds.includes(targetId);
  };

  const selectDefinition = (entry) => {
    const targetId = typeof entry === "string" ? entry : entry?.id;
    if (!targetId) return;

    setSelectedDefinitionIds((prev) =>
      prev.includes(targetId) ? prev : [...prev, targetId],
    );
  };

  const deselectDefinition = (entry) => {
    const targetId = typeof entry === "string" ? entry : entry?.id;
    if (!targetId) return;

    setSelectedDefinitionIds((prev) => prev.filter((item) => item !== targetId));
  };

  const { startDrag: startDefinitionSelection, enterDrag: enterDefinitionSelection } =
    useDragSelection({
      isSelected: isDefinitionSelected,
      onSelect: selectDefinition,
      onDeselect: deselectDefinition,
    });

  const shouldIgnoreSelectionGesture = (target) =>
    Boolean(target?.closest?.("[data-no-selection='true']"));

  const handleDefinitionMouseDown = (item, event) => {
    if (event.button !== 0 || shouldIgnoreSelectionGesture(event.target)) return;
    event.preventDefault();
    startDefinitionSelection(item);
  };

  const handleDefinitionMouseEnter = (item) => {
    enterDefinitionSelection(item);
  };

  const handleDownloadSample = () => {
    const sampleRows = [
      ["칭호명", "설명", "카테고리", "획득 조건", "등급", "순서"],
      [
        "저축왕 입문",
        "저축 습관을 처음 만든 학생에게 주는 칭호",
        "예금",
        "예금 상품을 1회 이상 가입하기",
        titleGrades[0]?.label || "기초",
        1,
      ],
      [
        "주식 첫걸음",
        "투자 활동을 시작한 학생에게 주는 칭호",
        "주식",
        "주식 주문을 5회 이상 완료하기",
        titleGrades[1]?.label || titleGrades[0]?.label || "성장",
        2,
      ],
    ];

    const guideRows = [
      ["항목", "작성 방법"],
      ["칭호명", "중복되지 않는 칭호 이름을 입력해 주세요."],
      ["설명", "칭호 카드나 관리 화면에서 참고할 짧은 설명입니다. 비워두면 기존 설명을 유지합니다."],
      ["카테고리", "예금, 주식, 소비처럼 학생 도감에서 묶어서 볼 이름을 적어 주세요."],
      ["획득 조건", "학생에게 보여줄 획득 기준을 적어 주세요."],
      ["등급", "등급 이름 또는 등급 ID를 입력할 수 있습니다."],
      ["순서", "도감 번호와 지급 목록 순서를 정하는 숫자입니다."],
      [
        "공개 설정",
        "이름/조건/명패 공개 방식은 엑셀 파일이 아니라 업로드 화면의 옵션에서 일괄 적용합니다.",
      ],
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sampleRows),
      "칭호 업로드 샘플",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(guideRows),
      "작성 안내",
    );
    XLSX.writeFile(workbook, "칭호_업로드_샘플.xlsx");
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      validateXlsxImportFile(file);
    } catch (error) {
      showFeedback(getXlsxImportErrorMessage(error), "error");
      event.target.value = "";
      return;
    }

    setFileName(file.name);
    setRowsToImport([]);
    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const { rows } = parseFirstXlsxWorksheet(loadEvent.target?.result, {
          file,
        });

        const existingByName = new Map(
          items
            .filter((item) => String(item?.name || "").trim())
            .map((item) => [normalizeUploadLookupKey(item.name), item]),
        );
        const seenNames = new Set();
        let nextNewDisplayOrder = nextImportDisplayOrderBase;

        const nextRows = rows
          .map((row, index) => {
            const rowNumber = index + 2;
            const name = String(
              row["칭호명"] ||
                row["칭호 이름"] ||
                row.titleName ||
                row.name ||
                "",
            ).trim();
            const acquisitionCondition = String(
              row["획득 조건"] ||
                row["획득조건"] ||
                row.acquisitionCondition ||
                "",
            ).trim();
            const description = String(
              row["설명"] ||
                row["칭호 설명"] ||
                row.description ||
                "",
            ).trim();
            const category = String(
              row["카테고리"] || row.category || "",
            ).trim();
            const gradeResult = resolveTitleGradeFromUpload(
              row["등급"] || row.grade || row.gradeId || "",
              titleGrades,
              defaultGradeId,
            );
            const inputDisplayOrder = parsePositiveInteger(
              row["순서"] || row.order || row.displayOrder,
            );
            const normalizedName = normalizeUploadLookupKey(name);
            const existingItem = existingByName.get(normalizedName) || null;
            const errorMessages = [];

            if (!name) errorMessages.push("칭호명을 입력해 주세요.");
            if (normalizedName && seenNames.has(normalizedName)) {
              errorMessages.push("같은 파일 안에 동일한 칭호명이 중복되어 있습니다.");
            }
            if (gradeResult.errorMessage) {
              errorMessages.push(`등급 확인 필요: ${gradeResult.errorMessage}`);
            }

            if (normalizedName) seenNames.add(normalizedName);

            const fallbackDisplayOrder =
              inputDisplayOrder ||
              parsePositiveInteger(existingItem?.displayOrder) ||
              nextNewDisplayOrder;

            if (!existingItem?.id) {
              nextNewDisplayOrder = Math.max(
                nextNewDisplayOrder + 1,
                fallbackDisplayOrder + 1,
              );
            }

            const payload = {
              name,
              description: description || existingItem?.description || "",
              acquisitionCondition:
                acquisitionCondition || existingItem?.acquisitionCondition || "",
              category: category || existingItem?.category || "",
              gradeId: gradeResult.gradeId,
              rarity: existingItem?.rarity || "common",
              icon: existingItem?.icon || "none",
              familyId: existingItem?.familyId || "plaque",
              paletteId: existingItem?.paletteId || "sky",
              trimPaletteId: existingItem?.trimPaletteId || "match",
              sourceType: "manual",
              displayOrder: fallbackDisplayOrder,
            };

            return {
              rowNumber,
              name: name || "이름 없음",
              categoryLabel: getTitleCategoryLabel(payload.category),
              acquisitionCondition: payload.acquisitionCondition,
              gradeLabel: gradeResult.gradeLabel,
              displayOrder: payload.displayOrder,
              isVisible: existingItem ? existingItem.isVisible !== false : true,
              existingId: existingItem?.id || null,
              existingItem,
              payload,
              status: errorMessages.length
                ? "invalid"
                : existingItem?.id
                  ? "update"
                  : "new",
              errorMessage: errorMessages.join(" "),
            };
          })
          .filter((item) => item.name);

        setRowsToImport(nextRows);

        if (!nextRows.length) {
          showFeedback("업로드 파일에서 읽을 수 있는 칭호가 없었습니다.", "warning");
        } else {
          showFeedback(`업로드 미리보기 ${nextRows.length}건을 불러왔습니다.`, "success");
        }
      } catch (error) {
        console.error("[TitleDefinitionCatalogModal] parse error:", error);
        showFeedback(getXlsxImportErrorMessage(error), "error");
      } finally {
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setIsProcessing(false);
      showFeedback("파일을 읽지 못했습니다.", "error");
    };

    reader.readAsArrayBuffer(file);
  };

  const updateImportRowVisibility = (targetKey, nextValue) => {
    setRowsToImport((prev) =>
      prev.map((item) =>
        `${item.rowNumber}-${item.name}` === targetKey
          ? { ...item, isVisible: nextValue }
          : item,
      ),
    );
  };

  const toggleDefinitionSelection = (titleId) => {
    setSelectedDefinitionIds((prev) =>
      prev.includes(titleId)
        ? prev.filter((item) => item !== titleId)
        : [...prev, titleId],
    );
  };

  const clearDefinitionSelection = () => {
    setSelectedDefinitionIds([]);
  };

  const toggleAllDefinitions = () => {
    setSelectedDefinitionIds((prev) => {
      const currentIds = filteredDefinitionItems.map((item) => item.id);
      const isEverySelected =
        currentIds.length > 0 && currentIds.every((id) => prev.includes(id));

      if (isEverySelected) {
        return prev.filter((id) => !currentIds.includes(id));
      }

      return Array.from(new Set([...prev, ...currentIds]));
    });
  };

  const persistDefinitionOrder = async (orderedItems) => {
    const operations = orderedItems
      .map((item, index) => ({
        item,
        nextDisplayOrder: index + 1,
      }))
      .filter(
        ({ item, nextDisplayOrder }) =>
          parsePositiveInteger(item.displayOrder) !== nextDisplayOrder,
      )
      .map(({ item, nextDisplayOrder }) => ({
        type: "update",
        ref: doc(db, "classes", classId, "titles", item.id),
        data: {
          displayOrder: nextDisplayOrder,
          updatedAt: serverTimestamp(),
          updatedByUid: userData.uid,
          updatedByName: issuerName,
        },
      }));

    if (!operations.length) return;
    await commitWriteOperations(operations);
  };

  const handleReorderDefinitions = async (orderedItems) => {
    if (!classId || !userData?.uid || isSavingOrder) return;

    setIsSavingOrder(true);
    try {
      await persistDefinitionOrder(orderedItems);
      showFeedback("칭호 순서를 저장했습니다.", "success");
    } catch (error) {
      console.error("[TitleDefinitionCatalogModal] reorder error:", error);
      showFeedback("칭호 순서를 저장하지 못했습니다.", "error");
      throw error;
    } finally {
      setIsSavingOrder(false);
    }
  };

  const openDeleteDialog = (ids, mode = "selected") => {
    const nextIds = [...new Set((ids || []).filter(Boolean))];
    if (!nextIds.length) return;

    if (cleanupLoading) {
      showFeedback(
        "학생 보유 기록 또는 요청 기록을 정리하는 중에는 삭제 작업을 잠시 막아 두었습니다.",
        "warning",
      );
      return;
    }

    setDeleteDialogState({
      open: true,
      ids: nextIds,
      mode,
    });
  };

  const openStyleApplyModal = (ids = selectedDefinitionItems.map((item) => item.id)) => {
    const nextIds = [...new Set((ids || []).filter(Boolean))];
    if (!nextIds.length) return;
    setStyleApplyState({
      open: true,
      ids: nextIds,
    });
  };

  const closeStyleApplyModal = () => {
    setStyleApplyState({
      open: false,
      ids: [],
    });
  };

  const openBulkEditModal = () => {
    if (!selectedDefinitionItems.length) return;

    setBulkEditState({
      open: true,
      revealConfig: {
        name: KEEP_VALUE,
        condition: KEEP_VALUE,
        nameplate: KEEP_VALUE,
      },
      gradeId: "__keep__",
      categoryId: "__keep__",
    });
  };

  const closeBulkEditModal = () => {
    if (bulkEditSubmitting) return;

    setBulkEditState((prev) => ({
      ...prev,
      open: false,
      revealConfig: {
        name: KEEP_VALUE,
        condition: KEEP_VALUE,
        nameplate: KEEP_VALUE,
      },
      gradeId: "__keep__",
      categoryId: "__keep__",
    }));
  };

  const handleBulkEditField = (field, value) => {
    setBulkEditState((prev) => ({ ...prev, [field]: value }));
  };

  const handleBulkEditRevealField = (field, value) => {
    setBulkEditState((prev) => ({
      ...prev,
      revealConfig: {
        ...prev.revealConfig,
        [field]: value,
      },
    }));
  };

  const handleBulkUploadRevealField = (field, value) => {
    setBulkUploadRevealConfig((prev) =>
      normalizeTitleRevealConfig({
        ...prev,
        [field]: value,
      }),
    );
  };

  const handleApplyDefinitionStyles = async (styleDraft) => {
    if (!classId || !userData?.uid || !styleApplyState.ids.length) return;

    const batch = writeBatch(db);
    styleApplyState.ids.forEach((titleId) => {
      batch.set(
        doc(db, "classes", classId, "titles", titleId),
        {
          version: styleDraft.version || 3,
          familyId: styleDraft.familyId || "plaque",
          paletteId: styleDraft.paletteId || "sky",
          trimPaletteId: styleDraft.trimPaletteId || "match",
          ornamentSetId: styleDraft.ornamentSetId || "none",
          icon: styleDraft.icon || "none",
          fontStyleId: styleDraft.fontStyleId || "basic",
          textScale: styleDraft.textScale ?? 100,
          textOffsetY: styleDraft.textOffsetY ?? 0,
          textColorMode: styleDraft.textColorMode || "auto",
          customTextColor: styleDraft.customTextColor || "",
          customFrameColor: styleDraft.customFrameColor || "",
          customBannerColor: styleDraft.customBannerColor || "",
          customTrimColor: styleDraft.customTrimColor || "",
          topDecoId: styleDraft.topDecoId || "none",
          sideDecoId: styleDraft.sideDecoId || "none",
          bottomDecoId: styleDraft.bottomDecoId || "none",
          patternId: styleDraft.patternId || "none",
          effectId: styleDraft.effectId || "none",
          updatedAt: serverTimestamp(),
          updatedByUid: userData.uid,
          updatedByName: issuerName,
        },
        { merge: true },
      );
    });

    try {
      await batch.commit();
      showFeedback(
        `선택한 칭호 ${styleApplyState.ids.length}개에 같은 명패 스타일을 적용했습니다.`,
        "success",
      );
      closeStyleApplyModal();
    } catch (error) {
      console.error("[TitleDefinitionCatalogModal] bulk style apply error:", error);
      showFeedback("명패 일괄 적용에 실패했습니다.", "error");
    }
  };

  const handleBulkEditDefinitions = async () => {
    if (!classId || !userData?.uid || !selectedDefinitionItems.length) return;

    const hasRevealConfigChange = Object.values(bulkEditState.revealConfig || {}).some(
      (value) => value !== KEEP_VALUE,
    );
    const hasGradeChange = bulkEditState.gradeId !== "__keep__";
    const hasCategoryChange = bulkEditState.categoryId !== "__keep__";

    if (!hasRevealConfigChange && !hasGradeChange && !hasCategoryChange) {
      showFeedback("변경할 항목을 하나 이상 선택해 주세요.", "warning");
      return;
    }

    const selectedCategory =
      titleCategoryOptions.find((item) => item.value === bulkEditState.categoryId) || null;

    setBulkEditSubmitting(true);
    try {
      const operations = selectedDefinitionItems.map((item) => {
        const nextData = {
          updatedAt: serverTimestamp(),
          updatedByUid: userData.uid,
          updatedByName: issuerName,
        };

        if (hasRevealConfigChange) {
          const currentRevealConfig = normalizeTitleRevealConfig(
            item.revealConfig,
            item.revealMode || "condition_only",
          );
          const nextRevealConfig = normalizeTitleRevealConfig({
            name:
              bulkEditState.revealConfig.name === KEEP_VALUE
                ? currentRevealConfig.name
                : bulkEditState.revealConfig.name,
            condition:
              bulkEditState.revealConfig.condition === KEEP_VALUE
                ? currentRevealConfig.condition
                : bulkEditState.revealConfig.condition,
            nameplate:
              bulkEditState.revealConfig.nameplate === KEEP_VALUE
                ? currentRevealConfig.nameplate
                : bulkEditState.revealConfig.nameplate,
          });

          nextData.revealConfig = nextRevealConfig;
          nextData.revealMode = deriveLegacyTitleRevealMode(nextRevealConfig);
        }

        if (hasGradeChange) {
          nextData.gradeId = bulkEditState.gradeId;
          nextData.rarity = bulkEditState.gradeId;
        }

        if (hasCategoryChange && selectedCategory) {
          nextData.categoryId = selectedCategory.value;
          nextData.category = selectedCategory.label;
        }

        return {
          type: "update",
          ref: doc(db, "classes", classId, "titles", item.id),
          data: nextData,
        };
      });

      await commitWriteOperations(operations);
      await onRebuildTeacherSummary?.();
      showFeedback(
        `선택한 칭호 ${selectedDefinitionItems.length}개를 일괄 수정했습니다.`,
        "success",
      );
      closeBulkEditModal();
      clearDefinitionSelection();
    } catch (error) {
      console.error("[TitleDefinitionCatalogModal] bulk edit error:", error);
      showFeedback("일괄 수정에 실패했습니다.", "error");
    } finally {
      setBulkEditSubmitting(false);
    }
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteDialogState({
      open: false,
      ids: [],
      mode: "selected",
    });
  };

  const handleUploadRows = async () => {
    const validRows = rowsToImport.filter((item) => item.status !== "invalid");

    if (!classId || !userData?.uid) {
      showFeedback("학급 정보를 확인한 뒤 다시 시도해 주세요.", "error");
      return;
    }
    if (!validRows.length) {
      showFeedback("등록할 수 있는 칭호가 없습니다.", "warning");
      return;
    }

    setIsUploading(true);
    try {
      const batch = writeBatch(db);
      const uploadRevealConfig = normalizeTitleRevealConfig(bulkUploadRevealConfig);

      validRows.forEach((item) => {
        const payload = {
          ...item.payload,
          revealConfig: uploadRevealConfig,
          revealMode: deriveLegacyTitleRevealMode(uploadRevealConfig),
          allowStudentRequest: true,
          isVisible: item.isVisible !== false,
          isActive: item.existingItem ? item.existingItem.isActive !== false : true,
          isDeleted: false,
          updatedAt: serverTimestamp(),
          updatedByUid: userData.uid,
          updatedByName: issuerName,
        };

        if (item.status === "update" && item.existingId) {
          batch.set(doc(db, "classes", classId, "titles", item.existingId), payload, {
            merge: true,
          });
          return;
        }

        batch.set(doc(collection(db, "classes", classId, "titles")), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: userData.uid,
          createdByName: issuerName,
        });
      });

      await batch.commit();
      showFeedback(`칭호 ${validRows.length}건을 반영했습니다.`, "success");
      setFileName("");
      setRowsToImport([]);
      if (fileInputRef.current) fileInputRef.current.value = null;
    } catch (error) {
      console.error("[TitleDefinitionCatalogModal] upload error:", error);
      showFeedback(`칭호 업로드에 실패했습니다: ${error.message}`, "error");
    } finally {
      setIsUploading(false);
    }
  };

  const loadDeleteImpactRecords = async () => ({
    impactedOwnedTitles: [],
    impactedRequests: [],
  });

  const handleDeleteDefinitions = async () => {
    if (!classId || !userData?.uid || !deleteDialogState.ids.length) return;

    setIsDeleting(true);
    try {
      const result = await deleteTitleDefinitionsWithCleanup({
        classId,
        titleIds: deleteDialogState.ids,
        actorName: issuerName,
      });
      showFeedback(
        `칭호 정의 ${result?.deletedDefinitionCount || deleteDialogState.ids.length}개를 정리했습니다.`,
        "success",
      );
      closeDeleteDialog();
      clearDefinitionSelection();
    } catch (error) {
      console.error("[TitleDefinitionCatalogModal] delete error:", error);
      showFeedback("칭호 정의를 정리하지 못했습니다.", "error");
    } finally {
      setIsDeleting(false);
    }
    if (deleteDialogState.ids.length < 0) {
      const deleteIdSet = new Set(deleteDialogState.ids);

    setIsDeleting(true);
    try {
      const { impactedOwnedTitles, impactedRequests } =
        await loadDeleteImpactRecords(deleteIdSet);
      const operations = [];

      deleteDialogState.ids.forEach((titleId) => {
        operations.push({
          type: "update",
          ref: doc(db, "classes", classId, "titles", titleId),
          data: {
            isDeleted: true,
            isActive: false,
            isVisible: false,
            deletedAt: serverTimestamp(),
            deletedByUid: userData.uid,
            deletedByName: issuerName,
            updatedAt: serverTimestamp(),
            updatedByUid: userData.uid,
            updatedByName: issuerName,
          },
        });
      });

      impactedOwnedTitles.forEach((item) => {
        operations.push({
          type: "update",
          ref: doc(
            db,
            "classes",
            classId,
            "students",
            item.studentUid,
            "ownedTitles",
            item.id,
          ),
          data: {
            isRevoked: true,
            revokedAt: serverTimestamp(),
            revokedByUid: userData.uid,
            revokedByName: issuerName,
            revokeReason: "삭제된 칭호 정의와 연결된 기록입니다.",
            equipped: false,
            updatedAt: serverTimestamp(),
          },
        });
      });

      impactedRequests.forEach((item) => {
        const requestUpdate = {
          definitionDeleted: true,
          status:
            (item.status || "pending") === "pending"
              ? "rejected"
              : item.status || "rejected",
          reviewedAt: serverTimestamp(),
          reviewedByUid: userData.uid,
          reviewedByName: issuerName,
          reviewMessage: "삭제된 칭호 정의와 연결된 요청입니다.",
          updatedAt: serverTimestamp(),
        };

        operations.push({
          type: "update",
          ref: doc(db, "classes", classId, "titleRequests", item.id),
          data: requestUpdate,
        });
        operations.push({
          type: "update",
          ref: doc(
            db,
            "classes",
            classId,
            "students",
            item.studentUid,
            "titleRequests",
            item.titleId,
          ),
          data: requestUpdate,
        });
      });

      await commitWriteOperations(operations);
      showFeedback(
        `칭호 정의 ${deleteDialogState.ids.length}건을 삭제했습니다.`,
        "success",
      );
      await onRebuildTeacherSummary?.();
      closeDeleteDialog();
      clearDefinitionSelection();
    } catch (error) {
      console.error("[TitleDefinitionCatalogModal] delete error:", error);
      showFeedback("칭호 정의를 삭제하지 못했습니다.", "error");
    } finally {
      setIsDeleting(false);
    }
    }
  };

  const catalogContent = (
    <div className="space-y-5">
          <div className="sticky top-0 z-10 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  칭호 관리
                </p>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {items.length}개 칭호 관리 중
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={XLSX_IMPORT_ACCEPT}
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button size="sm" tone="indigo" icon={Plus} onClick={onCreate}>
                  칭호 만들기
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={() => setImportPanelOpen((prev) => !prev)}
                  icon={Upload}
                >
                  일괄 등록
                </Button>
                {canDeleteDefinitions ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="red"
                    onClick={() => setDangerPanelOpen((prev) => !prev)}
                    disabled={!items.length}
                    icon={Trash2}
                  >
                    위험 작업
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {canDeleteDefinitions && dangerPanelOpen ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-bold text-rose-900">전체 삭제는 신중하게 진행해 주세요.</p>
                  <p className="mt-1 text-xs leading-5 text-rose-700">
                    등록된 칭호 정의와 연결된 보유/요청 기록까지 정리될 수 있습니다.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  tone="red"
                  onClick={() => openDeleteDialog(items.map((item) => item.id), "all")}
                  disabled={cleanupLoading || !items.length}
                  icon={Trash2}
                >
                  전체 삭제
                </Button>
              </div>
            </div>
          ) : null}

          {importPanelOpen || rowsToImport.length || isProcessing ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1 text-sm text-slate-600">
                <p>엑셀 업로드는 새 칭호 추가와 기존 칭호 수정 둘 다 처리합니다.</p>
                <p>학생 공개 방식은 업로드되는 칭호 전체에 공통으로 적용됩니다.</p>
                <p>정리된 엑셀을 다시 올리기 전, 여기서 선택 삭제나 전체 삭제를 먼저 진행할 수 있습니다.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {fileName ? <Badge tone="slate">{fileName}</Badge> : null}
                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={handleDownloadSample}
                  icon={Download}
                >
                  샘플 다운로드
                </Button>
                <Button
                  size="sm"
                  tone="slate"
                  onClick={() => fileInputRef.current?.click()}
                  icon={Upload}
                  disabled={isProcessing || isUploading}
                >
                  엑셀 불러오기
                </Button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/80 bg-white/80 p-4">
              <div className="grid gap-4 md:grid-cols-3">
                <SelectField
                  label="이름 공개"
                  value={bulkUploadRevealConfig.name}
                  onChange={(event) =>
                    handleBulkUploadRevealField("name", event.target.value)
                  }
                  options={TITLE_REVEAL_VISIBILITY_OPTIONS}
                  disabled={isProcessing || isUploading}
                />
                <SelectField
                  label="조건 공개"
                  value={bulkUploadRevealConfig.condition}
                  onChange={(event) =>
                    handleBulkUploadRevealField("condition", event.target.value)
                  }
                  options={TITLE_REVEAL_VISIBILITY_OPTIONS}
                  disabled={isProcessing || isUploading}
                />
                <SelectField
                  label="명패 공개"
                  value={bulkUploadRevealConfig.nameplate}
                  onChange={(event) =>
                    handleBulkUploadRevealField("nameplate", event.target.value)
                  }
                  options={TITLE_REVEAL_VISIBILITY_OPTIONS}
                  disabled={isProcessing || isUploading}
                />
              </div>
            </div>

            {isProcessing ? (
              <div className="mt-4 py-8">
                <Spinner />
              </div>
            ) : rowsToImport.length ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="emerald">신규 {importCounts.created}</Badge>
                    <Badge tone="blue">수정 {importCounts.updated}</Badge>
                    <Badge tone="red">오류 {importCounts.invalid}</Badge>
                    <Badge tone="slate">
                      이름 {getRevealVisibilityLabel(bulkUploadRevealConfig.name)}
                    </Badge>
                    <Badge tone="slate">
                      조건 {getRevealVisibilityLabel(bulkUploadRevealConfig.condition)}
                    </Badge>
                    <Badge tone="slate">
                      명패 {getRevealVisibilityLabel(bulkUploadRevealConfig.nameplate)}
                    </Badge>
                    <Badge tone="indigo">학생 요청 허용</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      tone="slate"
                      onClick={() => {
                        setFileName("");
                        setRowsToImport([]);
                        if (fileInputRef.current) fileInputRef.current.value = null;
                      }}
                    >
                      미리보기 비우기
                    </Button>
                    <Button
                      size="sm"
                      tone="indigo"
                      onClick={handleUploadRows}
                      isLoading={isUploading}
                      disabled={!rowsToImport.some((item) => item.status !== "invalid")}
                    >
                      업로드 반영
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50/90">
                      <tr className="text-left text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                        <th className="px-4 py-3">상태</th>
                        <th className="px-4 py-3">칭호명</th>
                        <th className="px-4 py-3">획득 조건</th>
                        <th className="px-4 py-3">등급 / 카테고리</th>
                        <th className="px-4 py-3">학생 도감 노출</th>
                        <th className="px-4 py-3">반영 방식</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {rowsToImport.map((row) => {
                        const rowKey = `${row.rowNumber}-${row.name}`;

                        return (
                          <tr
                            key={rowKey}
                            className={
                              row.status === "invalid"
                                ? "bg-rose-50/70"
                                : row.status === "update"
                                  ? "bg-blue-50/60"
                                  : "bg-emerald-50/50"
                            }
                          >
                            <td className="px-4 py-4">
                              <Badge
                                tone={
                                  row.status === "invalid"
                                    ? "red"
                                    : row.status === "update"
                                      ? "blue"
                                      : "emerald"
                                }
                              >
                                {row.status === "invalid"
                                  ? "오류"
                                  : row.status === "update"
                                    ? "수정"
                                    : "신규"}
                              </Badge>
                            </td>
                            <td className="px-4 py-4">
                              <div className="space-y-1">
                                <p className="font-bold text-slate-900">{row.name}</p>
                                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                  <span>행 {row.rowNumber}</span>
                                  <span>번호 {formatDexNumber(row.displayOrder)}</span>
                                  <span>{row.categoryLabel}</span>
                                </div>
                                {row.errorMessage ? (
                                  <p className="text-xs text-rose-600">
                                    {row.errorMessage}
                                  </p>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-4 text-slate-600">
                              {row.acquisitionCondition || "-"}
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap gap-2">
                                <Badge tone="slate">{row.gradeLabel}</Badge>
                                <Badge tone="blue">{row.categoryLabel}</Badge>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-3">
                                <ToggleSwitch
                                  checked={row.isVisible !== false}
                                  onChange={(checked) =>
                                    updateImportRowVisibility(rowKey, checked)
                                  }
                                  disabled={isUploading}
                                />
                                <Badge
                                  tone={row.isVisible !== false ? "blue" : "amber"}
                                >
                                  {row.isVisible !== false ? "노출" : "숨김"}
                                </Badge>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-slate-600">
                              {row.status === "update" ? "기존 정의 수정" : "새 정의 추가"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr),220px,220px,180px] xl:items-end">
              <InputField
                label="칭호 검색"
                value={definitionSearch}
                onChange={(event) => setDefinitionSearch(event.target.value)}
                placeholder="칭호명, 조건, 설명, 번호로 찾기"
              />
              <SelectField
                label="등급"
                value={definitionGradeFilter}
                onChange={(event) => setDefinitionGradeFilter(event.target.value)}
                options={[
                  { value: "all", label: "전체 등급" },
                  ...titleGrades.map((grade) => ({
                    value: grade.id,
                    label: grade.label,
                  })),
                ]}
              />
              <SelectField
                label="카테고리"
                value={definitionCategoryFilter}
                onChange={(event) => setDefinitionCategoryFilter(event.target.value)}
                options={[
                  { value: "all", label: "전체 카테고리" },
                  ...titleCategoryOptions.map((category) => ({
                    value: category.value,
                    label: category.label,
                  })),
                ]}
              />
              <SelectField
                label="상태"
                value={definitionStatusFilter}
                onChange={(event) => setDefinitionStatusFilter(event.target.value)}
                options={[
                  { value: "all", label: "전체 상태" },
                  { value: "visible", label: "학생 공개" },
                  { value: "hidden", label: "학생 숨김" },
                  { value: "inactive", label: "비활성" },
                ]}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {items.length}개 중 {filteredDefinitionItems.length}개 표시
              </span>
              <div className="flex flex-wrap gap-2">
                {definitionSearch ||
                definitionGradeFilter !== "all" ||
                definitionCategoryFilter !== "all" ||
                definitionStatusFilter !== "all" ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    tone="slate"
                    onClick={() => {
                      setDefinitionSearch("");
                      setDefinitionGradeFilter("all");
                      setDefinitionCategoryFilter("all");
                      setDefinitionStatusFilter("all");
                    }}
                  >
                    필터 초기화
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="py-12">
              <Spinner />
            </div>
          ) : items.length ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-1">
                  <Button
                    size="sm"
                    tone={definitionViewMode === "list" ? "indigo" : "slate"}
                    variant={definitionViewMode === "list" ? "secondary" : "ghost"}
                    icon={List}
                    onClick={() => setDefinitionViewMode("list")}
                  >
                    목록형
                  </Button>
                  <Button
                    size="sm"
                    tone={definitionViewMode === "nameplate" ? "indigo" : "slate"}
                    variant={definitionViewMode === "nameplate" ? "secondary" : "ghost"}
                    icon={LayoutGrid}
                    onClick={() => setDefinitionViewMode("nameplate")}
                  >
                    명패형
                  </Button>
                </div>
              </div>

              {cleanupLoading ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  학생 보유 기록 또는 요청 기록을 정리하는 중에는 삭제 작업을 잠시 막아 두었습니다.
                </div>
              ) : null}

              {!filteredDefinitionItems.length ? (
                <EmptyState
                  icon={Medal}
                  title="검색 결과가 없습니다"
                  description="검색어나 필터를 조정하면 다른 칭호를 찾을 수 있습니다."
                />
              ) : definitionViewMode === "list" ? (
                <TitleDefinitionListTable
                  items={displayedListItems}
                  selectedDefinitionIds={selectedDefinitionIds}
                  allSelected={allDefinitionsSelected}
                  onToggleSelection={toggleDefinitionSelection}
                  onToggleAllSelection={toggleAllDefinitions}
                  onReorder={handleReorderDefinitions}
                  onEdit={onEdit}
                  cleanupLoading={cleanupLoading}
                  isSavingOrder={isSavingOrder}
                  formatDexNumber={formatDexNumber}
                  onItemMouseDown={handleDefinitionMouseDown}
                  onItemMouseEnter={handleDefinitionMouseEnter}
                  enableReorder={listSortMode === "display-order-asc"}
                  listSortMode={listSortMode}
                  onToggleSort={(key) =>
                    setListSortMode((prev) => {
                      if (key === "category") {
                        return prev === "category-asc"
                          ? "category-desc"
                          : "category-asc";
                      }

                      if (key === "grade") {
                        return prev === "grade-asc"
                          ? "grade-desc"
                          : "grade-asc";
                      }

                      return prev === "display-order-asc"
                        ? "display-order-desc"
                        : "display-order-asc";
                    })
                  }
                />
              ) : (
                <>
                  <TitleDefinitionNameplateGrid
                    items={filteredDefinitionItems}
                    selectedDefinitionIds={selectedDefinitionIds}
                    onToggleSelection={toggleDefinitionSelection}
                    onEdit={onEdit}
                    formatDexNumber={formatDexNumber}
                    onItemMouseDown={handleDefinitionMouseDown}
                    onItemMouseEnter={handleDefinitionMouseEnter}
                  />
                <div className="hidden">
                  {filteredDefinitionItems.map((item) => {
                    const isSelected = selectedDefinitionIds.includes(item.id);

                    return (
                      <div
                        key={item.id}
                        onMouseDown={(event) => handleDefinitionMouseDown(item, event)}
                        onMouseEnter={() => handleDefinitionMouseEnter(item)}
                        className={[
                          "relative cursor-pointer select-none rounded-[28px] transition",
                          isSelected
                            ? "ring-2 ring-rose-300 ring-offset-2 ring-offset-white"
                            : "",
                        ].join(" ")}
                      >
                        <div
                          data-no-selection="true"
                          className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/90 bg-white/90 px-3 py-1.5 shadow-sm"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDefinitionSelection(item.id)}
                            aria-label={`${item.name} 선택`}
                            className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                          />
                          <span className="text-xs font-semibold text-slate-600">
                            {isSelected ? "선택됨" : "클릭 선택"}
                          </span>
                        </div>
                        <TitleShowcaseCard
                          item={{
                            ...item,
                            description: item.acquisitionCondition
                              ? `${item.description ? `${item.description}\n\n` : ""}획득 조건: ${item.acquisitionCondition}`
                              : item.description,
                          }}
                          statusSlot={
                            <>
                              <Badge tone="slate">
                                No. {formatDexNumber(item.displayOrder)}
                              </Badge>
                              {item.isActive === false ? (
                                <Badge tone="slate">지급 제외</Badge>
                              ) : null}
                              {item.isVisible === false ? (
                                <Badge tone="amber">학생 숨김</Badge>
                              ) : null}
                              {isSelected ? (
                                <Badge tone="rose">선택됨</Badge>
                              ) : null}
                            </>
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                </>
              )}

              <BulkActionFloatingBar
                count={selectedDefinitionItems.length}
                eyebrow="선택 작업"
                title={`선택한 칭호 ${selectedDefinitionItems.length}개`}
                subtitle={
                  selectedDefinitionItems.length === 1
                    ? "선택한 칭호에 같은 명패 스타일을 적용하거나 삭제할 수 있습니다."
                    : "여러 칭호에 같은 명패 스타일을 한 번에 적용하거나 삭제할 수 있습니다."
                }
                tone="indigo"
                placement="fixed"
                zIndex={120}
                actions={[
                  {
                    key: "bulk-edit",
                    label:
                      selectedDefinitionItems.length === 1
                        ? "공개/등급 편집"
                        : `일괄 편집 ${selectedDefinitionItems.length}개`,
                    icon: Pencil,
                    tone: "slate",
                    onClick: openBulkEditModal,
                  },
                  {
                    key: "style",
                    label:
                      selectedDefinitionItems.length === 1
                        ? "명패 디자인"
                        : `명패 디자인 ${selectedDefinitionItems.length}개`,
                    icon: LayoutGrid,
                    tone: "indigo",
                    onClick: () => openStyleApplyModal(),
                  },
                  ...(canDeleteDefinitions ? [{
                    key: "delete",
                    label: `선택 삭제 ${selectedDefinitionItems.length}개`,
                    icon: Trash2,
                    tone: "rose",
                    onClick: () =>
                      openDeleteDialog(
                        selectedDefinitionItems.map((item) => item.id),
                        "selected",
                      ),
                    disabled: cleanupLoading,
                  }] : []),
                ]}
                onClear={clearDefinitionSelection}
                clearLabel="선택 해제"
              />
            </div>
          ) : (
            <EmptyState
              icon={Medal}
              title="등록된 칭호가 아직 없습니다"
              description="첫 칭호를 만들거나 엑셀 업로드로 한 번에 불러와 보세요."
            />
          )}
    </div>
  );

  return (
    <>
      {embedded ? (
        catalogContent
      ) : (
        <Modal
          isOpen={open}
          onClose={onClose}
          title="칭호 정의 관리"
          size="max-w-[88rem]"
        >
          {catalogContent}
        </Modal>
      )}

      <TitleStyleDesignerModal
        open={styleApplyState.open}
        onClose={closeStyleApplyModal}
        onApply={handleApplyDefinitionStyles}
        initialStyle={styleApplyItems[0]}
        titleLabel={
          styleApplyItems.length > 1
            ? `선택한 칭호 ${styleApplyItems.length}개`
            : styleApplyItems[0]?.name || "칭호 명패"
        }
      />

      <Modal
        isOpen={bulkEditState.open}
        onClose={closeBulkEditModal}
        title="선택 칭호 일괄 편집"
        size="lg"
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-sm font-bold text-slate-900">
              선택한 칭호 {selectedDefinitionItems.length}개에 같은 값을 한 번에 적용합니다.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              바꾸고 싶은 항목만 선택하면 되고, `변경 안 함`으로 두면 기존 값을 그대로 유지합니다.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-5">
            <div className="grid gap-4 md:col-span-3 md:grid-cols-3">
              <SelectField
                label="이름 공개"
                value={bulkEditState.revealConfig.name}
                onChange={(event) =>
                  handleBulkEditRevealField("name", event.target.value)
                }
                options={[
                  { value: KEEP_VALUE, label: "변경 안 함" },
                  ...TITLE_REVEAL_VISIBILITY_OPTIONS,
                ]}
                disabled={bulkEditSubmitting}
              />
              <SelectField
                label="조건 공개"
                value={bulkEditState.revealConfig.condition}
                onChange={(event) =>
                  handleBulkEditRevealField("condition", event.target.value)
                }
                options={[
                  { value: KEEP_VALUE, label: "변경 안 함" },
                  ...TITLE_REVEAL_VISIBILITY_OPTIONS,
                ]}
                disabled={bulkEditSubmitting}
              />
              <SelectField
                label="명패 공개"
                value={bulkEditState.revealConfig.nameplate}
                onChange={(event) =>
                  handleBulkEditRevealField("nameplate", event.target.value)
                }
                options={[
                  { value: KEEP_VALUE, label: "변경 안 함" },
                  ...TITLE_REVEAL_VISIBILITY_OPTIONS,
                ]}
                disabled={bulkEditSubmitting}
              />
            </div>
            <SelectField
              label="등급"
              value={bulkEditState.gradeId}
              onChange={(event) => handleBulkEditField("gradeId", event.target.value)}
              options={[
                { value: KEEP_VALUE, label: "변경 안 함" },
                ...titleGrades.map((item) => ({
                  value: item.id,
                  label: item.label,
                })),
              ]}
              disabled={bulkEditSubmitting}
            />
            <SelectField
              label="카테고리"
              value={bulkEditState.categoryId}
              onChange={(event) => handleBulkEditField("categoryId", event.target.value)}
              options={[
                { value: KEEP_VALUE, label: "변경 안 함" },
                ...titleCategoryOptions.map((item) => ({
                  value: item.value,
                  label: item.label,
                })),
              ]}
              disabled={bulkEditSubmitting}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-sm font-bold text-slate-900">적용 대상</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedDefinitionItems.slice(0, 12).map((item) => (
                <Badge key={`bulk-edit-${item.id}`} tone="slate">
                  {item.name}
                </Badge>
              ))}
              {selectedDefinitionItems.length > 12 ? (
                <Badge tone="slate">+{selectedDefinitionItems.length - 12}개</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={closeBulkEditModal} disabled={bulkEditSubmitting}>
              취소
            </Button>
            <Button tone="indigo" onClick={handleBulkEditDefinitions} isLoading={bulkEditSubmitting}>
              일괄 적용
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={canDeleteDefinitions && deleteDialogState.open}
        onClose={closeDeleteDialog}
        title={deleteDialogState.mode === "all" ? "칭호 전체 삭제" : "칭호 삭제"}
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
            <p className="text-sm font-bold text-rose-900">
              삭제하면 칭호 정의뿐 아니라 연결된 학생 보유 기록과 요청 기록도 함께 정리됩니다.
            </p>
            <p className="mt-2 text-sm leading-6 text-rose-800">
              이미 지급된 칭호도 회수 처리되므로, 다시 사용하려면 칭호 정의를 새로 만들거나 엑셀로 다시 업로드해 주세요.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                칭호 정의
              </p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {deleteImpact.definitionCount}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                학생 보유 기록
              </p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {deleteImpact.ownedTitleCount}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                요청 기록
              </p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {deleteImpact.requestCount}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-sm font-bold text-slate-900">삭제 대상</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {items
                .filter((item) => deleteDialogState.ids.includes(item.id))
                .slice(0, 8)
                .map((item) => (
                  <Badge key={`delete-target-${item.id}`} tone="slate">
                    {item.name}
                  </Badge>
                ))}
              {deleteDialogState.ids.length > 8 ? (
                <Badge tone="slate">+{deleteDialogState.ids.length - 8}개</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={closeDeleteDialog} disabled={isDeleting}>
              취소
            </Button>
            <Button
              tone="red"
              onClick={handleDeleteDefinitions}
              isLoading={isDeleting}
              icon={Trash2}
            >
              {deleteDialogState.mode === "all" ? "전체 삭제 진행" : "삭제 진행"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default TitleDefinitionCatalogModal;
