"use strict";

// Only the common daily inverse objective independently checked in issuer HTML
// is promoted. Secondary research profiles and inferred ETF holdings are not.
const VERIFIED_STRUCTURE_VERSION = "issuer-structures-2026-10-02";
const STRUCTURE_SOURCE = {
    url: "https://www.proshares.com/our-etfs/find-leveraged-and-inverse-etfs",
    checkedAt: "2026-10-02",
    authority: "issuer",
    htmlSha256: "e8f3d3d47d398091c568069ad5f26a5645c9f40243dfc1f61b07b928bf918369",
};
const VERIFIED_DAILY_INVERSE_SYMBOLS = new Set([
    "BITI", "DOG", "EFZ", "MYY", "PSQ", "REK", "RWM",
    "SBB", "SEF", "SH", "SJB", "TBF", "TBX", "YXI",
]);

// NYSE OR prices identify OR Royalties, while our catalog says L'Oreal.
// Withhold risk estimates until identity is corrected; do not alter holdings.
const IDENTITY_CONFLICT_SYMBOLS = Object.freeze(["OR"]);

function getVerifiedStructure(symbol) {
    if (!VERIFIED_DAILY_INVERSE_SYMBOLS.has(symbol)) return null;
    return {
        inverse: true,
        dailyObjective: true,
        leverageMultiple: -1,
        source: STRUCTURE_SOURCE,
    };
}

module.exports = {
    VERIFIED_STRUCTURE_VERSION,
    IDENTITY_CONFLICT_SYMBOLS,
    getVerifiedStructure,
};
