const POLICY_GOVERNANCE_QUEUE_CTA: Record<string, string> = {
  policy_create: "Ver Política",
  policy_edit: "Ver Alterações",
  policy_publish: "Revisar Publicação",
  policy_archive: "Revisar Arquivamento",
};

export function policyGovernanceQueueCta(actionType: string | null | undefined): string {
  return POLICY_GOVERNANCE_QUEUE_CTA[actionType ?? ""] ?? "Ver Política";
}
