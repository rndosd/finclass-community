import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  SurfaceLoader,
  TableSkeleton,
} from "../../../../components/ui";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  formatTaxBillDate,
  formatTaxBillPeriod,
  calculateTaxBillLateFee,
  getTaxBillKindMeta,
  getTaxBillSourceSummary,
} from "../../../../utils/taxBillUtils";

const BillTable = ({
  bills,
  isLoading,
  currentPage,
  hasPreviousPage,
  hasNextPage,
  handlePageChange,
  paymentFilter,
  selectedBillIds,
  toggleBillSelection,
  toggleSelectAll,
  cancellableBillsOnPage,
  resolveStudentName,
  canCancelBill,
  getUnpaidDays,
  setSelectedBillForCancel,
  setShowCancelModal,
  currencyUnit,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const hasBills = bills.length > 0;

  return (
    <>
      <SurfaceLoader
        loading={isLoading}
        variant={hasBills ? "refreshing" : "surface-loading"}
        preserveContent={hasBills}
        skeleton={
          <TableSkeleton
            bare
            columns={10}
            rows={6}
            className="h-full min-h-full"
          />
        }
        className="flex-grow"
        minHeightClassName="min-h-[320px]"
      >
        <div className="flex-grow overflow-y-auto p-6">
          {hasBills ? (
            <DataTable>
              <DataTable.Header>
                <DataTable.Row interactive={false}>
                  <DataTable.HeadCell align="center" className="p-3">
                    <input
                      type="checkbox"
                      checked={
                        cancellableBillsOnPage.length > 0 &&
                        cancellableBillsOnPage.every((bill) =>
                          selectedBillIds.has(bill.id),
                        )
                      }
                      onChange={toggleSelectAll}
                      disabled={cancellableBillsOnPage.length === 0}
                      className="rounded"
                    />
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    납부기한
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    발급일
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    학생명
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    고지서
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    금액
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    납부 여부
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    미납 일수
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    납부일
                  </DataTable.HeadCell>
                  <DataTable.HeadCell align="center" className="p-3">
                    관리
                  </DataTable.HeadCell>
                </DataTable.Row>
              </DataTable.Header>
              <DataTable.Body>
                {bills.map((bill) => {
                  const studentName = resolveStudentName(bill);
                  const isPaid =
                    bill.isPaid === true ||
                    bill.isPaid === "true" ||
                    bill.status === "paid";
                  const cancelCheck = canCancelBill(bill);
                  const billKindMeta = getTaxBillKindMeta(bill);
                  const billPeriod = formatTaxBillPeriod(bill);
                  const billSourceSummary = getTaxBillSourceSummary(bill);
                  const lateFee = calculateTaxBillLateFee(bill);
                  const lateFeeAmount = isPaid
                    ? Number(bill.lateFeePaid || 0)
                    : lateFee.amount;
                  const principalAmount = Number(bill.amount || 0);
                  const displayAmount = isPaid
                    ? Number(bill.totalPaidAmount ?? principalAmount + lateFeeAmount)
                    : principalAmount + lateFeeAmount;

                  return (
                    <DataTable.Row key={bill.id}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedBillIds.has(bill.id)}
                          onChange={() => toggleBillSelection(bill.id)}
                          disabled={!cancelCheck.canCancel}
                          className="rounded"
                        />
                      </td>

                      <td className="whitespace-nowrap p-3">
                        {bill.dueDate ? formatTaxBillDate(bill.dueDate) : "-"}
                      </td>

                      <td className="whitespace-nowrap p-3">
                        {formatTaxBillDate(bill.issuedAt)}
                      </td>

                      <td className="whitespace-nowrap p-3">{studentName}</td>

                      <td className="p-3">
                        <div className="flex flex-col items-center gap-1">
                          <span className="whitespace-nowrap font-medium text-slate-800">
                            {bill.name}
                          </span>
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            <Badge color={billKindMeta.badgeColor} size="sm">
                              {billKindMeta.label}
                            </Badge>
                            {billPeriod && (
                              <span className="text-xs text-slate-500">
                                {billPeriod}
                              </span>
                            )}
                          </div>
                          {billSourceSummary && (
                            <span className="text-xs text-slate-500">
                              {billSourceSummary}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="whitespace-nowrap p-3 font-semibold text-red-600">
                        {formatDisplayMoney(displayAmount)} {currencyUnit}
                        {lateFeeAmount > 0 && (
                          <div className="text-xs font-bold text-rose-400">
                            원금 {formatDisplayMoney(principalAmount)} + 연체료{" "}
                            {formatDisplayMoney(lateFeeAmount)}
                          </div>
                        )}
                      </td>

                      <td className="p-3">
                        {isPaid ? (
                          <Badge color="green">납부 완료</Badge>
                        ) : (
                          <Badge color="yellow">미납</Badge>
                        )}
                      </td>

                      <td className="p-3">
                        {!isPaid ? (
                          (() => {
                            const unpaidDays = getUnpaidDays(bill);
                            const isOverdue = unpaidDays > 0;
                            if (!isOverdue) {
                              return <span className="text-slate-400">-</span>;
                            }
                            return (
                              <span
                                className={`font-medium ${
                                  isOverdue ? "text-red-600" : "text-orange-600"
                                }`}
                              >
                                {unpaidDays}일
                                {isOverdue && " 지연"}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap p-3">
                        {bill.paidAt ? formatTaxBillDate(bill.paidAt) : "-"}
                      </td>

                      <td className="p-3">
                        {cancelCheck.canCancel ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedBillForCancel({
                                ...bill,
                                studentName,
                              });
                              setShowCancelModal(true);
                            }}
                            tone="red"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        ) : (
                          <span
                            className="cursor-help text-xs text-slate-400"
                            title={cancelCheck.reason}
                          >
                            취소 불가
                          </span>
                        )}
                      </td>
                    </DataTable.Row>
                  );
                })}
              </DataTable.Body>
            </DataTable>
          ) : (
            <EmptyState
              title={
                paymentFilter === "all"
                  ? "선택한 기간에 발급된 고지서가 없습니다"
                  : "현재 필터 조건에 맞는 고지서가 없습니다"
              }
              description="기간이나 납부 상태 필터를 조정해 다시 확인해 보세요."
              className="my-6"
            />
          )}
        </div>
      </SurfaceLoader>

      {(hasPreviousPage || hasNextPage) && (
        <div className="flex items-center justify-between border-t p-4">
          <span className="text-sm text-slate-600">
            페이지 {currentPage} · 현재 {bills.length}건
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!hasPreviousPage}
            >
              <ChevronLeft className="h-4 w-4" /> 이전
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!hasNextPage}
            >
              다음 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default BillTable;
