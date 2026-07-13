from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend" / "src"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8-sig")


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



def test_changes_requested_overrides_previous_submission_readonly_flag() -> None:
    content = read("frontend/src/features/analysis-journey/components/new-analysis-page-view.tsx")

    assert 'status !== "changes_requested"' in content
    assert "isReturnedForChanges" in content
    assert "hasTechnicalWorkspaceEditCapability" in content
