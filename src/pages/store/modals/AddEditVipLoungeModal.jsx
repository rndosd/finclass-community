import React, { useEffect, useMemo, useState } from "react";
import {
  Crown,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

import {
  Button,
  InputField,
  Modal,
  ModernRichEditor,
  StudentSelector,
  ToggleSwitch,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { useClassStudents } from "../../../hooks/user/useClassStudents";
import { stripHtmlToText } from "../utils/vipLounge";
import {
  buildNewVipLoungeWriteData,
  buildVipLoungeWriteData,
} from "../utils/vipLoungePayload";

const TEXT = {
  titleCreate: "VIP \uB77C\uC6B4\uC9C0 \uCD94\uAC00",
  titleEdit: "VIP \uB77C\uC6B4\uC9C0 \uC218\uC815",
  subtitle:
    "\uB77C\uC6B4\uC9C0\uC5D0 \uD45C\uC2DC\uD560 \uC774\uB984, \uD55C \uC904 \uC18C\uAC1C, \uC785\uC7A5 \uAE30\uC900\uACFC \uC548\uB0B4\uB97C \uC124\uC815\uD569\uB2C8\uB2E4.",
  basicInfo: "\uB77C\uC6B4\uC9C0 \uAE30\uBCF8 \uC815\uBCF4",
  loungeName: "VIP \uB77C\uC6B4\uC9C0 \uC774\uB984",
  loungeNamePlaceholder:
    "\uC608: \uC544\uB9AC\uC2A4\uD1A0\uD154\uB808\uC2A4 \uB77C\uC6B4\uC9C0",
  loungeTagline: "\uD55C \uC904 \uC18C\uAC1C",
  loungeTaglinePlaceholder:
    "\uC608: \uC120\uC0DD\uB2D8\uC774 \uC900\uBE44\uD55C \uD2B9\uBCC4 \uACF5\uAC04\uC5D0\uC11C \uC804\uC6A9 \uC0C1\uD488\uC744 \uB9CC\uB098 \uBCF4\uC138\uC694.",
  loungeTaglineHint: "\uD559\uC0DD \uD654\uBA74 \uC81C\uBAA9 \uC544\uB798\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4. (80\uC790 \uC774\uB0B4)",
  entryCode: "\uD559\uC0DD \uCD08\uB300 \uCF54\uB4DC",
  entryCodePlaceholder:
    "\uD559\uC0DD\uC5D0\uAC8C \uC804\uB2EC\uD560 \uB77C\uC6B4\uC9C0 \uC785\uC7A5 \uCF54\uB4DC",
  entryCodeHint:
    "\uC785\uC7A5 \uAD8C\uD55C\uC774 \uC788\uB294 \uD559\uC0DD\uC774 \uB77C\uC6B4\uC9C0\uC5D0 \uC785\uC7A5\uD560 \uB54C \uC785\uB825\uD569\uB2C8\uB2E4. \uC800\uC7A5 \uD6C4 VIP \uD654\uBA74\uC5D0\uC11C \uBCF5\uC0AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  targetStudents: "\uC785\uC7A5 \uD559\uC0DD",
  accessMethod: "\uC785\uC7A5 \uAE30\uC900",
  accessCreditTierHelp:
    "\uC9C0\uC815\uD55C \uB4F1\uAE09 \uC774\uC0C1\uC758 \uD559\uC0DD\uC740 \uB4F1\uAE09\uC774 \uBC14\uB014 \uB54C\uB9C8\uB2E4 \uC790\uB3D9\uC73C\uB85C \uC785\uC7A5\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  accessHybridHelp:
    "\uC9C0\uC815\uD55C \uB4F1\uAE09 \uC774\uC0C1\uC774\uAC70\uB098, \uC120\uC0DD\uB2D8\uC774 \uCD94\uAC00\uB85C \uC120\uD0DD\uD55C \uD559\uC0DD\uC774\uBA74 \uC785\uC7A5\uD569\uB2C8\uB2E4.",
  extraStudents: "\uCD94\uAC00 \uC785\uC7A5 \uD559\uC0DD",
  minCreditTier: "\uCD5C\uC18C \uC2E0\uC6A9\uB4F1\uAE09",
  minCreditTierPlaceholder: "\uC785\uC7A5 \uAE30\uC900 \uB4F1\uAE09\uC744 \uC120\uD0DD\uD558\uC138\uC694",
  noCreditTiers:
    "\uC124\uC815\uB41C \uC2E0\uC6A9\uB4F1\uAE09\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC2E0\uC6A9\uB4F1\uAE09 \uC124\uC815\uC744 \uBA3C\uC800 \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
  selectedStudents: "\uC120\uD0DD\uB41C \uD559\uC0DD",
  studentSearchPlaceholder:
    "\uC774\uB984\uC774\uB098 \uBC88\uD638\uB85C \uD559\uC0DD \uCC3E\uAE30",
  noStudents: "\uD559\uC0DD \uBAA9\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
  creditHelp:
    "\uC120\uD0DD\uD55C \uD559\uC0DD\uB9CC \uCD08\uB300 \uCF54\uB4DC\uB97C \uC785\uB825\uD574 \uB77C\uC6B4\uC9C0\uC5D0 \uC785\uC7A5\uD558\uACE0 \uC804\uC6A9 \uC0C1\uD488\uC744 \uAD6C\uB9E4\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  layoutHelp:
    "\uD559\uC0DD \uD654\uBA74\uC5D0 \uBCF4\uC77C \uB77C\uC6B4\uC9C0 \uC774\uC57C\uAE30\uC640 \uC774\uC6A9 \uC548\uB0B4\uB97C \uC791\uC131\uD569\uB2C8\uB2E4.",
  imageEnabled: "\uC548\uB0B4 \uC785\uB825",
  imageOnly: "\uB77C\uC6B4\uC9C0 \uB300\uD45C \uC774\uBBF8\uC9C0",
  imageUpload: "\uC774\uBBF8\uC9C0 \uC62C\uB9AC\uAE30",
  imageReplace: "\uC774\uBBF8\uC9C0 \uBC14\uAFB8\uAE30",
  imageEdit: "\uC774\uBBF8\uC9C0 \uD3B8\uC9D1",
  imageEditTitle: "\uB300\uD45C \uC774\uBBF8\uC9C0 \uD3B8\uC9D1",
  imageEditHelp:
    "\uD559\uC0DD \uD654\uBA74\uC758 \uC640\uC774\uB4DC \uBC30\uACBD\uC5D0\uC11C \uC798 \uBCF4\uC77C \uC601\uC5ED\uC744 \uC870\uC815\uD569\uB2C8\uB2E4.",
  imageZoom: "\uD655\uB300",
  imagePositionX: "\uAC00\uB85C \uC704\uCE58",
  imagePositionY: "\uC138\uB85C \uC704\uCE58",
  imageReset: "\uCD08\uAE30\uD654",
  imageRemove: "\uC0AD\uC81C",
  imageHelp:
    "\uD559\uC0DD \uD654\uBA74\uC5D0\uC11C \uC640\uC774\uB4DC \uBC30\uACBD\uC73C\uB85C \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
  imageUploadError:
    "\uC774\uBBF8\uC9C0\uB97C \uC62C\uB9AC\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
  storyMeta: "\uB77C\uC6B4\uC9C0\uC758 \uC758\uBBF8\uC640 \uBD84\uC704\uAE30",
  benefitsMeta: "\uC774\uC6A9 \uAE30\uAC04\u00B7\uBC29\uBC95\u00B7\uC720\uC758\uC0AC\uD56D",
  storyPlaceholder:
    "\uB77C\uC6B4\uC9C0\uB97C \uB9CC\uB4E0 \uC774\uC720\uC640 \uD559\uC0DD\uB4E4\uC5D0\uAC8C \uC804\uD558\uACE0 \uC2F6\uC740 \uC774\uC57C\uAE30\uB97C \uC801\uC5B4 \uC8FC\uC138\uC694.",
  benefitsPlaceholder:
    "\uC774\uC6A9 \uAE30\uAC04, \uC2E0\uCCAD \uBC29\uBC95, \uC0C1\uD488 \uC0AC\uC6A9 \uC2DC \uC720\uC758\uC0AC\uD56D\uC744 \uC801\uC5B4 \uC8FC\uC138\uC694.",
  editText: "\uAE00 \uD3B8\uC9D1",
  apply: "\uC801\uC6A9",
  emptyText:
    "\uC544\uC9C1 \uC791\uC131\uB41C \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
  editorHelp:
    "\uC5EC\uAE30\uC11C \uAE00\uC744 \uAFB8\uBBF8\uBA74 \uC2E4\uC81C VIP \uB77C\uC6B4\uC9C0\uC758 \uC624\uB978\uCABD \uC124\uBA85 \uC601\uC5ED\uC5D0 \uADF8\uB300\uB85C \uBC18\uC601\uB429\uB2C8\uB2E4.",
  activeTitle: "\uB77C\uC6B4\uC9C0 \uD65C\uC131\uD654",
  activeHelp:
    "\uD65C\uC131\uD654\uB41C \uB77C\uC6B4\uC9C0\uB9CC \uC0C1\uC810 \uCE74\uD14C\uACE0\uB9AC\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
  cancel: "\uCDE8\uC18C",
  create: "\uB77C\uC6B4\uC9C0 \uCD94\uAC00",
  save: "\uB77C\uC6B4\uC9C0 \uC218\uC815",
  missingClass:
    "\uD559\uAE09 \uC815\uBCF4\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
  missingName:
    "VIP \uB77C\uC6B4\uC9C0 \uC774\uB984\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
  missingCode:
    "\uD559\uC0DD \uCD08\uB300 \uCF54\uB4DC\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
  missingStudents:
    "\uC785\uC7A5\uD560 VIP \uD559\uC0DD\uC744 \uD55C \uBA85 \uC774\uC0C1 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.",
  missingCreditTier:
    "\uC785\uC7A5 \uAE30\uC900\uC774 \uB420 \uC2E0\uC6A9\uB4F1\uAE09\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.",
  saved: "VIP \uB77C\uC6B4\uC9C0\uAC00 \uC218\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
  created: "VIP \uB77C\uC6B4\uC9C0\uAC00 \uCD94\uAC00\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
  saveError:
    "VIP \uB77C\uC6B4\uC9C0\uB97C \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
};

const normalizeCreditTierOption = (tier = {}) => {
  const id = String(tier?.id || tier?.name || "").trim();
  if (!id) return null;

  const parsedMinScore = Number(tier?.minScore);
  return {
    id,
    name: String(tier?.name || id).trim(),
    color: tier?.color || "#64748b",
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
  };
};

const sortCreditTiers = (tiers = []) =>
  [...tiers].sort((left, right) => {
    const scoreDelta = Number(right.minScore || 0) - Number(left.minScore || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return String(left.name || "").localeCompare(String(right.name || ""), "ko");
  });

const EMPTY_FORM = {
  name: "",
  entryCode: "",
  accessMode: "hybrid_or",
  allowedStudentUids: [],
  minCreditTierId: "",
  loungeTagline: "",
  loungeImageUrl: "",
  loungeDescriptionHtml: "",
  benefitsHtml: "",
  isActive: true,
};
const TextPreviewCard = ({
  title,
  meta,
  value,
  onEdit,
  disabled = false,
}) => {
  const preview = stripHtmlToText(value || "");

  return (
    <div className="min-w-0 border border-white/10 bg-white/[0.055] p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-200">
            {title}
          </p>
          <span className="mt-1 block text-[11px] font-semibold text-slate-400">
            {meta}
          </span>
        </div>
        <Button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          size="xs"
          tone="amber"
          kind="ghost"
          rounded="full"
          className="shrink-0 rounded-full border border-amber-200/35 bg-amber-200/10 px-3 py-1.5 text-xs font-black text-amber-100 transition hover:bg-amber-200 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {TEXT.editText}
        </Button>
      </div>
      <div className="min-h-[118px] border border-white/10 bg-black/20 px-4 py-3">
        <p
          className={`text-sm font-medium leading-relaxed ${
            preview ? "text-slate-200" : "text-slate-500"
          }`}
        >
          {preview || TEXT.emptyText}
        </p>
      </div>
    </div>
  );
};

const AddEditVipLoungeModal = ({
  isOpen,
  onClose,
  loungeToEdit = null,
  onSaved,
}) => {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [creditTiers, setCreditTiers] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorModal, setEditorModal] = useState({
    isOpen: false,
    field: "",
    title: "",
    value: "",
    placeholder: "",
  });

  const isEditMode = Boolean(loungeToEdit?.id);
  const { data: students = [] } = useClassStudents(classId, {
    enabled: !!classId && isOpen,
    realtime: isOpen,
  });

  useEffect(() => {
    if (!isOpen || !classId) {
      setCreditTiers([]);
      return undefined;
    }

    let cancelled = false;

    const loadCreditTiers = async () => {
      try {
        const snapshot = await getDoc(doc(db, "classes", classId, "tierCriteria", "default"));
        const tiers = Array.isArray(snapshot.data()?.tiers)
          ? snapshot.data().tiers
          : [];
        const normalized = sortCreditTiers(
          tiers.map(normalizeCreditTierOption).filter(Boolean),
        );
        if (!cancelled) setCreditTiers(normalized);
      } catch (error) {
        console.error("[AddEditVipLoungeModal] credit tiers load error:", error);
        if (!cancelled) setCreditTiers([]);
      }
    };

    loadCreditTiers();

    return () => {
      cancelled = true;
    };
  }, [classId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (loungeToEdit) {
      setFormData({
        name: loungeToEdit.name || "",
        loungeTagline: loungeToEdit.loungeTagline || "",
        entryCode: loungeToEdit.entryCode || "",
        accessMode: "hybrid_or",
        allowedStudentUids: Array.isArray(loungeToEdit.allowedStudentUids)
          ? loungeToEdit.allowedStudentUids
          : Array.isArray(loungeToEdit.vipStudentUids)
            ? loungeToEdit.vipStudentUids
            : [],
        minCreditTierId: String(loungeToEdit.minCreditTierId || "").trim(),
        loungeImageUrl:
          loungeToEdit.loungeImageUrl ||
          loungeToEdit.loungeDescriptionImageUrl ||
          loungeToEdit.benefitsImageUrl ||
          "",
        loungeDescriptionHtml: loungeToEdit.loungeDescriptionHtml || "",
        benefitsHtml: loungeToEdit.benefitsHtml || "",
        isActive: loungeToEdit.isActive !== false,
      });
      return;
    }

    setFormData(EMPTY_FORM);
  }, [isOpen, loungeToEdit]);

  const selectedStudents = useMemo(() => {
    const selectedSet = new Set(formData.allowedStudentUids || []);
    return students.filter((student) => selectedSet.has(student.uid));
  }, [formData.allowedStudentUids, students]);

  const selectedCreditTier = useMemo(
    () =>
      creditTiers.find((tier) => tier.id === formData.minCreditTierId) ||
      null,
    [creditTiers, formData.minCreditTierId],
  );

  const updateForm = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleStudentAccessChange = (uids) => {
    const nextUids = Array.from(
      new Set(
        (Array.isArray(uids) ? uids : [])
          .map((uid) => String(uid || "").trim())
          .filter(Boolean),
      ),
    );
    updateForm("allowedStudentUids", nextUids);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose?.();
  };

  const openTextEditor = (field, title, placeholder) => {
    setEditorModal({
      isOpen: true,
      field,
      title,
      value: formData[field] || "",
      placeholder,
    });
  };

  const closeTextEditor = () => {
    if (isSubmitting) return;
    setEditorModal({
      isOpen: false,
      field: "",
      title: "",
      value: "",
      placeholder: "",
    });
  };

  const saveTextEditor = () => {
    if (!editorModal.field) return;
    updateForm(editorModal.field, editorModal.value);
    closeTextEditor();
  };

  const handleSubmit = async () => {
    if (!classId) {
      showFeedback(TEXT.missingClass, "error");
      return;
    }

    const name = formData.name.trim();
    const entryCode = formData.entryCode.trim();
    if (!name) {
      showFeedback(TEXT.missingName, "warning");
      return;
    }

    if (!entryCode) {
      showFeedback(TEXT.missingCode, "warning");
      return;
    }

    const accessMode = "hybrid_or";

    if (
      !formData.minCreditTierId &&
      (formData.allowedStudentUids || []).length === 0
    ) {
      showFeedback(TEXT.missingStudents, "warning");
      return;
    }

    if (
      formData.minCreditTierId &&
      !selectedCreditTier
    ) {
      showFeedback(TEXT.missingCreditTier, "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const payloadOptions = {
        formData,
        selectedCreditTier,
        selectedStudents,
        isEditMode,
        teacherUid: userData?.uid,
        name,
        entryCode,
        accessMode,
      };

      if (isEditMode) {
        await updateDoc(
          doc(db, "classes", classId, "storeCategories", loungeToEdit.id),
          buildVipLoungeWriteData(payloadOptions),
        );
        showFeedback(TEXT.saved, "success");
        onSaved?.(loungeToEdit.id);
      } else {
        const createdRef = await addDoc(
          collection(db, "classes", classId, "storeCategories"),
          buildNewVipLoungeWriteData(payloadOptions),
        );
        showFeedback(TEXT.created, "success");
        onSaved?.(createdRef.id);
      }

      onClose?.();
    } catch (error) {
      console.error("[AddEditVipLoungeModal] save error:", error);
      showFeedback(TEXT.saveError, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
    <Modal isOpen={isOpen} onClose={handleClose} size="xl">
      <Modal.Header>
        <div className="flex items-start gap-4 pr-8">
          <div className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-3 text-amber-200">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-amber-200">
              VIP Lounge
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">
              {isEditMode ? TEXT.titleEdit : TEXT.titleCreate}
            </h2>
            <p className="mt-2 text-sm text-slate-300">{TEXT.subtitle}</p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6 bg-slate-50">
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {TEXT.basicInfo}
            </div>
            <div className="space-y-4">
              <InputField
                label={TEXT.loungeName}
                value={formData.name}
                onChange={(event) => updateForm("name", event.target.value)}
                placeholder={TEXT.loungeNamePlaceholder}
                disabled={isSubmitting}
              />

              <InputField
                label={TEXT.loungeTagline}
                value={formData.loungeTagline}
                onChange={(event) => updateForm("loungeTagline", event.target.value)}
                placeholder={TEXT.loungeTaglinePlaceholder}
                hint={TEXT.loungeTaglineHint}
                maxLength={80}
                disabled={isSubmitting}
              />

              <InputField
                label={TEXT.entryCode}
                value={formData.entryCode}
                onChange={(event) => updateForm("entryCode", event.target.value)}
                placeholder={TEXT.entryCodePlaceholder}
                hint={TEXT.entryCodeHint}
                required
                disabled={isSubmitting}
              />

            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-amber-900">
              <ShieldCheck className="h-4 w-4" />
              {TEXT.accessMethod}
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl bg-white/75 p-3 ring-1 ring-amber-100">
                <label className="ml-1 block text-[10px] font-black uppercase tracking-tighter text-slate-400">
                  {TEXT.minCreditTier}
                </label>
                <select
                  value={formData.minCreditTierId}
                  onChange={(event) =>
                    updateForm("minCreditTierId", event.target.value)
                  }
                  disabled={isSubmitting || creditTiers.length === 0}
                  className="mt-1 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{TEXT.minCreditTierPlaceholder}</option>
                  {creditTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} ({tier.minScore}
                      {"\uC810 \uC774\uC0C1"})
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs font-medium leading-relaxed text-amber-800">
                  {creditTiers.length === 0
                    ? TEXT.noCreditTiers
                    : TEXT.accessCreditTierHelp}
                </p>
              </div>

              <StudentSelector
                label={TEXT.extraStudents}
                selectedUids={formData.allowedStudentUids}
                onChange={handleStudentAccessChange}
                multiple
                includeTeacher={false}
                allStudents={students}
                disabled={isSubmitting}
                className="rounded-2xl bg-white/75 p-3 ring-1 ring-amber-100"
              />
              <p className="text-xs font-medium leading-relaxed text-amber-800">
                {TEXT.accessHybridHelp}
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-900 bg-[#050505] text-white shadow-xl shadow-slate-200">
          <div className="border-b border-white/10 bg-[linear-gradient(120deg,rgba(245,158,11,0.16),transparent_36%),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:auto,64px_64px] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-amber-200">
                  <LockKeyhole className="h-4 w-4" />
                  {"\uD559\uC0DD \uD654\uBA74 \uBBF8\uB9AC\uBCF4\uAE30"}
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-300">
                  {TEXT.layoutHelp}
                </p>
              </div>
              <span className="rounded-full border border-amber-200/30 bg-amber-200/10 px-3 py-1.5 text-xs font-black text-amber-100">
                {TEXT.imageEnabled}
              </span>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-1">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <TextPreviewCard
                title={"\uB77C\uC6B4\uC9C0 \uC774\uC57C\uAE30"}
                meta={TEXT.storyMeta}
                value={formData.loungeDescriptionHtml}
                disabled={isSubmitting}
                onEdit={() =>
                  openTextEditor(
                    "loungeDescriptionHtml",
                    "\uB77C\uC6B4\uC9C0 \uC774\uC57C\uAE30",
                    TEXT.storyPlaceholder,
                  )
                }
              />
              <TextPreviewCard
                title={"\uB77C\uC6B4\uC9C0 \uC774\uC6A9 \uC548\uB0B4"}
                meta={TEXT.benefitsMeta}
                value={formData.benefitsHtml}
                disabled={isSubmitting}
                onEdit={() =>
                  openTextEditor(
                    "benefitsHtml",
                    "\uB77C\uC6B4\uC9C0 \uC774\uC6A9 \uC548\uB0B4",
                    TEXT.benefitsPlaceholder,
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">{TEXT.activeTitle}</p>
            <p className="mt-1 text-xs text-slate-500">{TEXT.activeHelp}</p>
          </div>
          <ToggleSwitch
            checked={formData.isActive}
            onChange={(checked) => updateForm("isActive", checked)}
            disabled={isSubmitting}
          />
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button
          kind="outline"
          tone="slate"
          onClick={handleClose}
          disabled={isSubmitting}
        >
          {TEXT.cancel}
        </Button>
        <Button
          kind="solid"
          tone="slate"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={
            !formData.name.trim() ||
            !formData.entryCode.trim() ||
            (!selectedCreditTier &&
              (formData.allowedStudentUids || []).length === 0)
          }
          className="bg-slate-950 text-white hover:bg-slate-800"
          icon={Crown}
        >
          {isEditMode ? TEXT.save : TEXT.create}
        </Button>
      </Modal.Footer>
    </Modal>

    <Modal
      isOpen={editorModal.isOpen}
      aria-label={editorModal.title}
      onClose={closeTextEditor}
      size="lg"
      zIndexBase={3000}
    >
      <Modal.Header className="bg-slate-950 text-white">
        <div className="pr-8">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            VIP Lounge Editor
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
            {editorModal.title}
          </h2>
          <p className="mt-2 text-sm text-slate-600">{TEXT.editorHelp}</p>
        </div>
      </Modal.Header>
      <Modal.Body className="bg-slate-50">
        <ModernRichEditor
          value={editorModal.value}
          onChange={(html) =>
            setEditorModal((prev) => ({ ...prev, value: html }))
          }
          placeholder={editorModal.placeholder}
          height="340px"
          toolbar="standard"
          disabled={isSubmitting}
        />
      </Modal.Body>
      <Modal.Footer>
        <Button
          kind="outline"
          tone="slate"
          onClick={closeTextEditor}
          disabled={isSubmitting}
        >
          {TEXT.cancel}
        </Button>
        <Button
          kind="solid"
          tone="slate"
          onClick={saveTextEditor}
          disabled={isSubmitting}
          className="bg-slate-950 text-white hover:bg-slate-800"
        >
          {TEXT.apply}
        </Button>
      </Modal.Footer>
    </Modal>
    </>
  );
};

export default AddEditVipLoungeModal;
