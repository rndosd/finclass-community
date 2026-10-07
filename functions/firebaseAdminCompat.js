"use strict";

const {
    applicationDefault,
    cert,
    getApp,
    getApps,
    initializeApp,
    refreshToken,
} = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
    Blob,
    DocumentReference,
    FieldPath,
    FieldValue,
    Filter,
    GeoPoint,
    Timestamp,
    getFirestore,
} = require("firebase-admin/firestore");

function app(name) {
    return getApp(name);
}

function auth(firebaseApp) {
    return getAuth(firebaseApp);
}

function firestore(firebaseApp) {
    return getFirestore(firebaseApp);
}

Object.assign(firestore, {
    Blob,
    DocumentReference,
    FieldPath,
    FieldValue,
    Filter,
    GeoPoint,
    Timestamp,
});

const admin = {
    app,
    auth,
    credential: {
        applicationDefault,
        cert,
        refreshToken,
    },
    firestore,
    initializeApp,
};

Object.defineProperty(admin, "apps", {
    enumerable: true,
    get: getApps,
});

module.exports = admin;
