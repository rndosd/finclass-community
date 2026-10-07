"use strict";

const TOKEN_PERMISSION_MAP = Object.freeze({
    page_bank_view: "p_bnk",
    bank_admin: "a_bnk",
    action_bank_transfer: "x_trf",
    asset_manager_view: "p_ast",
    asset_manager_manage: "a_ast",
    page_tax_view: "p_tax",
    tax_admin: "a_tax",
    page_labor_view: "p_lbr",
    labor_admin: "a_lbr",
    page_police_view: "p_pol",
    permission_group_police: "a_pol",
    police_rules_manage: "a_prl",
    page_store_view: "p_str",
    store_admin: "a_str",
    page_stock_view: "p_stk",
    page_credit_view: "p_crd",
    credit_admin: "a_crd",
    page_credentials_view: "p_crt",
    credentials_admin: "a_crt",
    credentials_designer: "a_cds",
    page_job_board_view: "p_job",
    page_assembly_view: "p_asm",
    assembly_member: "a_asm",
    page_mission_view: "p_msn",
    mission_admin: "a_msn",
    page_news_view: "p_nws",
    news_admin: "a_nws",
    page_realestate_view: "p_rst",
    realestate_admin: "a_rst",
    page_marketplace_view: "p_mkt",
    marketplace_admin: "a_mkt",
    page_arcade_view: "p_arc",
});

const KNOWN_PERMISSION_KEYS = Object.freeze(Object.keys(TOKEN_PERMISSION_MAP));

const IMPLIED_PERMISSION_MAP = Object.freeze({
    bank_admin: ["page_bank_view"],
    action_bank_transfer: ["page_bank_view"],
    asset_manager_manage: ["asset_manager_view"],
    tax_admin: ["page_tax_view"],
    labor_admin: ["page_labor_view"],
    permission_group_police: ["page_police_view"],
    police_rules_manage: ["page_police_view"],
    store_admin: ["page_store_view"],
    credit_admin: ["page_credit_view"],
    assembly_member: ["page_assembly_view"],
    mission_admin: ["page_mission_view"],
    credentials_admin: ["page_credentials_view"],
    credentials_designer: ["page_credentials_view"],
    news_admin: ["page_news_view"],
    realestate_admin: ["page_realestate_view"],
    marketplace_admin: ["page_marketplace_view"],
});

const applyImpliedPermissions = (permissions = {}) => {
    const normalized = { ...permissions };

    Object.entries(IMPLIED_PERMISSION_MAP).forEach(([permissionKey, impliedKeys]) => {
        if (normalized[permissionKey] !== true) return;
        impliedKeys.forEach((impliedKey) => {
            if (KNOWN_PERMISSION_KEYS.includes(impliedKey)) {
                normalized[impliedKey] = true;
            }
        });
    });

    return normalized;
};

module.exports = {
    TOKEN_PERMISSION_MAP,
    KNOWN_PERMISSION_KEYS,
    IMPLIED_PERMISSION_MAP,
    applyImpliedPermissions,
};
