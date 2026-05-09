"use client";

const FALLBACK_USER_LABEL = "Usuário não identificado";

export function getCurrentUserDisplayName() {
  if (typeof window === "undefined") {
    return FALLBACK_USER_LABEL;
  }

  const cookieValue = document.cookie
    .split("; ")
    .find((item) => item.startsWith("gcc_user_display_name="))
    ?.split("=")[1];
  if (cookieValue) {
    const decoded = decodeURIComponent(cookieValue).trim();
    if (decoded.length > 0) {
      return decoded;
    }
  }

  const knownKeys = ["currentUserDisplayName", "userDisplayName", "user_name", "username"];
  for (const key of knownKeys) {
    const value = window.localStorage.getItem(key);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return FALLBACK_USER_LABEL;
}

export function getCurrentUserLoginName() {
  if (typeof window === "undefined") {
    return "Usuário";
  }

  const cookieValue = document.cookie
    .split("; ")
    .find((item) => item.startsWith("gcc_login_username="))
    ?.split("=")[1];
  if (cookieValue) {
    const decoded = decodeURIComponent(cookieValue).trim();
    if (decoded.length > 0) {
      return decoded;
    }
  }

  const fromStorage = window.localStorage.getItem("loginUsername");
  if (fromStorage && fromStorage.trim().length > 0) {
    return fromStorage.trim();
  }

  return "Usuário";
}
