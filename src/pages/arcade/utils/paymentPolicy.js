export const DEFAULT_ALLOWED_PAYMENT_TYPES = ["cash", "ticket"];

export const PAYMENT_POLICY_OPTIONS = [
  {
    id: "both",
    label: "둘 다",
    shortLabel: "현금/티켓",
    description: "현금과 티켓 모두 입장 가능",
    allowedPaymentTypes: ["cash", "ticket"],
  },
  {
    id: "cash",
    label: "현금만",
    shortLabel: "현금 전용",
    description: "돈으로만 입장 가능",
    allowedPaymentTypes: ["cash"],
  },
  {
    id: "ticket",
    label: "티켓만",
    shortLabel: "티켓 전용",
    description: "티켓으로만 입장 가능",
    allowedPaymentTypes: ["ticket"],
  },
];

export const normalizeAllowedPaymentTypes = (allowedPaymentTypes) => {
  if (!Array.isArray(allowedPaymentTypes)) {
    return [...DEFAULT_ALLOWED_PAYMENT_TYPES];
  }

  const normalized = [
    ...new Set(
      allowedPaymentTypes
        .map((value) => String(value || "").trim())
        .filter((value) => DEFAULT_ALLOWED_PAYMENT_TYPES.includes(value)),
    ),
  ];

  return normalized.length > 0
    ? normalized
    : [...DEFAULT_ALLOWED_PAYMENT_TYPES];
};

export const isPaymentTypeAllowed = (allowedPaymentTypes, paymentType) =>
  normalizeAllowedPaymentTypes(allowedPaymentTypes).includes(paymentType);

export const getPrimaryPaymentType = (allowedPaymentTypes) =>
  normalizeAllowedPaymentTypes(allowedPaymentTypes)[0] ||
  DEFAULT_ALLOWED_PAYMENT_TYPES[0];

export const getPaymentPolicyKey = (allowedPaymentTypes) => {
  const normalized = normalizeAllowedPaymentTypes(allowedPaymentTypes);

  if (normalized.length === 1 && normalized[0] === "cash") {
    return "cash";
  }

  if (normalized.length === 1 && normalized[0] === "ticket") {
    return "ticket";
  }

  return "both";
};

export const getPaymentPolicyMeta = (allowedPaymentTypes) =>
  PAYMENT_POLICY_OPTIONS.find(
    ({ id }) => id === getPaymentPolicyKey(allowedPaymentTypes),
  ) || PAYMENT_POLICY_OPTIONS[0];
