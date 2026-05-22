"use client";

const PERMISSIONS_COOKIE_KEY = "gcc_permissions";
const LEGACY_PERMISSION_COMPATIBILITY: Record<string, string[]> = {
  "credit.requests.view": ["credit_request_view_own", "credit_request_view_bu"],
  "credit.requests.submit": ["credit_request_submit", "credit_request_submit_approval", "credit.request.submit"],
  "credit.request.create": ["credit_request_submit", "credit.requests.submit", "credit.request.submit"],
  "credit.request.submit": ["credit_request_submit_approval"],
  "credit.approval.approve": ["credit_request_approve"],
  "credit.approval.reject": ["credit_request_reject"],
  "credit.analysis.execute": ["credit_request_validate"],
};

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
  if (permissions.includes(permissionKey)) return true;
  const aliases = LEGACY_PERMISSION_COMPATIBILITY[permissionKey] ?? [];
  return aliases.some((alias) => permissions.includes(alias));
}

export function hasAnyPermission(permissionKeys: string[], permissions: string[] = getEffectivePermissions()): boolean {
  return permissionKeys.some((permissionKey) => hasPermission(permissionKey, permissions));
}

export function hasAllPermissions(permissionKeys: string[], permissions: string[] = getEffectivePermissions()): boolean {
  return permissionKeys.every((permissionKey) => hasPermission(permissionKey, permissions));
}
