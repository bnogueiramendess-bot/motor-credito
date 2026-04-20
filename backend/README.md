# Motor de Credito Assistido - Backend

## Visao rapida
Backend do MVP de analise de credito interna com trilha auditavel de score, decisao do motor e decisao final do analista.

- Stack: FastAPI, SQLAlchemy 2.x, PostgreSQL, Alembic, Pydantic v2
- Banco (Docker): `localhost:5434`
- Connection string esperada no `.env` (raiz do projeto):
  - `DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5434/motor_credito`

### Subir API
```powershell
cd c:\Users\bruno.mendes\motor-credito
docker compose up -d

cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Fluxo operacional do MVP
1. Criar cliente
2. Criar analise de credito
3. Registrar external data
4. Calcular score
5. Calcular decisao do motor
6. Aplicar decisao final do analista

## Endpoints principais
- `POST /customers`
- `POST /credit-analyses`
- `POST /credit-analyses/{analysis_id}/external-data`
- `POST /credit-analyses/{analysis_id}/score/calculate`
- `GET /credit-analyses/{analysis_id}/score`
- `POST /credit-analyses/{analysis_id}/decision/calculate`
- `GET /credit-analyses/{analysis_id}/decision`
- `POST /credit-analyses/{analysis_id}/final-decision`
- `GET /credit-analyses/{analysis_id}/final-decision`
- `GET /credit-analyses/{analysis_id}/events`

## Smoke test (obrigatorio)
Executa o fluxo happy-path integrado do MVP.

```powershell
cd c:\Users\bruno.mendes\motor-credito\backend
.\.venv\Scripts\python.exe scripts\happy_path_smoke.py
```

Saida esperada:
```text
Happy-path smoke test passed.
```

## Observacoes de dominio
- `motor_result` nao e igual a `final_decision`.
  - `motor_result`: recomendacao automatica do motor.
  - `final_decision`: decisao humana que fecha a analise.
- O score usa o `ExternalDataEntry` mais recente da analise (`created_at desc`, `id desc`).
- A decisao final marca a analise como concluida (`analysis_status=completed`) e preenche `completed_at`.
