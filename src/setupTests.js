// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

Object.assign(process.env, {
  REACT_APP_FINCLASS_ENVIRONMENT: "production",
  REACT_APP_FIREBASE_API_KEY: "test-public-api-key",
  REACT_APP_FIREBASE_AUTH_DOMAIN: "your-finclass-project.firebaseapp.com",
  REACT_APP_FIREBASE_PROJECT_ID: "your-finclass-project",
  REACT_APP_FIREBASE_EXPECTED_PROJECT_ID: "your-finclass-project",
  REACT_APP_FIREBASE_STORAGE_BUCKET: "your-finclass-project.appspot.com",
  REACT_APP_FIREBASE_MESSAGING_SENDER_ID: "765945943044",
  REACT_APP_FIREBASE_APP_ID: "1:765945943044:web:test",
  REACT_APP_FIREBASE_MEASUREMENT_ID: "G-TEST",
  REACT_APP_PUBLIC_ORIGIN: "https://your-finclass-project.web.app",
});
