import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { FolderKey, Pencil, Plus, Trash2 } from "lucide-react";

import { db } from "../../../firebase";
import {
  Alert,
  Button,
  Checkbox,
  InputField,
  Modal,
  StudentSelector,
} from "../../../components/ui";
import { ADVANCED_ETFS } from "../../../config/advancedEtfs";
import { useFeedback } from "../../../contexts/FeedbackContext";

const EMPTY_FORM = {
  id: "",
  name: "",
  accessMode: "selected_students",
  allowedStudentUids: [],
  selectedSymbols: [],
  isActive: true,
};

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const buildCategoryForm = (category) => ({
  id: category.id,
  name: category.name || "",
  accessMode:
    category.accessMode === "all_students" ? "all_students" : "selected_students",
  allowedStudentUids: Array.isArray(category.allowedStudentUids)
    ? category.allowedStudentUids
    : [],
  selectedSymbols: (category.symbols || [])
    .map((stock) => normalizeSymbol(stock?.ticker || stock?.symbol || stock))
    .filter(Boolean),
  isActive: category.isActive !== false,
});

export default function StockCategoryManagerModal({
  isOpen,
  onClose,
  classId,
  categories = [],
  stocks = [],
  initialCategoryId = "",
}) {
  const { showFeedback } = useFeedback();
  const [form, setForm] = useState(EMPTY_FORM);
  const [searchTerm, setSearchTerm] = useState("");
  const [stockViewMode, setStockViewMode] = useState("all");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const initialCategory = categories.find((category) => category.id === initialCategoryId);
    setForm(initialCategory ? buildCategoryForm(initialCategory) : EMPTY_FORM);
    setSearchTerm("");
    setStockViewMode("all");
  }, [categories, initialCategoryId, isOpen]);

  const stockCatalog = useMemo(() => {
    const map = new Map();
    [...ADVANCED_ETFS, ...stocks].forEach((stock) => {
      const ticker = normalizeSymbol(stock?.symbol || stock?.ticker);
      if (!ticker) return;
      map.set(ticker, {
        ticker,
        companyName: stock?.companyName || ticker,
        isIndex: stock?.isIndex === true,
      });
    });
    return Array.from(map.values()).sort((left, right) =>
      left.ticker.localeCompare(right.ticker),
    );
  }, [stocks]);

  const searchedCatalog = useMemo(() => {
    const lowered = searchTerm.trim().toLowerCase();
    if (!lowered) return stockCatalog;
    return stockCatalog.filter(
      (stock) =>
        stock.ticker.toLowerCase().includes(lowered) ||
        stock.companyName.toLowerCase().includes(lowered),
    );
  }, [searchTerm, stockCatalog]);

  const filteredCatalog = useMemo(
    () =>
      stockViewMode === "selected"
        ? searchedCatalog.filter((stock) => form.selectedSymbols.includes(stock.ticker))
        : searchedCatalog,
    [form.selectedSymbols, searchedCatalog, stockViewMode],
  );

  const selectedStocks = useMemo(() => {
    const catalogMap = new Map(stockCatalog.map((stock) => [stock.ticker, stock]));
    return form.selectedSymbols.map((ticker) =>
      catalogMap.get(ticker) || { ticker, companyName: ticker });
  }, [form.selectedSymbols, stockCatalog]);

  const resetForm = () => setForm(EMPTY_FORM);

  const editCategory = (category) => {
    setForm(buildCategoryForm(category));
  };

  const toggleSymbol = (ticker) => {
    setForm((current) => ({
      ...current,
      selectedSymbols: current.selectedSymbols.includes(ticker)
        ? current.selectedSymbols.filter((symbol) => symbol !== ticker)
        : [...current.selectedSymbols, ticker],
    }));
  };

  const selectSearchedStocks = () => {
    setForm((current) => ({
      ...current,
      selectedSymbols: Array.from(
        new Set([...current.selectedSymbols, ...searchedCatalog.map((stock) => stock.ticker)]),
      ),
    }));
  };

  const clearSearchedStocks = () => {
    const searchedSymbols = new Set(searchedCatalog.map((stock) => stock.ticker));
    setForm((current) => ({
      ...current,
      selectedSymbols: current.selectedSymbols.filter((ticker) => !searchedSymbols.has(ticker)),
    }));
  };

  const saveCategory = async () => {
    const name = form.name.trim();
    if (!name) {
      showFeedback("카테고리 이름을 입력해주세요.", "warning");
      return;
    }
    if (form.selectedSymbols.length === 0) {
      showFeedback("카테고리에 종목을 한 개 이상 담아주세요.", "warning");
      return;
    }
    if (form.accessMode === "selected_students" && form.allowedStudentUids.length === 0) {
      showFeedback("접근을 허용할 학생을 한 명 이상 선택해주세요.", "warning");
      return;
    }

    const duplicateName = categories.some(
      (category) =>
        category.id !== form.id &&
        String(category.name || "").trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicateName) {
      showFeedback("같은 이름의 카테고리가 이미 있습니다.", "warning");
      return;
    }

    const conflictingSymbols = new Set();
    categories.forEach((category) => {
      if (category.id === form.id) return;
      (category.symbols || []).forEach((stock) => {
        const ticker = normalizeSymbol(stock?.ticker || stock?.symbol || stock);
        if (form.selectedSymbols.includes(ticker)) conflictingSymbols.add(ticker);
      });
    });
    if (conflictingSymbols.size > 0) {
      showFeedback(
        `다른 학급 카테고리에 이미 등록된 종목이 있습니다: ${Array.from(conflictingSymbols).join(", ")}`,
        "warning",
      );
      return;
    }

    const catalogMap = new Map(stockCatalog.map((stock) => [stock.ticker, stock]));
    const categoryRef = form.id
      ? doc(db, "classes", classId, "stockCategories", form.id)
      : doc(collection(db, "classes", classId, "stockCategories"));
    const previous = categories.find((category) => category.id === form.id);

    setIsSaving(true);
    try {
      await setDoc(categoryRef, {
        name,
        order: previous?.order ?? categories.length,
        isActive: form.isActive,
        accessMode: form.accessMode,
        allowedStudentUids:
          form.accessMode === "selected_students" ? form.allowedStudentUids : [],
        requiredCertificateId: null,
        symbols: form.selectedSymbols.map((ticker) => ({
          ticker,
          companyName: catalogMap.get(ticker)?.companyName || ticker,
          isIndex: catalogMap.get(ticker)?.isIndex === true,
        })),
        createdAt: previous?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // The class category listener applies this write without rereading global definitions.
      showFeedback("학급 주식 카테고리를 저장했습니다.", "success");
      resetForm();
    } catch (error) {
      console.error("[StockCategoryManagerModal] save failed:", error);
      showFeedback("카테고리 저장에 실패했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const removeCategory = async (category) => {
    if (!(await appConfirm(`'${category.name}' 카테고리를 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    try {
      await deleteDoc(doc(db, "classes", classId, "stockCategories", category.id));
      // The class category listener applies this write without rereading global definitions.
      if (form.id === category.id) resetForm();
      showFeedback("카테고리를 삭제했습니다.", "success");
    } catch (error) {
      console.error("[StockCategoryManagerModal] delete failed:", error);
      showFeedback("카테고리 삭제에 실패했습니다.", "error");
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <FolderKey className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">학급 주식 카테고리</h2>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-5">
        <Alert
          type="info"
          message="선택 학생 전용 카테고리는 지정한 학생에게만 표시되고 매수가 허용됩니다. 전체 숨김 종목도 선택된 학생은 볼 수 있으며, 권한이 해제된 뒤에도 기존 보유 종목은 매도할 수 있습니다."
        />

        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800">등록된 카테고리</h3>
              <Button size="xs" kind="ghost" tone="slate" icon={Plus} onClick={resetForm}>
                새로 만들기
              </Button>
            </div>
            {categories.length === 0 ? (
              <p className="rounded-xl bg-white p-4 text-sm text-slate-500">
                아직 학급 카테고리가 없습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {categories.map((category) => (
                  <div key={category.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-800">{category.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {(category.symbols || []).length}개 · {category.accessMode === "all_students"
                            ? "전체 학생"
                            : `선택 학생 ${(category.allowedStudentUids || []).length}명`}
                          {category.isActive === false ? " · 비활성" : ""}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="xs" kind="ghost" tone="slate" icon={Pencil} onClick={() => editCategory(category)} aria-label="수정" />
                        <Button size="xs" kind="ghost" tone="rose" icon={Trash2} onClick={() => removeCategory(category)} aria-label="삭제" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="font-black text-slate-800">
              {form.id ? "카테고리 수정" : "새 카테고리"}
            </h3>
            <InputField
              label="카테고리 이름"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="예: 원자재 심화 투자"
            />
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-700">학생 접근 권한</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    이 카테고리의 종목을 보고 매수할 학생을 정합니다.
                  </p>
                </div>
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                  {[
                    { value: "all_students", label: "전체 학생" },
                    { value: "selected_students", label: "선택 학생" },
                  ].map((option) => {
                    const isSelected = form.accessMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({ ...current, accessMode: option.value }))
                        }
                        className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                          isSelected
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        }`}
                        aria-pressed={isSelected}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {form.accessMode === "selected_students" ? (
                <StudentSelector
                  label={`허용 학생 ${form.allowedStudentUids.length}명`}
                  selectedUids={form.allowedStudentUids}
                  onChange={(allowedStudentUids) =>
                    setForm((current) => ({ ...current, allowedStudentUids }))
                  }
                  multiple
                />
              ) : (
                <p className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                  학급의 모든 학생에게 카테고리와 종목이 표시됩니다.
                </p>
              )}
            </div>
            <Checkbox
              id="stock-category-active"
              label="학생 화면에서 카테고리 사용"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-700">종목 선택</p>
                  <p className="mt-0.5 text-xs text-slate-500">티커나 종목명으로 검색해 담아주세요.</p>
                </div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700">
                  {form.selectedSymbols.length}개 선택
                </span>
              </div>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="티커 또는 종목명 검색"
                className="w-full rounded-xl border border-blue-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  {[
                    { value: "all", label: `전체 ${searchedCatalog.length}` },
                    { value: "selected", label: `선택됨 ${form.selectedSymbols.length}` },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStockViewMode(option.value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                        stockViewMode === option.value
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectSearchedStocks}
                    disabled={searchedCatalog.length === 0}
                    className="text-xs font-bold text-indigo-600 disabled:text-slate-300"
                  >
                    검색 결과 전체 선택
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={clearSearchedStocks}
                    disabled={searchedCatalog.length === 0}
                    className="text-xs font-bold text-slate-500 disabled:text-slate-300"
                  >
                    선택 해제
                  </button>
                </div>
              </div>
              {selectedStocks.length > 0 ? (
                <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-indigo-50/70 p-2">
                  {selectedStocks.map((stock) => (
                    <button
                      key={stock.ticker}
                      type="button"
                      onClick={() => toggleSymbol(stock.ticker)}
                      className="rounded-full border border-indigo-100 bg-white px-2.5 py-1 text-xs font-black text-indigo-700 hover:border-rose-200 hover:text-rose-600"
                      title={`${stock.companyName} 선택 해제`}
                    >
                      {stock.ticker} ×
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {filteredCatalog.length > 0 ? (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {filteredCatalog.map((stock) => {
                      const isSelected = form.selectedSymbols.includes(stock.ticker);
                      return (
                        <button
                          key={stock.ticker}
                          type="button"
                          onClick={() => toggleSymbol(stock.ticker)}
                          className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                            isSelected
                              ? "border-indigo-200 bg-indigo-50"
                              : "border-transparent hover:bg-slate-50"
                          }`}
                          aria-pressed={isSelected}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black ${
                              isSelected
                                ? "border-indigo-500 bg-indigo-600 text-white"
                                : "border-slate-300 bg-white text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-black text-slate-800">{stock.ticker}</span>
                            <span className="block truncate text-[11px] text-slate-500">{stock.companyName}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-slate-400">
                    {stockViewMode === "selected"
                      ? "선택한 종목이 없습니다."
                      : "검색 결과가 없습니다."}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" onClick={onClose}>닫기</Button>
        <Button tone="blue" onClick={saveCategory} isLoading={isSaving} disabled={isSaving}>
          {form.id ? "변경 저장" : "카테고리 등록"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
