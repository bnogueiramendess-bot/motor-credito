from enum import StrEnum


class AnalysisStatus(StrEnum):
    CREATED = "created"
    IN_PROGRESS = "in_progress"
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
