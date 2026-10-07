"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    IMPLIED_PERMISSION_MAP,
    KNOWN_PERMISSION_KEYS,
    applyImpliedPermissions,
} = require("../utils/permissionCatalog");

test("every delegated management permission implies a known view permission", () => {
    Object.entries(IMPLIED_PERMISSION_MAP).forEach(([permissionKey, impliedKeys]) => {
        assert.ok(KNOWN_PERMISSION_KEYS.includes(permissionKey));
        assert.ok(impliedKeys.length > 0);
        impliedKeys.forEach((impliedKey) => {
            assert.ok(
                KNOWN_PERMISSION_KEYS.includes(impliedKey),
                `${permissionKey} implies unknown permission ${impliedKey}`,
            );
        });
    });
});

test("a management grant automatically includes its page view grant", () => {
    assert.deepEqual(
        applyImpliedPermissions({ store_admin: true, page_store_view: false }),
        { store_admin: true, page_store_view: true },
    );
    assert.deepEqual(
        applyImpliedPermissions({ tax_admin: false, page_tax_view: false }),
        { tax_admin: false, page_tax_view: false },
    );
    assert.deepEqual(
        applyImpliedPermissions({ police_rules_manage: true }),
        { police_rules_manage: true, page_police_view: true },
    );
});
