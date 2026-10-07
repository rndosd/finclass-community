// src/pages/marketplace/components/ItemForm.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Package, Tag, Coins, Receipt } from "lucide-react";
import {
  getProductTypeAsset,
  MARKETPLACE_TYPE_ASSET_OPTIONS,
} from "../../../assets/illustrations/productTypes";
import { useCategories } from "../hooks/useCategories";
import { useUser } from "../../../contexts/UserContext";
import { Modal, Button, SelectField } from "../../../components/ui";

const normalizeWholePrice = (value) => {
  if (value === "" || value === null || value === undefined) return "";

  const sanitized = String(value).replace(/,/g, "").trim();
  const num = Number(sanitized);

  if (!Number.isFinite(num)) return "";

  return String(Math.max(0, Math.trunc(num)));
};

const normalizeWholeCount = (value) => {
  if (value === "" || value === null || value === undefined) return "";

  const sanitized = String(value).replace(/,/g, "").trim();
  const num = Number(sanitized);

  if (!Number.isFinite(num)) return "";

  return String(Math.max(1, Math.trunc(num)));
};

const formatWhole = (value, formatter) => {
  const normalized = Math.max(0, Math.trunc(Number(value || 0)));
  if (typeof formatter === "function") {
    return formatter(normalized);
  }
  return normalized.toLocaleString();
};

const ItemForm = ({
  currencyName,
  onSubmit,
  onClose,
  itemToEdit = null,
  autoApproveEnabled = false,
  sellerFeeRate = 0,
  sellerFeeEnabled = false,
  formatWholeNumber,
}) => {
  const { categories } = useCategories();
  const { classData } = useUser();

  const dynamicCurrencyUnit =
    classData?.currencyUnit ||
    classData?.currencySettings?.name ||
    currencyName ||
    "골드";

  const [formData, setFormData] = useState({
    title: "",
    itemIcon: "auto",
    description: "",
    category: "",
    price: "",
    stock: "1",
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedCategoryId = formData.category;
  const isEditing = Boolean(itemToEdit);
  const selectedItemAsset = getProductTypeAsset({
    itemIcon: formData.itemIcon,
    title: formData.title,
    description: formData.description,
    assetContext: "marketplace",
  });

  const normalizedPrice = Number(normalizeWholePrice(formData.price) || 0);
  const normalizedFeeRate = Math.max(0, Number(sellerFeeRate || 0));
  const estimatedFee = sellerFeeEnabled
    ? Math.round((normalizedPrice * normalizedFeeRate) / 100)
    : 0;
  const estimatedSellerNet = Math.max(0, normalizedPrice - estimatedFee);

  useEffect(() => {
    if (categories.length && !selectedCategoryId) {
      setFormData((prev) => ({ ...prev, category: categories[0].id }));
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!itemToEdit) {
      return;
    }

    setFormData({
      title: itemToEdit.title || "",
      itemIcon: itemToEdit.itemIcon || "auto",
      description: itemToEdit.description || "",
      category: itemToEdit.category || "",
      price: normalizeWholePrice(itemToEdit.price),
      stock: normalizeWholeCount(itemToEdit.stock || 1),
    });
  }, [itemToEdit]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    const nextValue =
      name === "price"
        ? normalizeWholePrice(value)
        : name === "stock"
          ? normalizeWholeCount(value)
          : value;
    setFormData((prev) => ({ ...prev, [name]: nextValue }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const descCount = useMemo(() => formData.description.length, [formData.description]);

  const validateForm = () => {
    const nextErrors = {};
    if (!formData.title.trim()) nextErrors.title = "제목을 입력해주세요";
    if (!formData.description.trim()) nextErrors.description = "설명을 입력해주세요";
    if (!formData.category) nextErrors.category = "카테고리를 선택해주세요";

    const price = Number(normalizeWholePrice(formData.price));
    if (!price || price <= 0) nextErrors.price = "올바른 가격을 입력해주세요";

    const stock = Number(normalizeWholeCount(formData.stock));
    if (!stock || stock <= 0) nextErrors.stock = "올바른 재고 수량을 입력해주세요";

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const data = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        category: formData.category,
        type: "sale",
        itemIcon: formData.itemIcon || "auto",
        price: normalizedPrice,
        stock: Number(normalizeWholeCount(formData.stock)),
      };

      await onSubmit(data);
    } catch (error) {
      console.error("아이템 등록 실패:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2">
            <Package className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold">
            {isEditing ? "상품 수정" : "물건 등록하기"}
          </span>
        </div>
      }
    >
      <div className="space-y-6 p-1">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              {"\uC0C1\uD488\uBA85"} *
            </label>
            <div className="flex items-stretch gap-2">
              <div
                className="relative flex w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 transition-colors hover:border-blue-200 hover:bg-blue-50"
                title={"\uB300\uD45C \uADF8\uB9BC \uC120\uD0DD"}
              >
                <img
                  src={selectedItemAsset}
                  alt=""
                  className="h-9 w-9 object-contain"
                  aria-hidden="true"
                />
                <span className="absolute bottom-0.5 right-1 text-[8px] text-slate-400">▼</span>
                <select
                  name="itemIcon"
                  value={formData.itemIcon}
                  onChange={handleChange}
                  aria-label={"\uB300\uD45C \uADF8\uB9BC \uC120\uD0DD"}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                  {MARKETPLACE_TYPE_ASSET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                maxLength={50}
                placeholder={"\uC0C1\uD488 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694"}
                disabled={isSubmitting}
                className={`min-w-0 flex-1 rounded-xl border px-4 py-3 text-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                  errors.title
                    ? "border-rose-300 ring-2 ring-rose-200"
                    : "border-blue-200 hover:border-blue-200"
                } ${isSubmitting ? "cursor-not-allowed opacity-50" : ""}`}
              />
            </div>
            <div className="flex items-center justify-between">
              {errors.title ? <p className="text-sm text-rose-600">{errors.title}</p> : null}
              <span className="ml-auto text-xs text-slate-500">{formData.title.length}/50</span>
            </div>
          </div><div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">설명 *</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              maxLength={200}
              rows={4}
              placeholder="상품 상태, 구성품, 사용감 등을 자세히 적어주세요"
              disabled={isSubmitting}
              className={`w-full resize-none rounded-xl border px-4 py-3 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                errors.description
                  ? "border-rose-300 ring-2 ring-rose-200"
                  : "border-blue-200 hover:border-blue-200"
              } ${isSubmitting ? "cursor-not-allowed opacity-50" : ""}`}
            />
            <div className="flex items-center justify-between">
              {errors.description ? (
                <p className="text-sm text-rose-600">{errors.description}</p>
              ) : null}
              <span className="ml-auto text-xs text-slate-500">{descCount}/200</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <SelectField
              label="카테고리"
              required
              value={formData.category}
              onChange={handleChange}
              name="category"
              error={errors.category}
              disabled={isSubmitting}
              options={categories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
            />

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">판매 가격 *</label>
              <div className="relative">
                <input
                  type="number"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  min="1"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  disabled={isSubmitting}
                  className={`w-full rounded-xl border px-4 py-3 pr-20 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                    errors.price
                      ? "border-rose-300 ring-2 ring-rose-200"
                      : "border-blue-200 hover:border-blue-200"
                  } ${isSubmitting ? "cursor-not-allowed opacity-50" : ""}`}
                />
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                  <Coins className="h-4 w-4 text-indigo-600" />
                  <span className="text-sm font-medium text-slate-700">
                    {dynamicCurrencyUnit}
                  </span>
                </div>
              </div>
              {errors.price ? <p className="text-sm text-rose-600">{errors.price}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">
                재고 수량 *
              </label>
              <input
                type="number"
                name="stock"
                value={formData.stock}
                onChange={handleChange}
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="1"
                disabled={isSubmitting}
                className={`w-full rounded-xl border px-4 py-3 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                  errors.stock
                    ? "border-rose-300 ring-2 ring-rose-200"
                    : "border-blue-200 hover:border-blue-200"
                } ${isSubmitting ? "cursor-not-allowed opacity-50" : ""}`}
              />
              {errors.stock ? <p className="text-sm text-rose-600">{errors.stock}</p> : null}
            </div>
          </div>

          {sellerFeeEnabled ? (
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-amber-100 p-2 text-amber-700">
                  <Receipt className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-bold text-amber-900">
                    판매 수수료 {normalizedFeeRate}%가 적용됩니다.
                  </p>
                  <p className="text-xs leading-5 text-slate-600">
                    판매 완료 시 판매자 정산금에서 수수료가 차감됩니다.
                  </p>
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-slate-500">판매가</div>
                      <div className="mt-1 font-bold text-slate-900">
                        {formatWhole(normalizedPrice, formatWholeNumber)} {dynamicCurrencyUnit}
                      </div>
                    </div>
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                      <div className="text-rose-600">예상 수수료</div>
                      <div className="mt-1 font-bold text-rose-700">
                        {formatWhole(estimatedFee, formatWholeNumber)} {dynamicCurrencyUnit}
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <div className="text-emerald-600">예상 실수령액</div>
                      <div className="mt-1 font-bold text-emerald-700">
                        {formatWhole(estimatedSellerNet, formatWholeNumber)} {dynamicCurrencyUnit}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {selectedCategory ? (
            <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 p-4">
              <h4 className="mb-2 text-sm font-semibold text-indigo-700">선택된 카테고리</h4>
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-medium text-slate-700">{selectedCategory.name}</span>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 rounded-full bg-slate-200 p-1">
                <svg className="h-3 w-3 text-slate-600" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="text-xs text-slate-600">
                <p className="mb-1 font-medium">등록 안내</p>
                <ul className="space-y-0.5">
                  <li>{isEditing ? "• 상품 상태와 전달 조건을 확인한 뒤 수정해주세요" : autoApproveEnabled ? "• 등록하면 바로 판매를 시작합니다" : "• 등록 후 승인 대기 상태가 되며, 승인되면 판매됩니다"}</li>
                  {sellerFeeEnabled ? (
                    <li>• 판매 완료 시 판매 수수료 {normalizedFeeRate}%가 차감됩니다</li>
                  ) : null}
                  <li>• 상품 상태를 정확히 기재해주세요</li>
                  <li>• 부적절한 내용은 거절될 수 있습니다</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <Button size="md"
              type="button"
              onClick={onClose}
              variant="outline"
              disabled={isSubmitting}
              
            >
              취소
            </Button>
            <Button tone="blue" kind="solid" size="md"
              type="submit"
              
              isLoading={isSubmitting}
              disabled={
                !formData.title ||
                !formData.description ||
                !formData.category ||
                !formData.price ||
                !formData.stock
              }
              icon={Package}
            >
              {isSubmitting
                ? isEditing
                  ? "수정 중..."
                  : "등록 중..."
                : isEditing
                  ? "상품 수정"
                  : "물건 등록하기"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

export default ItemForm;
