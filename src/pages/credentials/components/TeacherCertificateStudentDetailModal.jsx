import { CheckCircle2, Lock, Trash2 } from "lucide-react";

import { Badge, Button, Card, Modal, Spinner } from "../../../components/ui";
import {
  buildCertificateStatus,
  CertificateRecordCard,
  EmptyState,
} from "../CredentialsPage.parts";

export default function TeacherCertificateStudentDetailModal({
  open,
  onClose,
  studentLabel,
  items = [],
  isLoading,
  onToggleRevocation,
  canManageActions = false,
}) {
  if (!open) return null;

  const activeCount = items.filter((item) => !item.isRevoked).length;
  const revokedCount = items.length - activeCount;

  return (
    <Modal isOpen={open} onClose={onClose} title={`${studentLabel} 자격증 보유 현황`} size="xl">
      <Card className="overflow-hidden border-slate-200 bg-white" variant="elevated" tone="white" noShadow>
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Badge tone={activeCount ? "emerald" : "slate"}>보유 {activeCount}개</Badge>
          <Badge tone={revokedCount ? "red" : "slate"}>회수 {revokedCount}건</Badge>
        </div>
        {isLoading ? (
          <div className="py-12"><Spinner /></div>
        ) : items.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <CertificateRecordCard
                key={item.ownedId}
                item={item}
                status={buildCertificateStatus(item)}
                action={canManageActions ? (
                  <Button
                    size="sm"
                    variant="outline"
                    tone={item.isRevoked ? "emerald" : "red"}
                    onClick={() => onToggleRevocation(item)}
                    icon={item.isRevoked ? CheckCircle2 : Trash2}
                  >
                    {item.isRevoked ? "복구" : "회수"}
                  </Button>
                ) : null}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={Lock} title="보유한 자격증이 없습니다" description="자격증을 발급하면 이 학생의 상세 현황에 표시됩니다." />
        )}
      </Card>
    </Modal>
  );
}
