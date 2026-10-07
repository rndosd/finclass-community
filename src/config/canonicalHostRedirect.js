const normalizeHostname = (value) =>
  String(value || "").trim().toLowerCase();

export const readCanonicalRedirectHosts = (environment = process.env) =>
  String(environment.REACT_APP_CANONICAL_REDIRECT_HOSTS || "")
    .split(",")
    .map(normalizeHostname)
    .filter(Boolean);

export const buildCanonicalRedirectUrl = ({
  canonicalOrigin,
  currentHref,
  redirectHosts,
}) => {
  const currentUrl = new URL(currentHref);
  const normalizedHosts = new Set(
    (redirectHosts || []).map(normalizeHostname).filter(Boolean),
  );

  if (!normalizedHosts.has(normalizeHostname(currentUrl.hostname))) {
    return null;
  }

  const canonicalUrl = new URL(canonicalOrigin);
  if (currentUrl.origin === canonicalUrl.origin) {
    return null;
  }

  return new URL(
    `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    canonicalUrl.origin,
  ).toString();
};
