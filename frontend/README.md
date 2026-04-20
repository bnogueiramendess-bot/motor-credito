# Frontend - Motor Crédito

Frontend da tela principal de **Análise de Crédito**, construído com:

- Next.js (App Router)
- React
- Tailwind CSS
- shadcn/ui
- TanStack Query

## Pré-requisitos

- Node.js 20+
- Backend rodando em `http://localhost:8000`

## Configuração

1. No diretório `frontend`, copie o arquivo de exemplo:

```bash
cp .env.example .env.local
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

2. Instale as dependências:

```bash
npm install
```

3. Suba o projeto:

```bash
npm run dev
```

Aplicação disponível em `http://localhost:3000`.

## Variáveis de ambiente

- `BACKEND_API_URL`: URL base do backend FastAPI
  - Exemplo: `http://localhost:8000`

## Fluxo principal validado

- Listagem de análises (`/analises`) com:
  - loading
  - vazio
  - erro
- Detalhe da análise (`/analises/[analysisId]`) com:
  - dados do cliente
  - score e faixa
  - limite sugerido
  - decisão do motor
  - decisão final do analista
  - timeline de eventos
