import { CreditRuleItem } from "@/features/credit-rules/types";

export const creditRuleItemsMock: CreditRuleItem[] = [
  {
    id: "rule-a-1",
    score: "A",
    pillar: "externalRisk",
    field: "externalScore",
    label: "Score externo mínimo para perfil A",
    operator: "gte",
    value: 750,
    active: true,
    description: "Garante que clientes com menor risco de mercado permaneçam na faixa A."
  },
  {
    id: "rule-a-2",
    score: "A",
    pillar: "legal",
    field: "protestCount",
    label: "Sem protestos relevantes para score A",
    operator: "lte",
    value: 0,
    active: true
  },
  {
    id: "rule-a-3",
    score: "A",
    pillar: "internalHistory",
    field: "averageDelayDays",
    label: "Atraso médio máximo da carteira A",
    operator: "lte",
    value: 5,
    active: true
  },
  {
    id: "rule-a-4",
    score: "A",
    pillar: "financialCapacity",
    field: "limitToRevenueRatio",
    label: "Relação limite/faturamento conservadora",
    operator: "lte",
    value: 0.2,
    active: true
  },
  {
    id: "rule-b-1",
    score: "B",
    pillar: "externalRisk",
    field: "externalScore",
    label: "Faixa de score externo para perfil B",
    operator: "gte",
    value: 700,
    active: true
  },
  {
    id: "rule-b-2",
    score: "B",
    pillar: "internalHistory",
    field: "averageDelayDays",
    label: "Atraso médio máximo da carteira B",
    operator: "lte",
    value: 15,
    active: true
  },
  {
    id: "rule-b-3",
    score: "B",
    pillar: "legal",
    field: "legalProceedings",
    label: "Aceita apenas ocorrências jurídicas leves",
    operator: "allowed",
    value: true,
    active: true
  },
  {
    id: "rule-c-1",
    score: "C",
    pillar: "externalRisk",
    field: "externalScore",
    label: "Faixa mínima de score externo para perfil C",
    operator: "gte",
    value: 650,
    active: true
  },
  {
    id: "rule-c-2",
    score: "C",
    pillar: "internalHistory",
    field: "averageDelayDays",
    label: "Atraso médio máximo da carteira C",
    operator: "lte",
    value: 30,
    active: true
  },
  {
    id: "rule-c-3",
    score: "C",
    pillar: "financialCapacity",
    field: "limitToRevenueRatio",
    label: "Relação limite/faturamento em zona de atenção",
    operator: "lte",
    value: 0.35,
    active: true
  },
  {
    id: "rule-d-1",
    score: "D",
    pillar: "externalRisk",
    field: "externalScore",
    label: "Score externo abaixo da faixa de segurança",
    operator: "lte",
    value: 649,
    active: true
  },
  {
    id: "rule-d-2",
    score: "D",
    pillar: "legal",
    field: "legalProceedings",
    label: "Processos impeditivos classificam alto risco",
    operator: "not_allowed",
    value: true,
    active: true
  },
  {
    id: "rule-d-3",
    score: "D",
    pillar: "internalHistory",
    field: "averageDelayDays",
    label: "Atraso médio acima de 30 dias",
    operator: "gte",
    value: 31,
    active: true
  },
  {
    id: "rule-d-4",
    score: "D",
    pillar: "financialCapacity",
    field: "limitToRevenueRatio",
    label: "Limite incompatível com o faturamento",
    operator: "gte",
    value: 0.36,
    active: true
  }
];
