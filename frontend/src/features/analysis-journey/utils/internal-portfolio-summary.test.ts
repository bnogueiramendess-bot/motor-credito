import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveInternalPortfolioSummary,
  resolveInternalPortfolioSummaryFromSources,
} from "./internal-portfolio-summary.ts";

test("preserva fonte consistente de composição e limites", () => {
  const result = resolveInternalPortfolioSummaryFromSources({
    sources: [
      {
        open_amount: 165915,
        not_due_amount: 165915,
        overdue_amount: 0,
        total_limit: 4500000,
        available_limit: 4334085,
      },
    ],
  });

  assert.equal(result.openAmount, 165915);
  assert.equal(result.notDueAmount, 165915);
  assert.equal(result.overdueAmount, 0);
  assert.equal(result.currentLimit, 4500000);
  assert.equal(result.availableLimit, 4334085);
  assert.equal(result.hasConsistentComposition, true);
});

test("não mistura open_amount de uma fonte com not_due/overdue de outra fonte inconsistente", () => {
  const result = resolveInternalPortfolioSummaryFromSources({
    sources: [
      {
        open_amount: 165915,
        overdue_amount: 0,
      },
      {
        not_due_amount: 2000000,
        overdue_amount: 0,
      },
    ],
  });

  assert.equal(result.openAmount, 165915);
  assert.equal(result.notDueAmount, null);
  assert.equal(result.overdueAmount, 0);
  assert.notEqual(result.notDueAmount, 2000000);
  assert.equal(result.hasConsistentComposition, false);
});

test("composição inválida é marcada como inconsistente", () => {
  const result = resolveInternalPortfolioSummary({
    openAmount: 165915,
    notDueAmount: 2000000,
    overdueAmount: 0,
    currentLimit: 4500000,
    availableLimit: 4334085,
  });

  assert.equal(result.hasConsistentComposition, false);
});

test("fallback de limites é resolvido sem contaminar composição inconsistente", () => {
  const result = resolveInternalPortfolioSummaryFromSources({
    sources: [
      {
        open_amount: 165915,
      },
      {
        not_due_amount: 2000000,
        overdue_amount: 0,
        total_limit: 4500000,
        available_limit: 4334085,
      },
    ],
  });

  assert.equal(result.openAmount, 165915);
  assert.equal(result.notDueAmount, null);
  assert.equal(result.overdueAmount, null);
  assert.equal(result.currentLimit, 4500000);
  assert.equal(result.availableLimit, 4334085);
  assert.equal(result.hasConsistentComposition, false);
});

test("ignora totais agregados de not due/overdue para composição do cliente", () => {
  const result = resolveInternalPortfolioSummaryFromSources({
    sources: [
      {
        open_amount: 165915,
        total_not_due_amount: 2000000,
        total_overdue_amount: 0,
        approved_credit_amount: 4500000,
      },
    ],
  });

  assert.equal(result.openAmount, 165915);
  assert.equal(result.notDueAmount, null);
  assert.equal(result.overdueAmount, null);
  assert.equal(result.currentLimit, 4500000);
  assert.equal(result.hasConsistentComposition, false);
});
