import { readFirebaseClientConfiguration } from "./firebaseClientConfig";

const buildEnvironment = (overrides = {}) => ({
  REACT_APP_FINCLASS_ENVIRONMENT: "staging",
  REACT_APP_FIREBASE_API_KEY: "public-api-key",
  REACT_APP_FIREBASE_AUTH_DOMAIN: "finclass-staging-2026.firebaseapp.com",
  REACT_APP_FIREBASE_PROJECT_ID: "finclass-staging-2026",
  REACT_APP_FIREBASE_EXPECTED_PROJECT_ID: "finclass-staging-2026",
  REACT_APP_FIREBASE_STORAGE_BUCKET:
    "finclass-staging-2026.firebasestorage.app",
  REACT_APP_FIREBASE_MESSAGING_SENDER_ID: "868163017830",
  REACT_APP_FIREBASE_APP_ID:
    "1:868163017830:web:7eddbbb4be593c40dfa1a7",
  REACT_APP_FIREBASE_MEASUREMENT_ID: "G-TEST",
  ...overrides,
});

describe("readFirebaseClientConfiguration", () => {
  test("returns the selected staging Firebase configuration", () => {
    expect(readFirebaseClientConfiguration(buildEnvironment())).toEqual({
      environmentName: "staging",
      firebaseConfig: {
        apiKey: "public-api-key",
        authDomain: "finclass-staging-2026.firebaseapp.com",
        projectId: "finclass-staging-2026",
        storageBucket: "finclass-staging-2026.firebasestorage.app",
        messagingSenderId: "868163017830",
        appId: "1:868163017830:web:7eddbbb4be593c40dfa1a7",
        measurementId: "G-TEST",
      },
    });
  });

  test("rejects a staging build wired to the production project", () => {
    expect(() =>
      readFirebaseClientConfiguration(
        buildEnvironment({
          REACT_APP_FIREBASE_PROJECT_ID: "your-finclass-project",
        }),
      ),
    ).toThrow(/staging.*finclass-staging-2026/i);
  });

  test("rejects missing required public Firebase configuration", () => {
    expect(() =>
      readFirebaseClientConfiguration(
        buildEnvironment({ REACT_APP_FIREBASE_APP_ID: "" }),
      ),
    ).toThrow(/REACT_APP_FIREBASE_APP_ID/);
  });

  test("rejects unknown environment names", () => {
    expect(() =>
      readFirebaseClientConfiguration(
        buildEnvironment({
          REACT_APP_FINCLASS_ENVIRONMENT: "production-like",
        }),
      ),
    ).toThrow(/unknown Firebase environment/i);
  });
});
