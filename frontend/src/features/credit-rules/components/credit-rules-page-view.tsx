"use client";

import { useState } from "react";

import { CreditRuleFormSheet, CreditRuleFormSheetSubmitPayload } from "@/features/credit-rules/components/credit-rule-form-sheet";
import { CreditRulesFilters, PillarFilter, ScoreFilter } from "@/features/credit-rules/components/credit-rules-filters";
import { CreditRulesList } from "@/features/credit-rules/components/credit-rules-list";
import { CreditRulesLoadingState } from "@/features/credit-rules/components/credit-rules-loading-state";
import { CreditRulesOverview } from "@/features/credit-rules/components/credit-rules-overview";
import { CreditPolicyContextMode, CreditRulesPolicyState } from "@/features/credit-rules/components/credit-rules-policy-state";
import { CreditRulesToolbar } from "@/features/credit-rules/components/credit-rules-toolbar";
import { useActiveCreditPolicyQuery } from "@/features/credit-rules/hooks/use-active-credit-policy-query";
import { useCreateCreditPolicyRuleMutation } from "@/features/credit-rules/hooks/use-create-credit-policy-rule-mutation";
import { useDeleteCreditPolicyRuleMutation } from "@/features/credit-rules/hooks/use-delete-credit-policy-rule-mutation";
import { useDraftCreditPolicyQuery } from "@/features/credit-rules/hooks/use-draft-credit-policy-query";
import { usePublishCreditPolicyDraftMutation } from "@/features/credit-rules/hooks/use-publish-credit-policy-draft-mutation";
import { useResetCreditPolicyDraftMutation } from "@/features/credit-rules/hooks/use-reset-credit-policy-draft-mutation";
import { useUpdateCreditPolicyRuleMutation } from "@/features/credit-rules/hooks/use-update-credit-policy-rule-mutation";
import { mapCreditPolicyToViewModel } from "@/features/credit-rules/utils/credit-policy-view-model";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

type SaveFeedbackType = "success" | "error";

type SaveFeedback = {
  type: SaveFeedbackType;
  message: string;
};

function getContextHeadline(context: CreditPolicyContextMode) {
  if (context === "active") {
    return {
      title: "Visualizando: Política ativa",
      description: "Esta é a política usada hoje nas análises. Neste modo, a edição fica desabilitada."
    };
  }

  return {
    title: "Visualizando: Rascunho em edição",
    description: "As alterações feitas aqui só entram em vigor após a publicação."
  };
}

export function CreditRulesPageView() {
  const permissions = getEffectivePermissions();
  const canViewPolicy = hasPermission("credit.policy.view", permissions);
  const canManagePolicy = hasPermission("credit.policy.manage", permissions);
  const activePolicyQuery = useActiveCreditPolicyQuery();
  const draftPolicyQuery = useDraftCreditPolicyQuery();

  const createRuleMutation = useCreateCreditPolicyRuleMutation();
  const updateRuleMutation = useUpdateCreditPolicyRuleMutation();
  const deleteRuleMutation = useDeleteCreditPolicyRuleMutation();
  const publishDraftMutation = usePublishCreditPolicyDraftMutation();
  const resetDraftMutation = useResetCreditPolicyDraftMutation();

  const [selectedContext, setSelectedContext] = useState<CreditPolicyContextMode>("draft");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [pillarFilter, setPillarFilter] = useState<PillarFilter>("all");
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);

  if (!canViewPolicy) {
    return <PermissionDeniedState />;
  }

  const isPageLoading = activePolicyQuery.isLoading || draftPolicyQuery.isLoading;
  if (isPageLoading) {
    return <CreditRulesLoadingState />;
  }

  if (activePolicyQuery.isError || draftPolicyQuery.isError) {
    return (
      <section className="readability-standard space-y-4">
        <ErrorState
          title="Não foi possível carregar a política de crédito"
          description={activePolicyQuery.error?.message ?? draftPolicyQuery.error?.message ?? "Erro desconhecido."}
          onRetry={() => {
            activePolicyQuery.refetch();
            draftPolicyQuery.refetch();
          }}
        />
      </section>
    );
  }

  if (!activePolicyQuery.data || !draftPolicyQuery.data) {
    return <EmptyState title="Política indisponível" description="Não foi possível obter política ativa e rascunho no backend." />;
  }

  const activePolicy = mapCreditPolicyToViewModel(activePolicyQuery.data);
  const draftPolicy = mapCreditPolicyToViewModel(draftPolicyQuery.data);
  const isDraftContext = selectedContext === "draft";
  const currentPolicy = isDraftContext ? draftPolicy : activePolicy;

  const editingRule = editingRuleId === null ? null : draftPolicy.rules.find((rule) => rule.id === editingRuleId) ?? null;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredRules = currentPolicy.rules.filter((rule) => {
    if (scoreFilter !== "all" && rule.score !== scoreFilter) {
      return false;
    }

    if (pillarFilter !== "all" && rule.pillar !== pillarFilter) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const terms = [rule.title, rule.description, rule.source.field, rule.source.operator].join(" ").toLowerCase();
    return terms.includes(normalizedSearch);
  });

  const isAnyMutationPending =
    createRuleMutation.isPending ||
    updateRuleMutation.isPending ||
    deleteRuleMutation.isPending ||
    publishDraftMutation.isPending ||
    resetDraftMutation.isPending;

  async function handleFormSubmit(payload: CreditRuleFormSheetSubmitPayload) {
    try {
      if (payload.mode === "create") {
        await createRuleMutation.mutateAsync(payload.payload);
        setSaveFeedback({ type: "success", message: "Regra criada no rascunho com sucesso." });
      } else {
        await updateRuleMutation.mutateAsync({ ruleId: payload.ruleId, payload: payload.payload });
        setSaveFeedback({ type: "success", message: "Regra atualizada no rascunho com sucesso." });
      }
      setIsFormOpen(false);
      setEditingRuleId(null);
    } catch (error) {
      setSaveFeedback({ type: "error", message: error instanceof Error ? error.message : "Não foi possível salvar a regra." });
    }
  }

  async function handleDeleteRule(ruleId: number) {
    try {
      setDeletingRuleId(ruleId);
      await deleteRuleMutation.mutateAsync(ruleId);
      setSaveFeedback({ type: "success", message: "Regra removida do rascunho com sucesso." });
    } catch (error) {
      setSaveFeedback({ type: "error", message: error instanceof Error ? error.message : "Não foi possível excluir a regra." });
    } finally {
      setDeletingRuleId(null);
    }
  }

  async function handlePublishDraft() {
    try {
      await publishDraftMutation.mutateAsync();
      setSaveFeedback({ type: "success", message: "Rascunho publicado. O motor agora utiliza a nova política ativa." });
      setIsFormOpen(false);
      setEditingRuleId(null);
    } catch (error) {
      setSaveFeedback({ type: "error", message: error instanceof Error ? error.message : "Não foi possível publicar o rascunho." });
    }
  }

  async function handleResetDraft() {
    try {
      await resetDraftMutation.mutateAsync();
      setSaveFeedback({ type: "success", message: "Rascunho resetado com base na política ativa." });
      setIsFormOpen(false);
      setEditingRuleId(null);
    } catch (error) {
      setSaveFeedback({ type: "error", message: error instanceof Error ? error.message : "Não foi possível descartar o rascunho." });
    }
  }

  const contextHeadline = getContextHeadline(selectedContext);

  return (
    <section className="readability-standard space-y-4">
      <CreditRulesToolbar
        activePolicyName={activePolicy.metadata.name}
        draftVersion={draftPolicy.metadata.version}
        selectedContext={selectedContext}
        onCreateRule={() => {
          setSaveFeedback(null);
          setEditingRuleId(null);
          setIsFormOpen(true);
        }}
        showCreateRule={canManagePolicy}
        disableCreateRule={!canManagePolicy || !isDraftContext || isAnyMutationPending}
      />

      {saveFeedback ? (
        <Alert
          variant={saveFeedback.type === "error" ? "destructive" : "default"}
          className={saveFeedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : undefined}
        >
          <AlertTitle>{saveFeedback.type === "success" ? "Operação concluída" : "Falha na operação"}</AlertTitle>
          <AlertDescription>{saveFeedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <CreditRulesPolicyState
        activePolicy={activePolicy.metadata}
        draftPolicy={draftPolicy.metadata}
        activeRulesCount={activePolicy.rules.length}
        draftRulesCount={draftPolicy.rules.length}
        diffSummary={draftPolicy.diffSummary}
        selectedContext={selectedContext}
        onSelectContext={setSelectedContext}
        onPublishDraft={canManagePolicy ? handlePublishDraft : async () => {}}
        onResetDraft={canManagePolicy ? handleResetDraft : async () => {}}
        isPublishing={publishDraftMutation.isPending}
        isResetting={resetDraftMutation.isPending}
        publishDisabled={!canManagePolicy || draftPolicy.diffSummary.total === 0 || isAnyMutationPending}
        resetDisabled={!canManagePolicy || isAnyMutationPending}
        showManageActions={canManagePolicy}
      />

      <div className="rounded-xl border border-[#e5e9f2] bg-white px-4 py-3">
        <p className="text-sm font-semibold text-[#111827]">{contextHeadline.title}</p>
        <p className="mt-1 text-sm text-[#4b5563]">{contextHeadline.description}</p>
      </div>

      <CreditRulesFilters
        scoreFilter={scoreFilter}
        pillarFilter={pillarFilter}
        search={search}
        scoreOptions={currentPolicy.scoreFilterOptions}
        pillarOptions={currentPolicy.pillarFilterOptions}
        onScoreFilterChange={setScoreFilter}
        onPillarFilterChange={setPillarFilter}
        onSearchChange={setSearch}
      />

      <CreditRulesList
        rules={filteredRules}
        totalCount={currentPolicy.rules.length}
        contextLabel={isDraftContext ? "Rascunho em edição" : "Política ativa"}
        canEdit={canManagePolicy && isDraftContext}
        deletingRuleId={deletingRuleId}
        onEditRule={(rule) => {
          if (!canManagePolicy || !isDraftContext) {
            return;
          }
          setSaveFeedback(null);
          setEditingRuleId(rule.id);
          setIsFormOpen(true);
        }}
        onDeleteRule={(rule) => (canManagePolicy && isDraftContext ? handleDeleteRule(rule.id) : Promise.resolve())}
      />

      <CreditRulesOverview overview={activePolicy.overview} />

      <CreditRuleFormSheet
        open={isFormOpen}
        initialRule={editingRule}
        onClose={() => {
          setIsFormOpen(false);
          setEditingRuleId(null);
        }}
        onSubmit={canManagePolicy ? handleFormSubmit : async () => {}}
        submitError={createRuleMutation.error?.message ?? updateRuleMutation.error?.message}
        isSubmitting={createRuleMutation.isPending || updateRuleMutation.isPending}
      />
    </section>
  );
}
