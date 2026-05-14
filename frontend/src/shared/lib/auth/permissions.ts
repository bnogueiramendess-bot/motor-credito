"use client";

const PERMISSIONS_COOKIE_KEY = "gcc_permissions";

function readCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));
  if (!cookie) return null;
  return cookie.split("=")[1] ?? null;
}

export function getEffectivePermissions(): string[] {
  const raw = readCookieValue(PERMISSIONS_COOKIE_KEY);
  if (!raw) return [];

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function hasPermission(permissionKey: string, permissions: string[] = getEffectivePermissions()): boolean {
  return permissions.includes(permissionKey);
}

export function hasAnyPermission(permissionKeys: string[], permissions: string[] = getEffectivePermissions()): boolean {
  return permissionKeys.some((permissionKey) => permissions.includes(permissionKey));
}

export function hasAllPermissions(permissionKeys: string[], permissions: string[] = getEffectivePermissions()): boolean {
  return permissionKeys.every((permissionKey) => permissions.includes(permissionKey));
}
