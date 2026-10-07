import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React, { useState } from "react";
import {
    List,
    Plus,
    Trophy,
    Clock,
    Play,
    Square,
    Trash2,
    Save,
    Pencil,
    PartyPopper,
    Sparkles,
    LayoutGrid,
    ToggleLeft,
    ToggleRight,
    Ticket,
    Users,
    RotateCcw,
} from "lucide-react";

// ✅ 요청하신 정확한 경로 적용
import { Modal, Button, Badge } from "../../../../components/ui";
import StudentSelector from "../../../../components/ui/StudentSelector";
import PopoutWindow from "../../../../components/ui/PopoutWindow";
import { analyzeLottoPrizes } from "../../utils/prizeAnalytics";
import {
    drawLotto,
    createLottoRound,
    openLottoRound,
    pauseLottoRound,
    resumeLottoRound,
    closeLottoRound,
    deleteLottoRound,
    updateLottoRound,
    publishLottoResults,
    refundLottoTicket,
    subscribeLottoRoundTickets,
} from "../../services/arcadeServices";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import LottoDrawModal from "./LottoDrawModal";

const LottoManagementCenter = ({
    allRounds = [],
    storeItems = [],
    currencyName = "단위",
    classId,
    globalSettings = {},
    onClose,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const [selectedRoundId, setSelectedRoundId] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [editingRoundId, setEditingRoundId] = useState(null);
    const [selectedCopyRoundId, setSelectedCopyRoundId] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [showDrawModal, setShowDrawModal] = useState(false);
    const [showDrawPopout, setShowDrawPopout] = useState(false);
    const [drawPopoutWindow, setDrawPopoutWindow] = useState(null);
    const [drawResult, setDrawResult] = useState(null);
    const [showManualDrawModal, setShowManualDrawModal] = useState(false);
    const [manualWinningNumbers, setManualWinningNumbers] = useState([]);
    const [manualBonusNumber, setManualBonusNumber] = useState(null);
    const [manualSelectionMode, setManualSelectionMode] = useState("winning");
    const [confirmModal, setConfirmModal] = useState(null);
    const [alertModal, setAlertModal] = useState(null);
    const [showBuyerModal, setShowBuyerModal] = useState(false);
    const [showWinnerModal, setShowWinnerModal] = useState(false);
    const [roundTickets, setRoundTickets] = useState([]);
    const [buyerFilterUids, setBuyerFilterUids] = useState([]);
    const [deadlineEditModal, setDeadlineEditModal] = useState(null);
    const { showFeedback } = useFeedback();

    const activeRound = allRounds.find(
        (r) => r.status === "open" || r.status === "paused",
    );

    // ✅ 라벨 높이 고정(삐뚤삐뚤 해결 핵심)
    const FieldLabel = ({ children }) => (
        <span className="h-5 flex items-center text-xs font-black text-slate-400 ml-1">
            {children}
        </span>
    );

    // 새 회차 초기 설정 (이미지 레이아웃 기준)
    const [newRoundData, setNewRoundData] = useState({
        title: `${allRounds.length + 1}회차 주간 로또`,
        maxNumber: 45,
        pickCount: 6,
        useBonus: true,
        endTime: "",
        prizes: [
            { rank: 1, type: "money", amount: 50000, label: "1등 대박" },
            { rank: 2, type: "money", amount: 10000, label: "2등 아깝다" },
            { rank: 3, type: "money", amount: 5000, label: "3등 축하" },
        ],
    });

    // --- 수학 로직 ---
    const nCr = (n, r) => {
        if (r < 0 || r > n) return 0;
        if (r === 0 || r === n) return 1;
        if (r > n / 2) r = n - r;
        let res = 1;
        for (let i = 1; i <= r; i++) res = (res * (n - i + 1)) / i;
        return Math.floor(res);
    };

    const getProbPercent = (config, idx) => {
        const n = Number(config.maxNumber);
        const k = Number(config.pickCount);
        const total = nCr(n, k);
        if (total === 0) return "0%";

        let winCases = 0;
        if (idx === 0) winCases = 1;
        else if (config.useBonus) {
            if (idx === 1) winCases = k;
            else {
                const match = k - (idx - 1);
                winCases = nCr(k, match) * nCr(n - k - 1, idx - 1);
            }
        } else {
            const match = k - idx;
            winCases = nCr(k, match) * nCr(n - k, idx);
        }

        const pct = (winCases / total) * 100;
        return pct < 0.0001 ? "0.0001% 미만" : pct.toFixed(4) + "%";
    };

    const getConditionText = (config, idx) => {
        const N = Number(config.pickCount);
        if (idx === 0) return `${N}개 모두 일치`;
        if (config.useBonus) {
            if (idx === 1) return `${N - 1}개 + 보너스 번호 일치`;
            return `${Math.max(0, N - (idx - 1))}개 번호 일치`;
        }
        return `${Math.max(0, N - idx)}개 번호 일치`;
    };

    const getLottoRankNumber = (rank) =>
        Number(String(rank || "").match(/\d+/)?.[0] || 0);

    const openAlertModal = (title, message) => {
        setAlertModal({ title, message });
    };

    const getReadableManualDrawError = (error) => {
        const message = String(error?.message || "").trim();
        if (!message || /\?{4,}|�/.test(message)) {
            return "수동 추첨을 반영하지 못했습니다. 회차가 마감 상태인지, 구매 내역이 있는지, 당첨 번호와 보너스 번호가 올바른지 확인해 주세요.";
        }
        return message;
    };

    const formatMoney = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return `0 ${currencyName}`;
        return `${formatDisplayMoney(amount)} ${currencyName}`;
    };

    const formatPercent = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "0%";
        if (Math.abs(amount) >= 10) return `${amount.toFixed(0)}%`;
        if (Math.abs(amount) >= 1) return `${amount.toFixed(1)}%`;
        return `${amount.toFixed(2)}%`;
    };

    const globalFeeAmount = Math.max(0, Number(globalSettings?.feeAmount ?? 0));
    const globalEntryPrice = Math.max(0, Number(globalSettings?.price ?? 500));

    const toDateSafe = (value) => {
        if (!value) return null;
        if (value?.toDate) return value.toDate();
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    };

    const formatDateTimeLocalInput = (value) => {
        const date = toDateSafe(value);
        if (!date) return "";
        const pad = (number) => String(number).padStart(2, "0");
        const datePart = [
            date.getFullYear(),
            pad(date.getMonth() + 1),
            pad(date.getDate()),
        ].join("-");
        return `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const normalizeLocalDateTimeForSave = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
    };

    const buildEffectiveRoundConfig = (config = {}) => ({
        ...(config || {}),
        price: globalEntryPrice,
        feeAmount: globalFeeAmount,
    });

    // --- 액션 핸들러 ---
    const buildRoundDraft = (round) => ({
        title: round?.title || `${allRounds.length + 1}회차 럭키 로또`,
        maxNumber: Number(round?.settings?.maxNumber ?? globalSettings?.maxNumber ?? 45),
        pickCount: Number(round?.settings?.pickCount ?? globalSettings?.pickCount ?? 6),
        useBonus:
            round?.settings?.useBonus != null
                ? round.settings.useBonus !== false
                : globalSettings?.useBonus !== false,
        endTime: round?.settings?.endTime
            ? formatDateTimeLocalInput(round.settings.endTime)
            : "",
        prizes: Array.isArray(round?.settings?.prizes) && round.settings.prizes.length > 0
            ? round.settings.prizes.map((prize, idx) => ({
                rank: idx + 1,
                type: prize?.type === "item" ? "item" : "money",
                amount: Number(prize?.amount ?? 0),
                itemId: prize?.itemId || "",
                label: String(prize?.label || "").trim(),
            }))
            : [
                { rank: 1, type: "money", amount: 50000, label: "1등 당첨" },
                { rank: 2, type: "money", amount: 10000, label: "2등 당첨" },
                { rank: 3, type: "money", amount: 5000, label: "3등 당첨" },
            ],
    });

    const openCreateForm = () => {
        setNewRoundData(buildRoundDraft(null));
        setSelectedRoundId(null);
        setEditingRoundId(null);
        setSelectedCopyRoundId("");
        setIsCreating(true);
    };

    const openEditForm = (round) => {
        if (!round || round.status !== "ready") return;
        setNewRoundData(buildRoundDraft(round));
        setEditingRoundId(round.id);
        setSelectedCopyRoundId("");
        setIsCreating(true);
    };

    const closeEditor = () => {
        setIsCreating(false);
        setEditingRoundId(null);
        setSelectedCopyRoundId("");
    };

    const applyRoundFormatFrom = (round) => {
        if (!round) return;

        const copiedDraft = buildRoundDraft(round);
        setNewRoundData((prev) => ({
            ...prev,
            maxNumber: copiedDraft.maxNumber,
            pickCount: copiedDraft.pickCount,
            useBonus: copiedDraft.useBonus,
            prizes: copiedDraft.prizes.map((prize, idx) => ({
                ...prize,
                rank: idx + 1,
            })),
        }));
        showFeedback(`'${round.title}' 형식을 불러왔습니다.`, "info");
    };

    const openManualDrawModal = (round) => {
        if (!round) return;
        setManualWinningNumbers(
            Array.isArray(round.winningNumbers)
                ? [...round.winningNumbers].sort((left, right) => left - right)
                : [],
        );
        setManualBonusNumber(
            round.bonusNumber != null ? Number(round.bonusNumber) : null,
        );
        setManualSelectionMode("winning");
        setShowManualDrawModal(true);
    };

    const closeManualDrawModal = () => {
        setShowManualDrawModal(false);
        setManualWinningNumbers([]);
        setManualBonusNumber(null);
        setManualSelectionMode("winning");
    };

    const resetManualDrawSelection = () => {
        setManualWinningNumbers([]);
        setManualBonusNumber(null);
        setManualSelectionMode("winning");
    };

    const toggleManualWinningNumber = (numberValue) => {
        const pickCount = Number(selectedRound?.settings?.pickCount || 0);
        const useBonus = selectedRound?.settings?.useBonus !== false;

        if (manualBonusNumber === numberValue) {
            showFeedback("보너스 번호로 선택된 번호입니다. 먼저 보너스를 해제해 주세요.", "warning");
            return;
        }

        if (manualWinningNumbers.includes(numberValue)) {
            setManualWinningNumbers((prev) =>
                prev.filter((value) => value !== numberValue),
            );
            if (useBonus && manualSelectionMode === "bonus") {
                setManualSelectionMode("winning");
            }
            return;
        }

        if (manualWinningNumbers.length >= pickCount) {
            showFeedback(`${pickCount}개까지만 당첨 번호를 선택할 수 있습니다.`, "warning");
            return;
        }

        const nextWinningNumbers = [...manualWinningNumbers, numberValue].sort(
            (left, right) => left - right,
        );
        setManualWinningNumbers(nextWinningNumbers);

        if (useBonus && nextWinningNumbers.length === pickCount) {
            setManualSelectionMode("bonus");
        }
    };

    const toggleManualBonusSelection = (numberValue) => {
        if (manualWinningNumbers.includes(numberValue)) {
            showFeedback("당첨 번호와 보너스 번호는 중복될 수 없습니다.", "warning");
            return;
        }

        setManualBonusNumber((prev) => (prev === numberValue ? null : numberValue));
    };

    const handleManualNumberSelect = (numberValue) => {
        if (!Number.isInteger(numberValue)) return;

        if (manualSelectionMode === "bonus" && selectedRound?.settings?.useBonus !== false) {
            toggleManualBonusSelection(numberValue);
            return;
        }

        toggleManualWinningNumber(numberValue);
    };

    const handleSubmitManualDraw = async () => {
        if (!selectedRound) return;

        const maxNumber = Number(selectedRound.settings?.maxNumber || 0);
        const pickCount = Number(selectedRound.settings?.pickCount || 0);
        const useBonus = selectedRound.settings?.useBonus !== false;

        try {
            const winningNumbers = [...manualWinningNumbers].sort(
                (left, right) => left - right,
            );
            if (winningNumbers.length !== pickCount) {
                throw new Error(`${pickCount}개의 당첨 번호를 모두 선택해 주세요.`);
            }
            let bonusNumber = null;

            if (useBonus) {
                bonusNumber = Number(manualBonusNumber);
                if (!Number.isInteger(bonusNumber)) {
                    throw new Error("보너스 번호를 입력해 주세요.");
                }
                if (
                    bonusNumber < 1 ||
                    bonusNumber > maxNumber ||
                    winningNumbers.includes(bonusNumber)
                ) {
                    throw new Error("보너스 번호는 중복 없이 범위 안에서 입력해 주세요.");
                }
            }

            setIsProcessing(true);
            await drawLotto(classId, {
                roundId: selectedRound.id,
                winningNumbers,
                bonusNumber,
            });
            await publishLottoResults(classId, selectedRound.id);
            setSelectedRoundId(selectedRound.id);
            showFeedback("수동 추첨 결과를 반영하고 보상을 지급했습니다.", "success");
            closeManualDrawModal();
        } catch (error) {
            openAlertModal(
                "수동 추첨 오류",
                getReadableManualDrawError(error),
            );
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSaveNewRound = async () => {
        if (!newRoundData.title) {
            openAlertModal("입력 확인", "회차 제목을 입력해주세요.");
            return;
        }

        const maxNumberNum = Number(newRoundData.maxNumber);
        const pickCountNum = Number(newRoundData.pickCount);
        if (!Number.isFinite(maxNumberNum) || !Number.isFinite(pickCountNum) || maxNumberNum <= 0 || pickCountNum <= 0 || pickCountNum > maxNumberNum) {
            openAlertModal("입력 확인", "숫자 범위/선택 개수 설정이 올바르지 않습니다.");
            return;
        }

        const invalidPrize = newRoundData.prizes.find((prize) => {
            if (!String(prize.label || "").trim()) return true;
            if (prize.type === "item") return !String(prize.itemId || "").trim();
            if (prize.type === "money") return !Number.isFinite(Number(prize.amount)) || Number(prize.amount) < 0;
            return true;
        });
        if (invalidPrize) {
            openAlertModal("보상 설정 확인", "로또 보상 정보가 비어 있습니다. 아이템/금액/라벨을 확인해주세요.");
            return;
        }

        const normalizedPrizes = newRoundData.prizes.map((prize, idx) => {
            const base = {
                rank: idx + 1,
                type: prize.type === "item" ? "item" : "money",
                label: String(prize.label || "").trim(),
            };
            if (base.type === "item") {
                return {
                    ...base,
                    itemId: String(prize.itemId || "").trim(),
                };
            }
            return {
                ...base,
                amount: Math.max(0, Number(prize.amount) || 0),
            };
        });

        try {
            setIsProcessing(true);
            const payload = {
                ...newRoundData,
                maxNumber: maxNumberNum,
                pickCount: pickCountNum,
                endTime: normalizeLocalDateTimeForSave(newRoundData.endTime),
                prizes: normalizedPrizes,
            };

            if (editingRoundId) {
                await updateLottoRound(classId, editingRoundId, payload);
                setSelectedRoundId(editingRoundId);
            } else {
                const result = await createLottoRound(classId, payload);
                setSelectedRoundId(result?.roundId || null);
            }

            closeEditor();
            showFeedback(
                editingRoundId ? "로또 회차를 저장했습니다." : "로또 회차를 만들었습니다.",
                "success",
            );
        } catch (e) {
            openAlertModal("저장 실패", "회차 저장 중 오류가 발생했습니다.");
        } finally {
            setIsProcessing(false);
        }
    };

    const openDeadlineEditModal = (round) => {
        if (!round || !["open", "paused"].includes(round.status)) return;
        setDeadlineEditModal({
            roundId: round.id,
            title: round.title,
            endTime: formatDateTimeLocalInput(round.settings?.endTime),
        });
    };

    const handleSaveDeadline = async () => {
        if (!deadlineEditModal?.roundId) return;

        try {
            setIsProcessing(true);
            await updateLottoRound(classId, deadlineEditModal.roundId, {
                endTime: normalizeLocalDateTimeForSave(deadlineEditModal.endTime),
            });
            setDeadlineEditModal(null);
            showFeedback("마감 일시를 저장했습니다.", "success");
        } catch (e) {
            openAlertModal(
                "마감 일시 저장 실패",
                e?.message || "마감 일시 저장 중 오류가 발생했습니다.",
            );
        } finally {
            setIsProcessing(false);
        }
    };

    const handleStartSales = (roundId) => {
        if (activeRound) {
            openAlertModal("판매 시작 불가", `이미 '${activeRound.title}'이 진행 중입니다.`);
            return;
        }

        setConfirmModal({
            title: "판매 시작",
            message: "선택한 회차의 판매를 시작할까요?",
            confirmLabel: "시작하기",
            tone: "emerald",
            action: { type: "startSales", roundId },
        });
    };

    const handleDeleteRound = (e, roundId) => {
        e.stopPropagation();
        setConfirmModal({
            title: "회차 삭제",
            message: "정말로 이 회차를 삭제하시겠습니까?\n구매 내역을 포함한 모든 데이터가 영구 삭제됩니다.",
            confirmLabel: "삭제하기",
            tone: "rose",
            action: { type: "deleteRound", roundId },
        });
    };

    const handleStartDraw = (roundId) => {
        setConfirmModal({
            title: "추첨 시작",
            message: "추첨을 시작하시겠습니까?",
            confirmLabel: "추첨하기",
            tone: "indigo",
            action: { type: "startDraw", roundId },
        });
    };

    const handleRefundTicket = (ticket) => {
        if (!selectedRound || !ticket?.id) return;
        setConfirmModal({
            title: "복권 환불",
            message: `${ticket.studentName || "학생"}의 복권을 환불할까요?\n마감 전 회차의 복권만 환불할 수 있으며, 결제 금액과 티켓 결제분이 학생에게 되돌아갑니다.`,
            confirmLabel: "환불하기",
            tone: "rose",
            action: {
                type: "refundTicket",
                roundId: selectedRound.id,
                ticketId: ticket.id,
            },
        });
    };

    const executeConfirmedAction = async () => {
        if (!confirmModal?.action) return;
        const { type, roundId, ticketId } = confirmModal.action;
        setConfirmModal(null);
        const popoutWindow =
            type === "startDraw"
                ? openDrawPopout({ showAlert: false, clearResult: true })
                : null;

        try {
            setIsProcessing(true);

            if (type === "startSales") {
                await openLottoRound(classId, roundId);
                return;
            }

            if (type === "pauseSales") {
                await pauseLottoRound(classId, roundId);
                return;
            }

            if (type === "resumeSales") {
                await resumeLottoRound(classId, roundId);
                return;
            }

            if (type === "deleteRound") {
                await deleteLottoRound(classId, roundId);
                if (selectedRoundId === roundId) setSelectedRoundId(null);
                return;
            }

            if (type === "refundTicket") {
                await refundLottoTicket(classId, { roundId, ticketId });
                showFeedback("복권을 환불했습니다.", "success");
                return;
            }

            if (type === "startDraw") {
                const result = await drawLotto(classId, { roundId });
                setDrawResult({ ...result, roundId });
                if (!popoutWindow || popoutWindow.closed) setShowDrawModal(true);
            }
        } catch (e) {
            if (popoutWindow && !popoutWindow.closed) {
                popoutWindow.close();
            }
            if (type === "startDraw") {
                setShowDrawPopout(false);
                setDrawPopoutWindow(null);
            }
            if (type === "deleteRound") {
                openAlertModal("삭제 실패", "회차 삭제 중 오류가 발생했습니다.");
            } else if (type === "refundTicket") {
                openAlertModal(
                    "환불 실패",
                    e?.message || "복권 환불 중 오류가 발생했습니다.",
                );
            } else if (type === "startDraw") {
                openAlertModal("추첨 오류", e?.message || "추첨 중 오류가 발생했습니다.");
            } else {
                openAlertModal("상태 변경 실패", "판매 상태 변경 중 오류가 발생했습니다.");
            }
        } finally {
            setIsProcessing(false);
        }
    };

    const ongoingRounds = allRounds.filter((r) => r.status !== "finished");
    const finishedRounds = allRounds.filter((r) => r.status === "finished");
    const selectedRound = allRounds.find((r) => r.id === selectedRoundId);
    const manualPickCount = Number(selectedRound?.settings?.pickCount || 0);
    const manualMaxNumber = Number(selectedRound?.settings?.maxNumber || 0);
    const manualUsesBonus = Boolean(
        selectedRound && selectedRound.settings?.useBonus !== false,
    );
    const manualNumberOptions = Array.from(
        { length: Math.max(manualMaxNumber, 0) },
        (_, index) => index + 1,
    );
    const selectedRoundConfig = selectedRound
        ? buildEffectiveRoundConfig(selectedRound.settings)
        : null;
    const newRoundSummary = analyzeLottoPrizes(
        buildEffectiveRoundConfig(newRoundData),
        storeItems,
    );
    const selectedRoundSummary = analyzeLottoPrizes(selectedRoundConfig, storeItems);
    const copySourceRounds = allRounds.filter((round) => round.id !== editingRoundId);
    const selectedCopyRound =
        copySourceRounds.find((round) => round.id === selectedCopyRoundId) ||
        copySourceRounds[0] ||
        null;
    const isSelectedRoundRefundable = React.useMemo(() => {
        if (!selectedRound || !["open", "paused"].includes(selectedRound.status)) {
            return false;
        }
        const endTime = toDateSafe(selectedRound.settings?.endTime);
        return !endTime || Date.now() <= endTime.getTime();
    }, [selectedRound]);
    const visibleRoundTickets = React.useMemo(
        () =>
            roundTickets.filter(
                (ticket) => String(ticket.status || "active") !== "refunded",
            ),
        [roundTickets],
    );
    const buyerRows = React.useMemo(() => {
        const rows = new Map();
        visibleRoundTickets.forEach((ticket) => {
            const uid = ticket.studentUid || "unknown";
            const current = rows.get(uid) || {
                uid,
                name: ticket.studentName || "Unknown",
                count: 0,
                tickets: [],
            };
            current.count += 1;
            current.tickets.push(ticket);
            rows.set(uid, current);
        });

        return Array.from(rows.values()).sort((left, right) => {
            if (right.count !== left.count) return right.count - left.count;
            return String(left.name).localeCompare(String(right.name));
        });
    }, [visibleRoundTickets]);
    const visibleBuyerRows = React.useMemo(() => {
        if (!buyerFilterUids.length) return buyerRows;
        const selectedUidSet = new Set(buyerFilterUids);
        return buyerRows.filter((buyer) => selectedUidSet.has(buyer.uid));
    }, [buyerFilterUids, buyerRows]);
    const selectedBuyerHasTickets =
        buyerFilterUids.length > 0 && visibleBuyerRows.length > 0;
    const winnerRows = React.useMemo(() => {
        const rows = new Map();
        (Array.isArray(selectedRound?.winners) ? selectedRound.winners : []).forEach((winner) => {
            const rankNumber = getLottoRankNumber(winner.rank);
            const rankKey = rankNumber > 0 ? String(rankNumber) : "unknown";
            const current = rows.get(rankKey) || {
                rankNumber,
                rankLabel: rankNumber > 0 ? `${rankNumber}등` : "당첨",
                winners: [],
            };
            current.winners.push(winner);
            rows.set(rankKey, current);
        });

        return Array.from(rows.values()).sort((left, right) => {
            const leftRank = left.rankNumber || 999;
            const rightRank = right.rankNumber || 999;
            return leftRank - rightRank;
        });
    }, [selectedRound?.winners]);
    const totalWinnerCount = winnerRows.reduce(
        (sum, row) => sum + row.winners.length,
        0,
    );

    React.useEffect(() => {
        if (!showBuyerModal || !classId || !selectedRound?.id) {
            setRoundTickets([]);
            return undefined;
        }

        return subscribeLottoRoundTickets(classId, selectedRound.id, setRoundTickets);
    }, [classId, selectedRound?.id, showBuyerModal]);

    const openDrawPopout = ({ showAlert = true, clearResult = false } = {}) => {
        if (typeof window === "undefined") return null;

        const openedWindow = window.open(
            "",
            "finclass-lotto-draw",
            "popup=yes,width=1600,height=980",
        );

        if (!openedWindow) {
            if (!showAlert) return null;
            openAlertModal(
                "팝업 차단",
                "브라우저에서 팝업이 차단되었습니다. 팝업 허용 후 다시 열어주세요.",
            );
            return null;
        }

        if (clearResult) setDrawResult(null);
        setDrawPopoutWindow(openedWindow);
        setShowDrawPopout(true);
        setShowDrawModal(false);
        return openedWindow;
    };

    const closeDrawPresentation = () => {
        setShowDrawModal(false);
        setShowDrawPopout(false);
        setDrawPopoutWindow(null);
    };

    const finishDrawPresentation = async () => {
        const roundId = drawResult?.roundId || selectedRound?.id || null;
        if (!roundId) {
            closeDrawPresentation();
            return;
        }

        try {
            setIsProcessing(true);
            await publishLottoResults(classId, roundId);
            setDrawResult((prev) => (prev ? { ...prev, resultsPublished: true } : prev));
            setSelectedRoundId(roundId);
            showFeedback("추첨 결과를 학생 화면에 공개했습니다.", "success");
        } catch (error) {
            openAlertModal(
                "추첨 확정 실패",
                error?.message || "추첨 결과 공개 중 오류가 발생했습니다.",
            );
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            size="xl"
            className="h-[85vh]"
        >
            <div className="flex h-full overflow-hidden bg-white rounded-[2.5rem]">
                {/* 📂 [좌측] 회차 목록 사이드바 */}
                <div className="w-72 bg-slate-50 border-r border-slate-100 flex flex-col">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
                        <h3 className="font-black text-slate-800 flex items-center gap-2 text-sm">
                            <List size={18} /> 로또 회차 관리
                        </h3>
                        <Button
                            onClick={openCreateForm}
                            className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-105 transition-transform"
                        >
                            <Plus size={18} />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        <div>
                            <p className="text-[10px] font-black text-indigo-400 uppercase mb-3 px-2 tracking-widest">
                                진행 및 대기 회차
                            </p>
                            <div className="space-y-2">
                                {ongoingRounds.map((r) => (
                                    <div
                                        key={r.id}
                                        onClick={() => {
                                            setSelectedRoundId(r.id);
                                            setIsCreating(false);
                                            setEditingRoundId(null);
                                        }}
                                        className={`group relative p-4 rounded-[1.8rem] cursor-pointer border-2 transition-all ${selectedRoundId === r.id
                                            ? "bg-white shadow-xl border-indigo-500 scale-[1.02]"
                                            : "border-transparent hover:bg-white/60"
                                            } ${r.status === "open" ? "bg-emerald-50 border-emerald-200" : ""}`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <Badge
                                                tone={r.status === "open" ? "emerald" : r.status === "ready" ? "slate" : "rose"}
                                                size="xs"
                                            >
                                                {r.status === "open" ? "판매 중" : r.status === "ready" ? "준비됨" : "종료"}
                                            </Badge>
                                            <Button aria-label="삭제"
                                                onClick={(e) => handleDeleteRound(e, r.id)}
                                                className="opacity-0 group-hover:opacity-100 p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"
                                            >
                                                <Trash2 size={12} />
                                            </Button>
                                        </div>
                                        <span
                                            className={`font-black text-sm truncate block ${r.status === "open" ? "text-emerald-700" : "text-slate-700"
                                                }`}
                                        >
                                            {r.title}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase mb-3 px-2 tracking-widest">
                                지난 추첨 기록
                            </p>
                            <div className="space-y-2 opacity-60 hover:opacity-100 transition-opacity">
                                {finishedRounds.map((r) => (
                                    <div
                                        key={r.id}
                                        onClick={() => {
                                            setSelectedRoundId(r.id);
                                            setIsCreating(false);
                                            setEditingRoundId(null);
                                        }}
                                        className={`p-4 rounded-[1.8rem] cursor-pointer border-2 transition-all ${selectedRoundId === r.id ? "bg-white border-indigo-500 shadow-md" : "border-transparent hover:bg-white/60"
                                            }`}
                                    >
                                        <Badge tone="rose" size="xs">
                                            추첨 완료
                                        </Badge>
                                        <span className="font-black text-sm truncate block text-slate-600 mt-1">
                                            {r.title}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 🛠️ [우측] 설정 및 대시보드 */}
                <div className="flex-1 flex flex-col overflow-hidden bg-white">
                    {isCreating ? (
                        /* --- 📝 CASE 1: 새 회차 기획 --- */
                        <div className="flex-1 p-10 overflow-y-auto space-y-8 animate-in fade-in slide-in-from-right-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-3xl font-black text-slate-800 tracking-tight">
                                        {editingRoundId ? "로또 회차 수정" : "새로운 로또 기획"}
                                    </h2>
                                    {selectedCopyRound ? (
                                        <p className="mt-2 text-xs font-semibold text-slate-400">
                                            최근 회차의 숫자 규칙과 보상표를 그대로 불러올 수 있습니다.
                                        </p>
                                    ) : null}
                                </div>
                                {selectedCopyRound ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select
                                            value={selectedCopyRound?.id || ""}
                                            onChange={(e) => setSelectedCopyRoundId(e.target.value)}
                                            disabled={isProcessing}
                                            className="h-11 min-w-[220px] rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-bold text-slate-700 shadow-sm outline-none transition focus:border-indigo-200 focus:ring-2 focus:ring-blue-500/20"
                                        >
                                            {copySourceRounds.map((round) => (
                                                <option key={round.id} value={round.id}>
                                                    {round.title}
                                                </option>
                                            ))}
                                        </select>
                                    <Button
                                        size="sm"
                                        tone="blue"
                                        kind="soft"
                                        icon={LayoutGrid}
                                        onClick={() => applyRoundFormatFrom(selectedCopyRound)}
                                        disabled={isProcessing}
                                        
                                    >
                                        직전 회차 형식 복사
                                    </Button>
                                    </div>
                                ) : null}
                            </div>

                            {/* ✅ 라벨 높이 고정 + 필드 높이 통일 */}
                            <div className="grid grid-cols-2 gap-6 bg-slate-50 p-8 rounded-[3rem] border border-slate-100">
                                {/* 좌측 */}
                                <div className="space-y-4">
                                    <label className="block space-y-1.5">
                                        <FieldLabel>회차 제목</FieldLabel>
                                        <input
                                            type="text"
                                            value={newRoundData.title}
                                            onChange={(e) => setNewRoundData({ ...newRoundData, title: e.target.value })}
                                            className="w-full h-14 px-5 bg-blue-50/50 border-none rounded-xl font-black shadow-sm outline-none ring-2 ring-transparent focus:ring-blue-500/20"
                                        />
                                    </label>

                                    <div className="grid grid-cols-[minmax(180px,0.95fr)_minmax(140px,0.75fr)] gap-4">
                                        <label className="block space-y-1.5">
                                            <FieldLabel>적용 수수료</FieldLabel>
                                            <div className="flex h-14 items-center whitespace-nowrap rounded-2xl bg-white px-5 text-sm font-black text-slate-800 shadow-sm">
                                                {formatMoney(globalFeeAmount)}
                                            </div>
                                        </label>

                                        <label className="block space-y-1.5">
                                            <FieldLabel>숫자 범위(1~N)</FieldLabel>
                                            <input
                                                type="number"
                                                value={newRoundData.maxNumber}
                                                onChange={(e) => setNewRoundData({ ...newRoundData, maxNumber: e.target.value })}
                                                className="w-full h-14 px-5 bg-blue-50/50 border-none rounded-xl font-black shadow-sm outline-none"
                                            />
                                        </label>
                                    </div>
                                </div>

                                {/* 우측 */}
                                <div className="space-y-4">
                                    <label className="block space-y-1.5">
                                        <FieldLabel>
                                            <span className="inline-flex items-center gap-1.5">
                                                <Clock size={12} /> 자동 마감 일시(선택)
                                            </span>
                                        </FieldLabel>
                                        <input
                                            type="datetime-local"
                                            value={newRoundData.endTime}
                                            onChange={(e) => setNewRoundData({ ...newRoundData, endTime: e.target.value })}
                                            className="w-full h-14 px-5 bg-blue-50/50 border-none rounded-xl font-black shadow-sm outline-none"
                                        />

                                    </label>

                                    <div className="grid w-fit grid-cols-[140px_120px] gap-4">
                                        <label className="block space-y-1.5">
                                            <FieldLabel>선택 자리수</FieldLabel>
                                            <input
                                                type="number"
                                                value={newRoundData.pickCount}
                                                onChange={(e) => setNewRoundData({ ...newRoundData, pickCount: Number(e.target.value) })}
                                                className="w-full h-14 px-5 bg-blue-50/50 border-none rounded-xl font-black shadow-sm outline-none"
                                            />
                                        </label>

                                        {/* ✅ 보너스 번호도 동일한 구조(라벨+필드 h-14)로 통일 */}
                                        <label className="block space-y-1.5">
                                            <FieldLabel>보너스 번호</FieldLabel>
                                            <div className="h-14 bg-white rounded-2xl shadow-sm px-4 flex items-center justify-center">
                                                <Button
                                                    type="button"
                                                    onClick={() => setNewRoundData({ ...newRoundData, useBonus: !newRoundData.useBonus })}
                                                    className="flex items-center justify-center"
                                                >
                                                    {newRoundData.useBonus ? (
                                                        <ToggleRight className="text-indigo-600" size={32} />
                                                    ) : (
                                                        <ToggleLeft className="text-slate-200" size={32} />
                                                    )}
                                                </Button>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <p className="-mt-3 px-2 text-xs font-semibold text-slate-400">
                                입장료는 전체 놀이터 설정의 로또 입장료를 그대로 사용합니다.
                            </p>

                            {/* 당첨 확률 및 보상 설정 */}
                            <div className="rounded-[3rem] border border-indigo-100 bg-indigo-50/70 p-8">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-500">
                                            한 장 기준 평균
                                        </p>
                                        <h4 className="mt-1 text-2xl font-black text-slate-800">
                                            총 {formatMoney(newRoundSummary.totalCost)} 차감 시 평균{" "}
                                            {formatMoney(newRoundSummary.totalExpectedReturn)} 보상
                                        </h4>
                                        <p className="mt-2 text-sm font-semibold text-slate-600">
                                            {newRoundSummary.recommendation.description}
                                        </p>
                                    </div>
                                    <div className="rounded-full bg-white px-4 py-2 text-xs font-black text-indigo-600 shadow-sm">
                                        현재 성향: {newRoundSummary.recommendation.label}
                                    </div>
                                </div>

                                <div className="mt-5 grid gap-3 md:grid-cols-5">
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">총 차감</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatMoney(newRoundSummary.totalCost)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">평균 보상 가치</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatMoney(newRoundSummary.totalExpectedReturn)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">1회 평균 손익</p>
                                        <p
                                            className={`mt-1 text-xl font-black ${
                                                Number(newRoundSummary.expectedNet) >= 0 ? "text-emerald-600" : "text-rose-600"
                                            }`}
                                        >
                                            {newRoundSummary.expectedNet > 0 ? "+" : ""}
                                            {formatMoney(newRoundSummary.expectedNet)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">당첨 확률</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatPercent(newRoundSummary.totalWinRate)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">최대 보상 가치</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatMoney(newRoundSummary.maxPrizeValue)}
                                        </p>
                                    </div>
                                </div>

                                <p className="mt-4 text-xs font-semibold text-slate-500">
                                    실제 차감은 입장료 {formatMoney(newRoundSummary.entryPrice)}
                                    {Number(newRoundSummary.feeAmount || 0) > 0
                                        ? ` + 수수료 ${formatMoney(newRoundSummary.feeAmount)}`
                                        : ""}
                                    입니다. 아이템은 상점 가격 기준으로 돈처럼 합산합니다.
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                    <h4 className="text-sm font-black text-slate-800">당첨 확률 및 보상 설정</h4>
                                    <div className="flex gap-2">
                                        <Button
                                            size="xs"
                                            tone="slate"
                                            kind="ghost"
                                            onClick={() =>
                                                setNewRoundData({ ...newRoundData, prizes: newRoundData.prizes.slice(0, -1) })
                                            }
                                            disabled={newRoundData.prizes.length <= 1}
                                        >
                                            등수 삭제
                                        </Button>
                                        <Button
                                            size="xs"
                                            tone="blue"
                                            kind="soft"
                                            onClick={() =>
                                                setNewRoundData({
                                                    ...newRoundData,
                                                    prizes: [
                                                        ...newRoundData.prizes,
                                                        {
                                                            rank: newRoundData.prizes.length + 1,
                                                            type: "money",
                                                            amount: 0,
                                                            label: "당첨!",
                                                        },
                                                    ],
                                                })
                                            }
                                        >
                                            등수 추가
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    {newRoundData.prizes.map((p, i) => (
                                        <div
                                            key={i}
                                            className="grid grid-cols-[130px_110px_1fr_120px] gap-3 p-4 bg-slate-50 rounded-[2rem] items-center border border-slate-100"
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black text-rose-500">
                                                    {getConditionText(newRoundData, i)}
                                                </span>
                                                <span className="text-[9px] font-mono text-indigo-500 font-bold">
                                                    확률: {getProbPercent(newRoundData, i)}
                                                </span>
                                            </div>

                                            <select
                                                value={p.type}
                                                onChange={(e) => {
                                                    const np = [...newRoundData.prizes];
                                                    np[i].type = e.target.value;
                                                    if (e.target.value === "item") {
                                                        np[i].amount = 0;
                                                    } else {
                                                        np[i].itemId = "";
                                                    }
                                                    setNewRoundData({ ...newRoundData, prizes: np });
                                                }}
                                                className="h-11 px-3 bg-blue-50/50 border-none rounded-xl text-xs font-bold shadow-sm cursor-pointer"
                                            >
                                                <option value="money">금액 보상</option>
                                                <option value="item">아이템 보상</option>
                                            </select>

                                            {p.type === "money" ? (
                                                <input
                                                    type="number"
                                                    value={p.amount}
                                                    onChange={(e) => {
                                                        const np = [...newRoundData.prizes];
                                                        np[i].amount = e.target.value;
                                                        setNewRoundData({ ...newRoundData, prizes: np });
                                                    }}
                                                    className="h-11 px-4 bg-blue-50/50 border-none rounded-xl text-xs font-black text-right shadow-sm"
                                                    placeholder="상금 입력"
                                                />
                                            ) : (
                                                <select
                                                    value={p.itemId || ""}
                                                    onChange={(e) => {
                                                        const np = [...newRoundData.prizes];
                                                        np[i].itemId = e.target.value;
                                                        const selectedItem = storeItems.find((it) => it.id === e.target.value);
                                                        if (selectedItem) {
                                                            np[i].label = selectedItem.name;
                                                        }
                                                        setNewRoundData({ ...newRoundData, prizes: np });
                                                    }}
                                                    className="h-11 px-3 bg-blue-50/50 border-none rounded-xl text-xs font-bold shadow-sm cursor-pointer"
                                                >
                                                    <option value="">아이템 선택</option>
                                                    {storeItems.map((it) => (
                                                        <option key={it.id} value={it.id}>
                                                            {it.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}

                                            <input
                                                type="text"
                                                value={p.label}
                                                onChange={(e) => {
                                                    const np = [...newRoundData.prizes];
                                                    np[i].label = e.target.value;
                                                    setNewRoundData({ ...newRoundData, prizes: np });
                                                }}
                                                className="h-11 px-4 bg-blue-50/50 border-none rounded-xl text-xs font-bold shadow-sm"
                                                placeholder="당첨 문구"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t">
                                <Button tone="slate" kind="ghost" onClick={closeEditor} disabled={isProcessing}>
                                    취소
                                </Button>
                                <Button size="md"
                                    tone="blue"
                                    onClick={handleSaveNewRound}
                                    icon={Save}
                                    
                                    disabled={isProcessing}
                                >
                                    회차 기획 저장
                                </Button>
                            </div>
                        </div>
                    ) : selectedRound ? (
                        /* --- 📊 CASE 2: 회차 대시보드 --- */
                        <div className="flex-1 p-12 overflow-y-auto space-y-10">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="flex min-w-0 flex-1 items-center gap-5">
                                    <div
                                        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[2rem] text-white shadow-2xl ${selectedRound.status === "open" ? "bg-emerald-500" : "bg-slate-900"
                                            }`}
                                    >
                                        <PartyPopper size={32} />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="truncate text-3xl font-black text-slate-800">{selectedRound.title}</h2>
                                        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                                            상태:{" "}
                                            {selectedRound.status === "open"
                                                ? "판매 중"
                                                : selectedRound.status === "ready"
                                                    ? "기획 단계"
                                                    : "종료됨"}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                    <Button
                                        tone="slate"
                                        kind="outline"
                                        onClick={() => setShowBuyerModal(true)}
                                        disabled={isProcessing}
                                        icon={Users}
                                    >
                                        구매자
                                    </Button>
                                    <Button
                                        tone="amber"
                                        kind="outline"
                                        onClick={() => setShowWinnerModal(true)}
                                        disabled={isProcessing || selectedRound.status !== "finished"}
                                        icon={Trophy}
                                    >
                                        당첨자
                                    </Button>
                                    {["open", "paused"].includes(selectedRound.status) && (
                                        <Button
                                            tone="blue"
                                            kind="outline"
                                            onClick={() => openDeadlineEditModal(selectedRound)}
                                            disabled={isProcessing}
                                            icon={Clock}
                                        >
                                            마감 수정
                                        </Button>
                                    )}
                                    {selectedRound.status === "ready" && (
                                        <>
                                            <Button tone="slate" kind="outline" size="icon-md"
                                                type="button"
                                                onClick={() => openEditForm(selectedRound)}
                                                disabled={isProcessing}
                                                className="inline-flex w-12 items-center justify-center transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                                                title="회차 수정"
                                                aria-label="회차 수정"
                                            >
                                                <Pencil size={18} />
                                            </Button>
                                        <Button size="md"
                                            tone="emerald"
                                            onClick={() => handleStartSales(selectedRound.id)}
                                            disabled={!!activeRound}
                                            icon={Play}
                                            
                                        >
                                            판매 시작하기
                                        </Button>
                                        </>
                                    )}

                                    {selectedRound.status === "open" && (
                                        <>
                                            <Button
                                                tone="amber"
                                                onClick={() =>
                                                    setConfirmModal({
                                                        title: "일시 정지",
                                                        message: "현재 판매 중인 로또 회차를 잠시 멈출까요?",
                                                        confirmLabel: "일시 정지",
                                                        tone: "amber",
                                                        action: { type: "pauseSales", roundId: selectedRound.id },
                                                    })
                                                }
                                                disabled={isProcessing}
                                                icon={Clock}
                                            >
                                                일시정지
                                            </Button>
                                            <Button
                                                tone="rose"
                                                onClick={async () => {
                                                    try {
                                                        setIsProcessing(true);
                                                        await closeLottoRound(classId, selectedRound.id);
                                                        showFeedback("마감 처리했습니다.", "success");
                                                    } catch (e) {
                                                        openAlertModal(
                                                            "상태 변경 실패",
                                                            e?.message || "판매 상태 변경 중 오류가 발생했습니다.",
                                                        );
                                                    } finally {
                                                        setIsProcessing(false);
                                                    }
                                                }}
                                                disabled={isProcessing}
                                                icon={Square}
                                            >
                                                마감
                                            </Button>
                                        </>
                                    )}

                                    {selectedRound.status === "paused" && (
                                        <>
                                            <Button
                                                tone="emerald"
                                                onClick={() =>
                                                    setConfirmModal({
                                                        title: "판매 재개",
                                                        message: "일시 정지된 로또 회차 판매를 다시 시작할까요?",
                                                        confirmLabel: "판매 재개",
                                                        tone: "emerald",
                                                        action: { type: "resumeSales", roundId: selectedRound.id },
                                                    })
                                                }
                                                disabled={!!activeRound && activeRound.id !== selectedRound.id}
                                                icon={Play}
                                            >
                                                재개
                                            </Button>
                                            <Button
                                                tone="rose"
                                                onClick={async () => {
                                                    try {
                                                        setIsProcessing(true);
                                                        await closeLottoRound(classId, selectedRound.id);
                                                        showFeedback("마감 처리했습니다.", "success");
                                                    } catch (e) {
                                                        openAlertModal(
                                                            "상태 변경 실패",
                                                            e?.message || "판매 상태 변경 중 오류가 발생했습니다.",
                                                        );
                                                    } finally {
                                                        setIsProcessing(false);
                                                    }
                                                }}
                                                disabled={isProcessing}
                                                icon={Square}
                                            >
                                                마감
                                            </Button>
                                        </>
                                    )}

                                    {(selectedRound.status === "closed" || selectedRound.status === "finished") && (
                                        <>
                                            <Button
                                                tone={selectedRound.status === "finished" ? "amber" : "indigo"}
                                                onClick={() =>
                                                    selectedRound.status === "finished"
                                                        ? setConfirmModal({
                                                            title: "재추첨 실행",
                                                            message: "재추첨 시 이전에 지급된 당첨금과 상품은 회수되지 않습니다. 다시 당첨되면 보상이 한 번 더 지급될 수 있습니다. 계속할까요?",
                                                            confirmLabel: "자동 추첨",
                                                            tone: "amber",
                                                            action: { type: "startDraw", roundId: selectedRound.id },
                                                        })
                                                        : handleStartDraw(selectedRound.id)
                                                }
                                                icon={Trophy}
                                            >
                                                자동 추첨
                                            </Button>
                                            <Button
                                                tone="slate"
                                                kind="outline"
                                                onClick={() => openManualDrawModal(selectedRound)}
                                                disabled={isProcessing}
                                                icon={Pencil}
                                            >
                                                수동 추첨
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-6">
                                <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-100 shadow-inner text-center">
                                    <p className="text-xs font-black text-slate-400 uppercase mb-2">입장료</p>
                                    <p className="text-2xl font-black text-slate-800">
                                        {formatDisplayMoney(globalEntryPrice)} {currencyName}
                                    </p>
                                </div>

                                <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-100 shadow-inner text-center">
                                    <p className="text-xs font-black text-slate-400 uppercase mb-2">적용 수수료</p>
                                    <p className="text-2xl font-black text-slate-800">
                                        {formatDisplayMoney(Number(selectedRoundConfig?.feeAmount || 0))} {currencyName}
                                    </p>
                                </div>

                                <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-100 shadow-inner text-center">
                                    <p className="text-xs font-black text-slate-400 uppercase mb-2">숫자 범위</p>
                                    <p className="text-2xl font-black text-slate-800">
                                        1 ~ {selectedRound.settings.maxNumber}
                                    </p>
                                </div>

                                <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-100 shadow-inner text-center">
                                    <p className="text-xs font-black text-slate-400 uppercase mb-2">마감 일시</p>
                                    <p className="text-lg font-black text-slate-800 truncate">
                                        {selectedRound.settings.endTime
                                            ? new Date(selectedRound.settings.endTime).toLocaleString()
                                            : "미설정"}
                                    </p>
                                </div>
                            </div>

                            {/* 당첨 규칙 및 당첨자 명단 */}
                            <div className="rounded-[3rem] border border-indigo-100 bg-indigo-50/70 p-8">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-500">
                                            한 장 기준 평균
                                        </p>
                                        <h4 className="mt-1 text-2xl font-black text-slate-800">
                                            총 {formatMoney(selectedRoundSummary.totalCost)} 차감 시 평균{" "}
                                            {formatMoney(selectedRoundSummary.totalExpectedReturn)} 보상
                                        </h4>
                                        <p className="mt-2 text-sm font-semibold text-slate-600">
                                            {selectedRoundSummary.recommendation.description}
                                        </p>
                                    </div>
                                    <div className="rounded-full bg-white px-4 py-2 text-xs font-black text-indigo-600 shadow-sm">
                                        현재 성향: {selectedRoundSummary.recommendation.label}
                                    </div>
                                </div>

                                <div className="mt-5 grid gap-3 md:grid-cols-5">
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">총 차감</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatMoney(selectedRoundSummary.totalCost)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">평균 보상 가치</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatMoney(selectedRoundSummary.totalExpectedReturn)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">1회 평균 손익</p>
                                        <p
                                            className={`mt-1 text-xl font-black ${
                                                Number(selectedRoundSummary.expectedNet) >= 0 ? "text-emerald-600" : "text-rose-600"
                                            }`}
                                        >
                                            {selectedRoundSummary.expectedNet > 0 ? "+" : ""}
                                            {formatMoney(selectedRoundSummary.expectedNet)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">당첨 확률</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatPercent(selectedRoundSummary.totalWinRate)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                                        <p className="text-[11px] font-black text-slate-500">최대 보상 가치</p>
                                        <p className="mt-1 text-xl font-black text-slate-800">
                                            {formatMoney(selectedRoundSummary.maxPrizeValue)}
                                        </p>
                                    </div>
                                </div>

                                <p className="mt-4 text-xs font-semibold text-slate-500">
                                    실제 차감은 입장료 {formatMoney(selectedRoundSummary.entryPrice)}
                                    {Number(selectedRoundSummary.feeAmount || 0) > 0
                                        ? ` + 수수료 ${formatMoney(selectedRoundSummary.feeAmount)}`
                                        : ""}
                                    입니다. 아이템은 상점 가격 기준으로 돈처럼 합산합니다.
                                </p>
                            </div>

                            <div className="p-10 bg-slate-50 rounded-[4rem] border border-slate-200/60 shadow-inner relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12 scale-150">
                                    <Trophy size={100} className="text-slate-900" />
                                </div>

                                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 mb-8 flex items-center gap-2">
                                    <Sparkles size={14} className="text-amber-500" /> 회차 당첨 규칙 및 당첨자 명단
                                </h4>

                                <div className="space-y-4">
                                    {selectedRound.settings.prizes.map((p, i) => {
                                        const rankNumber = i + 1;
                                        const rankWinners = selectedRound.winners?.filter((w) => getLottoRankNumber(w.rank) === rankNumber) || [];
                                        return (
                                            <div
                                                key={i}
                                                className="flex flex-col p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md"
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] font-black text-indigo-500 uppercase bg-indigo-50 px-2 py-0.5 rounded-md">
                                                            {getConditionText(selectedRound.settings, i)}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-slate-400 italic">
                                                            (확률: {getProbPercent(selectedRound.settings, i)})
                                                        </span>
                                                    </div>

                                                    <div className="flex flex-col items-end">
                                                        <span className="text-xl font-black text-indigo-600">
                                                            {p.type === "money"
                                                                ? `${formatDisplayMoney(Number(p.amount))}${currencyName}`
                                                                : "상점 아이템"}
                                                        </span>

                                                        {selectedRound.status === "finished" && (
                                                            <span className="text-[10px] font-black text-slate-400 mt-1 bg-slate-100 px-2 py-0.5 rounded-full">
                                                                당첨자: {rankWinners.length}명
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <span className="text-lg font-black text-slate-800 mb-3">{p.label}</span>

                                                {selectedRound.status === "finished" && rankWinners.length > 0 && (
                                                    <div className="pt-3 border-t border-slate-50 flex flex-wrap gap-2">
                                                        {rankWinners.map((winner, wIdx) => (
                                                            <span
                                                                key={wIdx}
                                                                className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[11px] font-black shadow-sm"
                                                            >
                                                                {winner.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* --- 💤 CASE 3: 선택된 회차 없음 --- */
                        <div className="flex-1 flex flex-col items-center justify-center p-20 text-center space-y-6 animate-in fade-in zoom-in-95">
                            <div className="w-24 h-24 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center text-indigo-500 mb-2">
                                <LayoutGrid size={48} strokeWidth={1.5} />
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-2xl font-black text-slate-800">로또 센터에 오신 것을 환영합니다!</h3>
                                <p className="text-slate-400 font-bold max-w-sm leading-relaxed">
                                    아직 선택된 로또 회차가 없습니다. <br />
                                    새로운 판을 기획하거나, 지난 기록을 확인해보세요!
                                </p>
                            </div>

                            <Button size="md" tone="blue" kind="soft" onClick={() => setIsCreating(true)} icon={Plus} >
                                새 회차 기획 시작하기
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* 추첨 모달 연결 */}
            {showDrawModal && drawResult && (
                <LottoDrawModal
                    winningNumbers={drawResult.winningNumbers}
                    bonusNumber={drawResult.bonusNumber}
                    drawMode={drawResult.drawMode}
                    winners={drawResult.winners}
                    winnerCounts={drawResult.winnerCounts}
                    totalTickets={drawResult.totalTickets}
                    onOpenPopout={openDrawPopout}
                    onFinish={finishDrawPresentation}
                    onClose={closeDrawPresentation}
                />
            )}

            {showDrawPopout && (
                <PopoutWindow
                    isOpen={showDrawPopout}
                    title="복권 추첨"
                    windowName="finclass-lotto-draw"
                    providedWindow={drawPopoutWindow}
                    onClose={() => {
                        setShowDrawPopout(false);
                        setDrawPopoutWindow(null);
                    }}
                    onOpenFail={() => {
                        setShowDrawPopout(false);
                        setDrawPopoutWindow(null);
                        setShowDrawModal(true);
                        openAlertModal(
                            "팝업 차단",
                            "브라우저에서 팝업이 차단되어 기존 모달로 다시 표시했습니다.",
                        );
                    }}
                >
                    {drawResult ? (
                        <LottoDrawModal
                            winningNumbers={drawResult.winningNumbers}
                            bonusNumber={drawResult.bonusNumber}
                            drawMode={drawResult.drawMode}
                            winners={drawResult.winners}
                            winnerCounts={drawResult.winnerCounts}
                            totalTickets={drawResult.totalTickets}
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
                                    번호와 정산 결과를 불러오고 있습니다.
                                </p>
                            </div>
                        </div>
                    )}
                </PopoutWindow>
            )}

            {deadlineEditModal && (
                <Modal
                    isOpen={true}
                    onClose={() => {
                        if (!isProcessing) setDeadlineEditModal(null);
                    }}
                    size="sm"
                    closeOnOverlayClick={false}
                >
                    <Modal.Header>
                        <h3 className="text-lg font-black text-slate-800">마감일시 수정</h3>
                    </Modal.Header>
                    <Modal.Body className="space-y-4">
                        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-bold leading-relaxed text-amber-700">
                            진행 중인 회차는 마감일시만 수정할 수 있습니다. 숫자 범위, 보상, 회차 제목은 판매 시작 전 단계에서만 바꿀 수 있습니다.
                        </div>
                        <label className="block space-y-2">
                            <span className="text-xs font-black text-slate-500">회차</span>
                            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-800">
                                {deadlineEditModal.title}
                            </div>
                        </label>
                        <label className="block space-y-2">
                            <span className="text-xs font-black text-slate-500">자동 마감 일시</span>
                            <input
                                type="datetime-local"
                                value={deadlineEditModal.endTime}
                                onChange={(event) =>
                                    setDeadlineEditModal((prev) => ({
                                        ...prev,
                                        endTime: event.target.value,
                                    }))
                                }
                                className="h-12 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-black text-slate-800 outline-none transition focus:border-indigo-200 focus:ring-2 focus:ring-blue-500/20"
                                disabled={isProcessing}
                            />
                        </label>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button tone="slate" kind="ghost" onClick={() => setDeadlineEditModal(null)} disabled={isProcessing}>
                            취소
                        </Button>
                        <Button tone="blue" onClick={handleSaveDeadline} isLoading={isProcessing} disabled={isProcessing}>
                            저장
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}

            {showBuyerModal && selectedRound && (
                <Modal
                    isOpen={true}
                    onClose={() => setShowBuyerModal(false)}
                    size="xl"
                    closeOnOverlayClick={false}
                >
                    <Modal.Header>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-100">
                                    <Users size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-800">복권 구매자 확인</h3>
                                    <p className="mt-1 text-xs font-semibold text-slate-400">
                                        {selectedRound.title} · 총 {visibleRoundTickets.length}장 / {buyerRows.length}명
                                    </p>
                                </div>
                            </div>
                        </div>
                    </Modal.Header>
                    <Modal.Body className="max-h-[65vh] space-y-4 overflow-y-auto">
                        <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                <div className="min-w-0 flex-1">
                                    <StudentSelector
                                        label="학생별 보기"
                                        selectedUids={buyerFilterUids}
                                        onChange={(uids) => setBuyerFilterUids(uids.slice(0, 1))}
                                        singleSelect
                                        multiple={false}
                                        allowGroupSelect={false}
                                        dropdownAbsolute
                                    />
                                </div>
                                <Button size="md"
                                    tone={buyerFilterUids.length ? "indigo" : "slate"}
                                    kind={buyerFilterUids.length ? "soft" : "outline"}
                                    onClick={() => setBuyerFilterUids([])}
                                    className="shrink-0"
                                >
                                    전체 보기
                                </Button>
                            </div>
                            <p className="mt-3 text-[11px] font-semibold text-slate-400">
                                {buyerFilterUids.length
                                    ? selectedBuyerHasTickets
                                        ? "선택한 학생의 구매 내역만 보고 있습니다."
                                        : "선택한 학생의 구매 내역이 없습니다."
                                    : "전체 구매자를 한 번에 보고 있습니다."}
                            </p>
                        </div>
                        {buyerRows.length === 0 ? (
                            <div className="rounded-[2rem] border-2 border-dashed border-slate-100 bg-slate-50 py-14 text-center">
                                <Ticket size={40} className="mx-auto mb-3 text-slate-200" />
                                <p className="text-sm font-black text-slate-400">아직 구매한 학생이 없습니다.</p>
                            </div>
                        ) : visibleBuyerRows.length === 0 ? (
                            <div className="rounded-[2rem] border-2 border-dashed border-slate-100 bg-white py-12 text-center">
                                <Users size={36} className="mx-auto mb-3 text-slate-200" />
                                <p className="text-sm font-black text-slate-400">선택한 학생의 구매 내역이 없습니다.</p>
                            </div>
                        ) : (
                            visibleBuyerRows.map((buyer) => (
                                <div
                                    key={buyer.uid}
                                    className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm"
                                >
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-base font-black text-slate-800">{buyer.name}</p>
                                        </div>
                                        <Badge tone="indigo" size="sm">
                                            {buyer.count}장 구매
                                        </Badge>
                                    </div>
                                    <div className="space-y-2">
                                        {buyer.tickets.map((ticket) => {
                                            const purchasedAt = toDateSafe(ticket.purchasedAt);
                                            return (
                                                <div
                                                    key={ticket.id}
                                                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3"
                                                >
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {(ticket.numbers || []).map((numberValue) => (
                                                            <span
                                                                key={`${ticket.id}-${numberValue}`}
                                                                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-black text-slate-700 shadow-sm"
                                                            >
                                                                {numberValue}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-right text-[11px] font-bold text-slate-400">
                                                            <p>{ticket.paymentType === "ticket" ? "티켓" : "현금"} 결제</p>
                                                            <p>{purchasedAt ? purchasedAt.toLocaleString() : "구매 시간 없음"}</p>
                                                        </div>
                                                        {isSelectedRoundRefundable && String(ticket.status || "active") === "active" ? (
                                                            <Button
                                                                size="xs"
                                                                tone="rose"
                                                                kind="soft"
                                                                icon={RotateCcw}
                                                                onClick={() => handleRefundTicket(ticket)}
                                                                disabled={isProcessing}
                                                                className="shrink-0"
                                                            >
                                                                환불
                                                            </Button>
                                                        ) : (
                                                            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-400">
                                                                환불 마감
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button tone="slate" kind="ghost" onClick={() => setShowBuyerModal(false)}>
                            닫기
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}

            {showWinnerModal && selectedRound && (
                <Modal
                    isOpen={true}
                    onClose={() => setShowWinnerModal(false)}
                    size="xl"
                    closeOnOverlayClick={false}
                >
                    <Modal.Header>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-100">
                                    <Trophy size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-800">복권 당첨자 확인</h3>
                                    <p className="mt-1 text-xs font-semibold text-slate-400">
                                        {selectedRound.title} · 총 {totalWinnerCount}명
                                    </p>
                                </div>
                            </div>
                        </div>
                    </Modal.Header>
                    <Modal.Body className="max-h-[65vh] space-y-4 overflow-y-auto">
                        {selectedRound.status !== "finished" ? (
                            <div className="rounded-[2rem] border-2 border-dashed border-slate-100 bg-slate-50 py-14 text-center">
                                <Trophy size={40} className="mx-auto mb-3 text-slate-200" />
                                <p className="text-sm font-black text-slate-400">추첨 완료 후 당첨자를 확인할 수 있습니다.</p>
                            </div>
                        ) : winnerRows.length === 0 ? (
                            <div className="rounded-[2rem] border-2 border-dashed border-slate-100 bg-slate-50 py-14 text-center">
                                <Trophy size={40} className="mx-auto mb-3 text-slate-200" />
                                <p className="text-sm font-black text-slate-400">이번 회차는 당첨자가 없습니다.</p>
                            </div>
                        ) : (
                            winnerRows.map((row) => (
                                <div
                                    key={row.rankLabel}
                                    className="rounded-[2rem] border border-amber-100 bg-white p-5 shadow-sm"
                                >
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-base font-black text-slate-800">{row.rankLabel}</p>
                                            <p className="mt-1 text-xs font-semibold text-slate-400">
                                                {row.winners.length}명 당첨
                                            </p>
                                        </div>
                                        <Badge tone="amber" size="sm">
                                            {row.winners.length}명
                                        </Badge>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {row.winners.map((winner, index) => (
                                            <div
                                                key={`${winner.uid || winner.name || "winner"}-${index}`}
                                                className="rounded-2xl bg-amber-50 px-4 py-3"
                                            >
                                                <p className="text-sm font-black text-slate-800">
                                                    {winner.name || "학생"}
                                                </p>
                                                <p className="mt-1 text-[11px] font-bold text-amber-700">
                                                    {winner.prizeLabel || "보상"}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button tone="slate" kind="ghost" onClick={() => setShowWinnerModal(false)}>
                            닫기
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}

            {showManualDrawModal && selectedRound && (
                <Modal
                    isOpen={true}
                    onClose={() => {
                        if (!isProcessing) closeManualDrawModal();
                    }}
                    size="xl"
                    closeOnOverlayClick={false}
                >
                    <Modal.Header>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-black text-slate-800">수동 추첨</h3>
                                <p className="mt-1 text-xs font-semibold text-slate-400">
                                    학생 구매 화면처럼 번호를 눌러서 당첨 번호를 직접 선택하세요.
                                </p>
                            </div>
                            <Button
                                size="xs"
                                kind="ghost"
                                tone="slate"
                                onClick={resetManualDrawSelection}
                                disabled={isProcessing}
                            >
                                전체 지우기
                            </Button>
                        </div>
                    </Modal.Header>
                    <Modal.Body className="space-y-5">
                        <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs font-black text-slate-700">당첨 번호</p>
                                    <p className="mt-1 text-[11px] font-semibold text-slate-400">
                                        {manualWinningNumbers.length} / {manualPickCount}개 선택
                                    </p>
                                </div>
                                {manualUsesBonus && (
                                    <div className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-black text-amber-700">
                                        보너스 번호 {manualBonusNumber ?? "미선택"}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                {Array.from({ length: manualPickCount }).map((_, index) => (
                                    <div
                                        key={`manual-winning-${index}`}
                                        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-black transition-all ${
                                            manualWinningNumbers[index]
                                                ? "scale-105 border-rose-400 bg-rose-500 text-white shadow-md"
                                                : "border-dashed border-slate-200 bg-white text-slate-300"
                                        }`}
                                    >
                                        {manualWinningNumbers[index] || ""}
                                    </div>
                                ))}

                                {manualUsesBonus && (
                                    <>
                                        <div className="px-1 text-lg font-black text-slate-300">+</div>
                                        <div
                                            className={`flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 transition-all ${
                                                manualBonusNumber
                                                    ? "border-amber-300 bg-amber-400 text-white shadow-md"
                                                    : "border-dashed border-slate-200 bg-white text-slate-300"
                                            }`}
                                        >
                                            <span className="text-[7px] font-black leading-none opacity-80">
                                                보너스
                                            </span>
                                            <span className="text-sm font-black">
                                                {manualBonusNumber || ""}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {manualUsesBonus && (
                            <div className="grid grid-cols-2 gap-2 rounded-[1.6rem] border border-slate-100 bg-white p-2">
                                <Button
                                    type="button"
                                    onClick={() => setManualSelectionMode("winning")}
                                    className={`rounded-[1.2rem] px-4 py-3 text-sm font-black transition ${
                                        manualSelectionMode === "winning"
                                            ? "bg-rose-500 text-white shadow-sm"
                                            : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                                    }`}
                                >
                                    당첨 번호 선택
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => setManualSelectionMode("bonus")}
                                    className={`rounded-[1.2rem] px-4 py-3 text-sm font-black transition ${
                                        manualSelectionMode === "bonus"
                                            ? "bg-amber-400 text-white shadow-sm"
                                            : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                                    }`}
                                >
                                    보너스 번호 선택
                                </Button>
                            </div>
                        )}

                        <div className="rounded-[2rem] border border-indigo-100 bg-indigo-50/70 p-5">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-xs font-black text-indigo-700">
                                        {manualSelectionMode === "bonus" && manualUsesBonus
                                            ? "보너스 번호를 1개 선택하세요."
                                            : `당첨 번호 ${manualPickCount}개를 선택하세요.`}
                                    </p>
                                    <p className="mt-1 text-[11px] font-semibold text-indigo-400">
                                        이미 선택된 번호를 다시 누르면 해제됩니다.
                                    </p>
                                </div>
                                <div className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-indigo-600 shadow-sm">
                                    1 ~ {manualMaxNumber}
                                </div>
                            </div>

                            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
                                {manualNumberOptions.map((numberValue) => {
                                    const isWinningSelected = manualWinningNumbers.includes(numberValue);
                                    const isBonusSelected = manualBonusNumber === numberValue;

                                    return (
                                        <Button
                                            key={`manual-number-${numberValue}`}
                                            type="button"
                                            onClick={() => handleManualNumberSelect(numberValue)}
                                            className={`flex h-11 items-center justify-center rounded-2xl border text-sm font-black transition ${
                                                isWinningSelected
                                                    ? "border-rose-300 bg-rose-500 text-white shadow-sm"
                                                    : isBonusSelected
                                                        ? "border-amber-300 bg-amber-400 text-white shadow-sm"
                                                        : "border-white bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-600"
                                            }`}
                                        >
                                            {numberValue}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button tone="slate" kind="ghost" onClick={closeManualDrawModal} disabled={isProcessing}>
                            취소
                        </Button>
                        <Button
                            tone="blue"
                            onClick={handleSubmitManualDraw}
                            isLoading={isProcessing}
                            disabled={isProcessing}
                        >
                            결과 반영
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}

            {confirmModal && (
                <Modal
                    isOpen={true}
                    onClose={() => {
                        if (!isProcessing) setConfirmModal(null);
                    }}
                    size="sm"
                    closeOnOverlayClick={false}
                >
                    <Modal.Header>
                        <h3 className="text-lg font-black text-slate-800">{confirmModal.title}</h3>
                    </Modal.Header>
                    <Modal.Body>
                        <p className="text-sm text-slate-600 font-bold whitespace-pre-line">{confirmModal.message}</p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button tone="slate" kind="ghost" onClick={() => setConfirmModal(null)} disabled={isProcessing}>
                            취소
                        </Button>
                        <Button
                            tone={confirmModal.tone || "indigo"}
                            onClick={executeConfirmedAction}
                            isLoading={isProcessing}
                            disabled={isProcessing}
                        >
                            {confirmModal.confirmLabel || "확인"}
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}

            {alertModal && (
                <Modal
                    isOpen={true}
                    onClose={() => setAlertModal(null)}
                    size="sm"
                    closeOnOverlayClick={false}
                >
                    <Modal.Header>
                        <h3 className="text-lg font-black text-slate-800">{alertModal.title}</h3>
                    </Modal.Header>
                    <Modal.Body>
                        <p className="text-sm text-slate-600 font-bold whitespace-pre-line">{alertModal.message}</p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button tone="blue" onClick={() => setAlertModal(null)}>
                            확인
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}
        </Modal>
    );
};

export default LottoManagementCenter;

