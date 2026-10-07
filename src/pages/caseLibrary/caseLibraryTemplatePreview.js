import { summarizeCredentialsTemplatePayload } from "./templateAdapters/credentialsTemplateAdapter";
import { DEFAULT_MISSION_TOKEN_LABEL } from "../../utils/missionTokenLabel";

function emptyPreview() {
  return {
    highlights: [],
    compactItems: [],
    sections: [],
    visual: null,
  };
}

function formatNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toLocaleString("ko-KR") : "0";
}

function formatPercent(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue}%` : "-";
}

function formatCurrency(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue.toLocaleString("ko-KR")}원` : "-";
}

function normalizeText(value, fallback = "") {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || fallback;
}

function resolveBankAutoApprovalSettings(generalPolicies = {}) {
  const legacyValue =
    typeof generalPolicies?.isAutoApprovalEnabled === "boolean"
      ? generalPolicies.isAutoApprovalEnabled
      : false;

  return {
    deposit:
      typeof generalPolicies?.depositAutoApprovalEnabled === "boolean"
        ? generalPolicies.depositAutoApprovalEnabled
        : legacyValue,
    loan:
      typeof generalPolicies?.loanAutoApprovalEnabled === "boolean"
        ? generalPolicies.loanAutoApprovalEnabled
        : legacyValue,
  };
}

function buildCompactSampleList(items = [], formatter, maxItems = 3) {
  return items.slice(0, maxItems).map(formatter).filter(Boolean);
}

function buildPolicePreview(templatePayload) {
  const rules = Array.isArray(templatePayload?.data?.rules)
    ? templatePayload.data.rules
    : [];

  return {
    ...emptyPreview(),
    highlights: [{ label: "규칙 수", value: `${formatNumber(rules.length)}개` }],
    compactItems: buildCompactSampleList(rules, (rule) => ({
      title: normalizeText(rule?.text, "이름 없는 규칙"),
      meta: [
        Number(rule?.fineAmount) ? `벌금 ${formatCurrency(rule.fineAmount)}` : null,
        Number(rule?.creditChange) ? `신용 ${formatNumber(rule.creditChange)}` : null,
        Number(rule?.missionTokenChange)
          ? `${DEFAULT_MISSION_TOKEN_LABEL} ${formatNumber(rule.missionTokenChange)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    sections: [
      {
        title: "대표 규칙 예시",
        items: buildCompactSampleList(
          rules,
          (rule) => ({
            label: normalizeText(rule?.text, "이름 없는 규칙"),
            value: [
              Number(rule?.fineAmount) ? `벌금 ${formatCurrency(rule.fineAmount)}` : null,
              Number(rule?.creditChange) ? `신용 ${formatNumber(rule.creditChange)}` : null,
              Number(rule?.missionTokenChange)
                ? `${DEFAULT_MISSION_TOKEN_LABEL} ${formatNumber(rule.missionTokenChange)}`
                : null,
              normalizeText(rule?.notes),
            ]
              .filter(Boolean)
              .join(" · "),
          }),
          5,
        ),
      },
    ],
  };
}

function buildBankPreview(templatePayload) {
  const data = templatePayload?.data || {};
  const depositProducts = Array.isArray(data.depositProducts) ? data.depositProducts : [];
  const loanProducts = Array.isArray(data.loanProducts) ? data.loanProducts : [];
  const subscriptionProducts = Array.isArray(data.subscriptionProducts)
    ? data.subscriptionProducts
    : [];
  const generalPolicies = data.generalPolicies || {};
  const autoApprovalSettings = resolveBankAutoApprovalSettings(generalPolicies);

  return {
    ...emptyPreview(),
    highlights: [
      { label: "예금", value: `${formatNumber(depositProducts.length)}개` },
      { label: "대출", value: `${formatNumber(loanProducts.length)}개` },
      { label: "청약", value: `${formatNumber(subscriptionProducts.length)}개` },
    ],
    compactItems: [
      ...buildCompactSampleList(
        depositProducts,
        (item) => ({
          title: normalizeText(item?.label),
          meta: `${formatNumber(item?.days)}일 · 금리 ${formatPercent(item?.rate)}`,
        }),
        2,
      ),
      ...buildCompactSampleList(
        loanProducts,
        (item) => ({
          title: normalizeText(item?.label),
          meta: `${formatNumber(item?.days)}일 · 이율 ${formatPercent(item?.periodRate)}`,
        }),
        2,
      ),
    ].slice(0, 4),
    sections: [
      {
        title: "예금 상품 예시",
        items: buildCompactSampleList(
          depositProducts,
          (item) => ({
            label: normalizeText(item?.label),
            value: `${formatNumber(item?.days)}일 · 금리 ${formatPercent(item?.rate)}`,
          }),
          5,
        ),
      },
      {
        title: "대출 상품 예시",
        items: buildCompactSampleList(
          loanProducts,
          (item) => ({
            label: normalizeText(item?.label),
            value: `${formatNumber(item?.days)}일 · 이율 ${formatPercent(item?.periodRate)}`,
          }),
          5,
        ),
      },
      {
        title: "운영 정책",
        items: [
          {
            label: "예금 자동 승인",
            value: autoApprovalSettings.deposit ? "사용" : "미사용",
          },
          {
            label: "대출 자동 승인",
            value: autoApprovalSettings.loan ? "사용" : "미사용",
          },
          {
            label: "기본 대출 한도 비율",
            value:
              generalPolicies?.defaultLoanLimitRatio != null
                ? `${Math.round(Number(generalPolicies.defaultLoanLimitRatio) * 100)}%`
                : "설정 없음",
          },
        ],
      },
    ],
  };
}

function buildStorePreview(templatePayload) {
  const data = templatePayload?.data || {};
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const items = Array.isArray(data.items) ? data.items : [];
  const randomBoxCount = items.filter((item) => item?.itemType === "random_box").length;
  const saleCount = items.filter(
    (item) => item?.saleStatus && item.saleStatus !== "hidden",
  ).length;

  return {
    ...emptyPreview(),
    highlights: [
      { label: "카테고리", value: `${formatNumber(categories.length)}개` },
      { label: "상품", value: `${formatNumber(items.length)}개` },
      { label: "랜덤박스", value: `${formatNumber(randomBoxCount)}개` },
    ],
    compactItems: buildCompactSampleList(
      items,
      (item) => ({
        title: normalizeText(item?.name),
        meta: [item?.categorySnapshot?.name || null, item?.price != null ? formatCurrency(item.price) : null]
          .filter(Boolean)
          .join(" · "),
      }),
      4,
    ),
    sections: [
      {
        title: "카테고리 예시",
        items: buildCompactSampleList(
          categories,
          (category) => ({
            label: normalizeText(category?.name),
            value: category?.isActive === false ? "숨김" : "활성",
          }),
          6,
        ),
      },
      {
        title: "대표 상품 예시",
        items: buildCompactSampleList(
          items,
          (item) => ({
            label: normalizeText(item?.name),
            value: [
              item?.categorySnapshot?.name || null,
              item?.price != null ? formatCurrency(item.price) : null,
              item?.saleStatus && item.saleStatus !== "normal"
                ? `상태 ${item.saleStatus}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }),
          6,
        ),
      },
      {
        title: "판매 규칙 요약",
        items: [
          {
            label: "세일/노출 규칙 포함 상품",
            value: `${formatNumber(saleCount)}개`,
          },
          {
            label: "랜덤박스 구성",
            value: `${formatNumber(randomBoxCount)}개`,
          },
        ],
      },
    ],
  };
}

function buildTaxPreview(templatePayload) {
  const data = templatePayload?.data || {};
  const taxRules = Array.isArray(data.taxRules) ? data.taxRules : [];
  const autoTaxPolicy = data.autoTaxPolicy || {};
  const incomeSettlement = data.incomeSettlement || {};
  const enabledSettlementCount = Object.values(incomeSettlement).filter(
    (entry) => entry?.enabled === true,
  ).length;

  return {
    ...emptyPreview(),
    highlights: [
      { label: "세금 규칙", value: `${formatNumber(taxRules.length)}개` },
      {
        label: "자동 원천징수",
        value:
          autoTaxPolicy?.withholding?.depositInterest?.enabled ||
          autoTaxPolicy?.withholding?.payrollBonus?.enabled
            ? "사용"
            : "미사용",
      },
      { label: "소득 정산", value: `${formatNumber(enabledSettlementCount)}개 활성` },
    ],
    compactItems: buildCompactSampleList(
      taxRules,
      (rule) => ({
        title: normalizeText(rule?.name),
        meta: [
          rule?.targetType === "job" ? `직업 ${rule?.targetValue || "-"}` : "전체 대상",
          rule?.calculationMode || null,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
      4,
    ),
    sections: [
      {
        title: "세금 규칙 예시",
        items: buildCompactSampleList(
          taxRules,
          (rule) => ({
            label: normalizeText(rule?.name),
            value: [
              rule?.targetType === "job" ? `직업 ${rule?.targetValue || "-"}` : "전체 대상",
              rule?.displaySummary || rule?.calculationMode || null,
            ]
              .filter(Boolean)
              .join(" · "),
          }),
          6,
        ),
      },
      {
        title: "자동 세금 정책",
        items: [
          {
            label: "예금 이자 원천징수",
            value: autoTaxPolicy?.withholding?.depositInterest?.enabled ? "사용" : "미사용",
          },
          {
            label: "급여 보너스 원천징수",
            value: autoTaxPolicy?.withholding?.payrollBonus?.enabled ? "사용" : "미사용",
          },
        ],
      },
    ],
  };
}

function buildLookupLabelMap(items = []) {
  return new Map(
    items.map((item) => [
      normalizeText(item?.id).toLowerCase(),
      normalizeText(item?.label),
    ]),
  );
}

const NAMEPLATE_FAMILY_LABELS = {
  plaque: "기본형",
  wing: "날개형",
  seal: "봉인형",
  scroll: "문서형",
  jewel: "보석형",
  ticket: "티켓형",
  blossom: "블라썸형",
  shield: "방패형",
  arc: "아치형",
  marquee: "마키형",
};

function buildTitleStyleKey(item = {}) {
  return [
    normalizeText(item?.familyId, "plaque"),
    normalizeText(item?.paletteId, "sky"),
    normalizeText(item?.trimPaletteId, "match"),
    normalizeText(item?.patternId, "none"),
    normalizeText(item?.effectId, "none"),
    normalizeText(item?.topDecoId, "none"),
    normalizeText(item?.sideDecoId, "none"),
    normalizeText(item?.bottomDecoId, "none"),
  ]
    .join("::")
    .toLowerCase();
}

function getPreviewCandidateScore(item = {}) {
  const nameLength = Array.from(normalizeText(item?.name)).length || 99;
  const sourceOrder = Number(item?.sourceOrder);

  return {
    nameLength,
    sourceOrder: Number.isFinite(sourceOrder) ? sourceOrder : Number.MAX_SAFE_INTEGER,
  };
}

function comparePreviewCandidates(left, right) {
  const leftScore = getPreviewCandidateScore(left);
  const rightScore = getPreviewCandidateScore(right);

  if (leftScore.nameLength !== rightScore.nameLength) {
    return leftScore.nameLength - rightScore.nameLength;
  }

  return leftScore.sourceOrder - rightScore.sourceOrder;
}

function pickRepresentativeNameplateItems(items = [], maxItems = 4) {
  const familyBuckets = new Map();

  items.forEach((item) => {
    const familyKey = normalizeText(item?.familyId, "plaque").toLowerCase();
    if (!familyBuckets.has(familyKey)) {
      familyBuckets.set(familyKey, []);
    }
    familyBuckets.get(familyKey).push(item);
  });

  const selectedItems = [];
  const selectedIds = new Set();

  Array.from(familyBuckets.values())
    .map((bucket) => [...bucket].sort(comparePreviewCandidates)[0])
    .sort((left, right) => comparePreviewCandidates(left, right))
    .forEach((item) => {
      if (selectedItems.length >= maxItems || !item) {
        return;
      }

      selectedItems.push(item);
      selectedIds.add(item.id);
    });

  if (selectedItems.length >= maxItems) {
    return selectedItems.slice(0, maxItems);
  }

  const usedStyleKeys = new Set(selectedItems.map((item) => buildTitleStyleKey(item)));
  const remainingItems = items
    .filter((item) => !selectedIds.has(item.id))
    .sort(comparePreviewCandidates);

  remainingItems.forEach((item) => {
    if (selectedItems.length >= maxItems) {
      return;
    }

    const styleKey = buildTitleStyleKey(item);
    if (!usedStyleKeys.has(styleKey)) {
      usedStyleKeys.add(styleKey);
      selectedItems.push(item);
      selectedIds.add(item.id);
    }
  });

  remainingItems.forEach((item) => {
    if (selectedItems.length >= maxItems || selectedIds.has(item.id)) {
      return;
    }

    selectedItems.push(item);
    selectedIds.add(item.id);
  });

  return selectedItems;
}

function buildNormalizedCredentialsTitleItems(titleSettings = {}) {
  const grades = Array.isArray(titleSettings.titleGrades) ? titleSettings.titleGrades : [];
  const categories = Array.isArray(titleSettings.titleCategories)
    ? titleSettings.titleCategories
    : [];
  const titles = Array.isArray(titleSettings.titles) ? titleSettings.titles : [];
  const gradeLabelMap = buildLookupLabelMap(grades);
  const categoryLabelMap = buildLookupLabelMap(categories);

  return titles
    .filter((item) => normalizeText(item?.name))
    .map((item, index) => {
      const gradeLabel =
        gradeLabelMap.get(normalizeText(item?.gradeId).toLowerCase()) ||
        normalizeText(item?.rarity);
      const categoryLabel =
        categoryLabelMap.get(normalizeText(item?.categoryId).toLowerCase()) ||
        normalizeText(item?.category);

      return {
        id: normalizeText(item?.id, `title-${index + 1}`),
        name: normalizeText(item?.name, `칭호 ${index + 1}`),
        sourceOrder: index,
        gradeLabel,
        categoryLabel,
        familyLabel:
          NAMEPLATE_FAMILY_LABELS[normalizeText(item?.familyId, "plaque")] || "스타일",
        familyId: normalizeText(item?.familyId, "plaque"),
        paletteId: normalizeText(item?.paletteId, "sky"),
        trimPaletteId: normalizeText(item?.trimPaletteId, "match"),
        iconId: normalizeText(item?.iconId || item?.icon, "award"),
        customFrameColor: normalizeText(item?.customFrameColor),
        customBannerColor: normalizeText(item?.customBannerColor),
        customTrimColor: normalizeText(item?.customTrimColor),
        topDecoId: normalizeText(item?.topDecoId, "none"),
        sideDecoId: normalizeText(item?.sideDecoId, "none"),
        bottomDecoId: normalizeText(item?.bottomDecoId, "none"),
        patternId: normalizeText(item?.patternId, "none"),
        effectId: normalizeText(item?.effectId, "none"),
      };
    });
}

function buildCredentialsPreview(templatePayload) {
  const credentialsSummary = summarizeCredentialsTemplatePayload(templatePayload);
  const titleSettings = credentialsSummary.titleSettings;
  const grades = Array.isArray(titleSettings.titleGrades) ? titleSettings.titleGrades : [];
  const categories = Array.isArray(titleSettings.titleCategories)
    ? titleSettings.titleCategories
    : [];
  const stages = Array.isArray(titleSettings.titleCollectionStages)
    ? titleSettings.titleCollectionStages
    : [];
  const normalizedTitleItems = buildNormalizedCredentialsTitleItems(titleSettings);
  const previewItems = pickRepresentativeNameplateItems(normalizedTitleItems, 4);
  const uniqueStyleCount = new Set(
    normalizedTitleItems.map((item) => buildTitleStyleKey(item)),
  ).size;
  const gradeLabels = grades
    .slice(0, 3)
    .map((item) => normalizeText(item?.label))
    .filter(Boolean);
  const categoryLabels = categories
    .slice(0, 3)
    .map((item) => normalizeText(item?.label))
    .filter(Boolean);

  return {
    ...emptyPreview(),
    highlights: [
      {
        label: "칭호",
        value: `${formatNumber(credentialsSummary.titleDefinitionsCount)}개`,
      },
      {
        label: "등급",
        value: `${formatNumber(credentialsSummary.titleGradesCount)}개`,
      },
      {
        label: "카테고리",
        value: `${formatNumber(credentialsSummary.titleCategoriesCount)}개`,
      },
    ],
    sections: [
      {
        title: "분류 구성",
        items: [
          {
            label: "등급",
            value: grades.length
              ? `${formatNumber(grades.length)}개${gradeLabels.length ? ` · ${gradeLabels.join(", ")}` : ""}`
              : "없음",
          },
          {
            label: "카테고리",
            value: categories.length
              ? `${formatNumber(categories.length)}개${categoryLabels.length ? ` · ${categoryLabels.join(", ")}` : ""}`
              : "없음",
          },
          {
            label: "도감 단계",
            value: stages.length ? `${formatNumber(stages.length)}개` : "없음",
          },
          {
            label: "명패 스타일",
            value: uniqueStyleCount ? `${formatNumber(uniqueStyleCount)}종` : "없음",
          },
        ],
      },
    ],
    visual: previewItems.length
      ? {
          type: "nameplates",
          title: "대표 칭호 예시",
          description: `${formatNumber(credentialsSummary.titleDefinitionsCount)}개 칭호 중 프레임이 다른 예시를 먼저 보여줍니다.`,
          items: previewItems,
        }
      : null,
  };
}

export function buildCaseLibraryTemplatePreview(casePost) {
  const pageType = normalizeText(casePost?.pageType);
  const templatePayload = casePost?.templatePayload || {};

  if (!templatePayload || typeof templatePayload !== "object") {
    return emptyPreview();
  }

  if (pageType === "police") {
    return buildPolicePreview(templatePayload);
  }

  if (pageType === "bank") {
    return buildBankPreview(templatePayload);
  }

  if (pageType === "store") {
    return buildStorePreview(templatePayload);
  }

  if (pageType === "tax") {
    return buildTaxPreview(templatePayload);
  }

  if (pageType === "credentials") {
    return buildCredentialsPreview(templatePayload);
  }

  return emptyPreview();
}
