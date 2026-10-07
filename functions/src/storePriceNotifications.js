const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("../firebaseAdminCompat");
const { createNotificationsForUsers } = require("../utils/notificationUtils");

const FieldValue = admin.firestore.FieldValue;
const STORE_ITEM_DOCUMENT_PATH = "classes/{classId}/storeItems/{itemId}";
const KST_TIME_ZONE = "Asia/Seoul";

const toSafeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const isStudentRole = (role) => role !== "teacher" && role !== "admin";

const isStoreItemVisibleToStudents = (item = {}) => {
    const saleStatus = String(item?.saleStatus || "").trim();
    if (saleStatus === "hidden") return false;
    if (typeof item?.isActive === "boolean") return item.isActive;
    return true;
};

const formatPrice = (value) => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric.toLocaleString("ko-KR") : "0";
};

const computePriceChangePercent = (basePrice, currentPrice) => {
    if (!Number.isFinite(basePrice) || basePrice <= 0 || !Number.isFinite(currentPrice)) {
        return null;
    }

    const rawPercent = ((currentPrice - basePrice) / basePrice) * 100;
    if (!Number.isFinite(rawPercent) || rawPercent === 0) return null;

    return Math.round(rawPercent * 10) / 10;
};

const getTodayKeyInKst = () => {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: KST_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    return formatter.format(new Date());
};

const buildPriceChangeMessage = ({
    itemName,
    afterPrice,
    snapshotPercent,
}) => {
    const safeName = String(itemName || "상점 상품").trim() || "상점 상품";
    const currentPriceText = `현재 ${formatPrice(afterPrice)}원`;

    if (!Number.isFinite(snapshotPercent) || snapshotPercent === 0) {
        return `${safeName} 가격이 변경됐습니다. ${currentPriceText}`;
    }

    const directionText = snapshotPercent > 0 ? "▲" : "▼";
    return `${safeName} ${currentPriceText} · 오늘 기준 ${directionText}${Math.abs(snapshotPercent).toFixed(1)}%`;
};

exports.notifyStorePriceChanged = onDocumentUpdated(
    {
        document: STORE_ITEM_DOCUMENT_PATH,
        region: "asia-northeast3",
    },
    async (event) => {
        const beforeData = event.data?.before?.data() || {};
        const afterData = event.data?.after?.data() || {};
        const { classId, itemId } = event.params;

        if (!classId || !itemId) return;

        const beforePrice = toSafeNumber(beforeData.price);
        const afterPrice = toSafeNumber(afterData.price);
        if (!Number.isFinite(beforePrice) || !Number.isFinite(afterPrice)) return;
        if (beforePrice === afterPrice) return;
        if (!isStoreItemVisibleToStudents(afterData)) return;

        const priceChangePercent = computePriceChangePercent(beforePrice, afterPrice);
        const priceChangeDirection = afterPrice > beforePrice ? "up" : "down";
        const categoryId = String(afterData.categoryId || "").trim();
        const todayKey = getTodayKeyInKst();

        let snapshotBasePrice = null;
        let snapshotPriceChangePercent = null;

        try {
            const snapshotDoc = await admin
                .firestore()
                .doc(`classes/${classId}/storePriceSnapshots/${todayKey}`)
                .get();

            if (snapshotDoc.exists) {
                const prices = snapshotDoc.data()?.prices || {};
                snapshotBasePrice = toSafeNumber(prices[itemId]);
                snapshotPriceChangePercent = computePriceChangePercent(
                    snapshotBasePrice,
                    afterPrice,
                );
            }
        } catch (error) {
            console.error("Failed to load store snapshot for notification:", error);
        }

        await event.data.after.ref.set(
            {
                previousPrice: beforePrice,
                lastPriceChangePercent: priceChangePercent,
                lastPriceChangeDirection: priceChangeDirection,
                lastPriceChangeAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        // VIP products must never be named in a class-wide price notification.
        // Check both categories when a price and category change happen together.
        const categoryIds = [...new Set([
            beforeData.categoryId,
            afterData.categoryId,
        ].map((id) => String(id || "").trim()).filter(Boolean))];
        if (!categoryIds.length) return;

        const categoryDocs = await Promise.all(categoryIds.map((id) => admin
            .firestore()
            .doc(`classes/${classId}/storeCategories/${id}`)
            .get()));
        if (categoryDocs.some((categoryDoc) => {
            if (!categoryDoc.exists) return true;
            const category = categoryDoc.data() || {};
            return [category.type, category.categoryType]
                .some((type) => String(type || "").trim() === "vip");
        })) return;

        const studentsSnap = await admin
            .firestore()
            .collection("classes")
            .doc(classId)
            .collection("students")
            .get();

        const recipients = studentsSnap.docs
            .filter((studentDoc) => isStudentRole(studentDoc.data()?.role))
            .map((studentDoc) => studentDoc.id);

        if (!recipients.length) return;

        const itemName = String(afterData.name || beforeData.name || "").trim();
        await createNotificationsForUsers(classId, recipients, {
            title: itemName || "상점 가격 변동",
            message: buildPriceChangeMessage({
                itemName,
                afterPrice,
                snapshotPercent: snapshotPriceChangePercent,
            }),
            type: "store_price_changed",
            path: "/store",
            priority: "medium",
            categoryId,
            itemId,
            metadata: {
                itemId,
                categoryId,
                beforePrice,
                afterPrice,
                priceChangePercent,
                priceChangeDirection,
                snapshotBasePrice,
                snapshotPriceChangePercent,
            },
        });
    },
);
