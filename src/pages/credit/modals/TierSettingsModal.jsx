import React, { useEffect, useMemo, useState } from "react";
import {
    CheckIcon,
    Cog6ToothIcon,
    DocumentDuplicateIcon,
    EyeIcon,
    EyeSlashIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
    PlusIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { Button, Modal } from "../../../components/ui";
import { COLOR_PRESETS, TIER_TEMPLATES, validateTiers } from "../utils/tierUtils";

const createTierId = () =>
    `tier_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const toDisplayNumber = (value) => Number(value || 0).toLocaleString();

const normalizeTiers = (criteria = []) => {
    const source = criteria.length > 0 ? criteria : TIER_TEMPLATES.numeric.tiers;
    return [...source]
        .map((tier, index) => ({
            id: tier.id || createTierId(),
            name: tier.name || `등급 ${index + 1}`,
            color: tier.color || COLOR_PRESETS[index % COLOR_PRESETS.length].value,
            minScore: Number.isFinite(Number(tier.minScore))
                ? Number(tier.minScore)
                : 0,
        }))
        .sort((a, b) => Number(b.minScore || 0) - Number(a.minScore || 0));
};

const getSortedTiers = (tiers = []) =>
    [...tiers].sort((a, b) => Number(b.minScore || 0) - Number(a.minScore || 0));

const getMaxScoreError = (input) => {
    if (input === "") return "";
    const numericValue = Number(input);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return "신용점수 상한은 0 이상의 숫자여야 합니다.";
    }
    return "";
};

function FieldError({ message }) {
    if (!message) return null;
    return (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
            {message}
        </p>
    );
}

function TierRow({
    tier,
    upperBound,
    errors = [],
    isConfirmingDelete,
    onChange,
    onDuplicate,
    onDeleteRequest,
    onDeleteCancel,
    onDeleteConfirm,
}) {
    const [isExpanded, setIsExpanded] = useState(
        () => typeof window === "undefined" || window.innerWidth >= 768,
    );
    const nameError = errors.find((error) => error.field === "name")?.message;
    const scoreError = errors.find((error) => error.field === "minScore")?.message;
    const colorError = errors.find((error) => error.field === "color")?.message;
    const scoreRange = upperBound === null
        ? `${toDisplayNumber(tier.minScore)}점 이상`
        : `${toDisplayNumber(tier.minScore)}점 ~ ${toDisplayNumber(upperBound - 1)}점`;

    useEffect(() => {
        if (errors.length > 0 || isConfirmingDelete) {
            setIsExpanded(true);
        }
    }, [errors.length, isConfirmingDelete]);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(min-width: 768px)");
        const handleChange = (event) => {
            if (event.matches) setIsExpanded(true);
        };
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, []);

    return (
        <details
            open={isExpanded}
            onToggle={(event) => setIsExpanded(event.currentTarget.open)}
            className="rounded-3xl border border-slate-200 bg-white shadow-sm"
        >
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 md:hidden">
                <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                        {tier.name || "이름 없는 등급"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{scoreRange}</p>
                </div>
                <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600">
                    {isExpanded ? "접기" : "편집"}
                </span>
            </summary>

            <div className="border-t border-slate-100 p-4 md:border-t-0 md:p-5">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                            점수 구간
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{scoreRange}</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button tone="slate" kind="ghost" size="icon-md"
                            type="button"
                            onClick={onDuplicate}
                            className="transition"
                            title="등급 복제"
                        >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                        </Button>

                        {isConfirmingDelete ? (
                            <>
                                <Button tone="red" kind="solid" size="icon-md"
                                    type="button"
                                    onClick={onDeleteConfirm}
                                    className="transition"
                                    title="삭제 확인"
                                >
                                    <CheckIcon className="h-4 w-4" />
                                </Button>
                                <Button tone="slate" kind="soft" size="md"
                                    type="button"
                                    onClick={onDeleteCancel}
                                    className="transition"
                                    title="삭제 취소"
                                >
                                    취소
                                </Button>
                            </>
                        ) : (
                            <Button tone="rose" kind="ghost" size="icon-md"
                                type="button"
                                onClick={onDeleteRequest}
                                className="transition"
                                title="등급 삭제"
                            >
                                <TrashIcon className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">
                            등급 이름
                        </label>
                        <input
                            type="text"
                            value={tier.name}
                            onChange={(event) => onChange("name", event.target.value)}
                            placeholder="예: A등급"
                            className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${
                                nameError ? "border-red-300 bg-red-50" : "border-blue-200"
                            }`}
                        />
                        <FieldError message={nameError} />
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">
                            최소 점수
                        </label>
                        <input
                            type="number"
                            min="0"
                            value={tier.minScore}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                if (nextValue === "") {
                                    onChange("minScore", "");
                                    return;
                                }

                                const numericValue = Number(nextValue);
                                onChange(
                                    "minScore",
                                    Number.isFinite(numericValue) ? numericValue : "",
                                );
                            }}
                            className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${
                                scoreError ? "border-red-300 bg-red-50" : "border-blue-200"
                            }`}
                        />
                        <FieldError message={scoreError} />
                    </div>
                </div>

                <div>
                    <label className="mb-2 block text-xs font-medium text-slate-500">
                        등급 색상
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="color"
                            value={tier.color}
                            onChange={(event) => onChange("color", event.target.value)}
                            className="h-10 w-14 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                        />

                        {COLOR_PRESETS.map((color) => {
                            const isSelected = color.value === tier.color;
                            return (
                                <Button
                                    key={color.value}
                                    type="button"
                                    onClick={() => onChange("color", color.value)}
                                    className={`h-8 w-8 rounded-full border-2 transition ${
                                        isSelected
                                            ? "scale-105 border-slate-900"
                                            : "border-transparent hover:border-slate-300"
                                    }`}
                                    style={{ backgroundColor: color.value }}
                                    title={color.name}
                                />
                            );
                        })}
                    </div>
                    <FieldError message={colorError} />
                </div>
            </div>
            </div>
        </details>
    );
}

export default function TierSettingsModal({
    criteria = [],
    maxScore = null,
    onSave,
    onClose,
}) {
    const { showFeedback } = useFeedback();
    const [tiers, setTiers] = useState([]);
    const [maxScoreInput, setMaxScoreInput] = useState("");
    const [selectedTemplate, setSelectedTemplate] = useState("");
    const [showPreview, setShowPreview] = useState(false);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
    const [validationResult, setValidationResult] = useState({
        isValid: true,
        errors: [],
    });

    useEffect(() => {
        setTiers(normalizeTiers(criteria));
    }, [criteria]);

    useEffect(() => {
        if (maxScore === null || maxScore === undefined || maxScore === "") {
            setMaxScoreInput("");
            return;
        }

        const numericValue = Number(maxScore);
        setMaxScoreInput(
            Number.isFinite(numericValue) && numericValue > 0
                ? String(Math.floor(numericValue))
                : "",
        );
    }, [maxScore]);

    useEffect(() => {
        setValidationResult(validateTiers(tiers));
    }, [tiers]);

    const sortedTiers = useMemo(() => getSortedTiers(tiers), [tiers]);
    const globalErrors = useMemo(
        () =>
            validationResult.errors
                .filter((error) => error.id === "global")
                .map((error) => error.message),
        [validationResult.errors],
    );
    const maxScoreError = useMemo(
        () => getMaxScoreError(maxScoreInput),
        [maxScoreInput],
    );

    const updateTier = (tierId, field, value) => {
        setTiers((current) =>
            current.map((tier) =>
                tier.id === tierId ? { ...tier, [field]: value } : tier,
            ),
        );
    };

    const handleTemplateApply = () => {
        if (!selectedTemplate || !TIER_TEMPLATES[selectedTemplate]) return;
        setTiers(normalizeTiers(TIER_TEMPLATES[selectedTemplate].tiers));
        setConfirmingDeleteId(null);
        showFeedback("등급 템플릿을 적용했습니다.", "success");
    };

    const handleAddTier = () => {
        const nextTopScore = sortedTiers.length > 0
            ? Number(sortedTiers[0].minScore || 0) + 100
            : 0;
        const newTier = {
            id: createTierId(),
            name: "",
            color: COLOR_PRESETS[tiers.length % COLOR_PRESETS.length].value,
            minScore: nextTopScore,
        };

        setTiers((current) => [newTier, ...current]);
    };

    const handleDuplicateTier = (tierId) => {
        const sourceTier = tiers.find((tier) => tier.id === tierId);
        if (!sourceTier) return;

        const usedScores = new Set(
            tiers
                .map((tier) => Number(tier.minScore))
                .filter((value) => Number.isFinite(value)),
        );
        let nextScore = Number(sourceTier.minScore || 0) + 1;
        while (usedScores.has(nextScore)) {
            nextScore += 1;
        }

        setTiers((current) => [
            ...current,
            {
                ...sourceTier,
                id: createTierId(),
                name: sourceTier.name ? `${sourceTier.name} 복사본` : "",
                minScore: nextScore,
            },
        ]);
    };

    const handleDeleteTier = (tierId) => {
        if (tiers.length <= 1) {
            showFeedback("등급은 최소 1개 이상 필요합니다.", "warning");
            return;
        }

        setTiers((current) => current.filter((tier) => tier.id !== tierId));
        setConfirmingDeleteId(null);
    };

    const handleSave = () => {
        if (!validationResult.isValid) {
            showFeedback("등급 설정을 먼저 확인해 주세요.", "error");
            return;
        }

        if (maxScoreError) {
            showFeedback(maxScoreError, "error");
            return;
        }

        const normalizedMaxScore = maxScoreInput === ""
            ? null
            : Math.floor(Number(maxScoreInput));

        onSave({
            tiers: [...tiers]
                .map((tier) => ({
                    ...tier,
                    name: tier.name.trim(),
                    minScore: Number(tier.minScore),
                }))
                .sort((a, b) => a.minScore - b.minScore),
            maxScore: normalizedMaxScore,
        });
        onClose();
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            size="xl"
            showDefaultCloseButton={false}
            aria-label="신용등급 설정"
        >
            <Modal.Header>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600">
                            <Cog6ToothIcon className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-extrabold leading-7 text-slate-900 sm:text-2xl sm:leading-8">
                                신용등급 설정
                            </h2>
                            <p className="text-sm text-slate-500">
                                등급 기준과 학급별 신용점수 상한을 관리합니다.
                            </p>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        tone="blue"
                        size="sm"
                        aria-expanded={showPreview}
                        aria-controls="credit-tier-preview"
                        onClick={() => setShowPreview((current) => !current)}
                        className="w-full justify-center sm:w-auto"
                    >
                        {showPreview ? (
                            <>
                                <EyeSlashIcon className="h-4 w-4" />
                                미리보기 닫기
                            </>
                        ) : (
                            <>
                                <EyeIcon className="h-4 w-4" />
                                미리보기
                            </>
                        )}
                    </Button>
                </div>
            </Modal.Header>

            <Modal.Body>
                <div className="flex flex-col-reverse gap-6 lg:flex-row">
                    <div className="min-w-0 flex-1 space-y-6">
                        {globalErrors.length > 0 ? (
                            <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
                                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
                                    <ExclamationTriangleIcon className="h-5 w-5" />
                                    저장 전에 확인할 항목이 있습니다.
                                </div>
                                <ul className="space-y-1 text-sm text-red-600">
                                    {globalErrors.map((message, index) => (
                                        <li key={`${message}-${index}`}>{message}</li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <InformationCircleIcon className="h-4 w-4 text-slate-500" />
                                등급 템플릿
                            </label>
                            <div className="flex flex-col gap-3 sm:flex-row">
                                <select
                                    value={selectedTemplate}
                                    onChange={(event) =>
                                        setSelectedTemplate(event.target.value)
                                    }
                                    className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                >
                                    <option value="">템플릿을 선택하세요</option>
                                    {Object.entries(TIER_TEMPLATES).map(
                                        ([key, template]) => (
                                            <option key={key} value={key}>
                                                {template.name}
                                            </option>
                                        ),
                                    )}
                                </select>
                                <Button
                                    tone="blue"
                                    onClick={handleTemplateApply}
                                    disabled={!selectedTemplate}
                                >
                                    템플릿 적용
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <label className="mb-2 block text-sm font-semibold text-slate-700">
                                신용점수 상한
                            </label>
                            <input
                                type="number"
                                min="1"
                                value={maxScoreInput}
                                onChange={(event) => {
                                    const nextValue = event.target.value;
                                    if (nextValue !== "" && Number(nextValue) < 0) return;
                                    setMaxScoreInput(nextValue);
                                }}
                                placeholder="비워두면 상한 없이 운영합니다."
                                className={`w-full rounded-xl border bg-blue-50/50 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${
                                    maxScoreError ? "border-red-300" : "border-blue-200"
                                }`}
                            />
                            <p className="mt-2 text-xs text-slate-500">
                                이 값은 현재 학급에만 적용됩니다. 예를 들어 1000을 입력하면
                                학생 신용점수는 1000을 넘지 않도록 제한됩니다.
                            </p>
                            <FieldError message={maxScoreError} />
                        </div>

                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">
                                    신용등급 목록
                                </h3>
                                <p className="text-sm text-slate-500">
                                    높은 점수 등급부터 순서대로 표시됩니다.
                                </p>
                            </div>

                            <Button size="md"
                                tone="blue"
                                onClick={handleAddTier}
                                className="shrink-0 whitespace-nowrap"
                            >
                                <PlusIcon className="h-4 w-4" />
                                등급 추가
                            </Button>
                        </div>

                        <div className="space-y-3">
                            {sortedTiers.map((tier, index) => {
                                const upperBound = index === 0
                                    ? null
                                    : Number(sortedTiers[index - 1].minScore || 0);
                                const errors = validationResult.errors.filter(
                                    (error) => error.id === tier.id,
                                );

                                return (
                                    <TierRow
                                        key={tier.id}
                                        tier={tier}
                                        upperBound={upperBound}
                                        errors={errors}
                                        isConfirmingDelete={confirmingDeleteId === tier.id}
                                        onChange={(field, value) =>
                                            updateTier(tier.id, field, value)
                                        }
                                        onDuplicate={() => handleDuplicateTier(tier.id)}
                                        onDeleteRequest={() =>
                                            setConfirmingDeleteId(tier.id)
                                        }
                                        onDeleteCancel={() =>
                                            setConfirmingDeleteId(null)
                                        }
                                        onDeleteConfirm={() =>
                                            handleDeleteTier(tier.id)
                                        }
                                    />
                                );
                            })}
                        </div>
                    </div>

                    {showPreview ? (
                        <div id="credit-tier-preview" className="w-full lg:w-72 lg:flex-shrink-0">
                            <div className="sticky top-0 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                                <h3 className="text-base font-semibold text-slate-900">
                                    적용 미리보기
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    학생에게 보여질 등급 순서입니다.
                                </p>

                                <div className="mt-4 space-y-2">
                                    {sortedTiers.map((tier, index) => {
                                        const upperBound = index === 0
                                            ? null
                                            : Number(sortedTiers[index - 1].minScore || 0);
                                        const scoreRange = upperBound === null
                                            ? `${toDisplayNumber(tier.minScore)}점 이상`
                                            : `${toDisplayNumber(tier.minScore)}점 ~ ${toDisplayNumber(upperBound - 1)}점`;

                                        return (
                                            <div
                                                key={tier.id}
                                                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"
                                            >
                                                <div
                                                    className="h-3.5 w-3.5 rounded-full"
                                                    style={{ backgroundColor: tier.color }}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-semibold text-slate-800">
                                                        {tier.name || "이름 없음"}
                                                    </p>
                                                    <p className="text-xs text-slate-500">
                                                        {scoreRange}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </Modal.Body>

            <Modal.Footer className="grid grid-cols-2 sm:flex">
                <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
                    취소
                </Button>
                <Button
                    tone="blue"
                    onClick={handleSave}
                    disabled={!validationResult.isValid || Boolean(maxScoreError)}
                    className="w-full sm:w-auto"
                >
                    저장
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
