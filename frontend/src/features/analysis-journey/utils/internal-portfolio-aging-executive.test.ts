import test from "node:test";
import assert from "node:assert/strict";

import { resolveExecutiveAgingComposition } from "./internal-portfolio-aging-executive.ts";

test("cenario saudavel exibe not due 100 e mensagem saudavel", () => {
  const result = resolveExecutiveAgingComposition({
    sources: [],
    openAmount: 166000,
    notDueAmount: 166000,
    overdueAmount: 0,
    hasOpenBase: true,
    hasConsistentComposition: true,
  });

  assert.equal(result.message, "Carteira saudável, sem overdue interno relevante.");
  assert.equal(result.summary, "Not Due 100%");
});

test("usa buckets canonicos quando presentes na fonte", () => {
  const result = resolveExecutiveAgingComposition({
    sources: [
      {
        aging_buckets: {
          not_due: [{ bucket: "0-30", amount: 720 }],
          overdue: [
            { bucket: "31-60", amount: 180 },
            { bucket: "61-90", amount: 100 },
          ],
        },
      },
    ],
    openAmount: 1000,
    notDueAmount: 720,
    overdueAmount: 280,
    hasOpenBase: true,
    hasConsistentComposition: true,
  });

  assert.equal(result.summary, "Not Due 72% · 31–60 18% · 61–90 10%");
  assert.equal(result.message, "Overdue moderado concentrado em 31–60 dias.");
});

test("detecta deterioracao relevante acima de 90 dias", () => {
  const result = resolveExecutiveAgingComposition({
    sources: [
      {
        aging_buckets: {
          not_due: [{ bucket: "Not Due", amount: 400 }],
          overdue: [
            { bucket: "31-60", amount: 200 },
            { bucket: "61-90", amount: 150 },
            { bucket: "91-180", amount: 250 },
          ],
        },
      },
    ],
    openAmount: 1000,
    notDueAmount: 400,
    overdueAmount: 600,
    hasOpenBase: true,
    hasConsistentComposition: true,
  });

  assert.equal(result.message, "Carteira com deterioração relevante acima de 90 dias.");
});
