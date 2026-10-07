import {
  applyBankTemplatePayload,
  exportBankTemplatePayload,
} from "./templateAdapters/bankTemplateAdapter";
import {
  applyCredentialsTemplatePayload,
  exportCredentialsTemplatePayload,
} from "./templateAdapters/credentialsTemplateAdapter";
import {
  applyPoliceTemplatePayload,
  exportPoliceTemplatePayload,
} from "./templateAdapters/policeTemplateAdapter";
import {
  applyStoreTemplatePayload,
  exportStoreTemplatePayload,
} from "./templateAdapters/storeTemplateAdapter";
import {
  applyTaxTemplatePayload,
  exportTaxTemplatePayload,
} from "./templateAdapters/taxTemplateAdapter";

const caseLibraryTemplateAdapters = {
  bank: {
    pageType: "bank",
    exportTemplatePayload: exportBankTemplatePayload,
    applyTemplatePayload: applyBankTemplatePayload,
  },
  credentials: {
    pageType: "credentials",
    exportTemplatePayload: exportCredentialsTemplatePayload,
    applyTemplatePayload: applyCredentialsTemplatePayload,
  },
  police: {
    pageType: "police",
    exportTemplatePayload: exportPoliceTemplatePayload,
    applyTemplatePayload: applyPoliceTemplatePayload,
  },
  store: {
    pageType: "store",
    exportTemplatePayload: exportStoreTemplatePayload,
    applyTemplatePayload: applyStoreTemplatePayload,
  },
  tax: {
    pageType: "tax",
    exportTemplatePayload: exportTaxTemplatePayload,
    applyTemplatePayload: applyTaxTemplatePayload,
  },
};

export function getCaseLibraryTemplateAdapter(pageType) {
  return caseLibraryTemplateAdapters[pageType] || null;
}

export function hasCaseLibraryTemplateAdapter(pageType) {
  return Boolean(getCaseLibraryTemplateAdapter(pageType));
}

export async function exportCaseLibraryTemplatePayload({
  classId,
  pageType,
  scopeIds,
}) {
  const adapter = getCaseLibraryTemplateAdapter(pageType);
  if (!adapter?.exportTemplatePayload) {
    throw new Error("이 페이지는 아직 템플릿 내보내기를 지원하지 않습니다.");
  }

  return adapter.exportTemplatePayload({
    classId,
    pageType,
    scopeIds,
  });
}

export async function applyCaseLibraryTemplatePayload({
  classId,
  pageType,
  templatePayload,
  applyMode,
}) {
  const adapter = getCaseLibraryTemplateAdapter(pageType);
  if (!adapter?.applyTemplatePayload) {
    throw new Error("이 페이지는 아직 템플릿 적용을 지원하지 않습니다.");
  }

  return adapter.applyTemplatePayload({
    classId,
    pageType,
    templatePayload,
    applyMode,
  });
}
