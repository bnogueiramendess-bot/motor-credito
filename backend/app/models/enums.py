from enum import StrEnum


class AnalysisStatus(StrEnum):
    CREATED = "created"
    IN_PROGRESS = "in_progress"
    IN_APPROVAL = "in_approval"
    CHANGES_REQUESTED = "changes_requested"
    COMPLETED = "completed"


class MotorResult(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    MANUAL_REVIEW = "manual_review"


class FinalDecision(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    MANUAL_REVIEW = "manual_review"


class ActorType(StrEnum):
    SYSTEM = "system"
    USER = "user"


class EntryMethod(StrEnum):
    MANUAL = "manual"
    UPLOAD = "upload"
    AUTOMATIC = "automatic"


class SourceType(StrEnum):
    AGRISK = "agrisk"
    SERASA = "serasa"
    SCR = "scr"
    INTERNAL_SHEET = "internal_sheet"
    OTHER = "other"


class ScoreBand(StrEnum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class ProfileConsolidationStatus(StrEnum):
    PROFILE_NOT_CONSOLIDATED = "profile_not_consolidated"
    PROFILE_PARTIALLY_CONSOLIDATED = "profile_partially_consolidated"
    PROFILE_CONSOLIDATED = "profile_consolidated"


class CreditPolicyStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"
