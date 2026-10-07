"use strict";

const { createHash } = require("node:crypto");

const STORAGE_VERSION = 3;
const SEAT_FIELDS = new Set([
    "id", "permanentId", "number", "label", "studentId", "studentName",
    "teamId", "isActive", "row", "col",
]);
const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;
    if (typeof value.toJSON === "function") return canonical(value.toJSON());
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const validId = (id) => typeof id === "string" && id.length > 0 &&
    Buffer.byteLength(id, "utf8") <= 1500 && !id.includes("/") && ![".", ".."].includes(id);
const same = (a, b) => fingerprint(a) === fingerprint(b);

// Deterministic for a retry/backfill. Signatures and confirmation edits must not
// create a new ID for an already selected sale; its existing pointer wins.
const saleContractId = (desk, previousProperty) => {
    const state = desk.contractState;
    const generated = `sale_contract_${fingerprint({
        deskId: desk.id,
        selectedAt: state.selectedAt ?? null,
        buyerId: desk.buyerId ?? state.buyerId ?? null,
        selectedBy: state.selectedBy ?? null,
    }).slice(0, 40)}`;
    return previousProperty?.saleContractId === generated ? previousProperty.saleContractId : generated;
};

function splitLayout(layout, previousProperties = new Map()) {
    if (!layout || !Array.isArray(layout.groups)) throw new Error("Invalid real-estate groups");
    const properties = new Map();
    const contracts = new Map();
    const permanentIds = new Set();
    const groups = layout.groups.map((group) => {
        if (!Array.isArray(group.desks)) throw new Error("Invalid real-estate desks");
        const desks = group.desks.map((desk) => {
            if (!validId(desk.id) || properties.has(desk.id)) throw new Error("Missing or duplicate desk ID");
            if (desk.permanentId) {
                if (permanentIds.has(desk.permanentId)) throw new Error("Duplicate permanent desk ID");
                permanentIds.add(desk.permanentId);
            }
            const seat = {};
            const fields = {};
            const rentFields = {};
            for (const [key, value] of Object.entries(desk)) {
                if (SEAT_FIELDS.has(key)) seat[key] = value;
                else if (key.startsWith("rent") && key !== "rentContractId" && desk.rentContractId) rentFields[key] = value;
                else if (key !== "contractState" || !value || typeof value !== "object") fields[key] = value;
            }
            const property = { version: STORAGE_VERSION, deskId: desk.id, fields };
            if (desk.rentContractId) {
                if (!validId(desk.rentContractId) || contracts.has(desk.rentContractId)) throw new Error("Missing or reused rent contract ID");
                property.rentContractId = desk.rentContractId;
                contracts.set(desk.rentContractId, {
                    version: STORAGE_VERSION, kind: "rent", deskId: desk.id,
                    fields: rentFields,
                    partyIds: [...new Set([desk.ownerId, desk.rentTenantId || desk.studentId].filter(Boolean))],
                });
            }
            if (desk.contractState && typeof desk.contractState === "object") {
                property.saleContractId = saleContractId(desk, previousProperties.get(desk.id));
                if (contracts.has(property.saleContractId)) throw new Error("Sale contract ID collision");
                contracts.set(property.saleContractId, {
                    version: STORAGE_VERSION, kind: "sale", deskId: desk.id,
                    state: desk.contractState,
                    partyIds: [...new Set([desk.ownerId, desk.buyerId || desk.contractState.buyerId].filter(Boolean))],
                });
            }
            properties.set(desk.id, property);
            return seat;
        });
        return { ...group, desks };
    });
    return { layout: { ...layout, groups, storageSchemaVersion: STORAGE_VERSION }, properties, contracts };
}

function joinLayout(layout, properties, contracts, { includeContracts = true, includeSaleContracts = true } = {}) {
    if (layout?.storageSchemaVersion !== STORAGE_VERSION) return layout;
    const groups = (layout.groups || []).map((group) => ({
        ...group,
        desks: (group.desks || []).map((seat) => {
            const property = properties.get(seat.id);
            if (!property || property.version !== STORAGE_VERSION || property.deskId !== seat.id) throw new Error("Missing or incompatible property document");
            if (Object.keys(property.fields || {}).some((key) => SEAT_FIELDS.has(key))) throw new Error("Property overrides seat identity");
            const desk = { ...property.fields, ...seat };
            if (property.rentContractId !== (desk.rentContractId || undefined)) throw new Error("Rent contract pointer mismatch");
            if (!includeContracts) return desk;
            for (const [pointer, kind] of [[property.rentContractId, "rent"], [property.saleContractId, "sale"]]) {
                if (!pointer) continue;
                if (kind === "sale" && !includeSaleContracts) continue;
                const contract = contracts.get(pointer);
                if (!contract || contract.version !== STORAGE_VERSION || contract.kind !== kind || contract.deskId !== seat.id) throw new Error("Missing or mismatched contract document");
                if (kind === "sale") desk.contractState = contract.state;
                else {
                    if (Object.keys(contract.fields || {}).some((key) => !key.startsWith("rent") || key === "rentContractId")) throw new Error("Invalid rent contract fields");
                    Object.assign(desk, contract.fields);
                }
            }
            return desk;
        }),
    }));
    return { ...layout, groups };
}

function verifySplit(source, split) {
    const restored = joinLayout(split.layout, split.properties, split.contracts);
    // The only new top-level field is the explicit schema discriminator.
    const expected = { ...source, storageSchemaVersion: STORAGE_VERSION };
    if (!same(expected, restored)) throw new Error("Real-estate split loses or changes source fields");
    return { desks: split.properties.size, contracts: split.contracts.size, fingerprint: fingerprint(expected) };
}

module.exports = { STORAGE_VERSION, SEAT_FIELDS, splitLayout, joinLayout, verifySplit, fingerprint, same };
