export const OPEN_AGING_IMPORT_DRAWER_EVENT = "open-aging-import-drawer";

export function openAgingImportDrawer() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(OPEN_AGING_IMPORT_DRAWER_EVENT));
}
