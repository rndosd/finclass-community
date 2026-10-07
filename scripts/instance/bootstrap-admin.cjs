"use strict";
const { createHash } = require("node:crypto");
const path = require("node:path");
const { createRequire } = require("node:module");

function loadAdminSdk() {
  const backendRequire = createRequire(path.resolve(__dirname, "../../functions/package.json"));
  return { app: backendRequire("firebase-admin/app"), auth: backendRequire("firebase-admin/auth"), firestore: backendRequire("firebase-admin/firestore") };
}

function validateTarget(project, uid) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || "") || /^(?:your-|demo-)/.test(project)) throw new Error("Use your actual new Firebase project ID.");
  // Original service project IDs must never be targets of the copy's bootstrap.
  const forbidden = ["4de381b79152361d959cec4f3693d24ad5e6a6e5022fd0985b8c1e844e56fe2e", "2c5b08e78c14c3e05fcbbe2d841f0d49be0e8d51ae8e3db25965094b47a8d325"];
  if (forbidden.includes(createHash("sha256").update(project).digest("hex"))) throw new Error("Original service project is not an allowed target.");
  if (!uid || uid.length > 128 || /[\s/]/.test(uid)) throw new Error("Use the existing operator account's Firebase Auth UID.");
}

async function bootstrap({ project, uid, apply = false, auth, db, timestamp }) {
  validateTarget(project, uid);
  const user = await auth.getUser(uid);
  if (user.disabled || !user.email) throw new Error("Use an enabled, separately created operator account with an email.");
  const ref = db.doc(`users/${uid}`);
  const snapshot = await ref.get();
  if (snapshot.exists && !["admin", "pending", undefined].includes(snapshot.data().role)) throw new Error("Use a separate operator account; do not replace a teacher or student role.");
  const claims = { ...user.customClaims, role: "admin", isApproved: true };
  if (claims.sw === true || claims.classId) throw new Error("Use an operator account without a class or switched session.");
  if (!apply) return { mode: "dry-run", project, authClaim: "role=admin", profile: "users/<operator-uid>", remoteWrites: 0 };
  // Auth and Firestore are different services. A retry repairs a partial result;
  // preserve the account's unrelated claims and profile fields on every run.
  const existingProfile = snapshot.exists ? snapshot.data() : {};
  await ref.set({ uid, email: user.email, name: existingProfile.name || user.displayName || "운영자", role: "admin", status: "approved", privacyAgreed: existingProfile.privacyAgreed === true, updatedAt: timestamp() }, { merge: true });
  await auth.setCustomUserClaims(uid, claims);
  return { mode: "applied", project, authClaim: "role=admin", profile: "users/<operator-uid>", next: "Sign out, sign in, and complete privacy consent.", remoteWrites: 2 };
}

async function main() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (["--project", "--uid"].includes(args[i])) i++;
    else if (args[i] !== "--apply") throw new Error("Unknown option: " + args[i]);
  }
  const project = args[args.indexOf("--project") + 1];
  const uid = args[args.indexOf("--uid") + 1];
  if (!args.includes("--project") || !args.includes("--uid")) throw new Error("Required: --project YOUR_PROJECT --uid OPERATOR_AUTH_UID [--apply]");
  validateTarget(project, uid);
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Clear emulator variables before setting up a cloud operator account.");
  const sdk = loadAdminSdk();
  const { initializeApp, applicationDefault, deleteApp } = sdk.app;
  const { getAuth } = sdk.auth;
  const { getFirestore, FieldValue } = sdk.firestore;
  const app = initializeApp({ projectId: project, credential: applicationDefault() }, "instance-admin-bootstrap");
  try {
    const result = await bootstrap({ project, uid, apply: args.includes("--apply"), auth: getAuth(app), db: getFirestore(app), timestamp: () => FieldValue.serverTimestamp() });
    console.log(JSON.stringify(result, null, 2));
  } finally { await deleteApp(app); }
}
module.exports = { validateTarget, bootstrap, loadAdminSdk };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
