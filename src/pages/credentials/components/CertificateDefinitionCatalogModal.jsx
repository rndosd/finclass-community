import { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { GraduationCap, LayoutGrid, List, Plus, Trash2 } from "lucide-react";

import { db } from "../../../firebase";
import {
  Alert,
  BulkActionFloatingBar,
  Button,
  Modal,
  Spinner,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import CertificateDefinitionListTable from "./CertificateDefinitionListTable";
import CertificateDefinitionPreviewGrid from "./CertificateDefinitionPreviewGrid";
import { EmptyState, SectionLead, formatDexNumber } from "../CredentialsPage.parts";

function CertificateDefinitionCatalogModal({
  open,
  onClose,
  items,
  isLoading,
  onCreate,
  onEdit,
  canDeleteDefinitions = false,
}) {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();

  const [viewMode, setViewMode] = useState("list");
  const [selectedDefinitionIds, setSelectedDefinitionIds] = useState([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [deleteDialogState, setDeleteDialogState] = useState({
    open: false,
    ids: [],
  });
  const [isDeleting, setIsDeleting] = useState(false);

  const issuerName =
    userData?.name || userData?.teacherDisplayName || userData?.uid || "교사";

  useEffect(() => {
    if (open) return;
    setViewMode("list");
    setSelectedDefinitionIds([]);
    setIsSavingOrder(false);
    setDeleteDialogState({
      open: false,
      ids: [],
    });
    setIsDeleting(false);
  }, [open]);

  useEffect(() => {
    const validIds = new Set(items.map((item) => item.id));
    setSelectedDefinitionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [items]);

  const selectedDefinitionItems = useMemo(
    () => items.filter((item) => selectedDefinitionIds.includes(item.id)),
    [items, selectedDefinitionIds],
  );

  const allDefinitionsSelected = useMemo(
    () =>
      items.length > 0 &&
      items.every((item) => selectedDefinitionIds.includes(item.id)),
    [items, selectedDefinitionIds],
  );

  const toggleDefinitionSelection = (definitionId) => {
    setSelectedDefinitionIds((prev) =>
      prev.includes(definitionId)
        ? prev.filter((item) => item !== definitionId)
        : [...prev, definitionId],
    );
  };

  const toggleAllDefinitions = () => {
    setSelectedDefinitionIds((prev) => {
      const currentIds = items.map((item) => item.id);
      const isEverySelected =
        currentIds.length > 0 && currentIds.every((id) => prev.includes(id));

      return isEverySelected ? [] : currentIds;
    });
  };

  const clearDefinitionSelection = () => {
    setSelectedDefinitionIds([]);
  };

  const persistDefinitionOrder = async (orderedItems) => {
    if (!classId || !userData?.uid) return;
    setIsSavingOrder(true);

    try {
      const batch = writeBatch(db);

      orderedItems.forEach((item, index) => {
        batch.update(doc(db, "classes", classId, "certificates", item.id), {
          displayOrder: index + 1,
          updatedAt: serverTimestamp(),
          updatedByUid: userData.uid,
          updatedByName: issuerName,
        });
      });

      await batch.commit();
      showFeedback("자격증 순서를 저장했습니다.", "success");
    } catch (error) {
      console.error("[CertificateDefinitionCatalogModal] reorder error:", error);
      showFeedback("자격증 순서를 저장하지 못했습니다.", "error");
      throw error;
    } finally {
      setIsSavingOrder(false);
    }
  };

  const openDeleteDialog = (ids) => {
    if (!ids.length) return;
    setDeleteDialogState({
      open: true,
      ids,
    });
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteDialogState({
      open: false,
      ids: [],
    });
  };

  const deleteImpactCount = deleteDialogState.ids.length;

  const handleDeleteDefinitions = async () => {
    if (!classId || !userData?.uid || !deleteDialogState.ids.length) return;
    setIsDeleting(true);

    try {
      const batch = writeBatch(db);

      deleteDialogState.ids.forEach((id) => {
        batch.update(doc(db, "classes", classId, "certificates", id), {
          isDeleted: true,
          updatedAt: serverTimestamp(),
          updatedByUid: userData.uid,
          updatedByName: issuerName,
        });
      });

      await batch.commit();
      showFeedback(
        `${deleteDialogState.ids.length}개의 자격증 정의를 정리했습니다.`,
        "success",
      );
      setSelectedDefinitionIds((prev) =>
        prev.filter((id) => !deleteDialogState.ids.includes(id)),
      );
      closeDeleteDialog();
    } catch (error) {
      console.error("[CertificateDefinitionCatalogModal] delete error:", error);
      showFeedback("자격증 정의를 삭제하지 못했습니다.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={open}
        onClose={onClose}
        title="자격증 정의 관리"
        size="xl"
      >
        <div className="space-y-5">
          <SectionLead
            eyebrow="정의 관리"
            title="자격증 정의 목록"
            description="목록형과 미리보기형을 오가며 자격증 정의를 정리하고 순서를 관리할 수 있습니다."
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={viewMode === "list" ? "secondary" : "outline"}
                  tone={viewMode === "list" ? "blue" : "slate"}
                  aria-pressed={viewMode === "list"}
                  icon={List}
                  onClick={() => setViewMode("list")}
                >
                  목록형
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "preview" ? "secondary" : "outline"}
                  tone={viewMode === "preview" ? "blue" : "slate"}
                  aria-pressed={viewMode === "preview"}
                  icon={LayoutGrid}
                  onClick={() => setViewMode("preview")}
                >
                  미리보기형
                </Button>
                <Button size="sm" tone="blue" icon={Plus} onClick={onCreate}>
                  자격증 추가
                </Button>
              </div>
            }
          />

          <Alert
            type="info"
            message="자격증 정의를 삭제하면 정의 목록에서는 숨겨지지만, 이미 발급된 기록은 학생 보관함에 남을 수 있습니다."
          />

          {isLoading ? (
            <div className="py-16">
              <Spinner />
            </div>
          ) : items.length ? (
            <div className="space-y-4">
              {viewMode === "list" ? (
                <CertificateDefinitionListTable
                  items={items}
                  selectedDefinitionIds={selectedDefinitionIds}
                  allSelected={allDefinitionsSelected}
                  onToggleSelection={toggleDefinitionSelection}
                  onToggleAllSelection={toggleAllDefinitions}
                  onReorder={persistDefinitionOrder}
                  onEdit={onEdit}
                  isSavingOrder={isSavingOrder}
                  formatDexNumber={formatDexNumber}
                />
              ) : (
                <CertificateDefinitionPreviewGrid
                  items={items}
                  selectedDefinitionIds={selectedDefinitionIds}
                  onToggleSelection={toggleDefinitionSelection}
                  onEdit={onEdit}
                  formatDexNumber={formatDexNumber}
                />
              )}

              {canDeleteDefinitions ? <BulkActionFloatingBar
                count={selectedDefinitionItems.length}
                eyebrow="선택 작업"
                title={`선택한 자격증 ${selectedDefinitionItems.length}개`}
                subtitle="선택한 자격증 정의를 한 번에 정리할 수 있습니다."
                tone="indigo"
                placement="sticky"
                actions={[
                  {
                    key: "delete",
                    label: `선택 삭제 ${selectedDefinitionItems.length}개`,
                    icon: Trash2,
                    tone: "rose",
                    onClick: () =>
                      openDeleteDialog(
                        selectedDefinitionItems.map((item) => item.id),
                      ),
                  },
                ]}
                onClear={clearDefinitionSelection}
                clearLabel="선택 해제"
              /> : null}
            </div>
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="등록된 자격증이 아직 없습니다"
              description="첫 자격증을 만들면 학생 보관함과 발급 화면에 바로 연결됩니다."
            />
          )}
        </div>
      </Modal>

      <Modal
        isOpen={canDeleteDefinitions && deleteDialogState.open}
        onClose={closeDeleteDialog}
        title="자격증 정의 삭제"
        size="md"
      >
        <div className="space-y-5">
          <Alert
            type="warning"
            message={`선택한 자격증 정의 ${deleteImpactCount}개를 숨깁니다. 이미 발급된 기록은 남을 수 있으니 필요한지 다시 확인해 주세요.`}
          />

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button
              variant="outline"
              tone="slate"
              onClick={closeDeleteDialog}
              disabled={isDeleting}
            >
              취소
            </Button>
            <Button
              tone="rose"
              icon={Trash2}
              onClick={handleDeleteDefinitions}
              isLoading={isDeleting}
            >
              삭제하기
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default CertificateDefinitionCatalogModal;
