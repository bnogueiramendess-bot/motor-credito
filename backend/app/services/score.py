from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import ScoreBand
from app.models.external_data_entry import ExternalDataEntry
from app.models.score_result import ScoreResult


class ScoreCalculationError(Exception):
    pass


def _resolve_score_band(score: int) -> ScoreBand:
    if score >= 800:
        return ScoreBand.A
    if score >= 700:
        return ScoreBand.B
    if score >= 600:
        return ScoreBand.C
    return ScoreBand.D


def _apply_adjustment(adjustments: list[dict], score: int, points: int, reason: str, detail: str) -> int:
    adjustments.append(
        {
            "reason": reason,
            "points": points,
            "detail": detail,
        }
    )
    return score + points


def calculate_and_upsert_score(
    db: Session, analysis_id: int
) -> tuple[ScoreResult, ExternalDataEntry, bool]:
    source_entry = db.scalar(
        select(ExternalDataEntry)
        .where(ExternalDataEntry.credit_analysis_id == analysis_id)
        .order_by(ExternalDataEntry.created_at.desc(), ExternalDataEntry.id.desc())
    )
    if source_entry is None:
        raise ScoreCalculationError("No external data found for this analysis.")

    base_score = 1000
    score = base_score
    applied_adjustments: list[dict] = []

    if source_entry.has_restrictions:
        score = _apply_adjustment(
            applied_adjustments,
            score,
            -300,
            "has_restrictions",
            "Restrictions flag is true",
        )

    if source_entry.protests_count > 0:
        points = -50 * source_entry.protests_count
        score = _apply_adjustment(
            applied_adjustments,
            score,
            points,
            "protests_count",
            f"{source_entry.protests_count} protest(s)",
        )

    if source_entry.lawsuits_count > 0:
        points = -40 * source_entry.lawsuits_count
        score = _apply_adjustment(
            applied_adjustments,
            score,
            points,
            "lawsuits_count",
            f"{source_entry.lawsuits_count} lawsuit(s)",
        )

    if source_entry.bounced_checks_count > 0:
        points = -30 * source_entry.bounced_checks_count
        score = _apply_adjustment(
            applied_adjustments,
            score,
            points,
            "bounced_checks_count",
            f"{source_entry.bounced_checks_count} bounced check(s)",
        )

    if (
        source_entry.declared_indebtedness is not None
        and source_entry.declared_revenue is not None
        and source_entry.declared_indebtedness > 0
        and source_entry.declared_revenue > 0
    ):
        debt_ratio = source_entry.declared_indebtedness / source_entry.declared_revenue
        if debt_ratio > Decimal("0.8"):
            score = _apply_adjustment(
                applied_adjustments,
                score,
                -150,
                "debt_ratio",
                f"Debt ratio {debt_ratio:.4f} > 0.8",
            )
        elif debt_ratio > Decimal("0.5"):
            score = _apply_adjustment(
                applied_adjustments,
                score,
                -80,
                "debt_ratio",
                f"Debt ratio {debt_ratio:.4f} between 0.5 and 0.8",
            )
        elif debt_ratio > Decimal("0.3"):
            score = _apply_adjustment(
                applied_adjustments,
                score,
                -30,
                "debt_ratio",
                f"Debt ratio {debt_ratio:.4f} between 0.3 and 0.5",
            )

    final_score = max(0, min(1000, score))
    score_band = _resolve_score_band(final_score)

    calculation_memory_json = {
        "base_score": base_score,
        "applied_adjustments": applied_adjustments,
        "final_score": final_score,
        "score_band": score_band.value,
        "source_entry_id": source_entry.id,
        "source_type": source_entry.source_type.value,
        "summary": f"Final score {final_score} in band {score_band.value} based on external entry {source_entry.id}.",
    }

    score_result = db.scalar(
        select(ScoreResult).where(ScoreResult.credit_analysis_id == analysis_id)
    )
    recalculated = score_result is not None

    if score_result is None:
        score_result = ScoreResult(
            credit_analysis_id=analysis_id,
            base_score=base_score,
            final_score=final_score,
            score_band=score_band,
            calculation_memory_json=calculation_memory_json,
        )
        db.add(score_result)
    else:
        score_result.base_score = base_score
        score_result.final_score = final_score
        score_result.score_band = score_band
        score_result.calculation_memory_json = calculation_memory_json

    return score_result, source_entry, recalculated
