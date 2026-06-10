# Política de Decisão do Motor de Crédito v1 (COFACE-first)

## 1. Visão Geral
Este documento formaliza a Política de Decisão v1 do Motor de Crédito para orientar a evolução segura do motor configurável, sem alterar o comportamento atual em produção.

Escopo desta definição:
- Política funcional/técnica de decisão.
- Fonte de verdade no backend.
- Sem conexão com o motor atual nesta etapa.
- Sem alteração de workflow, frontend ou regras de execução vigentes.

Estado atual da base:
- Fundação de política configurável já existente (modelo, versionamento, endpoints, política ativa default, preview resolver e testes).
- Feature flag `credit_decision_policy_engine_enabled` permanece desligada (`false`).

## 2. Princípios da Política COFACE-first
1. COFACE é base primária de concessão quando houver cobertura válida.
2. Receita/faturamento não é obrigatória globalmente.
3. Cálculo financeiro é obrigatório apenas quando a decisão depender da capacidade financeira própria do cliente.
4. Com cobertura COFACE suficiente, a decisão pode ser determinística.
5. Limite COFACE é teto automático para recomendações do motor quando houver cobertura válida.
6. Quando houver exposição descoberta, o motor deve explicitar a exposição.
7. Cliente existente considera limite atual e histórico interno.
8. Cliente novo considera COFACE, Agrisk e complemento financeiro/manual.
9. Agrisk severo gera alerta, mas não bloqueia decisão baseada em COFACE.
10. Backend é a fonte da verdade para decisão.
11. Frontend não recalcula decisão.

## 2.1 Estratégia de Decisão
A Política deve separar explicitamente cálculo, recomendação e aprovação.

### Tipo 1 — Decisão Determinística
Aplicável quando a política possuir regra objetiva suficiente para recomendação automática.

Exemplo:
- Cliente existente com COFACE válida.
- Cliente novo com COFACE válida, conforme regras do cenário C.

Resultado:
- Motor gera recomendação objetiva.
- Motor registra a base da recomendação no dossiê.
- Recomendação pode ser automática quando não houver bloqueio ou exigência complementar definida na política.

### Tipo 2 — Decisão Assistida
Aplicável quando a política não deve executar decisão automática.

Exemplos:
- Cliente existente sem COFACE.
- Cliente novo sem COFACE.

Resultado:
- Motor não decide automaticamente.
- Motor não recomenda aumento, redução ou manutenção de limite.
- Motor organiza evidências.
- Motor produz dossiê.
- Motor sugere análise.
- Destino: Comitê de Crédito.

## 3. Cenários de Decisão
Grupos principais:
- A. Cliente existente com COFACE
- B. Cliente existente sem COFACE
- C. Cliente novo com COFACE
- D. Cliente novo sem COFACE

## 4. Regras por Cenário
### 4.1 Cenário A — Cliente existente com COFACE
Condição de entrada:
- Cliente identificado como existente na base/carteira.
- Cobertura COFACE válida disponível.

#### A1. COFACE = limite atual
- Recomendação: `Manutenção do Limite Atual`
- `recommendation_code`: `maintain_current_limit`
- Limite recomendado: `limite_atual`
- Impacto financeiro: `0`
- Exige receita: `não`
- Exige cálculo financeiro: `não`
- Decisão: determinística

#### A2. COFACE < limite atual
- Recomendação: `Redução de Limite devido Exposição com a COFACE`
- `recommendation_code`: `reduce_to_coface_limit`
- Limite recomendado: `coface`
- Impacto financeiro: `coface - limite_atual` (negativo)
- Exige receita: `não`
- Exige cálculo financeiro: `não`
- Decisão: determinística

#### A3. COFACE > limite atual e solicitado > COFACE
- Recomendação: `Aumento do Limite conforme Cobertura da COFACE`
- `recommendation_code`: `increase_to_coface_limit`
- Limite recomendado: `coface`
- Impacto financeiro: `coface - limite_atual` (positivo)
- Exige receita: `não`
- Exige cálculo financeiro: `não`
- Decisão: determinística

#### A4. COFACE > limite atual e solicitado <= COFACE
- Recomendação: `Aprovação do Limite Solicitado conforme Cobertura da COFACE`
- `recommendation_code`: `approve_requested_with_coface`
- Limite recomendado: `solicitado`
- Impacto financeiro: `solicitado - limite_atual`
- Exige receita: `não`
- Exige cálculo financeiro: `não`
- Decisão: determinística

Fallback no cenário A:
- Sem COFACE válida: redirecionar para cenário B.
- Dados inconsistentes: marcar para revisão manual.

### 4.2 Cenário B — Cliente existente sem COFACE
Condição de entrada:
- Cliente existente.
- Sem COFACE válida.

Regra definida:
- Estratégia de decisão: `Decisão Assistida`.
- Não executa decisão automática.
- Não recomenda aumento de limite.
- Não recomenda redução de limite.
- Não recomenda manutenção de limite.
- Dossiê é montado normalmente com as evidências disponíveis.
- Resultado: `Encaminhar ao Comitê de Crédito`.

Justificativa:
- Cliente existente sem cobertura COFACE válida.
- Necessidade de avaliação colegiada pelo Comitê de Crédito.

### 4.3 Cenário C — Cliente novo com COFACE
Condição de entrada:
- Cliente novo.
- COFACE válida disponível.

#### C1. COFACE < solicitado
- Recomendação: `Aprovação Parcial devido Exposição com a COFACE`
- Limite recomendado: `coface`
- Exposição: `solicitado - coface`
- Exige receita: `não` (padrão v1)
- Exige cálculo financeiro: `não`, salvo exigência complementar da política

#### C2. COFACE >= solicitado
- Recomendação: `Aprovação do Limite Solicitado conforme Cobertura da COFACE`
- Limite recomendado: `solicitado`
- Exige receita: `não` (padrão v1)
- Exige cálculo financeiro: `não`

Regra Agrisk:
- Agrisk severo não bloqueia decisão baseada em COFACE.
- O motor deve registrar alerta no dossiê.
- O motor deve destacar o risco identificado.
- A recomendação deve permanecer baseada na cobertura COFACE.

### 4.4 Cenário D — Cliente novo sem COFACE
Condição de entrada:
- Cliente novo.
- Sem COFACE válida.

Regra definida:
- Estratégia de decisão: `Decisão Assistida`.
- Não executa decisão automática.
- Não recomenda aprovação total ou parcial.
- Não recomenda aumento, redução ou manutenção de limite.
- Dossiê é montado normalmente com as evidências disponíveis.
- Resultado: `Encaminhar ao Comitê de Crédito`.

Justificativa:
- Cliente novo sem cobertura COFACE.
- Necessidade de avaliação colegiada pelo Comitê de Crédito.

## 5. Entradas Obrigatórias e Opcionais
Entradas base:
- `cliente_na_base` (bool)
- `limite_atual` (decimal)
- `limite_solicitado` (decimal)
- `coface_limit` (decimal|nulo)
- `agrisk_status/sinalizadores` (recomendado para qualificar o dossiê; obrigatório apenas se a política/comitê definir como requisito documental mínimo)
- `receita_faturamento` (condicional)
- `indicadores internos` (overdue, histórico, exposição aberta)
- `complemento_manual` (condicional)

Obrigatórias por cenário:
- A: limite atual, solicitado, COFACE.
- B: limite atual, solicitado e dados internos disponíveis para montagem do dossiê.
- C: solicitado, COFACE; Agrisk, quando disponível, gera alertas sem alterar a recomendação COFACE-first.
- D: solicitado e evidências disponíveis para montagem do dossiê.

## 6. Uso dos Pilares
Pesos atuais v1:
- Estabilidade Financeira e Liquidez: `55%`
- Garantias / Seguro de Crédito: `20%`
- Condições de Mercado: `15%`
- Histórico de Pagamento: `5%`
- Histórico de Relacionamento: `5%`

Regras de governança:
- Soma obrigatória: `100%`.
- Pesos configuráveis na política ativa.
- Mudança de peso gera nova versão de política.
- Política ativa não é editada diretamente.

Aplicação prática:
- Cenários determinísticos COFACE-first: pilares podem ser informativos.
- Cenários sem COFACE: pilares e insumos financeiros podem compor o dossiê, mas não determinam limite automaticamente.
- Em cenários com COFACE válida, o limite COFACE é o teto automático da recomendação do motor.

### 6.1 Pilar 1 — Estabilidade Financeira e Liquidez
O Pilar 1 representa a avaliação de estabilidade financeira e liquidez do cliente dentro do score institucional.

Peso inicial do Pilar 1 no score institucional:
- Estabilidade Financeira e Liquidez: `55%`

Governança do peso:
- O peso do Pilar 1 deve ser configurável na Política.
- O peso não deve ser hardcoded no motor.
- Toda alteração no peso do Pilar 1 deve gerar nova versão da política.
- Política ativa não pode ser editada diretamente.

#### 6.1.1 Regra Geral COFACE
Cliente com COFACE:
- Quando existir cobertura COFACE válida, o Pilar 1 recebe nota `10/10`.
- Motivo: risco financeiro mitigado por Seguro de Crédito COFACE.
- Neste cenário, não calcular indicadores financeiros.
- Neste cenário, não processar Agrisk Financeiro.
- Neste cenário, não executar fórmula financeira.
- Registrar a justificativa no dossiê.
- Agrisk severo deve gerar alerta no dossiê, sem bloquear a recomendação COFACE-first.

Cliente sem COFACE:
- Quando não existir cobertura COFACE válida, o Pilar 1 deve ser calculado.
- A fonte principal do cálculo é o Relatório Agrisk de Análise Financeira.

Cliente sem COFACE e sem Agrisk Financeiro:
- Nota: `0/10`.
- Status: `Não disponibilizado`.
- Exibir a justificativa no dossiê.

#### 6.1.2 Subgrupos do Pilar 1
Estrutura inicial aprovada:

| Subgrupo | Peso Inicial |
|---|---:|
| Liquidez | 35% |
| Geração de Caixa | 25% |
| Endividamento / Alavancagem | 20% |
| Rentabilidade / Eficiência | 15% |
| Qualidade dos Dados | 5% |

Regras:
- Pesos dos subgrupos são configuráveis.
- Soma obrigatória dos pesos dos subgrupos: `100%`.
- Não permitir salvar política com soma diferente de `100%`.

#### 6.1.3 Indicadores por Subgrupo
Liquidez:

| Indicador | Peso Inicial |
|---|---:|
| Liquidez Corrente | 40% |
| Liquidez Seca | 30% |
| Liquidez Geral | 20% |
| Liquidez Imediata | 10% |

Geração de Caixa:

| Indicador | Peso Inicial |
|---|---:|
| EBITDA | 40% |
| Fluxo de Caixa | 35% |
| Resultado DRE | 25% |

Endividamento / Alavancagem:

| Indicador | Peso Inicial |
|---|---:|
| Endividamento | 60% |
| Alavancagem Financeira | 40% |

Rentabilidade / Eficiência:

| Indicador | Peso Inicial |
|---|---:|
| Margem Bruta | 60% |
| Índice Operacional | 40% |

Qualidade dos Dados:

| Indicador | Peso Inicial |
|---|---:|
| Inconsistências Financeiras | 40% |
| Alertas Críticos | 40% |
| Anomalias Detectadas | 20% |

Regras:
- Pesos dos indicadores são configuráveis.
- Soma obrigatória dos pesos dos indicadores de cada subgrupo: `100%`.
- Não permitir salvar política com indicadores inconsistentes.

#### 6.1.4 Níveis Parametrizáveis
Todos os níveis do Pilar 1 são parametrizáveis pela Política:

| Nível | Configuração |
|---|---|
| Nível 1 | Peso do Pilar |
| Nível 2 | Peso dos Subgrupos |
| Nível 3 | Peso dos Indicadores |
| Nível 4 | Faixas de pontuação |

Exemplo de faixas de pontuação:

| Operador | Valor | Nota |
|---|---:|---:|
| >= | 1,50 | 10 |
| >= | 1,20 | 8 |
| >= | 1,00 | 6 |
| >= | 0,80 | 4 |
| > | 0 | 2 |
| = | 0 | 0 |

#### 6.1.5 Regras de Configuração
Regras obrigatórias:
- Soma dos pesos dos subgrupos do Pilar 1 deve ser `100%`.
- Soma dos pesos dos indicadores de cada subgrupo deve ser `100%`.
- A Política não deve permitir salvar configuração inconsistente.
- Toda alteração deve gerar nova versão da política.
- Política ativa não pode ser editada diretamente.

## 7. Obrigatoriedade de Receita/Faturamento
Receita obrigatória quando:
- Decisão depende de capacidade financeira própria.
- Aprovação envolve exposição descoberta relevante.

Receita não obrigatória quando:
- Cliente existente com COFACE suficiente.
- Manutenção/redução baseada em COFACE.
- Cliente novo com COFACE suficiente, salvo regra adicional de risco.
- Cenários B e D, pois não há decisão automática e o caso é encaminhado ao Comitê de Crédito com dossiê.

Pendências:
- Substituição parcial por EBITDA/lucro.
- Limiar de “exposição relevante”.

## 8. Tratamento de Ausência de Dados
Diretrizes:
- Dados críticos ausentes impedem decisão automática.
- Motor deve sinalizar `manual_review_required=true` quando faltarem entradas mandatórias do cenário.
- Sempre explicitar motivo (`reason`) e insumos ausentes.

Exemplos:
- Sem COFACE em cenário A/C: redirecionar para B/D.
- Sem COFACE em B/D: montar dossiê e encaminhar ao Comitê de Crédito.
- Agrisk ausente (quando obrigatório): revisão manual.

## 9. Resultado Esperado por Regra
Saída mínima por regra:
- Recomendação textual.
- Limite recomendado.
- Fonte do limite recomendado.
- Impacto financeiro.
- Exposição descoberta (quando aplicável).
- Necessidade de cálculo financeiro.
- Necessidade de receita.
- Necessidade de revisão manual.
- Estratégia de decisão.
- Destino da análise quando a decisão for assistida.
- Alertas e riscos destacados no dossiê.

## 10. Impacto no Motor Configurável
Objetivo de integração futura (não implementado nesta etapa):
- Resolver cenário/regra na política ativa versionada.
- Registrar `decision_basis` e trilha de auditoria por regra.
- Executar cálculo financeiro apenas quando `requires_financial_calculation=true` e a estratégia permitir decisão automática.
- Preservar fallback/manual review para ausência de dados.
- Encaminhar decisões assistidas para Comitê de Crédito com dossiê estruturado.
- Respeitar COFACE como teto automático de recomendação quando houver cobertura válida.
- Registrar alertas Agrisk sem bloquear recomendação COFACE-first.

Restrições atuais:
- Nenhuma conexão com o motor de decisão em produção.
- Sem alteração de `decision.py`, `recommendation.py`, workflow ou frontend nesta fase de documentação.

## 11. Matriz de Decisão Consolidada
| Cenário | COFACE | Cliente na base | Limite atual | Limite solicitado | Receita obrigatória? | Cálculo financeiro? | Limite recomendado | Recomendação |
|---|---|---|---|---|---|---|---|---|
| A1 | = limite atual | Sim | Obrigatório | Obrigatório | Não | Não | Limite atual | Manutenção do Limite Atual |
| A2 | < limite atual | Sim | Obrigatório | Obrigatório | Não | Não | COFACE | Redução de Limite devido Exposição com a COFACE |
| A3 | > limite atual e solicitado > COFACE | Sim | Obrigatório | Obrigatório | Não | Não | COFACE | Aumento do Limite conforme Cobertura da COFACE |
| A4 | > limite atual e solicitado <= COFACE | Sim | Obrigatório | Obrigatório | Não | Não | Solicitado | Aprovação do Limite Solicitado conforme Cobertura da COFACE |
| B | Ausente | Sim | Obrigatório | Obrigatório | Não para decisão automática | Não | N/A | Encaminhar ao Comitê de Crédito |
| C1 | < solicitado | Não | N/A | Obrigatório | Não (v1) | Não (v1) | COFACE | Aprovação Parcial devido Exposição com a COFACE |
| C2 | >= solicitado | Não | N/A | Obrigatório | Não (v1) | Não (v1) | Solicitado | Aprovação do Limite Solicitado conforme Cobertura da COFACE |
| D | Ausente | Não | N/A | Obrigatório | Não para decisão automática | Não | N/A | Encaminhar ao Comitê de Crédito |

Regra transversal da matriz:
- Quando houver COFACE válida, o limite recomendado pelo motor não deve superar a cobertura COFACE.
- Quando não houver COFACE válida, o motor não recomenda limite automaticamente e encaminha o caso ao Comitê de Crédito.

## 12. Resultado Técnico Esperado (Contrato de Regra)
Campos técnicos por avaliação:
- `scenario_code`
- `rule_code`
- `recommendation_code`
- `label`
- `recommended_limit_source`
- `recommended_limit`
- `financial_impact`
- `requires_financial_calculation`
- `requires_revenue`
- `decision_strategy`
- `analysis_destination`
- `decision_basis`
- `exposure_amount`
- `alerts`
- `manual_review_required`

Semântica:
- `decision_strategy`: `deterministic` para decisão objetiva ou `assisted` para montagem de dossiê sem decisão automática.
- `analysis_destination`: destino da análise quando `decision_strategy=assisted`, como `credit_committee`.
- `decision_basis`: identificador da política/versão/estratégia aplicada.
- `exposure_amount`: `max(0, limite_solicitado - cobertura/limite_recomendado conforme regra)`.
- `alerts`: lista de alertas e riscos destacados no dossiê, incluindo Agrisk severo quando aplicável.
- `manual_review_required=true` quando não houver dados mínimos ou regra explicitamente exigir intervenção humana.

## 13. Pontos Pendentes de Decisão de Negócio
1. Cliente novo com COFACE exige Agrisk obrigatório?
2. Overdue interno deve sobrepor COFACE?
3. Aprovação com exposição descoberta pode ser automática ou sempre manual?
4. EBITDA/lucro podem substituir receita em quais condições?
5. Quais campos do Complemento Manual são mandatórios por cenário?

## Recomendações de Próximos Passos
1. Validar os pendentes com negócio/comitê de crédito e transformar em regras fechadas.
2. Congelar `v1.0` com matriz final assinada por risco/crédito.
3. Definir testes de aceitação por cenário (A/B/C/D e exceções de dados).
4. Só então planejar integração gradual no motor sob feature flag desligada por padrão.
