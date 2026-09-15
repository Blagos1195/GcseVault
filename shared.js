// ── CONFIGURATION ─────────────────────────────────────────────────────────
const API_BASE = "https://quotevault-api.noah-l-barker.workers.dev";

// ── API CLIENT WRAPPER ────────────────────────────────────────────────────
/**
 * Makes an authenticated request to your backend Worker.
 * Automatically injects session tokens and handles JSON parsing.
 */
export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem("sessionToken") || sessionStorage.getItem("sessionToken");
  
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "X-Session-Token": token } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type");
  const data = contentType && contentType.includes("application/json") 
    ? await response.json() 
    : await response.text();

  if (!response.ok) {
    throw new Error(typeof data === "string" ? data : (data.error || "An error occurred"));
  }

  return data;
}

// ── USER STATE MANAGEMENT ─────────────────────────────────────────────────
const USER_KEY_STORAGE = "app_user_key";
const USER_DATA_STORAGE = "app_user_profile";

/** Get the stored unique user key */
export function getSavedUserKey() {
  return localStorage.getItem(USER_KEY_STORAGE);
}

/** Save user session information locally */
export function saveUserSession(userKey, profileData) {
  if (userKey) localStorage.setItem(USER_KEY_STORAGE, userKey);
  if (profileData) {
    localStorage.setItem(USER_DATA_STORAGE, JSON.stringify(profileData));
  }
}

/** Get cached full user profile */
export function getSavedUserProfile() {
  const data = localStorage.getItem(USER_DATA_STORAGE);
  return data ? JSON.parse(data) : null;
}

/** Clear local user session (Logout) */
export function clearUserSession() {
  localStorage.removeItem(USER_KEY_STORAGE);
  localStorage.removeItem(USER_DATA_STORAGE);
}

// ── ADMIN & AUTH MANAGEMENT ───────────────────────────────────────────────
const ADMIN_TOKEN_STORAGE = "sessionToken";

/** Check if the user currently has a local admin session token saved */
export function hasAdminSession() {
  return Boolean(localStorage.getItem(ADMIN_TOKEN_STORAGE) || sessionStorage.getItem(ADMIN_TOKEN_STORAGE));
}

/** Get the active admin session token */
export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_STORAGE) || sessionStorage.getItem(ADMIN_TOKEN_STORAGE) || "";
}

/** 
 * Authenticate as admin against the backend worker using a password string.
 * Saves the returned session token locally upon success.
 */
export async function loginAdmin(password, remember = true) {
  const data = await apiRequest("/auth", {
    method: "POST",
    body: JSON.stringify({ pw: password })
  });

  if (data && data.token) {
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(ADMIN_TOKEN_STORAGE, data.token);
    return true;
  }
  return false;
}

/** Log out the admin by wiping the saved session token */
export function logoutAdmin() {
  localStorage.removeItem(ADMIN_TOKEN_STORAGE);
  sessionStorage.removeItem(ADMIN_TOKEN_STORAGE);
}

// ── ROBUST THEME MANAGEMENT ───────────────────────────────────────────────

/** Built-in fallback presets */
export const PRESET_THEMES = {
  default: {
    label: "Default Dark",
    desc: "Sleek slate dark mode",
    "--bg": "#0f172a",
    "--card": "#1e293b",
    "--text": "#f8fafc",
    "--primary": "#3b82f6"
  },
  light: {
    label: "Clean Light",
    desc: "Bright and minimal",
    "--bg": "#f8fafc",
    "--card": "#ffffff",
    "--text": "#0f172a",
    "--primary": "#2563eb"
  },
  cyberpunk: {
    label: "Cyberpunk",
    desc: "Neon dark mode",
    "--bg": "#050505",
    "--card": "#121212",
    "--text": "#00ffcc",
    "--primary": "#ff007f"
  }
};

/** Applies any theme object (CSS properties) or string identifier to the document */
export function applyTheme(themeData) {
  if (!themeData) return;

  let parsed = themeData;
  if (typeof themeData === "string") {
    try {
      parsed = JSON.parse(themeData);
    } catch (e) {
      if (PRESET_THEMES[themeData]) {
        applyTheme(PRESET_THEMES[themeData]);
        return;
      }
      document.documentElement.setAttribute("data-theme", themeData);
      return;
    }
  }

  if (parsed && typeof parsed === "object") {
    Object.entries(parsed).forEach(([key, val]) => {
      if (key.startsWith("--")) {
        document.documentElement.style.setProperty(key, String(val));
      }
    });
  }
}

/** Fetches custom user-created themes from the KV backend */
export async function fetchUserCustomThemes(userKey) {
  if (!userKey) return {};
  try {
    const res = await apiRequest(`/themes/list?userKey=${encodeURIComponent(userKey)}`);
    return res.themes || {};
  } catch (err) {
    console.error("Failed to load custom themes:", err);
    return {};
  }
}

/** Saves a custom theme configuration for a user */
export async function saveCustomTheme(userKey, themeKey, themeObject) {
  return await apiRequest("/themes/save", {
    method: "POST",
    body: JSON.stringify({ userKey, key: themeKey, theme: themeObject })
  });
}

/** Deletes a custom theme configuration */
export async function deleteCustomTheme(userKey, themeKey) {
  return await apiRequest("/themes/delete", {
    method: "POST",
    body: JSON.stringify({ userKey, key: themeKey })
  });
}

// ── FORMATTING & UTILS ────────────────────────────────────────────────────
/** Formats large numbers cleanly (e.g., XP counts) */
export function formatNumber(num) {
  return Number(num || 0).toLocaleString();
}

/** Sanitizes simple user text inputs to prevent raw HTML injection */
export function sanitizeText(str) {
  return String(str || "").replace(/[<>]/g, "").trim();
}