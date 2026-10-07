import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Gift,
  Pencil,
  Play,
  Plus,
  Save,
  Square,
  Ticket,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { Modal, Button, Badge } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  closeNostalgiaPickRound,
  createNostalgiaPickRound,
  deleteNostalgiaPickRound,
  drawNostalgiaPickRound,
  openNostalgiaPickRound,
  pauseNostalgiaPickRound,
  publishNostalgiaPickResults,
  resumeNostalgiaPickRound,
  subscribeNostalgiaPickRoundEntries,
  updateNostalgiaPickRound,
} from "../services/arcadeServices";
import NostalgiaPickDrawModal from "./NostalgiaPickDrawModal";
import PopoutWindow from "../../../components/ui/PopoutWindow";

const statusMeta = {
  ready: { label: "준비", tone: "slate" },
  open: { label: "진행 중", tone: "emerald" },
  paused: { label: "일시 정지", tone: "amber" },
  closed: { label: "마감", tone: "indigo" },
  finished: { label: "추첨 완료", tone: "rose" },
};

const toDateSafe = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value) => {
  const date = toDateSafe(value);
  return date ? date.toLocaleString() : "마감 없음";
};

const formatDateTimeLocalInput = (value) => {
  const date = toDateSafe(value);
  if (!date) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const normalizeLocalDateTimeForSave = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
};

const createDefaultPrizes = () => [
  { rank: 1, type: "money", amount: 20, label: "1등" },
  { rank: 2, type: "money", amount: 10, label: "2등" },
  { rank: 3, type: "money", amount: 5, label: "3등" },
];

const buildRoundDraft = (round, allRounds, globalSettings) => ({
  title: round?.title || `${(allRounds?.length || 0) + 1}회차 추억의 뽑기`,
  boardSize: Number(round?.settings?.boardSize ?? globalSettings?.boardSize ?? 99),
  maxEntriesPerStudent: Number(
    round?.settings?.maxEntriesPerStudent ??
      globalSettings?.maxEntriesPerStudent ??
      3,
  ),
  duplicateWinnersAllowed:
    round?.settings?.duplicateWinnersAllowed ??
    globalSettings?.duplicateWinnersAllowed ??
    false,
  endTime: round?.settings?.endTime
    ? formatDateTimeLocalInput(round.settings.endTime)
    : "",
  prizes:
    Array.isArray(round?.settings?.prizes) && round.settings.prizes.length > 0
      ? round.settings.prizes.map((prize, index) => ({
          rank: index + 1,
          type: prize?.type === "item" ? "item" : "money",
          amount: Number(prize?.amount || 0),
          itemId: prize?.itemId || "",
          label: prize?.label || `${index + 1}등`,
        }))
      : createDefaultPrizes(),
});

const NostalgiaPickManagementCenter = ({
  allRounds = [],
  storeItems = [],
  currencyName = "단위",
  classId,
  globalSettings = {},
  onClose,
}) => {
  const { showFeedback } = useFeedback();
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState(null);
  const [draft, setDraft] = useState(() =>
    buildRoundDraft(null, allRounds, globalSettings),
  );
  const [entries, setEntries] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [drawResult, setDrawResult] = useState(null);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const [showDrawPopout, setShowDrawPopout] = useState(false);
  const [drawPopoutWindow, setDrawPopoutWindow] = useState(null);

  const selectedRound = useMemo(
    () => allRounds.find((round) => round.id === selectedRoundId) || allRounds[0] || null,
    [allRounds, selectedRoundId],
  );

  useEffect(() => {
    if (!selectedRound?.id && allRounds[0]?.id) {
      setSelectedRoundId(allRounds[0].id);
    }
  }, [allRounds, selectedRound?.id]);

  useEffect(() => {
    if (!classId || !selectedRound?.id) {
      setEntries([]);
      return undefined;
    }

    return subscribeNostalgiaPickRoundEntries(
      classId,
      selectedRound.id,
      setEntries,
    );
  }, [classId, selectedRound?.id]);

  const activeRound = allRounds.find(
    (round) => round.status === "open" || round.status === "paused",
  );
  const selectedStatus = statusMeta[selectedRound?.status] || statusMeta.ready;
  const activeEntries = entries.filter(
    (entry) => String(entry.status || "active") === "active",
  );
  const boardSize = Number(selectedRound?.settings?.boardSize || 0);
  const winners = Array.isArray(selectedRound?.winners) ? selectedRound.winners : [];

  const openCreateForm = () => {
    setDraft(buildRoundDraft(null, allRounds, globalSettings));
    setEditingRoundId(null);
    setIsEditing(true);
  };

  const openEditForm = (round) => {
    if (!round || round.status !== "ready") return;
    setDraft(buildRoundDraft(round, allRounds, globalSettings));
    setEditingRoundId(round.id);
    setIsEditing(true);
  };

  const patchDraft = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const patchPrize = (index, field, value) => {
    setDraft((prev) => ({
      ...prev,
      prizes: prev.prizes.map((prize, prizeIndex) =>
        prizeIndex === index ? { ...prize, [field]: value } : prize,
      ),
    }));
  };

  const handleSaveRound = async () => {
    const boardSizeNumber = Number(draft.boardSize);
    if (!String(draft.title || "").trim()) {
      showFeedback("회차 제목을 입력해 주세요.", "warning");
      return;
    }
    if (!Number.isFinite(boardSizeNumber) || boardSizeNumber <= 0) {
      showFeedback("칸 수를 확인해 주세요.", "warning");
      return;
    }

    const prizes = draft.prizes.map((prize, index) => {
      const type = prize.type === "item" ? "item" : "money";
      const base = {
        rank: index + 1,
        type,
        label: String(prize.label || "").trim() || `${index + 1}등`,
      };
      if (type === "item") {
        return { ...base, itemId: String(prize.itemId || "").trim() };
      }
      return { ...base, amount: Math.max(0, Number(prize.amount || 0)) };
    });

    const hasInvalidPrize = prizes.some((prize) =>
      prize.type === "item" ? !prize.itemId : !Number.isFinite(Number(prize.amount)),
    );
    if (hasInvalidPrize) {
      showFeedback("보상 설정을 확인해 주세요.", "warning");
      return;
    }

    try {
      setIsProcessing(true);
      const payload = {
        title: String(draft.title || "").trim(),
        boardSize: boardSizeNumber,
        maxEntriesPerStudent: Math.max(0, Number(draft.maxEntriesPerStudent || 0)),
        duplicateWinnersAllowed: draft.duplicateWinnersAllowed === true,
        endTime: normalizeLocalDateTimeForSave(draft.endTime),
        prizes,
      };

      if (editingRoundId) {
        await updateNostalgiaPickRound(classId, editingRoundId, payload);
        setSelectedRoundId(editingRoundId);
      } else {
        const result = await createNostalgiaPickRound(classId, payload);
        setSelectedRoundId(result?.roundId || null);
      }
      setIsEditing(false);
      setEditingRoundId(null);
      showFeedback("추억의 뽑기 회차를 저장했습니다.", "success");
    } catch (error) {
      showFeedback(error?.message || "회차 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const runAction = async (label, action) => {
    if (!selectedRound?.id) return;
    try {
      setIsProcessing(true);
      await action(classId, selectedRound.id);
      showFeedback(label, "success");
    } catch (error) {
      showFeedback(error?.message || "처리 중 오류가 발생했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const openDrawPopout = ({ showAlert = true, clearResult = false } = {}) => {
    const popupWindow = window.open(
      "",
      "finclass-nostalgia-pick-draw",
      "popup=yes,width=1600,height=980",
    );

    if (!popupWindow) {
      if (showAlert) {
        showFeedback(
          "브라우저에서 팝업이 차단되어 기존 모달로 표시합니다.",
          "warning",
        );
      }
      return null;
    }

    if (clearResult) {
      setDrawResult(null);
    }
    setDrawPopoutWindow(popupWindow);
    setShowDrawPopout(true);
    return popupWindow;
  };

  const closeDrawPresentation = () => {
    setShowDrawModal(false);
    setShowDrawPopout(false);
    setDrawPopoutWindow(null);
    setDrawResult(null);
  };

  const finishDrawPresentation = async () => {
    const roundId = drawResult?.roundId || selectedRound?.id;
    if (!roundId) return;
    await publishNostalgiaPickResults(classId, roundId);
    showFeedback("추첨 결과를 확정하고 보상을 지급했습니다.", "success");
  };

  const handleDrawRound = async () => {
    if (!selectedRound?.id) return;

    const popupWindow = openDrawPopout({ showAlert: false, clearResult: true });
    const entrySnapshot = activeEntries.map((entry) => ({
      id: entry.id,
      slotNumber: entry.slotNumber,
      studentName: entry.studentName,
    }));

    try {
      setIsProcessing(true);
      const result = await drawNostalgiaPickRound(classId, selectedRound.id);
      setDrawResult({
        ...result,
        roundId: selectedRound.id,
        roundTitle: selectedRound.title,
        entries: entrySnapshot,
      });
      if (!popupWindow || popupWindow.closed) {
        setShowDrawModal(true);
      }
      showFeedback("추첨 결과를 준비했습니다.", "success");
    } catch (error) {
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      setShowDrawPopout(false);
      setDrawPopoutWindow(null);
      showFeedback(error?.message || "추첨 중 오류가 발생했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="2xl">
      <Modal.Header>
        <div className="flex w-full items-center justify-between gap-4 pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-100">
              <Ticket size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800">추억의 뽑기 관리</h2>
              <p className="text-xs font-semibold text-slate-400">
                응모 비용은 놀이터 전체 설정의 추억의 뽑기 항목을 따릅니다.
              </p>
            </div>
          </div>
          <Button size="sm" tone="rose" icon={Plus} onClick={openCreateForm}>
            회차 만들기
          </Button>
        </div>
      </Modal.Header>

      <Modal.Body className="grid max-h-[72vh] gap-5 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50 p-3">
          {allRounds.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm font-bold text-slate-400">
              아직 회차가 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {allRounds.map((round) => {
                const meta = statusMeta[round.status] || statusMeta.ready;
                const isSelected = selectedRound?.id === round.id;
                return (
                  <Button
                    key={round.id}
                    type="button"
                    onClick={() => setSelectedRoundId(round.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isSelected
                        ? "border-rose-200 bg-white shadow-sm"
                        : "border-transparent bg-white/70 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-black text-slate-800">
                        {round.title}
                      </p>
                      <Badge tone={meta.tone} size="sm">
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-slate-500">
                      {Number(round.entryCount || 0)}명 참여 · {formatDateTime(round.settings?.endTime)}
                    </p>
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">
          {isEditing ? (
            <div className="space-y-5 rounded-2xl border border-slate-100 bg-white p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">회차 제목</span>
                  <input
                    value={draft.title}
                    onChange={(event) => patchDraft("title", event.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none focus:border-rose-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">마감 시간</span>
                  <input
                    type="datetime-local"
                    value={draft.endTime}
                    onChange={(event) => patchDraft("endTime", event.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none focus:border-rose-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">전체 칸 수</span>
                  <input
                    type="number"
                    min="1"
                    value={draft.boardSize}
                    onChange={(event) => patchDraft("boardSize", event.target.value)}
                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none focus:border-rose-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-black text-slate-500">
                    1인 최대 응모 수
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={draft.maxEntriesPerStudent}
                    onChange={(event) =>
                      patchDraft("maxEntriesPerStudent", event.target.value)
                    }
                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm font-bold outline-none focus:border-rose-300"
                  />
                </label>
              </div>

              <Button
                type="button"
                onClick={() =>
                  patchDraft(
                    "duplicateWinnersAllowed",
                    !draft.duplicateWinnersAllowed,
                  )
                }
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-black transition ${
                  draft.duplicateWinnersAllowed
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                중복 당첨 허용
                <span>{draft.duplicateWinnersAllowed ? "ON" : "OFF"}</span>
              </Button>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-700">당첨 보상</p>
                  <Button
                    size="xs"
                    tone="rose"
                    icon={Plus}
                    onClick={() =>
                      patchDraft("prizes", [
                        ...draft.prizes,
                        {
                          rank: draft.prizes.length + 1,
                          type: "money",
                          amount: 0,
                          label: `${draft.prizes.length + 1}등`,
                        },
                      ])
                    }
                  >
                    추가
                  </Button>
                </div>
                {draft.prizes.map((prize, index) => (
                  <div
                    key={`${index}-${prize.rank}`}
                    className="grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-3 md:grid-cols-[70px_110px_1fr_140px_40px]"
                  >
                    <div className="flex items-center text-sm font-black text-rose-600">
                      {index + 1}등
                    </div>
                    <select
                      value={prize.type}
                      onChange={(event) => patchPrize(index, "type", event.target.value)}
                      className="rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-2 text-xs font-bold outline-none"
                    >
                      <option value="money">금액</option>
                      <option value="item">아이템</option>
                    </select>
                    {prize.type === "item" ? (
                      <select
                        value={prize.itemId || ""}
                        onChange={(event) => patchPrize(index, "itemId", event.target.value)}
                        className="rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-2 text-xs font-bold outline-none"
                      >
                        <option value="">아이템 선택</option>
                        {storeItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        value={prize.amount}
                        onChange={(event) => patchPrize(index, "amount", event.target.value)}
                        className="rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-2 text-xs font-black outline-none"
                        placeholder={currencyName}
                      />
                    )}
                    <input
                      value={prize.label}
                      onChange={(event) => patchPrize(index, "label", event.target.value)}
                      className="rounded-xl border border-blue-200 bg-blue-50/50 px-2 py-2 text-xs font-bold outline-none"
                    />
                    <Button
                      size="sm"
                      tone="red"
                      kind="ghost"
                      icon={Trash2}
                      disabled={draft.prizes.length <= 1}
                      onClick={() =>
                        patchDraft(
                          "prizes",
                          draft.prizes.filter((_, prizeIndex) => prizeIndex !== index),
                        )
                      }
                      className="w-9"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : selectedRound ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-100 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge tone={selectedStatus.tone} size="sm">
                      {selectedStatus.label}
                    </Badge>
                    <h3 className="mt-3 text-2xl font-black text-slate-800">
                      {selectedRound.title}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {formatDateTime(selectedRound.settings?.endTime)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedRound.status === "ready" && (
                      <>
                        <Button
                          size="sm"
                          tone="slate"
                          kind="outline"
                          icon={Pencil}
                          onClick={() => openEditForm(selectedRound)}
                        >
                          수정
                        </Button>
                        <Button
                          size="sm"
                          tone="emerald"
                          icon={Play}
                          disabled={Boolean(activeRound) || isProcessing}
                          onClick={() =>
                            runAction("판매를 시작했습니다.", openNostalgiaPickRound)
                          }
                        >
                          시작
                        </Button>
                        <Button
                          size="sm"
                          tone="red"
                          kind="ghost"
                          icon={Trash2}
                          disabled={isProcessing}
                          onClick={() =>
                            runAction("회차를 삭제했습니다.", deleteNostalgiaPickRound)
                          }
                        >
                          삭제
                        </Button>
                      </>
                    )}
                    {selectedRound.status === "open" && (
                      <>
                        <Button
                          size="sm"
                          tone="amber"
                          icon={Square}
                          disabled={isProcessing}
                          onClick={() =>
                            runAction("판매를 일시 정지했습니다.", pauseNostalgiaPickRound)
                          }
                        >
                          일시 정지
                        </Button>
                        <Button
                          size="sm"
                          tone="blue"
                          icon={CheckCircle2}
                          disabled={isProcessing}
                          onClick={() => runAction("회차를 마감했습니다.", closeNostalgiaPickRound)}
                        >
                          마감
                        </Button>
                      </>
                    )}
                    {selectedRound.status === "paused" && (
                      <>
                        <Button
                          size="sm"
                          tone="emerald"
                          icon={Play}
                          disabled={isProcessing}
                          onClick={() =>
                            runAction("판매를 재개했습니다.", resumeNostalgiaPickRound)
                          }
                        >
                          재개
                        </Button>
                        <Button
                          size="sm"
                          tone="blue"
                          icon={CheckCircle2}
                          disabled={isProcessing}
                          onClick={() => runAction("회차를 마감했습니다.", closeNostalgiaPickRound)}
                        >
                          마감
                        </Button>
                      </>
                    )}
                    {selectedRound.status === "closed" && (
                      <Button
                        size="sm"
                        tone="rose"
                        icon={Trophy}
                          disabled={isProcessing || activeEntries.length === 0}
                          onClick={handleDrawRound}
                      >
                        추첨
                      </Button>
                    )}
                    {selectedRound.status === "finished" &&
                      selectedRound.resultsPending === true && (
                        <Button
                          size="sm"
                          tone="rose"
                          icon={Trophy}
                          disabled={isProcessing}
                          onClick={handleDrawRound}
                        >
                          추첨 이어보기
                        </Button>
                      )}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <Users size={16} className="mb-2 text-slate-400" />
                    <p className="text-xl font-black text-slate-800">
                      {activeEntries.length} / {boardSize}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500">참여 칸</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <CalendarClock size={16} className="mb-2 text-slate-400" />
                    <p className="text-xl font-black text-slate-800">
                      {selectedRound.settings?.maxEntriesPerStudent || "무제한"}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500">1인 최대</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <Gift size={16} className="mb-2 text-slate-400" />
                    <p className="text-xl font-black text-slate-800">
                      {selectedRound.settings?.prizes?.length || 0}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500">당첨 등수</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <Trophy size={16} className="mb-2 text-slate-400" />
                    <p className="text-xl font-black text-slate-800">
                      {selectedRound.settings?.duplicateWinnersAllowed ? "허용" : "불가"}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500">중복 당첨</p>
                  </div>
                </div>
              </div>

              {selectedRound.status === "finished" &&
              selectedRound.resultsPending === true ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
                  <p className="mb-2 text-sm font-black text-amber-700">
                    결과 확정 전
                  </p>
                  <p className="text-sm font-bold text-amber-600">
                    추첨 결과는 생성되었지만 아직 학생 보상과 결과 공개가 확정되지 않았습니다.
                  </p>
                </div>
              ) : selectedRound.status === "finished" ? (
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5">
                  <p className="mb-3 text-sm font-black text-rose-700">당첨 결과</p>
                  {winners.length === 0 ? (
                    <p className="text-sm font-bold text-rose-500">당첨자가 없습니다.</p>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-3">
                      {winners.map((winner) => (
                        <div
                          key={`${winner.rank}-${winner.slotNumber}`}
                          className="rounded-2xl bg-white px-4 py-3"
                        >
                          <p className="text-sm font-black text-slate-800">
                            {winner.rank}등 · {winner.slotNumber}번
                          </p>
                          <p className="mt-1 text-xs font-bold text-rose-600">
                            {winner.studentName} · {winner.prizeLabel}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="rounded-2xl border border-slate-100 bg-white p-5">
                <p className="mb-3 text-sm font-black text-slate-700">참여 명단</p>
                {activeEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm font-bold text-slate-400">
                    아직 이름이 적힌 칸이 없습니다.
                  </div>
                ) : (
                  <div className="grid max-h-[260px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                    {activeEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                      >
                        <p className="text-sm font-black text-slate-800">
                          {entry.slotNumber}번
                        </p>
                        <p className="mt-1 text-xs font-bold text-slate-500">
                          {entry.studentName || "학생"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
              <Ticket size={34} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-black text-slate-400">
                회차를 만들어 주세요.
              </p>
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        {isEditing ? (
          <>
            <Button
              tone="slate"
              kind="ghost"
              onClick={() => setIsEditing(false)}
              disabled={isProcessing}
            >
              취소
            </Button>
            <Button
              tone="rose"
              icon={Save}
              onClick={handleSaveRound}
              isLoading={isProcessing}
            >
              저장
            </Button>
          </>
        ) : (
          <Button tone="slate" kind="ghost" icon={X} onClick={onClose}>
            닫기
          </Button>
        )}
      </Modal.Footer>

      {showDrawModal && drawResult ? (
        <NostalgiaPickDrawModal
          roundTitle={drawResult.roundTitle}
          winners={drawResult.winners}
          entries={drawResult.entries}
          totalEntries={drawResult.totalEntries}
          onFinish={finishDrawPresentation}
          onClose={closeDrawPresentation}
        />
      ) : null}
      {showDrawPopout ? (
        <PopoutWindow
          isOpen={showDrawPopout}
          title="추억의 뽑기 추첨"
          windowName="finclass-nostalgia-pick-draw"
          providedWindow={drawPopoutWindow}
          onClose={closeDrawPresentation}
          onOpenFail={() => {
            setShowDrawPopout(false);
            setDrawPopoutWindow(null);
            setShowDrawModal(true);
            showFeedback(
              "브라우저에서 팝업이 차단되어 기존 모달로 다시 표시했습니다.",
              "warning",
            );
          }}
        >
          {drawResult ? (
            <NostalgiaPickDrawModal
              roundTitle={drawResult.roundTitle}
              winners={drawResult.winners}
              entries={drawResult.entries}
              totalEntries={drawResult.totalEntries}
              isStandalone
              onFinish={finishDrawPresentation}
              onClose={closeDrawPresentation}
            />
          ) : (
            <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 px-10 py-8 text-center shadow-2xl">
                <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-rose-400" />
                <p className="text-xl font-black">추첨 준비 중</p>
                <p className="mt-2 text-sm font-bold text-slate-400">
                  번호표와 당첨 결과를 불러오고 있습니다.
                </p>
              </div>
            </div>
          )}
        </PopoutWindow>
      ) : null}
    </Modal>
  );
};

export default NostalgiaPickManagementCenter;
