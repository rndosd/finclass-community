import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Button,
  InputField,
  Alert,
  EmptyState,
  ToggleSwitch,
} from "../../../components/ui";
import { CalendarClock, Percent, Settings2, Users } from "lucide-react";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";

const toPercentInput = (rate) =>
  Number.isFinite(Number(rate)) ? String(Number(rate) * 100) : "";

const normalizeRole = (value) => String(value || "student").trim().toLowerCase();

const sortStudents = (students = []) =>
  [...students]
    .filter((student) => student?.uid)
    .filter((student) => normalizeRole(student?.role) === "student")
    .sort((left, right) => {
      const leftNo = Number(left?.studentNumber);
      const rightNo = Number(right?.studentNumber);
      if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) {
        return leftNo - rightNo;
      }
      if (Number.isFinite(leftNo)) return -1;
      if (Number.isFinite(rightNo)) return 1;
      return String(left?.name || "").localeCompare(String(right?.name || ""), "ko");
    });

const normalizeOverrideRate = (value) => {
  const raw = value && typeof value === "object" ? value.rate : value;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
};

const buildOverrideInputs = (overrides = {}, students = []) => {
  return sortStudents(students).reduce((accumulator, student) => {
    const rate = normalizeOverrideRate(overrides?.[student.uid]);
    accumulator[student.uid] = rate === null ? "" : toPercentInput(rate);
    return accumulator;
  }, {});
};

const buildInitialFormState = (currentSettings) => ({
  conversionRate: currentSettings?.conversionRate?.toString() || "1",
  tradeFeeRate:
    currentSettings?.tradeFeeRate != null
      ? toPercentInput(currentSettings.tradeFeeRate)
      : "0",
  exchangeFeeRate:
    currentSettings?.exchangeFeeRate != null
      ? toPercentInput(currentSettings.exchangeFeeRate)
      : "0",
  studentAutoExchangeBuyEnabled:
    currentSettings?.studentAutoExchangeBuyEnabled === true,
  stockMinHoldingDays:
    currentSettings?.stockMinHoldingDays != null
      ? String(currentSettings.stockMinHoldingDays)
      : "0",
});

const MarketSettingsModal = ({
  isOpen,
  onClose,
  currentSettings,
  students = [],
  onSubmitSettings,
  isSubmitting,
  ...modalProps
}) => {
  const { classData } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = classData?.currencyUnit || "코인";

  const [formState, setFormState] = useState(
    buildInitialFormState(currentSettings),
  );
  const [tradeOverrideInputs, setTradeOverrideInputs] = useState(() =>
    buildOverrideInputs(currentSettings?.tradeFeeOverrides, students),
  );
  const [exchangeOverrideInputs, setExchangeOverrideInputs] = useState(() =>
    buildOverrideInputs(currentSettings?.exchangeFeeOverrides, students),
  );
  const [commonTradeOverrideInput, setCommonTradeOverrideInput] = useState("");
  const [commonExchangeOverrideInput, setCommonExchangeOverrideInput] = useState("");
  const [errors, setErrors] = useState({});
  const studentRows = useMemo(() => sortStudents(students), [students]);

  useEffect(() => {
    if (!isOpen) return;
    setFormState(buildInitialFormState(currentSettings));
    setTradeOverrideInputs(
      buildOverrideInputs(currentSettings?.tradeFeeOverrides, students),
    );
    setExchangeOverrideInputs(
      buildOverrideInputs(currentSettings?.exchangeFeeOverrides, students),
    );
    setCommonTradeOverrideInput("");
    setCommonExchangeOverrideInput("");
    setErrors({});
  }, [currentSettings, isOpen, students]);

  const handleInputChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleOverrideInputChange = (type, uid, value) => {
    const setter =
      type === "exchange" ? setExchangeOverrideInputs : setTradeOverrideInputs;
    setter((prev) => ({
      ...prev,
      [uid]: value,
    }));
    if (errors.feeOverrides) {
      setErrors((prev) => ({ ...prev, feeOverrides: null }));
    }
  };

  const handleApplyCommonOverride = (type) => {
    const commonValue =
      type === "exchange" ? commonExchangeOverrideInput : commonTradeOverrideInput;
    const value = Number(commonValue);
    if (commonValue === "" || Number.isNaN(value) || value < 0) {
      showFeedback("0 이상의 수수료율을 입력해주세요.", "warning");
      return;
    }

    const setter =
      type === "exchange" ? setExchangeOverrideInputs : setTradeOverrideInputs;
    setter((prev) => {
      const next = { ...prev };
      studentRows.forEach((student) => {
        next[student.uid] = commonValue;
      });
      return next;
    });
  };

  const handlePasteOverride = (event, type, startIndex) => {
    event.preventDefault();
    const rows = event.clipboardData
      .getData("text")
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean);

    const setter =
      type === "exchange" ? setExchangeOverrideInputs : setTradeOverrideInputs;
    setter((prev) => {
      const next = { ...prev };
      rows.forEach((row, rowIndex) => {
        const target = studentRows[startIndex + rowIndex];
        if (!target) return;
        const [firstCell] = row.split("\t");
        next[target.uid] = firstCell?.trim() || "";
      });
      return next;
    });
  };

  const validate = () => {
    const newErrors = {};
    const numConversion = Number(formState.conversionRate);
    const numTrade = Number(formState.tradeFeeRate);
    const numExchange = Number(formState.exchangeFeeRate);
    const numStockMinHoldingDays = Number(formState.stockMinHoldingDays);

    if (!formState.conversionRate || Number.isNaN(numConversion) || numConversion <= 0) {
      newErrors.conversionRate = "0보다 큰 숫자를 입력하세요.";
    }

    if (Number.isNaN(numTrade) || numTrade < 0) {
      newErrors.tradeFeeRate = "0 이상의 숫자를 입력하세요.";
    }

    if (Number.isNaN(numExchange) || numExchange < 0 || numExchange >= 100) {
      newErrors.exchangeFeeRate = "0 이상 100 미만의 숫자를 입력하세요.";
    }

    if (
      Number.isNaN(numStockMinHoldingDays) ||
      numStockMinHoldingDays < 0 ||
      numStockMinHoldingDays > 365
    ) {
      newErrors.stockMinHoldingDays = "0부터 365 사이의 일수를 입력하세요.";
    }

    const hasInvalidOverride = [
      ...Object.values(tradeOverrideInputs),
      ...Object.values(exchangeOverrideInputs),
    ].some((value) => {
      if (String(value || "").trim() === "") return false;
      const parsed = Number(value);
      return Number.isNaN(parsed) || parsed < 0 || parsed >= 100;
    });

    if (hasInvalidOverride) {
      newErrors.feeOverrides =
        "계정별 수수료율은 빈 칸 또는 0 이상 100 미만의 숫자여야 합니다.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const buildOverridesPayload = (inputs) => {
      const payload = {};
      Object.entries(inputs).forEach(([uid, value]) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return;
        const percent = Number(trimmed);
        if (!Number.isFinite(percent) || percent < 0) return;
        payload[uid] = percent / 100;
      });
      return payload;
    };

    const tradeFeeOverrides = buildOverridesPayload(tradeOverrideInputs);
    const exchangeFeeOverrides = buildOverridesPayload(exchangeOverrideInputs);

    const payload = {
      conversionRate: Number(formState.conversionRate),
      tradeFeeRate: Number(formState.tradeFeeRate) / 100,
      tradeFeeOverrides,
      exchangeFeeRate: Number(formState.exchangeFeeRate) / 100,
      exchangeFeeOverrides,
      studentAutoExchangeBuyEnabled:
        formState.studentAutoExchangeBuyEnabled === true,
      stockMinHoldingDays: Math.round(Number(formState.stockMinHoldingDays) || 0),
      rateDirection: "LOCAL_TO_FIN",
      currencyUnit,
      lastUpdated: new Date().toISOString(),
    };

    try {
      const result = await onSubmitSettings(payload);

      if (result?.success === false) {
        throw new Error(result?.message || "Failed to save market settings.");
      }

      showFeedback("주식 시장 설정이 저장되었습니다.", "success");
      onClose();
    } catch (error) {
      showFeedback(
        error.message || "설정 저장 중 오류가 발생했습니다.",
        "error",
      );
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" {...modalProps}>
      <Modal.Header>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">주식 시장 설정</h2>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        <div className="rounded-2xl border border-indigo-100/50 bg-indigo-50 p-4">
          <p className="text-sm font-medium leading-relaxed text-indigo-700">
            이 모달은 주식 거래 계산 규칙만 관리합니다. 숫자 표시 방식은
            학급 설정의 `주식 숫자` 탭에서 별도로 관리합니다.
          </p>
        </div>

        <div className="space-y-5">
          <InputField
            label={`1 ${currencyUnit}당 가치 (FIN)`}
            type="number"
            value={formState.conversionRate}
            onChange={(event) =>
              handleInputChange("conversionRate", event.target.value)
            }
            placeholder="예: 10"
            error={errors.conversionRate}
            className="font-mono"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InputField
              label="매매 수수료 (%)"
              type="number"
              value={formState.tradeFeeRate}
              onChange={(event) =>
                handleInputChange("tradeFeeRate", event.target.value)
              }
              icon={Percent}
              error={errors.tradeFeeRate}
            />
            <InputField
              label="환전 수수료 (%)"
              type="number"
              value={formState.exchangeFeeRate}
              onChange={(event) =>
                handleInputChange("exchangeFeeRate", event.target.value)
              }
              icon={Percent}
              error={errors.exchangeFeeRate}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div>
              <p className="text-sm font-bold text-slate-800">
                학생 자동환전 매수
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                보유 FIN이 부족하면 부족분만 학급 화폐에서 자동환전합니다. 위 환전 수수료와 학생별 예외가 그대로 적용됩니다.
              </p>
            </div>
            <ToggleSwitch
              id="student-auto-exchange-buy"
              checked={formState.studentAutoExchangeBuyEnabled}
              onChange={(checked) =>
                handleInputChange("studentAutoExchangeBuyEnabled", checked)
              }
              srLabel="학생 자동환전 매수 사용 여부"
            />
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  보유 기간 규칙
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  학생은 매수 후 설정한 기간이 지나야 매도할 수 있습니다. 0일이면 제한 없이 매도할 수 있습니다.
                </p>
              </div>
            </div>
            <InputField
              label="최소 보유 기간(일)"
              type="number"
              min="0"
              max="365"
              step="1"
              value={formState.stockMinHoldingDays}
              onChange={(event) =>
                handleInputChange("stockMinHoldingDays", event.target.value)
              }
              placeholder="예: 0, 1, 3, 7"
              error={errors.stockMinHoldingDays}
              className="font-mono"
            />
            <p className="mt-2 text-xs font-medium text-blue-700">
              추천: 첫 수업은 1일, 장기 관찰 수업은 3일 이상으로 설정해 보세요.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-bold text-slate-700">
                  계정별 수수료 예외
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  빈 칸은 각 기본 수수료율을 사용합니다. 표에는 퍼센트 숫자만 입력하세요.
                </p>
              </div>
              <div className="grid grid-cols-[30%_25%_25%_20%] gap-2 px-3">
                <div className="hidden sm:block" />
                <div className="flex gap-2">
                  <InputField
                    value={commonTradeOverrideInput}
                    onChange={(event) =>
                      setCommonTradeOverrideInput(event.target.value)
                    }
                    placeholder="매매 공통(%)"
                    className="h-9 min-w-0 text-sm"
                  />
                  <Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    onClick={() => handleApplyCommonOverride("trade")}
                    className="shrink-0"
                  >
                    입력
                  </Button>
                </div>
                <div className="flex gap-2">
                  <InputField
                    value={commonExchangeOverrideInput}
                    onChange={(event) =>
                      setCommonExchangeOverrideInput(event.target.value)
                    }
                    placeholder="환전 공통(%)"
                    className="h-9 min-w-0 text-sm"
                  />
                  <Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    onClick={() => handleApplyCommonOverride("exchange")}
                    className="shrink-0"
                  >
                    입력
                  </Button>
                </div>
                <div className="hidden sm:block" />
              </div>
            </div>

            {errors.feeOverrides ? (
              <p className="text-xs font-semibold text-rose-600">
                {errors.feeOverrides}
              </p>
            ) : null}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[25%]" />
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 border-b bg-slate-50">
                  <tr>
                    <th className="w-28 px-3 py-2 text-left text-slate-500">
                      계정
                    </th>
                    <th className="w-28 px-3 py-2 text-center text-slate-500">
                      매매 수수료(%)
                    </th>
                    <th className="w-28 px-3 py-2 text-center text-slate-500">
                      환전 수수료(%)
                    </th>
                    <th className="w-28 px-3 py-2 text-center text-slate-500">
                      기본값
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {studentRows.map((student, index) => {
                    const tradeOverrideValue =
                      tradeOverrideInputs[student.uid] ?? "";
                    const exchangeOverrideValue =
                      exchangeOverrideInputs[student.uid] ?? "";
                    const appliedTradeValue =
                      String(tradeOverrideValue).trim() === ""
                        ? formState.tradeFeeRate
                        : tradeOverrideValue;
                    const appliedExchangeValue =
                      String(exchangeOverrideValue).trim() === ""
                        ? formState.exchangeFeeRate
                        : exchangeOverrideValue;

                    return (
                      <tr key={student.uid}>
                        <td className="bg-slate-50/50 px-3 py-2 font-semibold text-slate-700">
                          <div>{student.name || "이름 없음"}</div>
                          <div className="mt-0.5 text-[10px] font-medium text-slate-400">
                            {student.studentNumber ? `${student.studentNumber}번` : student.uid}
                          </div>
                        </td>
                        <td className="px-3 py-1">
                          <InputField
                            value={tradeOverrideValue}
                            onChange={(event) =>
                              handleOverrideInputChange(
                                "trade",
                                student.uid,
                                event.target.value,
                              )
                            }
                            onPaste={(event) =>
                              handlePasteOverride(event, "trade", index)
                            }
                            placeholder={formState.tradeFeeRate || "0"}
                            className="h-8 text-center text-xs"
                          />
                        </td>
                        <td className="px-3 py-1">
                          <InputField
                            value={exchangeOverrideValue}
                            onChange={(event) =>
                              handleOverrideInputChange(
                                "exchange",
                                student.uid,
                                event.target.value,
                              )
                            }
                            onPaste={(event) =>
                              handlePasteOverride(event, "exchange", index)
                            }
                            placeholder={formState.exchangeFeeRate || "0"}
                            className="h-8 text-center text-xs"
                          />
                        </td>
                        <td className="px-3 py-1 text-center">
                          <Button
                            size="xs"
                            kind="ghost"
                            tone="slate"
                            onClick={() => {
                              handleOverrideInputChange("trade", student.uid, "");
                              handleOverrideInputChange("exchange", student.uid, "");
                            }}
                            disabled={
                              String(tradeOverrideValue).trim() === "" &&
                              String(exchangeOverrideValue).trim() === ""
                            }
                          >
                            기본값 사용
                          </Button>
                          <div className="mt-1 text-[10px] text-slate-400">
                            매매 {appliedTradeValue || "0"}% · 환전{" "}
                            {appliedExchangeValue || "0"}%
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {studentRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4"
                      >
                        <EmptyState
                          icon={Users}
                          title="표시할 학생 계정이 없습니다"
                          description="학생 계정이 등록되면 계정별 수수료 예외를 설정할 수 있습니다."
                          size="sm"
                          className="min-h-[150px] border-slate-200 bg-slate-50/70 py-6"
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <Alert
          type="warning"
          message="주의: 환율과 수수료를 바꾸면 주식 거래 계산 결과가 달라집니다."
        />
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full justify-end gap-3">
          <Button onClick={onClose} variant="ghost" disabled={isSubmitting}>
            취소
          </Button>
          <Button size="md"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            tone="blue"
            
          >
            설정 저장하기
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default MarketSettingsModal;
