const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const DEPLOY_TEMPLATE_VISIBLE_PAGE_IDS = new Set(["credentials"]);

function getHostname() {
  if (typeof window === "undefined") {
    return "";
  }

  return String(window.location.hostname || "").trim().toLowerCase();
}

export const isCaseLibraryLocalEnabled = () => {
  return LOCAL_HOSTS.has(getHostname());
};

export const isCaseLibraryEnabled = () => true;

export const isCaseLibraryTemplateVisible = (pageType) => {
  const normalizedPageType = String(pageType || "").trim();
  if (!normalizedPageType) {
    return false;
  }

  if (isCaseLibraryLocalEnabled()) {
    return true;
  }

  return DEPLOY_TEMPLATE_VISIBLE_PAGE_IDS.has(normalizedPageType);
};
