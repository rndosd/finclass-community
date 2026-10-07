const normalizeSymbol = (value) =>
    String(value || "")
        .trim()
        .toUpperCase();

function collectCatalogSymbols(catalogEntries = []) {
    return new Set(
        (Array.isArray(catalogEntries) ? catalogEntries : [])
            .map((entry) => normalizeSymbol(entry?.symbol || entry?.ticker || entry))
            .filter(Boolean),
    );
}

function findUnregisteredHoldingSymbols(holdings = [], catalogEntries = []) {
    const registeredSymbols = collectCatalogSymbols(catalogEntries);

    return Array.from(
        new Set(
            (Array.isArray(holdings) ? holdings : [])
                .map((holding) => normalizeSymbol(holding?.symbol || holding?.ticker || holding))
                .filter((symbol) => symbol && !registeredSymbols.has(symbol)),
        ),
    ).sort();
}

module.exports = {
    collectCatalogSymbols,
    findUnregisteredHoldingSymbols,
};
