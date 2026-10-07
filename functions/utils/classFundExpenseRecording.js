"use strict";

const CLASS_FUND_USAGE_STATUS_SETTLED = "settled";

const toExpenseAmount = (value) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const buildImmediateClassFundExpenseAccounting = (amount) => {
    const normalizedAmount = toExpenseAmount(amount);
    return {
        cashDelta: normalizedAmount > 0 ? -normalizedAmount : 0,
        spentTotalDelta: normalizedAmount,
        settledExpenseTotalDelta: normalizedAmount,
        totalValueDelta: normalizedAmount > 0 ? -normalizedAmount : 0,
    };
};

const stageImmediateClassFundExpense = (
    tx,
    {
        classId,
        usageRef,
        fundId,
        fundName = "",
        fundType = "general",
        amount,
        channel,
        description = "",
        dateKey,
        balanceBefore,
        balanceAfter,
        createdBy,
        now,
        taxContext = {},
        usageData = {},
        taxData = {},
    },
    dependencies = {},
) => {
    const stageExpense = dependencies.stageTaxExpense ||
        require("./taxExpense").stageTaxExpense;
    const normalizedAmount = toExpenseAmount(amount);
    if (!tx || !usageRef || !classId || !fundId || normalizedAmount <= 0) {
        throw new Error("즉시 반영할 기금 지출 정보가 올바르지 않습니다.");
    }

    const taxExpenseResult = stageExpense(
        tx,
        classId,
        {
            amount: normalizedAmount,
            description,
            source: usageData.source || "class_fund_usage",
            expenseType: "class_fund",
            category: channel || "manualExpense",
            studentUid: createdBy,
            ...taxData,
        },
        createdBy,
        {
            ...taxContext,
            skipFeatureGate: true,
            customId: `classFundUsage_${usageRef.id}`,
            aggregateMeta: {
                group: "class_fund_immediate_expense",
                batchKey: usageRef.id,
                pageKey: channel || "manualExpense",
                actorUid: createdBy,
                reason: "class_fund_usage",
                mode: "immediate",
                version: 1,
            },
            detailLines: [
                {
                    id: usageRef.id,
                    amount: normalizedAmount,
                    description,
                    source: usageData.source || "class_fund_usage",
                    expenseType: "class_fund",
                    category: channel || "manualExpense",
                    relatedDoc: {
                        collection: "fundUsages",
                        id: usageRef.id,
                    },
                    meta: {
                        fundId,
                        fundName,
                        dateKey,
                        channel: channel || "manualExpense",
                    },
                },
            ],
        },
    );

    if (taxExpenseResult.skipped || !taxExpenseResult.id) {
        throw new Error("기금 지출을 국고 장부에 반영할 수 없습니다.");
    }

    tx.set(usageRef, {
        ...usageData,
        fundId,
        fundName,
        fundType,
        amount: normalizedAmount,
        channel: channel || "manualExpense",
        description,
        dateKey,
        balanceBefore,
        balanceAfter,
        settlementStatus: CLASS_FUND_USAGE_STATUS_SETTLED,
        taxExpenseId: taxExpenseResult.id,
        createdBy,
        usedAt: now,
        settledAt: now,
        createdAt: now,
        updatedAt: now,
    });

    return {
        accounting: buildImmediateClassFundExpenseAccounting(normalizedAmount),
        taxExpenseId: taxExpenseResult.id,
        usageId: usageRef.id,
    };
};

module.exports = {
    CLASS_FUND_USAGE_STATUS_SETTLED,
    buildImmediateClassFundExpenseAccounting,
    stageImmediateClassFundExpense,
};
