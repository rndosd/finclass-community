const ENVIRONMENT_NAMES = new Set(["production", "staging"]);

const REQUIRED_CONFIGURATION = [
  ["apiKey", "REACT_APP_FIREBASE_API_KEY"],
  ["authDomain", "REACT_APP_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "REACT_APP_FIREBASE_PROJECT_ID"],
  ["storageBucket", "REACT_APP_FIREBASE_STORAGE_BUCKET"],
  ["messagingSenderId", "REACT_APP_FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "REACT_APP_FIREBASE_APP_ID"],
];

const readValue = (environment, key) =>
  typeof environment[key] === "string" ? environment[key].trim() : "";

export const readFirebaseClientConfiguration = (environment = process.env) => {
  const environmentName = readValue(
    environment,
    "REACT_APP_FINCLASS_ENVIRONMENT",
  ).toLowerCase();

  if (!ENVIRONMENT_NAMES.has(environmentName)) {
    throw new Error(
      `Unknown Firebase environment: ${environmentName || "(empty)"}`,
    );
  }
  const expectedProjectId = readValue(
    environment,
    "REACT_APP_FIREBASE_EXPECTED_PROJECT_ID",
  );
  if (!expectedProjectId) {
    throw new Error(
      "Missing Firebase client configuration: REACT_APP_FIREBASE_EXPECTED_PROJECT_ID",
    );
  }

  const firebaseConfig = {};
  REQUIRED_CONFIGURATION.forEach(([property, key]) => {
    const value = readValue(environment, key);
    if (!value) {
      throw new Error(`Missing Firebase client configuration: ${key}`);
    }
    firebaseConfig[property] = value;
  });

  const measurementId = readValue(
    environment,
    "REACT_APP_FIREBASE_MEASUREMENT_ID",
  );
  if (measurementId) {
    firebaseConfig.measurementId = measurementId;
  }

  if (firebaseConfig.projectId !== expectedProjectId) {
    throw new Error(
      `${environmentName} Firebase environment must use project ${expectedProjectId}; received ${firebaseConfig.projectId}.`,
    );
  }
  if (firebaseConfig.authDomain !== `${expectedProjectId}.firebaseapp.com`) {
    throw new Error(
      `${environmentName} Firebase auth domain must be ${expectedProjectId}.firebaseapp.com.`,
    );
  }
  if (!firebaseConfig.storageBucket.startsWith(`${expectedProjectId}.`)) {
    throw new Error(
      `${environmentName} Firebase storage bucket must belong to ${expectedProjectId}.`,
    );
  }
  if (
    !firebaseConfig.appId.startsWith(
      `1:${firebaseConfig.messagingSenderId}:web:`,
    )
  ) {
    throw new Error(
      `${environmentName} Firebase appId must match its messaging sender ID.`,
    );
  }

  return { environmentName, firebaseConfig };
};
