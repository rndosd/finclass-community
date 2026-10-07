"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "../..");

function validate(env, task) {
  const required = ["REACT_APP_FINCLASS_ENVIRONMENT", "REACT_APP_FIREBASE_API_KEY",
    "REACT_APP_FIREBASE_PROJECT_ID", "REACT_APP_FIREBASE_EXPECTED_PROJECT_ID",
    "REACT_APP_FIREBASE_AUTH_DOMAIN", "REACT_APP_FIREBASE_STORAGE_BUCKET",
    "REACT_APP_FIREBASE_MESSAGING_SENDER_ID", "REACT_APP_FIREBASE_APP_ID", "REACT_APP_PUBLIC_ORIGIN", "REACT_APP_GOOGLE_CLIENT_ID"];
  for (const key of required) {
    const value = String(env[key] || "").trim();
    if (!value || /replace-|your-finclass|example\.invalid/.test(value)) throw new Error("Configure " + key + " with your own value.");
  }
  if (!["production", "staging"].includes(env.REACT_APP_FINCLASS_ENVIRONMENT)) throw new Error("Environment must be production or staging.");
  const project = env.REACT_APP_FIREBASE_PROJECT_ID;
  if (project !== env.REACT_APP_FIREBASE_EXPECTED_PROJECT_ID) throw new Error("Firebase project IDs do not match.");
  if (env.REACT_APP_FIREBASE_AUTH_DOMAIN !== `${project}.firebaseapp.com`) throw new Error("Auth domain must belong to your project.");
  if (!env.REACT_APP_FIREBASE_STORAGE_BUCKET.startsWith(project + ".")) throw new Error("Storage bucket must belong to your project.");
  if (!env.REACT_APP_FIREBASE_APP_ID.startsWith(`1:${env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID}:web:`)) throw new Error("Firebase app ID does not match sender ID.");
  if (!env.REACT_APP_GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com")) throw new Error("Use your Google OAuth Web client ID.");
  const origin = new URL(env.REACT_APP_PUBLIC_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Public origin must be a plain HTTPS origin.");
  if (env.REACT_APP_USE_EMULATORS === "true" && (task === "build" || !project.startsWith("demo-"))) throw new Error("Emulators require start and a demo- project.");
  if (env.REACT_APP_APPCHECK_ENABLED === "true" && !env.REACT_APP_APPCHECK_ENTERPRISE_SITE_KEY && !env.REACT_APP_APPCHECK_SITE_KEY) throw new Error("App Check is enabled but its website key is missing.");
  if (env.REACT_APP_APPCHECK_ENABLED === "true" && /replace-|example\.invalid/.test(env.REACT_APP_APPCHECK_ENTERPRISE_SITE_KEY || env.REACT_APP_APPCHECK_SITE_KEY || "")) throw new Error("Configure your own App Check website key.");
  if (task === "build" && env.REACT_APP_APPCHECK_DEBUG_TOKEN) throw new Error("Remove the App Check debug token before building.");
  return env;
}

function main() {
  const [task, ...args] = process.argv.slice(2);
  if (!["start", "build"].includes(task)) throw new Error("Use start or build.");
  const env = { ...process.env };
  const mode = task === "build" ? "production" : "development";
  for (const name of [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const parsed = dotenv.parse(fs.readFileSync(file));
    for (const [key, value] of Object.entries(parsed)) if (env[key] === undefined) env[key] = value;
  }
  validate(env, task);
  env.NODE_ENV = mode;
  delete env.SELFHOST_CLONE_BUILD;
  const binary = require.resolve("@craco/craco/dist/bin/craco.js", { paths: [root] });
  const result = spawnSync(process.execPath, [binary, task, ...args], { cwd: root, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}
module.exports = { validate };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
