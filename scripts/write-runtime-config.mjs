#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--")) || "dist/config.js";
const app = optionValue("--app", env("MOMENT_APP", "APP") || "user");
const portalVariant = optionValue("--portal-variant", env("MOMENT_PORTAL_VARIANT", "PORTAL_VARIANT"));

const brand = {
  adminLogoUrl: env("MOMENT_ADMIN_LOGO_URL", "ADMIN_LOGO_URL", "LOGO_URL"),
  displayName: env("MOMENT_BRAND_DISPLAY_NAME", "MOMENT_BRAND_NAME", "BRAND_NAME", "APP_NAME"),
  faviconUrl: env("MOMENT_FAVICON_URL", "FAVICON_URL"),
  footerText: env("MOMENT_FOOTER_TEXT", "FOOTER_TEXT"),
  supportEmail: env("MOMENT_SUPPORT_EMAIL", "SUPPORT_EMAIL"),
  themeColor: env("MOMENT_THEME_COLOR", "THEME_COLOR"),
  userLogoUrl: env("MOMENT_USER_LOGO_URL", "USER_LOGO_URL", "LOGO_URL"),
};

const config = {
  apiBaseUrl: env("MOMENT_API_BASE_URL", "API_BASE_URL", "VITE_API_BASE_URL"),
  brand: prune(brand),
};

if (portalVariant) {
  config.portalVariant = portalVariant;
}

writeConfig(target, prune(config));
console.log(`Wrote runtime config for ${app} to ${target}`);

function optionValue(name, fallback = "") {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1].trim();
  }
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function env(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function prune(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ""));
}

function writeConfig(path, config) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    `window.__MOMENT_CONFIG__ = ${JSON.stringify(config, null, 2)};\nwindow.__APP_CONFIG__ = window.__APP_CONFIG__ || window.__MOMENT_CONFIG__;\n`,
  );
}
