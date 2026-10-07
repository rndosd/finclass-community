import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../../firebase";

// 🚀 [조회] 회차 목록 (관리자용)
export const useLotteryRounds = (classId, productId) => {
    return useQuery({
        queryKey: ["lotteryRounds", classId, productId],
        queryFn: async () => {
            if (!classId || !productId) return [];
            const colRef = collection(db, `classes/${classId}/lotteryRounds`);
            const q = query(colRef, where("productId", "==", productId), orderBy("roundNumber", "desc"));
            const snap = await getDocs(q);

            return snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                scheduledDate: doc.data().scheduledDate?.toDate(),
                eligibilityDate: doc.data().eligibilityDate?.toDate(),
                lotteryDate: doc.data().lotteryDate?.toDate(),
            }));
        },
        enabled: !!classId && !!productId,
    });
};

// 🚀 [조회] 현재 회차의 참여 자격자 명단
export const useEligibleParticipantsQuery = (classId, productId, round) => {
    return useQuery({
        queryKey: ["eligibleParticipants", classId, productId, round?.id],
        queryFn: async () => {
            if (!classId || !productId || !round) return [];
            // 이미 완료된 회차라면 당시 당첨자/참여자 데이터를 쓰면 되므로 굳이 계산하지 않음
            if (round.status === 'completed') return round.winners || [];

            const fn = httpsCallable(functions, "getLotteryEligibleParticipants");
            const res = await fn({
                classId,
                productId,
                requiredPayments: round.requiredPayments,
                eligibilityDate: round.eligibilityDate instanceof Date
                    ? round.eligibilityDate.toISOString()
                    : round.eligibilityDate || null,
            });
            return res.data?.participants || [];
        },
        enabled: !!classId && !!productId && !!round,
    });
};