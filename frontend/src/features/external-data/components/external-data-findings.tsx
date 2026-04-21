import { AlertTriangle, CircleAlert, ShieldCheck } from "lucide-react";

import { ExternalDataFinding } from "@/features/external-data/utils/external-data-view-models";
import { cn } from "@/shared/lib/utils";

type ExternalDataFindingsProps = {
  findings: ExternalDataFinding[];
};

function toneClass(tone: ExternalDataFinding["tone"]) {
  if (tone === "danger") {
    return {
      box: "border-rose-200 bg-rose-50",
      icon: "text-rose-600"
    };
  }
  if (tone === "warning") {
    return {
      box: "border-amber-200 bg-amber-50",
      icon: "text-amber-600"
    };
  }
  return {
    box: "border-sky-200 bg-sky-50",
    icon: "text-sky-700"
  };
}

function toneIcon(tone: ExternalDataFinding["tone"]) {
  if (tone === "danger") {
    return AlertTriangle;
  }
  if (tone === "warning") {
    return CircleAlert;
  }
  return ShieldCheck;
}

export function ExternalDataFindings({ findings }: ExternalDataFindingsProps) {
  return (
    <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
      <p className="mb-3 text-[13px] font-medium text-[#111827]">Achados relevantes</p>
      <div className="space-y-2">
        {findings.map((finding) => {
          const styles = toneClass(finding.tone);
          const Icon = toneIcon(finding.tone);

          return (
            <div key={finding.id} className={cn("rounded-[8px] border px-3 py-2", styles.box)}>
              <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", styles.icon)} />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#111827]">{finding.title}</p>
                  <p className="text-[11px] text-[#4b5563]">{finding.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
