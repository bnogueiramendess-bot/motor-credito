import { creditRuleItemsMock } from "@/features/credit-rules/data/credit-rule-items.mock";
import { CreditRuleItem } from "@/features/credit-rules/types";

export const initialCreditRulesDraft: CreditRuleItem[] = creditRuleItemsMock.map((rule) => ({ ...rule }));
