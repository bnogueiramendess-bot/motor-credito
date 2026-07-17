import test from "node:test";
import assert from "node:assert/strict";

import { resolveAnalysisJourneyReadOnly } from "./workspace-readonly";

test("resolve readonly state for technical workspace lifecycle", () => {
  const cases = [
    {
      name: "in_progress with authorized analyst is editable",
      input: { analysisStatus: "in_progress", hasTechnicalContinuationCapability: true },
      expected: false,
    },
    {
      name: "changes_requested remains editable even after a previous submission",
      input: {
        analysisStatus: "changes_requested",
        submittedForApprovalAt: "2026-07-17T10:00:00Z",
        availableActions: ["continue_analysis"],
        hasTechnicalContinuationCapability: false,
      },
      expected: false,
    },
    {
      name: "in_approval is technical readonly",
      input: { analysisStatus: "in_approval", availableActions: ["continue_analysis"], hasTechnicalContinuationCapability: true },
      expected: true,
    },
    {
      name: "approved is readonly",
      input: { analysisStatus: "approved", availableActions: ["continue_analysis"], hasTechnicalContinuationCapability: true },
      expected: true,
    },
    {
      name: "rejected is readonly",
      input: { analysisStatus: "rejected", availableActions: ["continue_analysis"], hasTechnicalContinuationCapability: true },
      expected: true,
    },
    {
      name: "completed is readonly",
      input: { analysisStatus: "completed", availableActions: ["continue_analysis"], hasTechnicalContinuationCapability: true },
      expected: true,
    },
    {
      name: "cancelled is readonly",
      input: { analysisStatus: "cancelled", availableActions: ["continue_analysis"], hasTechnicalContinuationCapability: true },
      expected: true,
    },
    {
      name: "missing technical edit action is readonly",
      input: { analysisStatus: "in_progress", hasTechnicalContinuationCapability: false, availableActions: [] },
      expected: true,
    },
  ];

  for (const item of cases) {
    assert.equal(
      resolveAnalysisJourneyReadOnly({
        isWorkspaceMode: true,
        availableActions: [],
        submittedForApprovalAt: null,
        finalDecision: null,
        ...item.input,
      }),
      item.expected,
      item.name
    );
  }
});
