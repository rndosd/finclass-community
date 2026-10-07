const INTERNAL_ROUTE_BASE = "https://finclass.invalid";

const containsControlCharacter = (value) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

const normalizeInternalRoutePath = (path) => {
  if (typeof path !== "string") return "";

  const candidate = path.trim();
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    containsControlCharacter(candidate)
  ) {
    return "";
  }

  try {
    const parsed = new URL(candidate, INTERNAL_ROUTE_BASE);
    if (parsed.origin !== INTERNAL_ROUTE_BASE) return "";

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return "";
  }
};

export const sanitizeInternalRoutePath = (path, fallback = "") =>
  normalizeInternalRoutePath(path) || normalizeInternalRoutePath(fallback);
