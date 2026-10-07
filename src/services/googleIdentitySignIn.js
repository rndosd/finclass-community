import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
} from "firebase/auth";

const GOOGLE_IDENTITY_SCRIPT_ID = "google-identity-services";
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const DEFAULT_GOOGLE_CLIENT_ID = "";

let googleIdentityScriptPromise;

const createAuthError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeGoogleError = (response = {}) => {
  const reason = response.error || response.type;

  if (
    reason === "popup_closed_by_user" ||
    reason === "popup_closed" ||
    reason === "access_denied"
  ) {
    return createAuthError(
      "auth/popup-closed-by-user",
      "Google login popup was closed.",
    );
  }

  if (reason === "popup_failed_to_open") {
    return createAuthError(
      "auth/popup-blocked",
      "Google login popup was blocked by the browser.",
    );
  }

  return createAuthError(
    "auth/google-identity-failed",
    response.error_description || "Google login did not return a credential.",
  );
};

const loadGoogleIdentityScript = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      createAuthError(
        "auth/operation-not-supported-in-this-environment",
        "Google login requires a browser.",
      ),
    );
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve(window.google);
  }

  if (googleIdentityScriptPromise) return googleIdentityScriptPromise;

  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
    const script = existingScript || document.createElement("script");

    const handleLoad = () => {
      if (window.google?.accounts?.oauth2) {
        resolve(window.google);
        return;
      }

      googleIdentityScriptPromise = undefined;
      reject(
        createAuthError(
          "auth/google-identity-unavailable",
          "Google Identity Services failed to initialize.",
        ),
      );
    };

    const handleError = () => {
      googleIdentityScriptPromise = undefined;
      reject(
        createAuthError(
          "auth/network-request-failed",
          "Google Identity Services could not be loaded.",
        ),
      );
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existingScript) {
      script.id = GOOGLE_IDENTITY_SCRIPT_ID;
      script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return googleIdentityScriptPromise;
};

export const signInWithGoogleIdentity = async (auth) => {
  if (process.env.NODE_ENV === "development") {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider);
  }

  const google = await loadGoogleIdentityScript();
  const clientId =
    process.env.REACT_APP_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;

  if (!clientId) throw createAuthError("auth/configuration-not-found", "Configure this installation\'s Google Web client ID.");

  const accessToken = await new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (response) => {
        if (response?.access_token) {
          resolve(response.access_token);
          return;
        }
        reject(normalizeGoogleError(response));
      },
      error_callback: (response) => reject(normalizeGoogleError(response)),
    });

    tokenClient.requestAccessToken({ prompt: "select_account" });
  });

  const credential = GoogleAuthProvider.credential(null, accessToken);
  return signInWithCredential(auth, credential);
};
