const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const isLocalRuntime = () => {
  if (typeof window === "undefined") return false;

  return LOCAL_HOSTS.has(
    String(window.location?.hostname || "").trim().toLowerCase(),
  );
};
