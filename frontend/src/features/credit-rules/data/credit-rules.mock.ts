import { CreditScore, CreditScoreRuleSet } from "@/features/credit-rules/types";

export const creditScoreOrder: CreditScore[] = ["A", "B", "C", "D"];

export const creditRulesByScore: Record<CreditScore, CreditScoreRuleSet> = {
  A: {
    score: "A",
    label: "Score A",
    riskSubtitle: "Baixo risco",
    summary: "Perfil com sinais consistentes de estabilidade e baixa probabilidade de inadimplência.",
    decisionImpact: "Elegível para aprovação com condições comerciais mais favoráveis.",
    practicalExample:
      "Empresa com score externo elevado, histórico interno estável e relação de limite compatível com o faturamento.",
    groups: {
      externalRisk: {
        title: "Risco externo",
        description: "Sinais de mercado e compromissos financeiros com baixa exposição.",
        rules: [
          "Score externo mínimo de 750 pontos.",
          "Sem protestos relevantes em bases consultadas.",
          "Baixo volume de restrições financeiras ativas."
        ]
      },
      legal: {
        title: "Jurídico",
        description: "Situação jurídica estável, sem impeditivos relevantes para concessão.",
        rules: [
          "Sem processos relevantes com impacto direto de crédito.",
          "Sem ocorrências impeditivas em órgãos de consulta."
        ]
      },
      internalHistory: {
        title: "Histórico interno",
        description: "Relacionamento com comportamento previsível e saudável.",
        rules: [
          "Atraso médio de pagamento de até 5 dias.",
          "Poucas intercorrências operacionais no histórico recente."
        ]
      },
      financialCapacity: {
        title: "Capacidade financeira",
        description: "Estrutura financeira confortável para suportar o limite solicitado.",
        rules: [
          "Relação limite/faturamento em faixa conservadora.",
          "Sinais de geração de caixa adequados ao compromisso."
        ]
      }
    }
  },
  B: {
    score: "B",
    label: "Score B",
    riskSubtitle: "Atenção leve",
    summary: "Perfil com risco controlado, mas com pontos de atenção moderados.",
    decisionImpact: "Elegível para aprovação, com monitoramento e eventuais ajustes de condições.",
    practicalExample:
      "Empresa com score externo na faixa intermediária alta, baixa restrição e atraso pontual sem impacto estrutural.",
    groups: {
      externalRisk: {
        title: "Risco externo",
        description: "Sinais de mercado positivos, com pequenas ocorrências não críticas.",
        rules: [
          "Score externo entre 700 e 749 pontos.",
          "Baixo volume de restrições financeiras.",
          "Possível ocorrência leve não impeditiva."
        ]
      },
      legal: {
        title: "Jurídico",
        description: "Quadro jurídico com alertas leves, sem bloqueio de decisão.",
        rules: [
          "Sem processos impeditivos relevantes.",
          "Ocorrências jurídicas de baixa materialidade podem ser aceitas."
        ]
      },
      internalHistory: {
        title: "Histórico interno",
        description: "Relacionamento geralmente saudável, com atrasos sob controle.",
        rules: [
          "Atraso médio de pagamento de até 15 dias.",
          "Padrão de regularização observado em boa parte dos ciclos."
        ]
      },
      financialCapacity: {
        title: "Capacidade financeira",
        description: "Capacidade de pagamento ainda confortável para o limite avaliado.",
        rules: [
          "Relação limite/faturamento ainda saudável.",
          "Comprometimento financeiro em faixa aceitável para a política."
        ]
      }
    }
  },
  C: {
    score: "C",
    label: "Score C",
    riskSubtitle: "Atenção",
    summary: "Perfil com risco elevado em parte dos pilares, exigindo maior cautela na decisão.",
    decisionImpact: "Tende a revisão manual e condições mais restritivas de concessão.",
    practicalExample:
      "Empresa com sinais externos moderados, histórico interno irregular e capacidade financeira pressionada para o limite pedido.",
    groups: {
      externalRisk: {
        title: "Risco externo",
        description: "Sinais de mercado mistos, com exposição moderada ao risco.",
        rules: [
          "Score externo entre 650 e 699 pontos.",
          "Presença moderada de restrições em fontes consultadas.",
          "Conjunto externo pede atenção adicional na análise."
        ]
      },
      legal: {
        title: "Jurídico",
        description: "Ocorrências jurídicas que não bloqueiam sozinhas, mas aumentam o risco agregado.",
        rules: [
          "Existência de registros jurídicos com potencial de impacto financeiro.",
          "Necessidade de validação complementar conforme materialidade."
        ]
      },
      internalHistory: {
        title: "Histórico interno",
        description: "Comportamento de pagamento inconsistente em ciclos recentes.",
        rules: [
          "Atraso médio de pagamento de até 30 dias.",
          "Maior frequência de oscilações no relacionamento interno."
        ]
      },
      financialCapacity: {
        title: "Capacidade financeira",
        description: "Sinais de pressão na capacidade de absorver o limite proposto.",
        rules: [
          "Capacidade financeira pressionada para o patamar de crédito avaliado.",
          "Relação limite/faturamento próxima da zona de atenção."
        ]
      }
    }
  },
  D: {
    score: "D",
    label: "Score D",
    riskSubtitle: "Alto risco",
    summary: "Perfil com combinação de sinais críticos e alta chance de inadimplência.",
    decisionImpact: "Tende à recusa ou encaminhamento para tratativa excepcional.",
    practicalExample:
      "Empresa com score externo baixo, restrições relevantes e limite solicitado incompatível com o faturamento.",
    groups: {
      externalRisk: {
        title: "Risco externo",
        description: "Sinais de mercado com alta exposição a inadimplência.",
        rules: [
          "Score externo abaixo de 650 pontos.",
          "Restrições financeiras relevantes em bases consultadas.",
          "Conjunto externo classificado como de alto risco."
        ]
      },
      legal: {
        title: "Jurídico",
        description: "Ocorrências jurídicas com potencial impeditivo para concessão.",
        rules: [
          "Presença de processos impeditivos relevantes.",
          "Combinação de ocorrências legais que eleva substancialmente o risco."
        ]
      },
      internalHistory: {
        title: "Histórico interno",
        description: "Relacionamento com recorrência de atraso e baixa previsibilidade.",
        rules: [
          "Atraso médio de pagamento acima de 30 dias.",
          "Histórico com recorrência de descasamento de prazos."
        ]
      },
      financialCapacity: {
        title: "Capacidade financeira",
        description: "Capacidade de pagamento insuficiente para suportar o limite solicitado.",
        rules: [
          "Limite solicitado incompatível com o faturamento.",
          "Comprometimento financeiro acima da faixa aceita na política."
        ]
      }
    }
  }
};
