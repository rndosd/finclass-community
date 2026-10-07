import { deleteField, serverTimestamp } from "firebase/firestore";

import { STORE_CATEGORY_TYPE_VIP } from "./vipLounge";

export function buildVipLoungeWriteData({
  formData,
  selectedCreditTier,
  selectedStudents,
  isEditMode,
  teacherUid,
  name,
  entryCode,
  accessMode,
}) {
  const allowedStudentUids = Array.from(
    new Set(
      (formData.allowedStudentUids || [])
        .map((uid) => String(uid).trim())
        .filter(Boolean),
    ),
  );
  const selectedStudentNames = selectedStudents
    .map((student) => String(student?.name || "").trim())
    .filter(Boolean);
  const baseData = {
    name,
    loungeTagline: formData.loungeTagline || "",
    type: STORE_CATEGORY_TYPE_VIP,
    icon: "Sparkles",
    iconColor: "slate",
    entryCode,
    vipAccessMode: accessMode,
    loungeImageUrl: formData.loungeImageUrl || "",
    loungeDescriptionHtml: formData.loungeDescriptionHtml || "",
    benefitsHtml: formData.benefitsHtml || "",
    isActive: formData.isActive,
    updatedAt: serverTimestamp(),
    teacherUid: teacherUid || null,
  };

  if (selectedCreditTier) {
    baseData.minCreditTierId = selectedCreditTier.id;
    baseData.minCreditTierName = selectedCreditTier.name;
    baseData.minCreditTierMinScore = selectedCreditTier.minScore;
    baseData.minCreditTier = {
      id: selectedCreditTier.id,
      name: selectedCreditTier.name,
      minScore: selectedCreditTier.minScore,
      color: selectedCreditTier.color || null,
    };
  }

  baseData.allowedStudentUids = allowedStudentUids;
  baseData.allowedStudentNames = selectedStudentNames;
  baseData.allowedStudentCount = allowedStudentUids.length;

  if (isEditMode && !selectedCreditTier) {
    baseData.minCreditTierId = deleteField();
    baseData.minCreditTierName = deleteField();
    baseData.minCreditTierMinScore = deleteField();
    baseData.minCreditTier = deleteField();
  }

  if (isEditMode) baseData.vipStudentUids = deleteField();

  if (isEditMode && !formData.loungeImageUrl) {
    baseData.loungeImageUrl = deleteField();
    baseData.loungeDescriptionImageUrl = deleteField();
    baseData.benefitsImageUrl = deleteField();
  }

  if (isEditMode && formData.loungeImageUrl) {
    baseData.loungeDescriptionImageUrl = deleteField();
    baseData.benefitsImageUrl = deleteField();
  }

  return baseData;
}

export function buildNewVipLoungeWriteData(options) {
  return {
    ...buildVipLoungeWriteData(options),
    createdAt: serverTimestamp(),
    order: Math.floor(Date.now() / 1000),
  };
}
