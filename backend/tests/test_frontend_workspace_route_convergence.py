from __future__ import annotations

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend" / "src"
TECHNICAL_EDIT_ACTIONS = {"start_analysis", "continue_analysis", "execute_analysis"}
TECHNICALLY_EDITABLE_STATUSES = {"created", "in_progress", "changes_requested"}
FINAL_READ_ONLY_STATUSES = {"approved", "rejected", "completed", "cancelled"}


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8-sig")


def resolve_journey_readonly(
    *,
    status: str,
    has_technical_continuation_capability: bool = False,
    available_actions: tuple[str, ...] = (),
    submitted_for_approval_at: str | None = None,
    final_decision: str | None = None,
) -> bool:
    has_technical_edit_capability = (
        has_technical_continuation_capability or bool(TECHNICAL_EDIT_ACTIONS.intersection(available_actions))
    ) and status in TECHNICALLY_EDITABLE_STATUSES
    approval_locked_by_status = status == "in_approval" or (
        submitted_for_approval_at is not None and status != "changes_requested" and status not in TECHNICALLY_EDITABLE_STATUSES
    )

    return (
        not has_technical_edit_capability
        or final_decision is not None
        or status in FINAL_READ_ONLY_STATUSES
        or approval_locked_by_status
    )


def test_legacy_analysis_route_redirects_to_workspace() -> None:
    content = read("frontend/src/app/(app)/analises/[analysisId]/page.tsx")

    assert "AnalysisDetailPageView" not in content
    assert "redirect(getCreditAnalysisWorkspaceRoute(analysisId))" in content


def test_historical_dossier_route_redirects_to_workspace() -> None:
    content = read("frontend/src/app/(app)/credit-analysis/[id]/dossier/page.tsx")

    assert "redirect(getCreditAnalysisWorkspaceRoute(params.id))" in content
    assert "redirect(`/analises/${params.id}`)" not in content


def test_internal_analysis_navigation_uses_workspace_route_helper() -> None:
    checked_files = [
        "frontend/src/features/credit-analyses/components/monitor-page-view.tsx",
        "frontend/src/features/dashboard/components/dashboard-analysis-card.tsx",
        "frontend/src/features/credit-analyses/components/analysis-list-cards.tsx",
        "frontend/src/features/credit-analyses/components/analysis-queue-card.tsx",
        "frontend/src/features/credit-analysis/components/new-credit-analysis-page-view.tsx",
        "frontend/src/features/credit-analyses/components/approval-queue-page-view.tsx",
    ]

    for file_name in checked_files:
        content = read(file_name)
        assert "getCreditAnalysisWorkspaceRoute" in content, file_name
        assert "href={`/analises/${" not in content, file_name
        assert "router.push(`/analises/${" not in content, file_name


def test_legacy_detail_components_are_not_rendered_by_internal_routes() -> None:
    route_content = read("frontend/src/app/(app)/analises/[analysisId]/page.tsx")

    assert "analysis-detail-page-view" not in route_content
    assert "analysis-detail-cards" not in route_content
    assert "use-credit-analysis-detail-query" not in route_content


@pytest.mark.parametrize(
    ("case", "status", "has_capability", "actions", "submitted_at", "expected_readonly"),
    [
        ("in_progress + authorized analyst", "in_progress", True, (), None, False),
        ("changes_requested + previous submission", "changes_requested", False, ("continue_analysis",), "2026-07-17T10:00:00Z", False),
        ("in_approval technical readonly", "in_approval", True, ("continue_analysis",), "2026-07-17T10:00:00Z", True),
        ("approved readonly", "approved", True, ("continue_analysis",), None, True),
        ("rejected readonly", "rejected", True, ("continue_analysis",), None, True),
        ("completed readonly", "completed", True, ("continue_analysis",), None, True),
        ("cancelled readonly", "cancelled", True, ("continue_analysis",), None, True),
        ("missing technical edit action", "in_progress", False, (), None, True),
    ],
)
def test_workspace_readonly_rule(
    case: str,
    status: str,
    has_capability: bool,
    actions: tuple[str, ...],
    submitted_at: str | None,
    expected_readonly: bool,
) -> None:
    assert (
        resolve_journey_readonly(
            status=status,
            has_technical_continuation_capability=has_capability,
            available_actions=actions,
            submitted_for_approval_at=submitted_at,
        )
        is expected_readonly
    ), case


def test_changes_requested_overrides_previous_submission_readonly_flag() -> None:
    component = read("frontend/src/features/analysis-journey/components/new-analysis-page-view.tsx")
    helper = read("frontend/src/features/analysis-journey/utils/workspace-readonly.ts")

    assert "workspace-readonly" in component
    assert "resolveAnalysisJourneyReadOnly({" in component
    assert "resolveTechnicalWorkspaceEditCapability({" in component
    assert "export function resolveAnalysisJourneyReadOnly" in helper
    assert (
        resolve_journey_readonly(
            status="changes_requested",
            available_actions=("continue_analysis",),
            submitted_for_approval_at="2026-07-17T10:00:00Z",
        )
        is False
    )
