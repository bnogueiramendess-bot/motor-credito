import { cookies } from "next/headers";

export const ACCESS_TOKEN_COOKIE = "gcc_access_token";
export const REFRESH_TOKEN_COOKIE = "gcc_refresh_token";

export async function getAccessTokenFromCookies() {
  return cookies().get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export async function getRefreshTokenFromCookies() {
  return cookies().get(REFRESH_TOKEN_COOKIE)?.value ?? null;
}

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const store = cookies();
  store.set(ACCESS_TOKEN_COOKIE, accessToken, { httpOnly: true, sameSite: "lax", path: "/" });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function clearAuthCookies() {
  const store = cookies();
  store.set(ACCESS_TOKEN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  store.set(REFRESH_TOKEN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  store.set("gcc_permissions", "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
  store.set("gcc_user_display_name", "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
  store.set("gcc_login_username", "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
}
