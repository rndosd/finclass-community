"use strict";

const admin = require("../firebaseAdminCompat");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { buildLayoutViewData } = require("./realestateLayoutViewSummary");

const db = admin.firestore();
const { STORAGE_VERSION, same } = require("../utils/realEstateStorageSchema");
const { activeSeats, assetFields } = require("../utils/realEstateProjectionChanges");
const { reconcileRealEstateAssets } = require("../utils/realEstateAssetProjection");

exports.syncRealEstateLayoutView = onDocumentWritten(
    {
        document: "classes/{classId}/real_estate/layout",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;

        const layoutViewRef = db.doc(`classes/${classId}/real_estate/layoutView`);
        const beforeLayout = event.data?.before?.exists === true ?
            event.data.before.data() || {} :
            {};
        const hasAfter = event.data?.after?.exists === true;
        const afterLayout = hasAfter ? event.data.after.data() || {} : {};

        if (afterLayout.storageSchemaVersion === STORAGE_VERSION) {
            if (beforeLayout.storageSchemaVersion === STORAGE_VERSION && same(activeSeats(beforeLayout), activeSeats(afterLayout))) return;
            const formerOwnerIds = (beforeLayout.groups || []).flatMap((g) => g.desks || []).map((d) => d.ownerId).filter(Boolean);
            await reconcileRealEstateAssets(db, classId, formerOwnerIds);
            return;
        }
        // An out-of-order legacy event must not resurrect the removed summary or
        // apply an old asset delta after this class has switched storage.
        const currentLayout = await db.doc(`classes/${classId}/real_estate/layout`).get();
        if (currentLayout.data()?.storageSchemaVersion === STORAGE_VERSION) {
            const formerOwnerIds = [...(beforeLayout.groups || []), ...(afterLayout.groups || [])].flatMap((g) => g.desks || []).map((d) => d.ownerId).filter(Boolean);
            await reconcileRealEstateAssets(db, classId, formerOwnerIds);
            return;
        }

        const formerOwnerIds = [...(beforeLayout.groups || []), ...(afterLayout.groups || [])].flatMap((g) => g.desks || []).map((d) => d.ownerId).filter(Boolean);
        await Promise.all([
            db.runTransaction(async (transaction) => {
                const latest = await transaction.get(db.doc(`classes/${classId}/real_estate/layout`));
                if (latest.data()?.storageSchemaVersion === STORAGE_VERSION) return;
                if (latest.exists) transaction.set(layoutViewRef, buildLayoutViewData(latest.data()));
                else transaction.delete(layoutViewRef);
            }),
            reconcileRealEstateAssets(db, classId, formerOwnerIds),
        ]);
    },
);

exports.syncRealEstatePropertyAssets = onDocumentWritten(
    { document: "classes/{classId}/real_estate/properties/items/{deskId}", region: "asia-northeast3" },
    async (event) => {
        if (same(assetFields(event.data?.before?.data()), assetFields(event.data?.after?.data()))) return;
        const formerOwnerIds = [event.data?.before?.data()?.fields?.ownerId, event.data?.after?.data()?.fields?.ownerId].filter(Boolean);
        await reconcileRealEstateAssets(db, event.params.classId, formerOwnerIds);
    },
);
