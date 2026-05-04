"use client";

const FALLBACK_USER_LABEL = "Usuário não identificado";

export function getCurrentUserDisplayName() {
  if (typeof window === "undefined") {
    return FALLBACK_USER_LABEL;
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

