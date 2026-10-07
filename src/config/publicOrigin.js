export const readPublicOrigin = (environment = process.env) => {
  const value = String(environment.REACT_APP_PUBLIC_ORIGIN || "").trim();
  if (!value) {
    throw new Error("REACT_APP_PUBLIC_ORIGIN is required.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("REACT_APP_PUBLIC_ORIGIN must be a valid URL origin.");
  }

  if (url.protocol !== "https:") {
    throw new Error("REACT_APP_PUBLIC_ORIGIN must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("REACT_APP_PUBLIC_ORIGIN must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("REACT_APP_PUBLIC_ORIGIN must contain only an origin.");
  }

  return url.origin;
};

export const publicOrigin = readPublicOrigin();
