import { User, ShoppingCart, Plus, Minus, Trash2, Search, ShoppingBag, CheckCircle2, Zap, Package, Landmark } from "lucide-react";
import { Modal, Button, Badge, IconButton } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { getStoreCurrencyUnit } from "../utils/storeCurrency";
import { getCompactTimeSaleLabel } from "../utils/timeSale";
import { useStorePosModalController } from "./useStorePosModalController";
const StorePosModal = ({
  isOpen,
  onClose,
  classId,
  students = [],
  items = [],
  classFunds = [],
  fundPaymentOnly = false,
  fixedFundId = "",
  onExecutePurchase,
  isSubmitting,
  currencyUnit
}) => {
  const { missionTokenLabel } = useUser();
  const {
    formatClassCurrency,
    queue,
    activeUid,
    batchSelectedUids,
    studentSearch,
    setStudentSearch,
    isImmediate,
    transactionType,
    settingsReady,
    settingsError,
    retrySettings,
    recordAsTaxExpense,
    selectedFund,
    selectedFundBalance,
    isFundPayment,
    handleModeToggle,
    handleTransactionTypeToggle,
    handleTaxExpenseToggle,
    displayStudents,
    isMultiSelectMode,
    batchSelectedUidSet,
    batchSelectedPreview,
    allDisplayedSelected,
    posAvailableItems,
    currentCart,
    activeStudentName,
    queueStudentCount,
    getRemainingStock,
    toggleAllDisplayedStudents,
    handleSelectionModeChange,
    handleStudentRowClick,
    handleBatchRowPointerDown,
    handleBatchRowPointerEnter,
    addSingleToCart,
    addBatchToCart,
    updateCartQty,
    removeFromCart,
    clearActiveStudentCart,
    clearAllStudentCarts,
    handleFinalExecute,
    totalQueueByCurrency,
    totalQueueAmount,
    batchSelectedCartSummary,
    batchSelectedQueuedCount
  } = useStorePosModalController({
    isOpen,
    classId,
    students,
    items,
    classFunds,
    fundPaymentOnly,
    fixedFundId,
    onExecutePurchase,
    currencyUnit
  });
  const hasNonCashFundItems = isFundPayment && Object.keys(totalQueueByCurrency).some(type => type !== "cash" && Number(totalQueueByCurrency[type] || 0) > 0);
  const isFundQueueBlocked = isFundPayment && (hasNonCashFundItems || totalQueueAmount > selectedFundBalance);
  if (!settingsReady) return <Modal isOpen={isOpen} onClose={onClose} title="매점 POS 시스템" size="xl">
    <Modal.Body>
      <p role={settingsError ? "alert" : "status"} className="p-6 text-center text-sm text-slate-600">
        {settingsError || "저장된 POS 처리 방식을 확인하고 있습니다..."}
      </p>
      {settingsError && <Button onClick={retrySettings}>다시 시도</Button>}
    </Modal.Body>
  </Modal>;
  return <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex w-full items-center justify-between pr-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white shadow-lg shadow-blue-100">
              <ShoppingCart size={20} />
            </div>
            <h2 className="text-xl font-black text-slate-800">매점 POS 시스템</h2>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-100 p-1">
              <Button type="button" onClick={() => handleTransactionTypeToggle("purchase")} size="xs" tone="indigo" kind={transactionType === "purchase" ? "soft" : "ghost"} rounded="xl" className={`gap-2  ${transactionType === "purchase" ? "bg-white text-indigo-600" : "text-slate-400 hover:text-slate-600"}`}>
                <ShoppingCart size={14} />
                결제
              </Button>
              <Button type="button" onClick={() => handleTransactionTypeToggle("gift")} size="xs" tone="emerald" kind={transactionType === "gift" ? "soft" : "ghost"} rounded="xl" disabled={fundPaymentOnly} className={`gap-2  ${transactionType === "gift" ? "bg-white text-emerald-600" : "text-slate-400 hover:text-slate-600"}`}>
                <Package size={14} />
                무료 선물
              </Button>
            </div>

            {fundPaymentOnly && isFundPayment ? <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                <Landmark size={14} />
                {selectedFund?.name || "사용할 수 없는 기금"} · {formatClassCurrency(selectedFund?.cashBalance || 0)} {currencyUnit}
              </div> : null}

            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-100 p-1">
              <Button type="button" onClick={() => handleModeToggle(true)} size="xs" tone="blue" kind={isImmediate ? "soft" : "ghost"} rounded="xl" className={`gap-2  ${isImmediate ? "bg-white text-blue-600" : "text-slate-400 hover:text-slate-600"}`}>
                <Zap size={14} fill={isImmediate ? "currentColor" : "none"} />
                즉시 처리
              </Button>
              <Button type="button" onClick={() => handleModeToggle(false)} size="xs" tone="amber" kind={!isImmediate ? "soft" : "ghost"} rounded="xl" className={`gap-2  ${!isImmediate ? "bg-white text-orange-600" : "text-slate-400 hover:text-slate-600"}`}>
                <Package size={14} fill={!isImmediate ? "currentColor" : "none"} />
                가방에 지급
              </Button>
            </div>

            {transactionType === "gift" && <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" checked={recordAsTaxExpense} onChange={event => handleTaxExpenseToggle(event.target.checked)} />
                무료 선물 금액을 국고 지출로 처리 (학급 재정 차감)
              </label>}
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="flex h-[78vh] flex-col overflow-hidden bg-white p-0 lg:flex-row">
        <div className="flex w-full flex-col border-r border-slate-100 bg-slate-50/30 lg:w-1/2">
          <div className="border-b border-slate-100 bg-white p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input placeholder="학생 이름 또는 번호 검색" value={studentSearch} onChange={event => setStudentSearch(event.target.value)} className="w-full rounded-xl border-none bg-slate-100 py-2.5 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-blue-100" />
            </div>

            <div className="mt-3 space-y-3">
              <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-100 p-1">
                <Button type="button" onClick={() => handleSelectionModeChange("single")} size="xs" tone="blue" kind={!isMultiSelectMode ? "soft" : "ghost"} rounded="xl" className={`flex-1  ${!isMultiSelectMode ? "bg-white text-blue-600" : "text-slate-400 hover:text-slate-600"}`}>
                  단일 담기
                </Button>
                <Button type="button" onClick={() => handleSelectionModeChange("multi")} size="xs" tone="emerald" kind={isMultiSelectMode ? "soft" : "ghost"} rounded="xl" className={`flex-1  ${isMultiSelectMode ? "bg-white text-emerald-600" : "text-slate-400 hover:text-slate-600"}`}>
                  다중 담기
                </Button>
              </div>

              <div className={`rounded-2xl border p-3 ${isMultiSelectMode ? "border-emerald-100 bg-emerald-50/70" : "border-slate-100 bg-slate-50"}`}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800">
                      {isMultiSelectMode ? `다중 담기 대상 ${batchSelectedUids.length}명` : `단일 담기 대상 ${activeUid ? activeStudentName : "미선택"}`}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isMultiSelectMode ? batchSelectedUids.length > 0 ? `${batchSelectedPreview} 선택됨. 학생 행을 누르거나 드래그해서 추가하거나 해제할 수 있습니다.` : "다중 담기 모드에서는 학생 행 전체를 누르거나 드래그해서 대상을 선택합니다." : activeUid ? `${activeStudentName} 장바구니를 보고 있습니다. 다른 학생 행을 누르면 바로 전환됩니다.` : "단일 담기 모드에서는 학생 행을 눌러 장바구니를 열고 상품을 담습니다."}
                    </p>
                  </div>

                  {isMultiSelectMode ? <div className="justify-self-end">
                      <Button type="button" onClick={toggleAllDisplayedStudents} size="xs" tone="slate" kind="outline" rounded="lg" className="w-[92px] shrink-0 whitespace-nowrap text-center">
                        {allDisplayedSelected ? "전체 해제" : "전체 선택"}
                      </Button>
                    </div> : <div className="justify-self-end">
                      <Badge tone={activeUid ? "blue" : "slate"} variant="soft">
                      {activeUid ? "학생 선택됨" : "학생 선택 필요"}
                      </Badge>
                    </div>}
                </div>
              </div>
            </div>
          </div>

          <div className="scrollbar-hide flex-1 overflow-y-auto">
            {displayStudents.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-400">
                <Search size={20} />
                <p className="text-sm font-bold">검색 결과가 없습니다.</p>
              </div> : <table className="w-full text-left">
                <tbody className={`divide-y divide-slate-100 bg-white ${isMultiSelectMode ? "select-none" : ""}`}>
                  {displayStudents.map(student => {
                const cartSize = queue[student.uid]?.length || 0;
                const isActive = activeUid === student.uid;
                const isBatchSelected = batchSelectedUidSet.has(student.uid);
                const isHighlighted = isMultiSelectMode ? isBatchSelected : isActive;
                return <tr key={student.uid} onClick={() => handleStudentRowClick(student.uid)} onPointerDown={event => handleBatchRowPointerDown(event, student.uid, isBatchSelected)} onPointerEnter={() => handleBatchRowPointerEnter(student.uid)} onDragStart={event => event.preventDefault()} className={`transition-all ${isMultiSelectMode ? isBatchSelected ? "cursor-cell bg-emerald-50 shadow-sm hover:bg-emerald-100/80" : "cursor-cell bg-white hover:bg-emerald-50" : isActive ? "cursor-pointer bg-blue-600 text-white shadow-lg" : "cursor-pointer bg-white hover:bg-blue-50"}`}>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold ${isMultiSelectMode ? isBatchSelected ? "text-emerald-600" : "text-slate-400" : isActive ? "text-blue-100" : "text-slate-400"}`}>
                                  {student.studentNumber || "-"}
                                </span>
                                <span className="truncate text-base font-black">
                                  {student.name}
                                </span>
                                {!isMultiSelectMode && isActive ? <CheckCircle2 size={16} className="shrink-0 text-blue-100" /> : null}
                                {isMultiSelectMode && isBatchSelected ? <Badge tone="emerald" variant="soft">
                                    선택됨
                                  </Badge> : null}
                              </div>

                              <p className={`mt-1 text-[11px] font-bold ${isMultiSelectMode ? isBatchSelected ? "text-emerald-700" : "text-slate-400" : isActive ? "text-blue-100" : "text-slate-400"}`}>
                                {isMultiSelectMode ? isBatchSelected ? "다중 담기 대상에 포함됨" : "행을 누르거나 드래그해 다중 대상에 추가" : cartSize > 0 ? `장바구니 ${cartSize}건` : "행을 눌러 장바구니 보기"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {cartSize > 0 ? <Badge tone={isMultiSelectMode ? isHighlighted ? "emerald" : "blue" : isActive ? "white" : "blue"} variant="solid">
                              {cartSize}건
                            </Badge> : null}
                        </td>
                      </tr>;
              })}
                </tbody>
              </table>}
          </div>
        </div>

        <div className="flex w-full flex-col overflow-hidden bg-white lg:w-1/2">
          <div className="flex-shrink-0 border-b border-slate-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  빠른 상품 추가
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {isMultiSelectMode ? "선택한 학생 여러 명에게 같은 상품을 한 번에 담습니다." : "현재 선택한 학생 한 명에게 상품을 바로 담습니다."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={isMultiSelectMode ? "emerald" : "blue"} variant="soft">
                  현재 모드 {isMultiSelectMode ? "다중 담기" : "단일 담기"}
                </Badge>
                <Badge tone={isMultiSelectMode ? batchSelectedUids.length > 0 ? "emerald" : "slate" : activeUid ? "blue" : "slate"} variant="soft">
                  {isMultiSelectMode ? `선택 ${batchSelectedUids.length}명` : `선택 ${activeUid ? activeStudentName : "없음"}`}
                </Badge>
              </div>
            </div>

            <div className="scrollbar-hide mt-4 grid max-h-60 grid-cols-2 gap-3 overflow-y-auto pr-1">
              {posAvailableItems.map(item => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-700">{item.name}</p>
                      <p className="mt-0.5 text-[10px] font-black text-blue-600">
                        {formatClassCurrency(item.effectivePrice ?? item.price)}{" "}
                        {getStoreCurrencyUnit(
                          item.currencyType,
                          currencyUnit,
                          missionTokenLabel,
                        )}
                      </p>
                      {item.timeSaleActive ? <p className="mt-0.5 text-[10px] font-bold text-rose-500">
                          {item.timeSaleDiscountPercent || 0}% 세일
                        </p> : null}
                      {Number(item.stock) !== -1 ? <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                          남은 재고 {Math.max(getRemainingStock(item), 0)}개
                        </p> : null}
                    </div>

                    {isMultiSelectMode ? <Button type="button" onClick={() => addBatchToCart(item)} disabled={batchSelectedUids.length === 0} size="xs" tone="emerald" kind="outline" rounded="lg" className="shrink-0">
                        담기
                      </Button> : <Button type="button" onClick={() => addSingleToCart(item)} disabled={!activeUid} size="xs" tone="blue" rounded="lg" className="shrink-0">
                        담기
                      </Button>}
                  </div>
                </div>)}
            </div>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden bg-slate-50/20 p-5">
            {isMultiSelectMode ? <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-xl bg-white p-2 shadow-sm">
                      <ShoppingBag size={16} className="text-emerald-600" />
                    </div>
                    <p className="text-base font-black text-slate-800">
                      선택 학생 {batchSelectedUids.length}명
                    </p>
                    <Badge tone={batchSelectedQueuedCount > 0 ? "emerald" : "slate"} variant="soft">
                      이미 담긴 학생 {batchSelectedQueuedCount}명
                    </Badge>
                  </div>
                  <p className="text-[11px] font-medium text-slate-400">
                    수량 편집은 단일 담기 모드에서 할 수 있습니다.
                  </p>
                </div>

                <div className="scrollbar-hide flex-1 overflow-y-auto pr-1">
                  {batchSelectedCartSummary.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-white/80 px-6 text-center text-slate-400">
                      <User size={24} />
                      <p className="text-sm font-medium">
                        다중 담기 모드입니다.
                        <br />
                        학생 행을 누르거나 드래그해 여러 명을 선택해 주세요.
                      </p>
                    </div> : <div className="space-y-2">
                      {batchSelectedCartSummary.map(({
                  student,
                  cartKinds,
                  totalQuantity
                }) => <div key={student.uid} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-bold text-slate-800">
                                {student.name}
                              </p>
                              <Badge tone="emerald" variant="soft">
                                선택됨
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">
                              {student.studentNumber || "-"}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-sm font-black text-slate-700">
                              {totalQuantity > 0 ? `${cartKinds}종 / ${totalQuantity}개` : "아직 담긴 상품 없음"}
                            </p>
                            <p className="mt-1 text-[11px] font-medium text-slate-400">
                              {totalQuantity > 0 ? "기존 장바구니에 이어서 담깁니다." : "상품을 누르면 이 학생에게도 함께 담깁니다."}
                            </p>
                          </div>
                        </div>)}
                    </div>}
                </div>
              </> : activeUid ? <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-xl bg-white p-2 shadow-sm">
                      <ShoppingBag size={16} className="text-blue-600" />
                    </div>
                    <p className="text-base font-black text-slate-800">
                      {activeStudentName} 장바구니
                    </p>
                    {batchSelectedUidSet.has(activeUid) ? <Badge tone="emerald" variant="soft">
                        다중 대상 포함
                      </Badge> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" onClick={clearActiveStudentCart} disabled={currentCart.length === 0} size="xs" tone="rose" kind="outline" rounded="lg" >
                      선택 학생 전체 비우기
                    </Button>
                    <Button type="button" onClick={clearAllStudentCarts} disabled={queueStudentCount === 0} size="xs" tone="slate" kind="outline" rounded="lg" >
                      모든 학생 전체 비우기
                    </Button>
                  </div>
                </div>

                <div className="scrollbar-hide flex-1 overflow-y-auto pr-1">
                  {currentCart.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-white/80 px-6 text-center text-slate-400">
                      <ShoppingBag size={24} />
                      <p className="text-sm font-medium">
                        아직 담긴 상품이 없습니다.
                        <br />
                        위 상품 버튼으로 먼저 담아 주세요.
                      </p>
                    </div> : <div className="space-y-2">
                      {currentCart.map(item => <div key={item.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-800">
                              {item.name}
                            </p>
                            <p className="text-xs text-slate-400">
                              {formatClassCurrency(item.effectivePrice ?? item.price)}{" "}
                              {getStoreCurrencyUnit(
                                item.currencyType,
                                currencyUnit,
                                missionTokenLabel,
                              )}
                            </p>
                            {item.timeSaleActive ? <p className="text-[10px] font-bold text-rose-500">
                                {getCompactTimeSaleLabel(item.timeSaleCountdownLabel) || "세일 진행 중"}
                              </p> : null}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex items-center rounded-xl bg-slate-100 p-1">
                              <IconButton type="button" onClick={() => updateCartQty(item.id, -1)} icon={Minus} label="수량 줄이기" tone="red" size="sm" className="h-7 w-7 rounded-lg border-0 bg-transparent p-1 hover:text-rose-500" />
                              <span className="w-6 text-center text-sm font-black text-slate-700">
                                {item.quantity}
                              </span>
                              <IconButton type="button" onClick={() => updateCartQty(item.id, 1)} icon={Plus} label="수량 늘리기" tone="blue" size="sm" className="h-7 w-7 rounded-lg border-0 bg-transparent p-1 hover:text-blue-600" />
                            </div>
                            <IconButton type="button" onClick={() => removeFromCart(item.id)} icon={Trash2} label="상품 제거" tone="red" size="md" className="border-0 bg-transparent p-2 text-slate-300 hover:text-rose-500" />
                          </div>
                        </div>)}
                    </div>}
                </div>
              </> : <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <User size={32} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium">
                  단일 담기 모드입니다.
                  <br />
                  학생 행을 선택하면 장바구니를 확인할 수 있습니다.
                </p>
              </div>}
          </div>

          <div className="border-t border-slate-100 bg-white px-5 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">
                    결제 대기 학생 수
                  </p>
                  <p className="text-xl font-black text-slate-900">
                    {queueStudentCount}{" "}
                    <span className="text-sm font-medium text-slate-400">명</span>
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase text-slate-400">
                    {transactionType === "gift" ? "총 선물 금액" : "총 결제 금액"}
                  </p>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {Object.keys(totalQueueByCurrency).length === 0 ? <p className="text-xl font-black text-blue-600">
                        {formatClassCurrency(0)}{" "}
                        <span className="text-sm font-bold text-blue-300">
                          {currencyUnit}
                        </span>
                      </p> : null}
                    {Object.entries(totalQueueByCurrency).map(([type, amount]) => <p key={type} className="text-lg font-black text-blue-600">
                        {formatClassCurrency(amount)}{" "}
                        <span className="text-sm font-bold text-blue-300">
                          {getStoreCurrencyUnit(type, currencyUnit, missionTokenLabel)}
                        </span>
                      </p>)}
                  </div>
                  {isFundPayment ? <p className="mt-1 text-[11px] font-bold text-emerald-600">
                      출금 기금: {selectedFund?.name || "기금"} · 잔액{" "}
                      {formatClassCurrency(selectedFundBalance)} {currencyUnit}
                    </p> : null}
                  {isFundQueueBlocked ? <p className="mt-1 text-[11px] font-bold text-rose-600">
                      {hasNonCashFundItems ? "기금 POS는 일반 화폐 상품만 결제할 수 있습니다." : "기금 잔액이 부족합니다."}
                    </p> : null}
                </div>
              </div>

              <div className="w-full lg:w-auto lg:min-w-[220px]">
                <Button fullWidth tone={totalQueueAmount > 0 ? transactionType === "gift" ? "emerald" : isImmediate ? "blue" : "indigo" : "slate"} kind={totalQueueAmount > 0 ? "solid" : "soft"} size="lg" disabled={totalQueueAmount === 0 || isSubmitting || isFundQueueBlocked} onClick={handleFinalExecute} className={`transition-all  ${totalQueueAmount > 0 && !isFundQueueBlocked ? transactionType === "gift" ? "" : isImmediate ? "" : "" : "opacity-50"}`}>
                  {isSubmitting ? transactionType === "gift" ? "선물 처리 중..." : "결제 처리 중..." : transactionType === "gift" ? isImmediate ? "즉시 선물 실행" : "가방에 선물 실행" : isImmediate ? "즉시 결제 실행" : "대기열 결제 실행"}
                </Button>
              </div>
            </div>

            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10px] font-bold text-slate-400">
              {isImmediate ? <Zap size={10} className="fill-current" /> : <Package size={10} className="fill-current" />}
              현재 POS 모드:
              <span className={transactionType === "gift" ? "text-emerald-500" : isImmediate ? "text-blue-500" : "text-orange-500"}>
                {transactionType === "gift" ? isImmediate ? "즉시 선물" : "가방에 선물" : isFundPayment ? isImmediate ? "기금 즉시 결제" : "기금 대기열 결제" : isImmediate ? "즉시 결제" : "대기열 결제"}
              </span>
              (모드는 자동 저장됩니다)
            </p>
          </div>
        </div>
      </Modal.Body>
    </Modal>;
};
export default StorePosModal;
