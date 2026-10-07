import React, { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";

import { Alert, Button, InputField, Modal } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  DEFAULT_REPORT_CYCLE_DAYS,
  MAX_REPORT_CYCLE_DAYS,
  MIN_REPORT_CYCLE_DAYS,
} from "../utils/reportCycle";

const INPUT_CLASSNAME =
  "min-h-[52px] rounded-xl border-2 border-slate-200 px-4 text-sm shadow-none";
const FUND_REBALANCE_OPEN_TIME = "07:45";
const FUND_ORDER_CUTOFF_MIN_TIME = "08:01";
const FUND_ORDER_CUTOFF_MAX_TIME = "18:00";

const isTimeInRange = (value, min, max) =>
  /^\d{2}:\d{2}$/.test(String(value || "").trim()) &&
  value >= min &&
  value <= max;

function InfoLine({ label, children }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
      <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      <span className="font-semibold text-slate-800">{children}</span>
    </div>
  );
}

export default function FundSettingsModal({
  isOpen,
  onClose,
  currentSettings,
  onSubmitSettings,
  isSubmitting = false,
}) {
  const { showFeedback } = useFeedback();
  const [reportCycleDays, setReportCycleDays] = useState(
    String(DEFAULT_REPORT_CYCLE_DAYS),
  );
  const [minHoldingsCount, setMinHoldingsCount] = useState("3");
  const [maxSingleWeightPct, setMaxSingleWeightPct] = useState("40");
  const [orderCutoffTime, setOrderCutoffTime] = useState("15:00");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    setReportCycleDays(
      String(currentSettings?.fundReportCycleDays ?? DEFAULT_REPORT_CYCLE_DAYS),
    );
    setMinHoldingsCount(String(currentSettings?.fundMinHoldingsCount ?? 3));
    setMaxSingleWeightPct(
      ((Number(currentSettings?.fundMaxSingleWeightBps) || 4000) / 100).toString(),
    );
    setOrderCutoffTime(
      currentSettings?.fundDailyCutoffTime ||
        currentSettings?.fundOrderCutoffTime ||
        "15:00",
    );
    setErrorMessage("");
  }, [currentSettings, isOpen]);

  const handleSubmit = async () => {
    const cycleDays = Math.round(Number(reportCycleDays) || 0);
    const minCount = Math.round(Number(minHoldingsCount) || 0);
    const maxWeightPct = Number(maxSingleWeightPct) || 0;
    const cutoffAt = String(orderCutoffTime || "").trim();

    if (cycleDays < MIN_REPORT_CYCLE_DAYS || cycleDays > MAX_REPORT_CYCLE_DAYS) {
      setErrorMessage(
        `운용 보고서 주기는 ${MIN_REPORT_CYCLE_DAYS}일 이상 ${MAX_REPORT_CYCLE_DAYS}일 이하로 설정해 주세요.`,
      );
      return;
    }

    if (minCount < 1 || minCount > 8) {
      setErrorMessage("최소 편입 종목 수는 1개 이상 8개 이하로 설정해 주세요.");
      return;
    }

    if (maxWeightPct <= 0 || maxWeightPct > 100) {
      setErrorMessage("단일 종목 최대 비중은 0% 초과 100% 이하로 설정해 주세요.");
      return;
    }

    if (!/^\d{2}:\d{2}$/.test(cutoffAt)) {
      setErrorMessage("시간은 HH:MM 형식으로 입력해 주세요.");
      return;
    }

    if (!isTimeInRange(cutoffAt, FUND_ORDER_CUTOFF_MIN_TIME, FUND_ORDER_CUTOFF_MAX_TIME)) {
      setErrorMessage(
        `거래 마감 시간은 ${FUND_ORDER_CUTOFF_MIN_TIME}~${FUND_ORDER_CUTOFF_MAX_TIME} 사이에서 설정해 주세요.`,
      );
      return;
    }

    try {
      const result = await onSubmitSettings({
        fundReportCycleDays: cycleDays,
        fundReportCadenceLabel: `${cycleDays}일`,
        fundMinHoldingsCount: minCount,
        fundMaxSingleWeightBps: Math.round(maxWeightPct * 100),
        fundDailyCutoffTime: cutoffAt,
        fundOrderCutoffTime: cutoffAt,
      });

      if (result?.success === false) {
        throw new Error(result?.message || "설정 저장에 실패했습니다.");
      }

      showFeedback("펀드 설정을 저장했습니다.", "success");
      onClose?.();
    } catch (error) {
      showFeedback(error?.message || "설정 저장 중 오류가 발생했습니다.", "error");
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">펀드 설정</h2>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6">
        <Alert
          type="info"
          message="편입 조건, 보고서 주기, 거래 마감시간은 모든 펀드에 공통 적용됩니다. 운용보수는 신청서에서 연 0%, 1%, 2% 중 선택합니다."
        />

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
          <div>
            <h3 className="text-lg font-black text-slate-900">거래 시간 안내</h3>
            <p className="mt-1 text-sm text-slate-500">
              가입·환매·리밸런싱은 같은 시간에 열리고 하나의 마감시간을 사용합니다.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <InfoLine label="설정 가능 범위">
              거래 마감 {FUND_ORDER_CUTOFF_MIN_TIME}~{FUND_ORDER_CUTOFF_MAX_TIME}
            </InfoLine>
            <InfoLine label="운용 가능 시간">
              평일 {FUND_REBALANCE_OPEN_TIME}부터 설정한 마감시간 전까지
            </InfoLine>
            <InfoLine label="즉시 체결 방식">
              가입과 환매는 신청 즉시 처리됩니다.
            </InfoLine>
            <InfoLine label="보고서 연체">
              경고만 표시하며 가입을 자동으로 막지 않습니다.
            </InfoLine>
          </div>

          <div className="max-w-sm">
            <InputField
              id="fundOrderCutoffTime"
              label="오늘 거래 마감시간"
              type="time"
              min={FUND_ORDER_CUTOFF_MIN_TIME}
              max={FUND_ORDER_CUTOFF_MAX_TIME}
              value={orderCutoffTime}
              onChange={(event) => {
                setOrderCutoffTime(event.target.value);
                setErrorMessage("");
              }}
              className={INPUT_CLASSNAME}
            />
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
          <div>
            <h3 className="text-lg font-black text-slate-900">종목 구성 조건</h3>
            <p className="mt-1 text-sm text-slate-500">
              학생들이 신청서를 작성할 때 지켜야 하는 편입 규칙입니다. 최대 종목 수는 12개로 고정됩니다.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <InputField
              id="minHoldingsCount"
              label="최소 종목 수"
              type="number"
              min="1"
              max="8"
              step="1"
              value={minHoldingsCount}
              onChange={(event) => {
                setMinHoldingsCount(event.target.value);
                setErrorMessage("");
              }}
              className={INPUT_CLASSNAME}
            />
            <InputField
              id="maxSingleWeightPct"
              label="단일 종목 최대 비중 (%)"
              type="number"
              min="1"
              max="100"
              step="1"
              value={maxSingleWeightPct}
              onChange={(event) => {
                setMaxSingleWeightPct(event.target.value);
                setErrorMessage("");
              }}
              className={INPUT_CLASSNAME}
            />
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
          <div>
            <h3 className="text-lg font-black text-slate-900">운용 보고서 주기</h3>
            <p className="mt-1 text-sm text-slate-500">
              마지막 보고서 제출일을 기준으로 다음 보고서 마감일을 자동 계산합니다.
            </p>
          </div>

          <InputField
            id="fundReportCycleDays"
            label="보고서 제출 주기 (일)"
            type="number"
            min={String(MIN_REPORT_CYCLE_DAYS)}
            max={String(MAX_REPORT_CYCLE_DAYS)}
            step="1"
            value={reportCycleDays}
            onChange={(event) => {
              setReportCycleDays(event.target.value);
              setErrorMessage("");
            }}
            className={INPUT_CLASSNAME}
          />

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            예를 들어 <strong>7</strong>로 설정하면 마지막 보고서 제출일 기준 7일 뒤가 다음 마감일이 됩니다.
          </div>
        </section>

        {errorMessage ? <Alert type="error" message={errorMessage} /> : null}
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full justify-end gap-3">
          <Button onClick={onClose} kind="soft" tone="slate" disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting} tone="blue" kind="solid">
            설정 저장
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
