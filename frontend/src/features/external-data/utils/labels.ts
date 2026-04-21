import { EntryMethod, SourceType } from "@/features/external-data/api/contracts";

export function sourceTypeLabel(value: SourceType): string {
  switch (value) {
    case "agrisk":
      return "Agrisk";
    case "serasa":
      return "Serasa";
    case "scr":
      return "SCR";
    case "internal_sheet":
      return "Planilha Interna";
    case "other":
      return "Outra Fonte";
    default:
      return value;
  }
}

export function entryMethodLabel(value: EntryMethod): string {
  switch (value) {
    case "manual":
      return "Manual";
    case "upload":
      return "Upload";
    case "automatic":
      return "Automatico";
    default:
      return value;
  }
}
