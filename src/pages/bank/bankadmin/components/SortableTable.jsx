// src/pages/bank/bankadmin/components/SortableTable.jsx
import React, { useCallback, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { getStatusLabel, getStatusBadgeProps } from "../../constants/bankStatus";
import Badge from "../../../../components/ui/Badge";
import { DataTable, EmptyState } from "../../../../components/ui";
import {
    calculateRepaymentDate,
    calculateFinalInterest,
    calculateMaturityDate,
    hasLoanOverduePenalty,
} from "../../utils/dateUtils";
import {
    getLoanOutstandingPrincipal,
    getLoanPrincipal,
    getLoanRemainingInterest,
} from "../../utils/loanMetrics";
import {
    formatDateInKST,
    startOfDayInKST,
    toDate,
} from "../../../../utils/kstDate";
import { formatBankMoney } from "../../../../utils/bankMoney";

/* ============ Utils ============ */

// Firestore Timestamp / number / Date / string → ms 표준화
function tsToMillis(t) {
    if (!t) return null;
    if (typeof t.toDate === "function") return t.toDate().getTime();
    if (typeof t.seconds === "number") return t.seconds * 1000;
    if (t instanceof Date) return t.getTime();
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d.getTime();
}

// 숫자 포맷
function number(n) {
    return formatBankMoney(n);
}

// 날짜 포맷
function formatDate(timestamp) {
    if (!timestamp) return "-";
    const date = toDate(timestamp);
    if (!date || isNaN(date.getTime())) return "-";
    return formatDateInKST(date, "ko-KR", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
    });
}

/* ============ Stable multi-sort (tableType-aware) ============ */
function getSortedData(data, sortConfigs, studentsMap, tableType) {
    if (!Array.isArray(data) || data.length === 0) return data;
    if (!Array.isArray(sortConfigs) || sortConfigs.length === 0) return data;

    const withIndex = data.map((row, i) => ({ row, __i: i }));

    const getVal = (r, key) => {
        switch (key) {
            case "student":
                return (studentsMap[r.requestedBy] || r.studentName || r.requestedBy || "").trim();
            case "product":
                return (r.productLabel || r.productId || "").trim();
            case "amount":
                return tableType === "loans"
                    ? getLoanPrincipal(r)
                    : Number(r.amount) || 0;
            case "interest":
                return calculateFinalInterest(r);
            case "principalLeft":
                return tableType === "loans"
                    ? getLoanOutstandingPrincipal(r)
                    : Number(r.amount) || 0;
            case "interestLeft":
                return tableType === "loans"
                    ? getLoanRemainingInterest(r)
                    : 0;
            case "days":
                return Number(r.days) || 0;
            case "startDate": {
                const t = r.startedAt || r.processedAt;
                return tsToMillis(t);
            }
            case "maturityDate": {
                if (tableType === "savings") {
                    const m = calculateMaturityDate(r);
                    return tsToMillis(m);
                } else {
                    const m = calculateRepaymentDate(r);
                    return tsToMillis(m);
                }
            }
            case "status":
                return getStatusLabel(r.status) || "";
            default:
                return tsToMillis(r.createdAt);
        }
    };

    const cmp = (a, b) => {
        for (const { key, direction } of sortConfigs) {
            const dir = direction === "asc" ? 1 : -1;
            const va = getVal(a.row, key);
            const vb = getVal(b.row, key);

            const na = va === null || va === undefined;
            const nb = vb === null || vb === undefined;
            if (na && !nb) return 1;
            if (!na && nb) return -1;
            if (na && nb) continue;

            let c = 0;
            if (typeof va === "number" && typeof vb === "number") {
                c = va - vb;
            } else {
                c = String(va).localeCompare(String(vb), "ko");
            }
            if (c !== 0) return c * dir;
        }
        return a.__i - b.__i;
    };

    const sorted = [...withIndex].sort(cmp);
    return sorted.map(({ row }) => row);
}

/* ============ Header label map ============ */
const HEAD_LABELS = {
    student: "학생",
    product: "상품",
    amount: "금액",
    interest: "예상이자",
    principalLeft: "남은원금",
    interestLeft: "남은이자",
    days: "기간(일)",
    startDate: "시작일",
    maturityDate: "만기일", // ← 교체
    status: "상태",
};

export default function SortableTable({
    data = [],
    studentsMap = {},
    sortConfigs = [],
    onSort,
    tableType = "savings",
    currencyUnit = "캐시",
    qText = "",
    statusFilter = "all",
    startDate = "",
    endDate = "",
    textFilter,
    dateFilter,
    emptyMessage = "데이터가 없습니다.",
    filteredEmptyMessage = "검색 조건에 맞는 데이터가 없습니다.",
}) {
    const nowMs = startOfDayInKST(new Date()).getTime();

    /* ----- 수령가능 / 연체 판정 ----- */
    const isClaimable = useCallback((item) => {
        if (tableType !== "savings") return false;
        if (item.status !== "active") return false;
        const maturityDate = calculateMaturityDate(item);
        return maturityDate && nowMs >= startOfDayInKST(maturityDate).getTime();
    }, [tableType, nowMs]);

    const isOverdue = useCallback((item) => {
        if (tableType !== "loans") return false;
        if (!["ongoing", "approved"].includes(item.status)) return false;
        return hasLoanOverduePenalty(item);
    }, [tableType]);

    /* ----- 필터링 ----- */
    const filteredData = useMemo(() => {
        if (!Array.isArray(data)) return [];
        return data.filter((item) => {
            const name = studentsMap[item.requestedBy] || item.studentName || item.requestedBy || "";
            const label = item.productLabel || item.productId || "";

            // 텍스트
            const matchesText = textFilter(name, label, qText);

            // 날짜 (시작일 기준)
            const matchesDate = dateFilter(item);

            // 상태
            let matchesStatus = true;
            if (statusFilter === "open") {
                matchesStatus = (tableType === "savings" ? ["active", "pending"] : ["active", "approved", "ongoing", "pending"]).includes(item.status);
            } else if (statusFilter === "claimable") {
                matchesStatus = isClaimable(item);
            } else if (statusFilter === "overdue") {
                matchesStatus = isOverdue(item);
            } else if (statusFilter !== "all") {
                matchesStatus = item.status === statusFilter;
            }

            return matchesText && matchesDate && matchesStatus;
        });
    }, [data, studentsMap, qText, statusFilter, tableType, textFilter, dateFilter, isClaimable, isOverdue]);

    /* ----- 정렬 ----- */
    const sortedData = useMemo(
        () => getSortedData(filteredData, sortConfigs, studentsMap, tableType),
        [filteredData, sortConfigs, studentsMap, tableType]
    );

    /* ----- UI: 필터 결과 표시 ----- */
    const FilterResultBar = () => {
        if (filteredData.length === 0 && data.length === 0) return null;

        return (
            <div className="px-3 py-2 text-sm border-b border-slate-200 bg-slate-50/50">
                {statusFilter === "claimable" && (
                    <span className="text-emerald-600 font-semibold">💰 수령 가능한 예금 {filteredData.length}건</span>
                )}
                {statusFilter === "overdue" && (
                    <span className="text-red-600 font-semibold">⚠️ 연체된 대출 {filteredData.length}건</span>
                )}
                {statusFilter !== "claimable" && statusFilter !== "overdue" && (
                    <span className="text-slate-600">총 {filteredData.length}건</span>
                )}
            </div>
        );
    };

    /* ----- UI: 정렬 순서 요약 바 ----- */
    const SortOrderBar = () => {
        if (!sortConfigs?.length) return null;
        return (
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">정렬 순서</span>
                {sortConfigs.map((c, i) => (
                    <Badge
                        key={`${c.key}-${i}`}
                        tone="blue"
                        size="sm"
                        variant="soft"
                        pill
                        title={`${i + 1}순위 • ${HEAD_LABELS[c.key] ?? c.key} • ${c.direction === "asc" ? "오름차순" : "내림차순"
                            }`}
                    >
                        <span className="font-semibold">{i + 1}</span>
                        <span>{HEAD_LABELS[c.key] ?? c.key}</span>
                        {c.direction === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                        )}
                    </Badge>
                ))}
            </div>
        );
    };

    /* ----- 헤더 ----- */
    const SortIcon = ({ dir }) =>
        dir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 ml-1 inline text-blue-600" />
        ) : (
            <ChevronDown className="h-3.5 w-3.5 ml-1 inline text-blue-600" />
        );

    const SortableHeader = ({ children, sortKey, className = "" }) => {
        const idx = sortConfigs.findIndex((c) => c.key === sortKey);
        const active = idx !== -1;
        const dir = active ? sortConfigs[idx].direction : null;

        const handleClick = () => onSort?.(sortKey);

        return (
            <DataTable.HeadCell
                className={[
                    "px-3 py-2 cursor-pointer select-none transition-colors text-slate-600",
                    active ? "bg-blue-50/60" : "hover:bg-slate-50",
                    className,
                ].join(" ")}
                onClick={handleClick}
                title="클릭: 오름 → 내림 → 해제 (최근 클릭이 최우선)"
            >
                <div className="flex items-center">
                    <span className="font-medium">{children}</span>
                    {!active ? <span className="text-slate-300 ml-1">↕</span> : <SortIcon dir={dir} />}
                </div>
            </DataTable.HeadCell>
        );
    };

    /* ----- 공용 컨테이너 ----- */
    const TableShell = ({ children }) => (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200">
                <SortOrderBar />
            </div>
            <FilterResultBar />
            {children}
        </div>
    );

    /* ----- 상태 뱃지 (기본 + 보조 → 조건부 교체) ----- */
    const StatusCellBadge = ({ item }) => {
        const displayStatus =
            tableType === "savings" && isClaimable(item)
                ? "claimable"
                : tableType === "loans" && isOverdue(item)
                    ? "overdue"
                    : item.status;

        const displayLabel =
            tableType === "loans" && isOverdue(item)
                ? "연체"
                : getStatusLabel(displayStatus);

        return (
            <Badge
                {...getStatusBadgeProps(displayStatus, {
                    variant: "soft",
                    className: "pointer-events-none select-none cursor-default",
                })}
            >
                {displayLabel}
            </Badge>
        );
    };

    /* ===== Render: 예금 테이블 ===== */
    if (tableType === "savings") {
        return (
            <TableShell>
                <DataTable>
                    <DataTable.Header className="bg-white">
                        <DataTable.Row interactive={false}>
                            <SortableHeader sortKey="student" className="text-left w-[16%]">학생</SortableHeader>
                            <SortableHeader sortKey="product" className="text-left w-[26%]">상품</SortableHeader>
                            <SortableHeader sortKey="amount" className="text-right w-[10%]">금액</SortableHeader>
                            <SortableHeader sortKey="interest" className="text-right w-[10%]">예상이자</SortableHeader>
                            <SortableHeader sortKey="days" className="text-center w-[8%] whitespace-nowrap">기간(일)</SortableHeader>
                            <SortableHeader sortKey="startDate" className="text-center w-[10%]">시작일</SortableHeader>
                            <SortableHeader sortKey="maturityDate" className="text-center w-[10%]">만기일</SortableHeader>
                            <SortableHeader sortKey="status" className="text-center w-[10%]">상태</SortableHeader>
                        </DataTable.Row>
                    </DataTable.Header>
                    <DataTable.Body>
                        {sortedData.map((s) => {
                            const maturityDate = calculateMaturityDate(s);
                            return (
                                <DataTable.Row key={s.id}>
                                    <td className="px-3 py-2">
                                        {studentsMap[s.requestedBy] || s.studentName || s.requestedBy}
                                    </td>
                                    <td className="px-3 py-2">{s.productLabel || s.productId}</td>
                                    <td className="px-3 py-2 text-right">
                                        {number(s.amount)} <span className="text-slate-400">{currencyUnit}</span>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {number(calculateFinalInterest(s))}{" "}
                                        <span className="text-slate-400">{currencyUnit}</span>
                                    </td>
                                    <td className="px-3 py-2 text-center">{s.days}</td>
                                    <td className="px-3 py-2 text-center">
                                        {formatDate(s.startedAt || s.processedAt)}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {formatDate(maturityDate)}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <StatusCellBadge item={s} />
                                    </td>
                                </DataTable.Row>
                            );
                        })}
                        {sortedData.length === 0 && (
                            <DataTable.Empty colSpan={8} className="py-8">
                                <EmptyState
                                    title={data.length === 0 ? emptyMessage : filteredEmptyMessage}
                                    description="검색어, 상태, 날짜 필터를 조정해 다시 확인해 보세요."
                                />
                            </DataTable.Empty>
                        )}
                    </DataTable.Body>
                </DataTable>
            </TableShell>
        );
    }

    /* ===== Render: 대출 테이블 ===== */
    return (
        <TableShell>
            <DataTable>
                <DataTable.Header className="bg-white">
                    <DataTable.Row interactive={false}>
                        <SortableHeader sortKey="student" className="text-left w-[18%]">학생</SortableHeader>
                        <SortableHeader sortKey="product" className="text-left w-[24%]">상품</SortableHeader>
                        <SortableHeader sortKey="amount" className="text-right w-[10%]">원금</SortableHeader>
                        <SortableHeader sortKey="principalLeft" className="text-right w-[10%]">남은원금</SortableHeader>
                        <SortableHeader sortKey="interestLeft" className="text-right w-[10%]">남은이자</SortableHeader>
                        <SortableHeader sortKey="days" className="text-center w-[8%] whitespace-nowrap">기간(일)</SortableHeader>
                        <SortableHeader sortKey="startDate" className="text-center w-[10%]">시작일</SortableHeader>
                        <SortableHeader sortKey="maturityDate" className="text-center w-[10%]">만기일</SortableHeader>
                        <SortableHeader sortKey="status" className="text-center w-[8%]">상태</SortableHeader>
                    </DataTable.Row>
                </DataTable.Header>
                <DataTable.Body>
                    {sortedData.map((l) => {
                        const principal = getLoanPrincipal(l);
                        const principalLeft = getLoanOutstandingPrincipal(l);
                        const interestLeft = getLoanRemainingInterest(l);
                        const maturityDate = calculateRepaymentDate(l);

                        return (
                            <DataTable.Row key={l.id}>
                                <td className="px-3 py-2">
                                    {studentsMap[l.requestedBy] || l.studentName || l.requestedBy}
                                </td>
                                <td className="px-3 py-2">{l.productLabel || l.productId}</td>
                                <td className="px-3 py-2 text-right">
                                    {number(principal)} <span className="text-slate-400">{currencyUnit}</span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {number(principalLeft)} <span className="text-slate-400">{currencyUnit}</span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {number(interestLeft)} <span className="text-slate-400">{currencyUnit}</span>
                                </td>
                                <td className="px-3 py-2 text-center">{l.days}</td>
                                <td className="px-3 py-2 text-center">
                                    {formatDate(l.startedAt || l.processedAt)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {formatDate(maturityDate)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <StatusCellBadge item={l} />
                                </td>
                            </DataTable.Row>
                        );
                    })}
                    {sortedData.length === 0 && (
                        <DataTable.Empty colSpan={9} className="py-8">
                            <EmptyState
                                title={data.length === 0 ? emptyMessage : filteredEmptyMessage}
                                description="검색어, 상태, 날짜 필터를 조정해 다시 확인해 보세요."
                            />
                        </DataTable.Empty>
                    )}
                </DataTable.Body>
            </DataTable>
        </TableShell>
    );
}
