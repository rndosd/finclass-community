const { ADVANCED_SECURITIES } = require("./stockCatalog");

const ADVANCED_SECURITY_SYMBOLS = new Set(
    ADVANCED_SECURITIES.map((stock) => String(stock.ticker || "").trim().toUpperCase()),
);

const normalizeSymbol = (value) =>
    String(value || "").trim().toUpperCase();

const normalizeRole = (value) =>
    String(value || "").trim().toLowerCase();

const categoryContainsSymbol = (category = {}, symbol = "") =>
    Array.isArray(category.symbols) &&
  category.symbols.some(
      (item) => normalizeSymbol(item?.ticker || item?.symbol || item) === symbol,
  );

/**
 * Resolves whether a caller may discover/buy a stock in a class.
 *
 * Rules:
 * - Teachers/admins always pass.
 * - A selected-student class category claims its symbols and requires the
 *   caller UID to be included in the category allowlist.
 * - That category grant may reveal a class-wide hidden symbol.
 * - A plain hidden symbol remains unavailable to students.
 * - A reviewed catalog symbol marked default-hidden stays unavailable until a
 *   teacher assigns it to an active class category.
 * - Sell is intentionally not handled here; owned positions always remain
 *   sellable after category access is removed.
 */
async function resolveStockAccess({ db, classId, uid, symbol, role }) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const normalizedRole = normalizeRole(role);

    if (!db || !classId || !uid || !normalizedSymbol) {
        return { allowed: false, reason: "invalid_request" };
    }

    if (normalizedRole === "teacher" || normalizedRole === "admin") {
        return { allowed: true, reason: "staff" };
    }

    const [settingsSnap, categorySnap, registrationSnap] = await Promise.all([
        db.doc(`classes/${classId}/config/stockMarket`).get(),
        db.collection(`classes/${classId}/stockCategories`).get(),
        db.doc(`stockCatalogRegistrations/${normalizedSymbol}`).get(),
    ]);

    const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
    const hidden = settings.hiddenStocks?.[normalizedSymbol] === true;
    const restrictedCategories = [];
    let claimedByActiveCategory = false;
    let claimedByPublicCategory = false;

    categorySnap.forEach((docSnap) => {
        const category = docSnap.data() || {};
        const containsSymbol = categoryContainsSymbol(category, normalizedSymbol);
        if (category.isActive !== false && containsSymbol) {
            claimedByActiveCategory = true;
            if (
                category.accessMode !== "selected_students" &&
                category.accessMode !== "credential_required"
            ) {
                claimedByPublicCategory = true;
            }
        }
        if (
            category.isActive !== false &&
      (category.accessMode === "selected_students" ||
        category.accessMode === "credential_required") &&
      containsSymbol
        ) {
            restrictedCategories.push({ id: docSnap.id, ...category });
        }
    });

    if (restrictedCategories.length > 0) {
        const isAllowedStudent = restrictedCategories.some((category) =>
            Array.isArray(category.allowedStudentUids) &&
            category.allowedStudentUids
                .map((value) => String(value || "").trim())
                .includes(uid),
        );
        if (isAllowedStudent) {
            return { allowed: true, reason: "category_student_grant" };
        }

        if (!claimedByPublicCategory) {
            return { allowed: false, reason: "category_student_required" };
        }
    }

    if (hidden) {
        return { allowed: false, reason: "class_hidden" };
    }

    const isRegisteredDefaultHidden = registrationSnap.exists &&
        registrationSnap.data()?.defaultVisible !== true;
    if (
        (ADVANCED_SECURITY_SYMBOLS.has(normalizedSymbol) || isRegisteredDefaultHidden) &&
        !claimedByActiveCategory
    ) {
        return { allowed: false, reason: "advanced_unassigned" };
    }

    return { allowed: true, reason: "public" };
}

module.exports = {
    categoryContainsSymbol,
    normalizeSymbol,
    resolveStockAccess,
};
