import { collection, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../../firebase";

export const DONATION_LEADERBOARD_LIMIT = 50;

export const getDonationLeaderboardQuery = (
    classId,
    maxItems = DONATION_LEADERBOARD_LIMIT,
) =>
    query(
        collection(db, `classes/${classId}/donationStats`),
        orderBy("total", "desc"),
        limit(maxItems),
    );

export const mapDonationLeaderboardSnapshot = (snapshot) =>
    snapshot.docs.map((docSnapshot, index) => {
        const data = docSnapshot.data() || {};
        return {
            rank: index + 1,
            uid: docSnapshot.id,
            name: data.name || "이름 없음",
            total: Number(data.total || 0),
            count: Number(data.count || 0),
        };
    });
