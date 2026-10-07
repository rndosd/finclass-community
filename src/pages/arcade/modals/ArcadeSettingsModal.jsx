import React, { useState } from "react";
import {
  Settings,
  Ticket,
  PartyPopper,
  RotateCcw,
  Grid3X3,
  Save,
  Info,
  CircleHelp,
  Trophy,
  Brain,
} from "lucide-react";
import Modal from "../../../components/ui/Modal";
import { Button, ToggleSwitch } from "../../../components/ui";
import {
  getPaymentPolicyKey,
  PAYMENT_POLICY_OPTIONS,
} from "../utils/paymentPolicy";

const GAME_INFO = {
  scratch: {
    name: "스크래치 복권",
    icon: Ticket,
    description: "즉시 결과를 확인하는 빠른 복권 게임",
  },
  roulette: {
    name: "행운의 룰렛",
    icon: RotateCcw,
    description: "룰렛을 돌려 보상을 받는 게임",
  },
  lotto: {
    name: "로또",
    icon: PartyPopper,
    description: "번호를 고르고 추첨 결과를 기다리는 게임",
  },
  paperpick: {
    name: "종이 뽑기",
    icon: Grid3X3,
    description: "보드에서 한 칸을 골라 보상을 받는 게임",
  },
  nostalgiaPick: {
    name: "추억의 뽑기",
    icon: Ticket,
    description: "번호에 이름을 적고 마감 후 추첨하는 회차형 뽑기",
  },
  matchPrediction: {
    name: "경기 예측",
    icon: Trophy,
    description: "KBO 야구 승무패와 점수를 예측하는 무료 이벤트",
  },
  miniQuiz: {
    name: "간단퀴즈",
    icon: Brain,
    description: "짧은 OX, 객관식, 단답형 문제로 보상을 지급합니다.",
  },
};

const ArcadeSettingsModal = ({
  settings,
  currencyName = "원",
  onSave,
  onClose,
}) => {
  const [localSettings, setLocalSettings] = useState({ ...settings });

  const handleGameToggle = (gameId) => {
    setLocalSettings((prev) => ({
      ...prev,
      games: {
        ...prev.games,
        [gameId]: {
          ...prev.games?.[gameId],
          enabled: !prev.games?.[gameId]?.enabled,
        },
      },
    }));
  };

  const handleProbabilityTableToggle = () => {
    setLocalSettings((prev) => ({
      ...prev,
      showProbabilityTable: !(prev?.showProbabilityTable === true),
    }));
  };

  const handleNumberChange = (gameId, field, value) => {
    const parsedValue =
      value === "" ? null : Math.max(0, parseInt(value, 10) || 0);

    setLocalSettings((prev) => ({
      ...prev,
      games: {
        ...prev.games,
        [gameId]: {
          ...prev.games?.[gameId],
          [field]: parsedValue,
        },
      },
    }));
  };

  const handlePaymentPolicyChange = (gameId, allowedPaymentTypes) => {
    setLocalSettings((prev) => ({
      ...prev,
      games: {
        ...prev.games,
        [gameId]: {
          ...prev.games?.[gameId],
          allowedPaymentTypes: [...allowedPaymentTypes],
        },
      },
    }));
  };

  const handleBooleanChange = (gameId, field) => {
    setLocalSettings((prev) => ({
      ...prev,
      games: {
        ...prev.games,
        [gameId]: {
          ...prev.games?.[gameId],
          [field]: !(prev.games?.[gameId]?.[field] !== false),
        },
      },
    }));
  };

  const handleSave = () => {
    onSave(localSettings);
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="lg">
      <Modal.Header>
        <h3 className="flex items-center gap-2 text-xl font-bold text-slate-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700">
            <Settings size={20} className="text-white" />
          </div>
          놀이터 전체 설정
        </h3>
      </Modal.Header>

      <Modal.Body className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
          <Info size={16} className="shrink-0 text-amber-500" />
          <span>
            게임 공개 여부, 입장 금액, 추가 수수료, 이용 제한, 입장 방식,
            확률표 공개 여부를 한 번에 관리할 수 있습니다.
          </span>
        </div>

        <div className="rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-cyan-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-black text-sky-700 ring-1 ring-sky-100">
                <CircleHelp size={12} />
                확률표 노출
              </div>
              <p className="mt-3 text-sm font-bold text-slate-800">
                각 게임 카드에 보상 확률표를 공개합니다.
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                스크래치, 룰렛, 로또, 종이뽑기에 설정된 확률 기준이 학생 화면에도
                함께 표시됩니다.
              </p>
            </div>

            <ToggleSwitch
              checked={localSettings?.showProbabilityTable === true}
              onChange={handleProbabilityTableToggle}
              tone="blue"
              srLabel="확률표 공개"
            />
          </div>
        </div>

        {Object.entries(GAME_INFO).map(([gameId, info]) => {
          const gameConfig = localSettings.games?.[gameId] || {};
          const Icon = info.icon;
          const isEnabled = gameConfig.enabled ?? false;
          const paymentPolicyKey = getPaymentPolicyKey(
            gameConfig.allowedPaymentTypes,
          );

          return (
            <div
              key={gameId}
              className={`rounded-xl border-2 transition-all ${
                isEnabled
                  ? "border-indigo-200 bg-white"
                  : "border-slate-100 bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      isEnabled
                        ? "bg-indigo-100 text-indigo-600"
                        : "bg-slate-200 text-slate-400"
                    }`}
                  >
                    <Icon size={20} />
                  </div>
                  <div>
                    <p
                      className={`font-semibold ${
                        isEnabled ? "text-slate-800" : "text-slate-400"
                      }`}
                    >
                      {info.name}
                    </p>
                    <p className="text-xs text-slate-400">{info.description}</p>
                  </div>
                </div>

                <ToggleSwitch
                  checked={isEnabled}
                  onChange={() => handleGameToggle(gameId)}
                  tone="indigo"
                  srLabel={`${info.name} 학생 공개`}
                />
              </div>

              {isEnabled && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  {gameId === "matchPrediction" ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <label className="w-20 text-sm text-slate-500">
                            승무패
                          </label>
                          <input
                            type="number"
                            value={gameConfig.outcomeRewardAmount ?? ""}
                            onChange={(event) =>
                              handleNumberChange(
                                gameId,
                                "outcomeRewardAmount",
                                event.target.value,
                              )
                            }
                            className="min-w-0 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500/20"
                            min="0"
                            placeholder="0"
                          />
                          <span className="shrink-0 text-sm text-slate-400">
                            {currencyName}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <label className="w-20 text-sm text-slate-500">
                            점수 차
                          </label>
                          <input
                            type="number"
                            value={gameConfig.exactScoreRewardAmount ?? ""}
                            onChange={(event) =>
                              handleNumberChange(
                                gameId,
                                "exactScoreRewardAmount",
                                event.target.value,
                              )
                            }
                            className="min-w-0 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500/20"
                            min="0"
                            placeholder="0"
                          />
                          <span className="shrink-0 text-sm text-slate-400">
                            {currencyName}
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        {[
                          ["rewardEnabled", "보상 지급"],
                          ["autoPayoutEnabled", "자동 지급"],
                        ].map(([field, label]) => {
                          const checked = gameConfig[field] !== false;

                          return (
                            <div
                              key={field}
                              className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition-all ${
                                checked
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-500"
                              }`}
                            >
                              <span className="text-sm font-black">{label}</span>
                              <ToggleSwitch
                                checked={checked}
                                onChange={() =>
                                  handleBooleanChange(gameId, field)
                                }
                                tone="emerald"
                                srLabel={label}
                              />
                            </div>
                          );
                        })}
                      </div>

                      <p className="text-[11px] font-bold leading-5 text-slate-400">
                        승리 팀과 점수 차 구간을 모두 맞추면 두 보상이 지급됩니다. 무승부는 기본 보상만 지급합니다.
                      </p>
                    </div>
                  ) : (
                    <>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <label className="w-14 text-sm text-slate-500">
                        입장료
                      </label>
                      <input
                        type="number"
                        value={gameConfig.price ?? ""}
                        onChange={(event) =>
                          handleNumberChange(gameId, "price", event.target.value)
                        }
                        className="min-w-0 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500/20"
                        min="0"
                        placeholder="0"
                      />
                      <span className="shrink-0 text-sm text-slate-400">
                        {currencyName}
                      </span>
                    </div>

                    {gameId === "lotto" && (
                      <p className="text-[11px] font-bold text-indigo-500 md:col-span-2 xl:col-span-4">
                        로또는 새 회차와 학생 화면 모두 이 입장료를 기준으로 사용합니다.
                      </p>
                    )}

                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <label className="w-14 text-sm text-slate-500">
                        수수료
                      </label>
                      <input
                        type="number"
                        value={gameConfig.feeAmount ?? ""}
                        onChange={(event) =>
                          handleNumberChange(
                            gameId,
                            "feeAmount",
                            event.target.value,
                          )
                        }
                        className="min-w-0 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500/20"
                        min="0"
                        placeholder="0"
                      />
                      <span className="shrink-0 text-sm text-slate-400">
                        {currencyName}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <label className="w-14 text-sm text-slate-500">
                        일일
                      </label>
                      <input
                        type="number"
                        value={gameConfig.dailyLimit ?? ""}
                        onChange={(event) =>
                          handleNumberChange(
                            gameId,
                            "dailyLimit",
                            event.target.value,
                          )
                        }
                        className="min-w-0 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500/20"
                        min="0"
                        placeholder="0"
                      />
                      <span className="shrink-0 text-sm text-slate-400">
                        회
                      </span>
                    </div>

                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <label className="w-14 text-sm text-slate-500">
                        주간
                      </label>
                      <input
                        type="number"
                        value={gameConfig.weeklyLimit ?? ""}
                        onChange={(event) =>
                          handleNumberChange(
                            gameId,
                            "weeklyLimit",
                            event.target.value,
                          )
                        }
                        className="min-w-0 w-full rounded-xl border border-blue-200 px-3 py-2 text-right text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500/20"
                        min="0"
                        placeholder="0"
                      />
                      <span className="shrink-0 text-sm text-slate-400">
                        회
                      </span>
                    </div>
                  </div>

                  <p className="mt-3 text-[11px] font-bold text-slate-400">
                    학생 입장 시에는 기본 입장료에 설정된 수수료만큼 추가 차감됩니다.
                    제한값을 0으로 두면 무제한으로 처리됩니다.
                  </p>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">
                        입장 방식
                      </p>
                      <span className="text-[11px] font-bold text-slate-400">
                        게임별로 현금과 티켓 사용 가능 여부를 설정합니다.
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {PAYMENT_POLICY_OPTIONS.map((option) => {
                        const isSelected = paymentPolicyKey === option.id;

                        return (
                          <Button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              handlePaymentPolicyChange(
                                gameId,
                                option.allowedPaymentTypes,
                              )
                            }
                            className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                              isSelected
                                ? "border-indigo-300 bg-indigo-50 shadow-sm"
                                : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                            }`}
                          >
                            <p
                              className={`text-sm font-black ${
                                isSelected
                                  ? "text-indigo-700"
                                  : "text-slate-700"
                              }`}
                            >
                              {option.label}
                            </p>
                            <p className="mt-1 text-[11px] font-bold leading-snug text-slate-400">
                              {option.description}
                            </p>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Modal.Body>

      <Modal.Footer>
        <Button tone="slate" kind="ghost" size="sm"
          onClick={onClose}
          className="transition-colors"
        >
          취소
        </Button>
        <Button tone="blue" kind="solid" size="sm"
          onClick={handleSave}
          className="flex items-center gap-2 transition-colors"
        >
          <Save size={16} />
          저장
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ArcadeSettingsModal;
