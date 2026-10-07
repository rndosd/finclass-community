import { useNumberFormat } from "../../../../contexts/NumberFormatContext";
import React, { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { Crown, Medal, Sparkles, Trophy, X } from "lucide-react";
import { Button, IconButton, Modal, Spinner } from "../../../../components/ui";
import { useUser } from "../../../../contexts/UserContext";
import {
    getDonationLeaderboardQuery,
    mapDonationLeaderboardSnapshot,
} from "../../services/donationLeaderboard";
import { beginFirestoreSubscriptionDebug } from "../../../../utils/firestoreSubscriptionDebug";

const podiumTone = {
    1: "from-amber-200 via-yellow-100 to-amber-300 shadow-amber-200/70",
    2: "from-slate-200 via-white to-slate-200 shadow-slate-200/80",
    3: "from-orange-200 via-amber-100 to-orange-300 shadow-orange-200/80",
};

const rankBadgeTone = {
    1: "bg-amber-100 text-amber-700 border-amber-200",
    2: "bg-slate-100 text-slate-700 border-slate-200",
    3: "bg-orange-100 text-orange-700 border-orange-200",
};

const DonationLeaderboardModal = ({ isOpen, onClose, classId }) => {
    const { formatClassCurrency } = useNumberFormat();
    const { userData, classData } = useUser();
    const currencyUnit = classData?.currencyUnit || "원";
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState([]);

    useEffect(() => {
        if (!isOpen || !classId) return undefined;

        setLoading(true);
        const leaderboardQuery = getDonationLeaderboardQuery(classId);
        const subscriptionDebug = beginFirestoreSubscriptionDebug({
            source: "DonationLeaderboardModal",
            pathKey: "classes/{classId}/donationLeaderboard",
            classId,
            role: userData?.role,
        });

        const unsubscribe = onSnapshot(
            leaderboardQuery,
            (snapshot) => {
                subscriptionDebug.recordSnapshot(snapshot);
                setRows(mapDonationLeaderboardSnapshot(snapshot));
                setLoading(false);
            },
            (error) => {
                subscriptionDebug.recordError(error);
                console.error("[DonationLeaderboardModal] leaderboard listen error:", error);
                setRows([]);
                setLoading(false);
            },
        );

        return () => {
            unsubscribe();
            subscriptionDebug.stop();
        };
    }, [classId, isOpen, userData?.role]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" showDefaultCloseButton={false}>
            <Modal.Header className="border-b-0 bg-gradient-to-br from-amber-50 via-white to-rose-50 px-5 py-5 sm:px-7">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold text-amber-700">
                            <Trophy className="h-3.5 w-3.5" />
                            기부 순위
                        </div>
                        <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
                            우리 반 따뜻한 마음 랭킹
                        </h2>
                        <p className="mt-2 text-sm text-slate-600">
                            누가 얼마나 꾸준히 기부했는지 한눈에 볼 수 있어요.
                        </p>
                    </div>
                    <IconButton
                        icon={X}
                        label="닫기"
                        onClick={onClose}
                        tone="slate"
                        size="lg"
                        className="rounded-full border border-white/80 bg-white/80 p-2 text-slate-400 transition hover:text-slate-700"
                    />
                </div>
            </Modal.Header>

            <Modal.Body className="space-y-4 px-4 py-4 sm:px-7 sm:py-6">
                <div className="grid gap-3 rounded-[2rem] border border-amber-100 bg-gradient-to-r from-amber-50 via-white to-rose-50 p-4 shadow-[0_24px_60px_-32px_rgba(251,113,133,0.25)] sm:grid-cols-[1.2fr_0.8fr]">
                    <div>
                        <p className="text-xs font-semibold tracking-[0.2em] text-amber-600">
                            실시간 현황
                        </p>
                        <p className="mt-2 text-lg font-bold text-slate-800">
                            실시간 누적 기부 금액 기준
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                            기부 횟수도 함께 보여 주고, 내 이름은 더 또렷하게 강조됩니다.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <SummaryMiniCard
                            label="참여 인원"
                            value={`${rows.length}명`}
                            icon={Sparkles}
                        />
                        <SummaryMiniCard
                            label="내 순위"
                            value={
                                rows.find((row) => row.uid === userData?.uid)?.rank
                                    ? `${rows.find((row) => row.uid === userData?.uid)?.rank}위`
                                    : "-"
                            }
                            icon={Crown}
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="flex h-56 items-center justify-center rounded-[2rem] border border-slate-200 bg-slate-50">
                        <Spinner size="lg" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
                        아직 집계된 기부 순위가 없습니다.
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="grid gap-3 md:grid-cols-3">
                            {rows.slice(0, 3).map((row) => (
                                <div
                                    key={row.uid}
                                    className={`rounded-[2rem] bg-gradient-to-br p-[1px] shadow-lg ${podiumTone[row.rank]}`}
                                >
                                    <div className="h-full rounded-[calc(2rem-1px)] bg-white/90 p-5 backdrop-blur">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-black tracking-[0.2em] text-slate-500">
                                                상위 {row.rank}
                                            </span>
                                            <Medal className="h-5 w-5 text-amber-400" />
                                        </div>
                                        <p className="mt-4 truncate text-lg font-black text-slate-800">
                                            {row.name}
                                        </p>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {row.count}회 기부
                                        </p>
                                        <p className="mt-6 text-2xl font-black tracking-tight text-slate-800">
                                            {formatClassCurrency(row.total)}
                                            <span className="ml-1 text-sm font-semibold text-slate-500">
                                                {currencyUnit}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white">
                            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 text-xs font-semibold tracking-[0.2em] text-slate-500">
                                전체 순위
                            </div>
                            <div className="max-h-[48vh] overflow-y-auto">
                                {rows.map((row) => {
                                    const isMe = row.uid === userData?.uid;
                                    return (
                                        <div
                                            key={row.uid}
                                            className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition ${
                                                isMe
                                                    ? "bg-rose-50/80"
                                                    : "border-t border-slate-100 first:border-t-0"
                                            }`}
                                        >
                                            <div
                                                className={`inline-flex min-w-[3rem] items-center justify-center rounded-full border px-3 py-1 text-sm font-black ${
                                                    rankBadgeTone[row.rank] ||
                                                    "border-slate-200 bg-slate-50 text-slate-700"
                                                }`}
                                            >
                                                {row.rank}위
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-bold text-slate-800">
                                                    {row.name}
                                                    {isMe ? (
                                                        <span className="ml-2 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                                                            나
                                                        </span>
                                                    ) : null}
                                                </p>
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    총 {row.count}회 기부
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-black text-slate-700">
                                                    {formatClassCurrency(row.total)}
                                                    <span className="ml-1 text-xs font-semibold text-slate-500">
                                                        {currencyUnit}
                                                    </span>
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </Modal.Body>

            <Modal.Footer className="bg-white px-4 py-4 sm:px-7">
                <Button onClick={onClose} variant="secondary" tone="slate" className="w-full sm:w-auto">
                    닫기
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

const SummaryMiniCard = ({ label, value, icon: Icon }) => (
    <div className="rounded-2xl border border-white bg-white/90 p-3 shadow-sm">
        <div className="flex items-center gap-2 text-slate-500">
            <Icon className="h-4 w-4" />
            <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="mt-3 text-xl font-black tracking-tight text-slate-800">{value}</p>
    </div>
);

export default DonationLeaderboardModal;
