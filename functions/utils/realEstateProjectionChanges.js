"use strict";
const activeSeats = (layout) => (layout?.groups || []).flatMap((g) => g.desks || []).map((d) => ({ id: d.id, isActive: d.isActive !== false }));
const assetFields = (property) => {
    const d = property?.fields || {};
    return { ownerId: d.ownerId || null, ownerType: d.ownerType || null, price: d.price ?? null, lastPurchasePrice: d.lastPurchasePrice ?? null };
};
const rentPropertyFields = (property) => {
    const fields = property?.fields || {};
    return Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith("rent") || ["ownerId", "weeklyRent"].includes(key)));
};
module.exports = { activeSeats, assetFields, rentPropertyFields };
