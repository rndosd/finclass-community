// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "firebase/app-check";
import { readFirebaseClientConfiguration } from "./config/firebaseClientConfig";
const {
  environmentName: firebaseEnvironmentName,
  firebaseConfig
} = readFirebaseClientConfiguration();
const app = initializeApp(firebaseConfig);
const appCheckEnabled = process.env.REACT_APP_APPCHECK_ENABLED === "true";
const enterpriseSiteKey = process.env.REACT_APP_APPCHECK_ENTERPRISE_SITE_KEY;
const v3SiteKey = process.env.REACT_APP_APPCHECK_SITE_KEY;
const appCheckDebugToken = process.env.REACT_APP_APPCHECK_DEBUG_TOKEN;
const isDevelopment = process.env.NODE_ENV !== "production";
const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
if (appCheckEnabled && isDevelopment && isLocalhost && appCheckDebugToken && typeof window !== "undefined") {
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken === "true" ? true : appCheckDebugToken;
}
const appCheckProvider = !appCheckEnabled ? null : enterpriseSiteKey ? new ReCaptchaEnterpriseProvider(enterpriseSiteKey) : v3SiteKey ? new ReCaptchaV3Provider(v3SiteKey) : null;
export const appCheck = appCheckProvider ? initializeAppCheck(app, {
  provider: appCheckProvider,
  isTokenAutoRefreshEnabled: true
}) : null;
if (appCheckEnabled && !appCheckProvider && isDevelopment) {
  console.warn("[AppCheck] Missing site key. Set REACT_APP_APPCHECK_ENTERPRISE_SITE_KEY (recommended) or REACT_APP_APPCHECK_SITE_KEY.");
}
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // The persistent cache caused production listener crashes with the current
  // Firestore SDK/runtime combination, so we keep a single in-memory cache
  // until the client version is aligned and re-verified.
  localCache: memoryLocalCache()
});
export const functions = getFunctions(app, "asia-northeast3");
export const storage = getStorage(app);
export { firebaseEnvironmentName };
export default app;

// Synthetic, loopback-only development. Never mix an emulator with a live project.
if (process.env.REACT_APP_USE_EMULATORS === "true") {
  if (!isLocalhost || !firebaseConfig.projectId.startsWith("demo-")) {
    throw new Error("Local emulators require localhost and a demo- project ID.");
  }
  const { connectAuthEmulator } = require("firebase/auth");
  const { connectFirestoreEmulator } = require("firebase/firestore");
  const { connectFunctionsEmulator } = require("firebase/functions");
  const { connectStorageEmulator } = require("firebase/storage");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
