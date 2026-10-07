"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const admin = require("../firebaseAdminCompat");

if (!admin.apps.length) {
    admin.initializeApp({ projectId: "demo-permission-sync" });
}

const {
    buildTokenPermissions,
    sanitizePermissionMap,
    syncCustomClaims,
} = require("../utils/permissionSync");

test("manual management permissions normalize their required view permissions", () => {
    const normalized = sanitizePermissionMap({
        store_admin: true,
        page_store_view: false,
        tax_admin: true,
        page_tax_view: false,
    });

    assert.equal(normalized.store_admin, true);
    assert.equal(normalized.page_store_view, true);
    assert.equal(normalized.tax_admin, true);
    assert.equal(normalized.page_tax_view, true);
});

test("normalized view permissions are included in custom claims", () => {
    const tokenPermissions = buildTokenPermissions(
        sanitizePermissionMap({ realestate_admin: true }),
    );

    assert.equal(tokenPermissions.a_rst, true);
    assert.equal(tokenPermissions.p_rst, true);
});

test("police rules management stays separate from police operations", () => {
    const tokenPermissions = buildTokenPermissions(
        sanitizePermissionMap({ police_rules_manage: true }),
    );

    assert.equal(tokenPermissions.a_prl, true);
    assert.equal(tokenPermissions.p_pol, true);
    assert.equal(tokenPermissions.a_pol, undefined);
});

test("saving unchanged document permissions repairs missing custom claims", async () => {
    const claimWrites = [];
    const authClient = {
        getUser: async () => ({ customClaims: { role: "student" } }),
        setCustomUserClaims: async (uid, claims) => {
            claimWrites.push({ uid, claims });
        },
    };

    const result = await syncCustomClaims(
        "student-a",
        sanitizePermissionMap({ store_admin: true }),
        { authClient },
    );

    assert.equal(result.updated, true);
    assert.equal(claimWrites.length, 1);
    assert.equal(claimWrites[0].claims.permissions.a_str, true);
    assert.equal(claimWrites[0].claims.permissions.p_str, true);
});

test("matching custom claims are not rewritten", async () => {
    let writeCount = 0;
    const authClient = {
        getUser: async () => ({
            customClaims: {
                role: "student",
                permissions: { a_str: true, p_str: true },
            },
        }),
        setCustomUserClaims: async () => {
            writeCount += 1;
        },
    };

    const result = await syncCustomClaims(
        "student-a",
        sanitizePermissionMap({ store_admin: true }),
        { authClient },
    );

    assert.equal(result.updated, false);
    assert.equal(writeCount, 0);
});
