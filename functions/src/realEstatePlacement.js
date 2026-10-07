"use strict";

const admin = require("../firebaseAdminCompat");
const { randomUUID, createHash } = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { canManagePlacement, validatePlacement, withSeatNumbers, overlaps, canHideDesk, getDeskDisplayScaleUpdate } = require("../utils/realEstatePlacement");
const { mergeAssignments, buildGrouping, validateConstraints } = require("../utils/realEstateAssignment");

const db = admin.firestore();
const { readRealEstateLayout, stageRealEstateLayout, runRealEstateTransaction } = require("../utils/realEstateStorage");
const requestHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

exports.setRealEstateSeatActive = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, deskId, isActive } = request.data || {};
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (typeof classId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(classId) ||
        !canManagePlacement(request.auth.token || {}, classId)) {
        throw new HttpsError("permission-denied", "자리 관리 권한이 없습니다.");
    }
    if (typeof deskId !== "string" || deskId.length > 128 || typeof isActive !== "boolean") {
        throw new HttpsError("invalid-argument", "자리 정보가 올바르지 않습니다.");
    }
    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const placementRef = db.doc(`classes/${classId}/real_estate/placement`);
    return runRealEstateTransaction(db, async (transaction) => {
        const [layoutSnap, placementSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction), transaction.get(placementRef),
        ]);
        if (!layoutSnap.exists) throw new HttpsError("not-found", "교실 배치가 없습니다.");
        const current = layoutSnap.data();
        const desks = (current.groups || []).flatMap((group) => group.desks || []);
        const desk = desks.find((item) => item.id === deskId);
        if (!desk) throw new HttpsError("not-found", "책상을 찾을 수 없습니다.");
        if ((desk.isActive !== false) === isActive) return { isActive };
        if (!isActive) {
            if (!canHideDesk(desk)) {
                throw new HttpsError("failed-precondition", "소유권·계약·보증금 또는 학생 배정이 있는 책상은 숨길 수 없습니다.");
            }
            const auctionQuery = db.collection(`classes/${classId}/real_estate_auctions`)
                .where("deskId", "==", deskId);
            const auctionSnap = await transaction.get(auctionQuery);
            if (auctionSnap.docs.some((item) => ["active", "queued"].includes(item.data().status))) {
                throw new HttpsError("failed-precondition", "진행 중인 경매가 있는 책상은 숨길 수 없습니다.");
            }
        } else {
            const placements = placementSnap.data()?.seats || [];
            const target = placements.find((seat) => seat.id === deskId);
            if (target && placements.some((seat) => seat.id !== deskId &&
                desks.some((item) => item.id === seat.id && item.isActive !== false) &&
                overlaps(target, seat))) {
                throw new HttpsError("failed-precondition", "현재 위치가 다른 책상과 겹칩니다. 배치를 조정한 뒤 복구해 주세요.");
            }
        }
        const groups = current.groups.map((group) => ({
            ...group,
            desks: group.desks.map((item) => item.id === deskId ? { ...item, isActive } : item),
        }));
        stageRealEstateLayout(transaction, layoutRef, {
            groups, updatedAt: new Date().toISOString(),
            editorRevision: (Number(current.editorRevision) || 0) + 1,
        });
        return { isActive };
    });
});

exports.saveRealEstateAssignments = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, groups, constraints, expectedRevision, requestId } = request.data || {};
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (typeof classId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(classId) ||
        !canManagePlacement(request.auth.token || {}, classId)) {
        throw new HttpsError("permission-denied", "자리 관리 권한이 없습니다.");
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 ||
        typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId) ||
        !Array.isArray(groups) || groups.length > 300 ||
        !constraints || typeof constraints !== "object" || Array.isArray(constraints) ||
        JSON.stringify({ groups, constraints }).length > 800000) {
        throw new HttpsError("invalid-argument", "저장할 자리 정보가 올바르지 않습니다.");
    }
    const payloadHash = requestHash({ groups, constraints });
    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const groupingRef = db.doc(`classes/${classId}/real_estate/grouping`);
    return runRealEstateTransaction(db, async (transaction) => {
        const snap = await readRealEstateLayout(db, layoutRef, transaction);
        if (!snap.exists) throw new HttpsError("not-found", "교실 배치가 없습니다.");
        const current = snap.data();
        const revision = Number(current.editorRevision) || 0;
        if (current.lastEditorRequestId === requestId) {
            if (current.lastEditorRequestHash !== payloadHash) {
                throw new HttpsError("invalid-argument", "같은 요청 식별값에 다른 내용이 포함되었습니다.");
            }
            return { revision };
        }
        if (revision !== expectedRevision) {
            throw new HttpsError("aborted", "다른 관리자가 좌석 배정을 수정했습니다. 화면을 새로고침한 뒤 다시 확인해 주세요.");
        }
        let nextGroups;
        let safeConstraints;
        try {
            nextGroups = mergeAssignments(current.groups, groups);
            safeConstraints = validateConstraints(constraints);
        } catch (error) {
            throw new HttpsError("failed-precondition", error.message);
        }
        const updatedAt = new Date().toISOString();
        stageRealEstateLayout(transaction, layoutRef, {
            groups: nextGroups, constraints: safeConstraints, updatedAt,
            editorRevision: revision + 1, lastEditorRequestId: requestId,
            lastEditorRequestHash: payloadHash,
        });
        transaction.set(groupingRef, buildGrouping(nextGroups, updatedAt));
        return { revision: revision + 1 };
    });
});

exports.saveRealEstatePlacement = onCall({ region: "asia-northeast3" }, async (request) => {
    const classId = request.data?.classId;
    const seats = request.data?.seats;
    const expectedRevision = request.data?.expectedRevision;
    const requestId = request.data?.requestId;
    const labels = request.data?.labels || {};
    const token = request.auth?.token || {};
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (typeof classId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(classId)) {
        throw new HttpsError("invalid-argument", "학급 정보가 올바르지 않습니다.");
    }
    if (!canManagePlacement(token, classId)) {
        throw new HttpsError("permission-denied", "배치 관리 권한이 없습니다.");
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new HttpsError("invalid-argument", "배치 버전이 올바르지 않습니다.");
    }
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
        throw new HttpsError("invalid-argument", "저장 요청 식별값이 올바르지 않습니다.");
    }
    if (!labels || Array.isArray(labels) || typeof labels !== "object" ||
        Object.keys(labels).length > 300 ||
        Object.values(labels).some((label) => typeof label !== "string" || label.length > 40)) {
        throw new HttpsError("invalid-argument", "자리 이름 형식이 올바르지 않습니다.");
    }
    const payloadHash = requestHash({ seats, labels });

    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const placementRef = db.doc(`classes/${classId}/real_estate/placement`);
    return runRealEstateTransaction(db, async (transaction) => {
        const [layoutSnap, placementSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction), transaction.get(placementRef),
        ]);
        if (!layoutSnap.exists) throw new HttpsError("not-found", "교실 배치가 없습니다.");
        const currentRevision = Number(placementSnap.data()?.revision) || 0;
        if (placementSnap.data()?.lastRequestId === requestId) {
            if (placementSnap.data()?.lastRequestHash !== payloadHash) {
                throw new HttpsError("invalid-argument", "같은 요청 식별값에 다른 내용이 포함되었습니다.");
            }
            return { revision: currentRevision };
        }
        let validated;
        try {
            validated = validatePlacement(seats, layoutSnap.data()?.groups);
        } catch (error) {
            throw new HttpsError("invalid-argument", error.message);
        }
        if (currentRevision !== expectedRevision) {
            throw new HttpsError("aborted", "다른 관리자가 배치를 수정했습니다. 화면을 새로고침한 후 다시 확인해 주세요.");
        }
        const currentLayout = layoutSnap.data();
        const nextGroups = withSeatNumbers(currentLayout.groups, validated);
        const knownIds = new Set(nextGroups.flatMap((group) => group.desks.map((desk) => desk.id)));
        if (Object.keys(labels).some((id) => !knownIds.has(id))) {
            throw new HttpsError("invalid-argument", "이름을 변경할 자리를 찾을 수 없습니다.");
        }
        const labeledGroups = nextGroups.map((group) => ({
            ...group,
            desks: group.desks.map((desk) => Object.prototype.hasOwnProperty.call(labels, desk.id)
                ? { ...desk, label: labels[desk.id].trim() } : desk),
        }));
        const nextRevision = currentRevision + 1;
        stageRealEstateLayout(transaction, layoutRef, {
            groups: labeledGroups,
            updatedAt: new Date().toISOString(),
        });
        transaction.set(placementRef, {
            version: 2,
            coordinateSystem: "legacy-grid-center",
            geometry: { seatWidth: 2, seatHeight: 2 },
            revision: nextRevision,
            lastRequestId: requestId,
            lastRequestHash: payloadHash,
            seats: validated,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { revision: nextRevision };
    });
});

exports.saveRealEstateDeskDisplayScale = onCall({ region: "asia-northeast3" }, async (request) => {
    const { classId, deskDisplayScale, requestId } = request.data || {};
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (typeof classId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(classId) ||
        !canManagePlacement(request.auth.token || {}, classId)) {
        throw new HttpsError("permission-denied", "배치 관리 권한이 없습니다.");
    }
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
        throw new HttpsError("invalid-argument", "저장 요청 식별값이 올바르지 않습니다.");
    }
    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const placementRef = db.doc(`classes/${classId}/real_estate/placement`);
    return runRealEstateTransaction(db, async (transaction) => {
        const [layoutSnap, placementSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction), transaction.get(placementRef),
        ]);
        if (!layoutSnap.exists) throw new HttpsError("not-found", "교실 배치가 없습니다.");
        const current = placementSnap.exists ? placementSnap.data() || {} : {};
        let update;
        try {
            update = getDeskDisplayScaleUpdate(current, deskDisplayScale, requestId);
        } catch (error) {
            throw new HttpsError("invalid-argument", error.message);
        }
        if (!update) return { deskDisplayScale };
        transaction.set(placementRef, {
            ...update,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { deskDisplayScale };
    });
});

exports.createRealEstateSeat = onCall({ region: "asia-northeast3" }, async (request) => {
    const classId = request.data?.classId;
    const requestId = request.data?.requestId;
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (typeof classId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(classId)) {
        throw new HttpsError("invalid-argument", "학급 정보가 올바르지 않습니다.");
    }
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
        throw new HttpsError("invalid-argument", "요청 식별값이 올바르지 않습니다.");
    }
    if (!canManagePlacement(request.auth.token || {}, classId)) {
        throw new HttpsError("permission-denied", "자리 관리 권한이 없습니다.");
    }

    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const configRef = db.doc(`classes/${classId}/real_estate/config`);
    const groupId = `gfree${requestId.replace(/-/g, "")}`;
    const deskId = `${groupId}-0-0`;
    const permanentId = `seat-${randomUUID()}`;
    return runRealEstateTransaction(db, async (transaction) => {
        const [layoutSnap, configSnap] = await Promise.all([
            readRealEstateLayout(db, layoutRef, transaction), transaction.get(configRef),
        ]);
        const layout = layoutSnap.exists ? layoutSnap.data() || {} : {};
        const groups = Array.isArray(layout.groups) ? layout.groups : [];
        if (groups.some((group) => group.id === groupId)) return { deskId };
        const desks = groups.flatMap((group) => Array.isArray(group.desks) ? group.desks : []);
        if (desks.length >= 300) throw new HttpsError("resource-exhausted", "자리를 더 추가할 수 없습니다.");
        const config = configSnap.exists ? configSnap.data() || {} : {};
        const marketPrice = Math.max(0, Math.round(Number(config.seedMarketPrice) || 1000));
        const ratio = Number.isFinite(Number(config.officialPriceRatio)) ?
            Number(config.officialPriceRatio) : 70;
        const desk = {
            id: deskId,
            permanentId,
            number: Math.max(0, ...desks.map((item) => Number(item.number) || 0)) + 1,
            isActive: true,
            studentId: null,
            studentName: null,
            teamId: "none",
            lastPurchasePrice: marketPrice,
            price: Math.max(0, Math.floor(marketPrice * ratio / 100)),
            ownerId: null,
            ownerName: null,
            rentPaidUntil: null,
            rentContractId: null,
            rentStartAt: null,
            rentLastDateAt: null,
            rentTenantId: null,
            rentTenantName: null,
            rentPaidDays: 0,
            rentPaidAmount: 0,
            isTradeRestricted: false,
            hasTradeHistory: false,
        };
        stageRealEstateLayout(transaction, layoutRef, {
            ...layout,
            groups: [...groups, { id: groupId, name: "자리", rows: 1, cols: 1, desks: [desk] }],
            updatedAt: new Date().toISOString(),
        }, { replace: true });
        return { deskId };
    });
});
