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
5. Quando houver exposição descoberta, o motor deve explicitar a exposição.
6. Cliente existente considera limite atual e histórico interno.
7. Cliente novo considera COFACE, Agrisk e complemento financeiro/manual.
8. Backend é a fonte da verdade para decisão.
9. Frontend não recalcula decisão.

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

Proposta funcional inicial (pendente de validação):
- Exige cálculo financeiro: `sim`.
- Usa histórico interno (carteira/pagamento/overdue), Agrisk e complemento manual.
- Receita/faturamento: obrigatória em aumento de limite; manutenção sem aumento permanece pendente de regra final.

Possíveis saídas:
- Manutenção (quando risco interno forte e sem deterioração relevante) — pendente.
- Redução por risco/overdue.
- Aprovação parcial por capacidade financeira.
- Revisão manual obrigatória quando dados insuficientes.

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

Pendências de regra:
- Agrisk obrigatório mesmo com COFACE.
- Severidade Agrisk capaz de bloquear decisão COFACE-first.

### 4.4 Cenário D — Cliente novo sem COFACE
Condição de entrada:
- Cliente novo.
- Sem COFACE válida.

Proposta funcional inicial:
- Exige cálculo financeiro: `sim`.
- Exige receita/faturamento: `sim`.
- Agrisk: `obrigatório`.
- Complemento manual/demonstrações: obrigatórios quando faltar base estruturada.

Saídas esperadas:
- `cálculo >= solicitado`: aprovação do solicitado com exposição descoberta explícita.
- `cálculo < solicitado`: aprovação parcial com exposição.
- dados insuficientes: revisão manual ou bloqueio de cálculo.

## 5. Entradas Obrigatórias e Opcionais
Entradas base:
- `cliente_na_base` (bool)
- `limite_atual` (decimal)
- `limite_solicitado` (decimal)
- `coface_limit` (decimal|nulo)
- `agrisk_status/sinalizadores` (opcional por cenário, obrigatório em cenários sem COFACE para cliente novo)
- `receita_faturamento` (condicional)
- `indicadores internos` (overdue, histórico, exposição aberta)
- `complemento_manual` (condicional)

Obrigatórias por cenário:
- A: limite atual, solicitado, COFACE.
- B: limite atual, solicitado, dados internos e base financeira mínima.
- C: solicitado, COFACE (e regra de Agrisk pendente).
- D: solicitado, receita/faturamento, Agrisk e insumos financeiros.

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
- Cenários sem COFACE/alta exposição: pilares e cálculo financeiro tornam-se determinantes para limite.

## 7. Obrigatoriedade de Receita/Faturamento
Receita obrigatória quando:
- Cliente novo sem COFACE.
- Cliente existente sem COFACE e solicitando aumento.
- Decisão depende de capacidade financeira própria.
- Aprovação envolve exposição descoberta relevante.

Receita não obrigatória quando:
- Cliente existente com COFACE suficiente.
- Manutenção/redução baseada em COFACE.
- Cliente novo com COFACE suficiente, salvo regra adicional de risco.

Pendências:
- Manutenção de cliente existente sem COFACE sem receita.
- Substituição parcial por EBITDA/lucro.
- Limiar de “exposição relevante”.

## 8. Tratamento de Ausência de Dados
Diretrizes:
- Dados críticos ausentes impedem decisão automática.
- Motor deve sinalizar `manual_review_required=true` quando faltarem entradas mandatórias do cenário.
- Sempre explicitar motivo (`reason`) e insumos ausentes.

Exemplos:
- Sem COFACE em cenário A/C: redirecionar para B/D.
- Sem receita em D: bloquear cálculo automático e enviar para revisão manual.
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

## 10. Impacto no Motor Configurável
Objetivo de integração futura (não implementado nesta etapa):
- Resolver cenário/regra na política ativa versionada.
- Registrar `decision_basis` e trilha de auditoria por regra.
- Executar cálculo financeiro apenas quando `requires_financial_calculation=true`.
- Preservar fallback/manual review para ausência de dados.

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
| B | Ausente | Sim | Obrigatório | Obrigatório | Condicional (tende a sim em aumento) | Sim | Resultado do cálculo/fallback | Pendente de validação |
| C1 | < solicitado | Não | N/A | Obrigatório | Não (v1) | Não (v1) | COFACE | Aprovação Parcial devido Exposição com a COFACE |
| C2 | >= solicitado | Não | N/A | Obrigatório | Não (v1) | Não (v1) | Solicitado | Aprovação do Limite Solicitado conforme Cobertura da COFACE |
| D | Ausente | Não | N/A | Obrigatório | Sim | Sim | Resultado do cálculo | Aprovação parcial/total com exposição ou revisão manual |

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
- `decision_basis`
- `exposure_amount`
- `manual_review_required`

Semântica:
- `decision_basis`: identificador da política/versão/estratégia aplicada.
- `exposure_amount`: `max(0, limite_solicitado - cobertura/limite_recomendado conforme regra)`.
- `manual_review_required=true` quando não houver dados mínimos ou regra explicitamente exigir intervenção humana.

## 13. Pontos Pendentes de Decisão de Negócio
1. Cliente existente sem COFACE pode manter limite sem receita?
2. Cliente novo com COFACE exige Agrisk obrigatório?
3. Agrisk com restrição severa pode bloquear decisão COFACE-first?
4. Overdue interno deve sobrepor COFACE?
5. Limite COFACE é teto absoluto em todos os casos?
6. Aprovação com exposição descoberta pode ser automática ou sempre manual?
7. EBITDA/lucro podem substituir receita em quais condições?
8. Quais campos do Complemento Manual são mandatórios por cenário?

## Recomendações de Próximos Passos
1. Validar os pendentes com negócio/comitê de crédito e transformar em regras fechadas.
2. Congelar `v1.0` com matriz final assinada por risco/crédito.
3. Definir testes de aceitação por cenário (A/B/C/D e exceções de dados).
4. Só então planejar integração gradual no motor sob feature flag desligada por padrão.
