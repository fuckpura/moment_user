export type MomentBranding = {
  adminLogoUrl: string;
  displayName: string;
  faviconUrl: string;
  footerText: string;
  supportEmail: string;
  themeColor: string;
  userLogoUrl: string;
};

export type MomentRuntimeBrandConfig = Partial<MomentBranding> & {
  name?: string;
};

export type MomentRuntimeConfig = {
  apiBaseUrl?: string;
  brand?: MomentRuntimeBrandConfig;
  portalVariant?: string;
  userAccessToken?: string;
};

declare global {
  interface Window {
    __MOMENT_CONFIG__?: MomentRuntimeConfig;
    __APP_CONFIG__?: MomentRuntimeConfig;
  }
}

const userTokenKey = portalVariant() === "internal" ? "moment.internalUser.accessToken" : "moment.user.accessToken";

export function apiBaseUrl(): string {
  const configured = runtimeConfig().apiBaseUrl?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return window.location.origin;
}

export function userAccessToken(): string {
  return readBrowserStorage("localStorage", userTokenKey) || readBrowserStorage("sessionStorage", userTokenKey) || runtimeConfig().userAccessToken?.trim() || "";
}

export function storeUserAccessToken(token: string): void {
  const normalized = token.trim();
  if (normalized) {
    writeBrowserStorage("localStorage", userTokenKey, normalized);
    writeBrowserStorage("sessionStorage", userTokenKey, normalized);
  } else {
    removeBrowserStorage("localStorage", userTokenKey);
    removeBrowserStorage("sessionStorage", userTokenKey);
  }
}

export function runtimeBranding(): MomentBranding {
  return normalizeBranding(runtimeConfig().brand);
}

export function portalVariant(): "public" | "internal" {
  const value = runtimeConfig().portalVariant?.trim().toLowerCase();
  return value === "internal" || value === "internal-user" || value === "internal_user" ? "internal" : "public";
}

export function applyDocumentBranding(branding: MomentBranding, titleSuffix = ""): void {
  const displayName = branding.displayName || "Moment";
  document.title = titleSuffix ? `${displayName} ${titleSuffix}` : displayName;
  setFavicon(branding.faviconUrl);
  setThemeColor(branding.themeColor);
}

export function runtimeConfig(): MomentRuntimeConfig {
  return window.__MOMENT_CONFIG__ || window.__APP_CONFIG__ || {};
}

function normalizeBranding(brand?: MomentRuntimeBrandConfig): MomentBranding {
  return {
    adminLogoUrl: brand?.adminLogoUrl?.trim() || "",
    displayName: brand?.displayName?.trim() || brand?.name?.trim() || "Moment",
    faviconUrl: brand?.faviconUrl?.trim() || "",
    footerText: brand?.footerText?.trim() || "",
    supportEmail: brand?.supportEmail?.trim() || "",
    themeColor: brand?.themeColor?.trim() || "#111827",
    userLogoUrl: brand?.userLogoUrl?.trim() || "",
  };
}

function setFavicon(faviconUrl: string): void {
  const normalized = faviconUrl.trim();
  if (!normalized) {
    return;
  }
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = normalized;
}

function setThemeColor(themeColor: string): void {
  const normalized = themeColor.trim();
  if (!normalized) {
    return;
  }
  let meta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = normalized;
}

function readBrowserStorage(kind: "localStorage" | "sessionStorage", key: string): string {
  try {
    return window[kind]?.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeBrowserStorage(kind: "localStorage" | "sessionStorage", key: string, value: string): void {
  try {
    window[kind]?.setItem(key, value);
  } catch {
    // Some embedded browsers disable persistent storage; the in-memory app state still keeps the current login.
  }
}

function removeBrowserStorage(kind: "localStorage" | "sessionStorage", key: string): void {
  try {
    window[kind]?.removeItem(key);
  } catch {
    // Storage cleanup is best-effort when the browser blocks a storage area.
  }
}
