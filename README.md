# Mish Business 1.0 — BPO Financeiro

Plataforma de **BPO financeiro** para escritórios que fazem a gestão financeira terceirizada de várias empresas clientes. Reúne em um só lugar: **login com perfis de acesso, contas a pagar e receber, conciliação bancária (OFX/CSV), B.I. e relatórios gerenciais** (DRE, fluxo de caixa, contas e conciliação).

## Funcionalidades

### Acesso e segurança
- Login com e-mail e senha, sessão por cookie `HttpOnly` + `SameSite=Lax` (12 h).
- Senhas com hash **scrypt** e salt; o banco guarda só o hash SHA-256 do token de sessão.
- Três perfis:
  | Perfil | O que pode fazer |
  |---|---|
  | **Administrador** | Tudo, incluindo gestão de usuários e exclusão de empresas |
  | **Analista BPO** | Opera todas as empresas da carteira (lançamentos, conciliação, cadastros, relatórios) |
  | **Cliente** | Acessa **somente a própria empresa**, em modo consulta (B.I., relatórios, lançamentos) |
- Proteção contra força bruta no login, proteção CSRF (cabeçalho obrigatório) e cabeçalhos de segurança (CSP, `X-Frame-Options` etc.).
- Troca de senha encerra as outras sessões.

### Multiempresa (carteira BPO)
- Cadastro de empresas clientes; cada nova empresa recebe um **plano de contas padrão** já mapeado para a DRE.
- **Carteira BPO**: visão consolidada de todas as empresas, com receitas, despesas, resultado, valores vencidos, vencimentos dos próximos 7 dias e extrato pendente de conciliação.

### Contas a pagar e receber
- Lançamentos com categoria, conta bancária, cliente/fornecedor, documento, competência e vencimento.
- **Parcelamento/recorrência** (até 60 meses), baixa e estorno de pagamentos.
- Status automático: em aberto, atrasado ou pago. Filtros por período, tipo, status, categoria e busca.

### Conciliação bancária
- Importação de extratos **OFX** (padrão dos bancos brasileiros) e **CSV** (data, descrição e valor, ou colunas de crédito e débito; datas DD/MM/AAAA e valores `1.234,56`). Arquivos em UTF-8 ou Windows-1252.
- Transações duplicadas são ignoradas na reimportação (pelo `FITID` do OFX).
- **Conciliação automática**: liga cada transação ao lançamento em aberto com mesmo valor e sentido, vencimento em até ±7 dias e mesma conta. Quando há mais de um candidato, a decisão fica com o analista.
- Conciliação manual com sugestões, **criação de lançamento a partir do extrato** (tarifas, IOF, rendimentos) e desfazer conciliação.
- Lançamentos conciliados ficam travados (valor, data e conta) até a conciliação ser desfeita.

### B.I. (painel financeiro por empresa)
- Indicadores: receitas, despesas, resultado e margem, saldo bancário, a receber/a pagar, valores vencidos, inadimplência e % do extrato conciliado.
- Gráfico de **fluxo de caixa dos últimos 12 meses** (realizado e previsto), com linha de resultado.
- Despesas e receitas por categoria, **aging** de contas a receber e a pagar, maiores clientes e fornecedores, saldo por conta.

### Relatórios
- **DRE gerencial** com colunas mensais, detalhamento por categoria e análise vertical (AV%), em **regime de caixa ou competência**.
- **Fluxo de caixa** realizado (mensal ou diário) com saldo acumulado.
- **Contas a pagar e receber** por vencimento e status.
- **Conciliação bancária**: saldo do extrato × saldo do sistema por conta, com a lista de pendências.
- Exportação **CSV pronta para o Excel** (`;` e vírgula decimal) e **impressão/PDF** com layout próprio.

## Tecnologias

- [Node.js](https://nodejs.org/) 22.5+ com SQLite nativo (`node:sqlite`), sem módulos nativos para compilar
- [Express 5](https://expressjs.com/) — a única dependência
- Frontend em HTML, CSS e JavaScript puros (módulos ES, sem build), com gráficos em SVG, tema claro e escuro e layout responsivo

## Como rodar

```bash
npm install
npm run seed   # opcional: dados de demonstração (2 empresas, 14 meses de lançamentos, extrato a conciliar)
npm start      # http://localhost:3000
```

**Primeiro acesso:** se o banco não tiver usuários, o servidor cria um administrador e mostra a senha no console. Para definir as credenciais você mesmo, use `MISH_ADMIN_EMAIL` e `MISH_ADMIN_SENHA`.

**Usuários de demonstração** (criados pelo `npm run seed`; senha `mish12345`, use só em ambiente de teste):

| E-mail | Perfil |
|---|---|
| `admin@mish.local` | Administrador |
| `analista@mish.local` | Analista BPO |
| `cliente1@mish.local` | Cliente (Pão Dourado) |
| `cliente2@mish.local` | Cliente (TechNova) |

Para testar a importação de extrato, use os arquivos em [`exemplos/`](exemplos/).

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `MISH_DB` | `data/mish.db` | Caminho do banco SQLite |
| `MISH_ADMIN_EMAIL` | `admin@mish.local` | E-mail do administrador criado no primeiro acesso |
| `MISH_ADMIN_SENHA` | (gerada) | Senha do administrador criado no primeiro acesso |
| `NODE_ENV` | — | Em `production`, o cookie de sessão é marcado como `Secure` |
| `TRUST_PROXY` | — | Configure (ex.: `1`) quando rodar atrás de proxy reverso/HTTPS |

## Testes

```bash
npm test
```

Cobrem autenticação e perfis, CSRF, bloqueio de força bruta, isolamento entre empresas, lançamentos e parcelas, importação OFX/CSV, conciliação automática e manual, DRE, B.I., fluxo de caixa e exportação CSV.

## API (resumo)

Todas as rotas exigem login, exceto `/api/health` e `/api/auth/login`. Requisições que alteram dados precisam do cabeçalho `X-Requested-With: mish`.

| Rota | Descrição |
|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/senha` | Sessão |
| `/api/usuarios` | Usuários (admin) |
| `GET /api/bi/carteira` | Visão consolidada da carteira BPO |
| `/api/empresas[/:id]` | Empresas clientes |
| `/api/empresas/:id/contas` · `/categorias` | Contas bancárias e plano de contas |
| `/api/empresas/:id/lancamentos` (+ `/:lid/baixar`, `/:lid/estornar`) | Contas a pagar e receber |
| `/api/empresas/:id/conciliacao` (+ `/importar`, `/automatica`, `/resumo`, `/:tid/vincular`, `/:tid/criar-lancamento`, `/:tid/desfazer`) | Conciliação bancária |
| `GET /api/empresas/:id/bi` | Painel de B.I. |
| `GET /api/empresas/:id/relatorios/{dre,fluxo-caixa,contas,conciliacao}` | Relatórios (`?formato=csv` para exportar) |

Os períodos usam `?inicio=AAAA-MM-DD&fim=AAAA-MM-DD`; sem eles, vale o mês corrente.

## Estrutura

```
src/
  app.js                 # Express, segurança e montagem das rotas
  db.js                  # esquema SQLite, transações e plano de contas padrão
  server.js              # inicialização e criação do primeiro administrador
  seed.js                # dados de demonstração
  lib/auth.js            # senhas, sessões, perfis e limitador de login
  lib/extrato.js         # parsers de extrato OFX e CSV
  lib/datas.js           # utilitários de datas
  routes/                # auth, usuarios, empresas, lancamentos, conciliacao, bi, relatorios
public/
  index.html, styles.css
  js/main.js             # login, menu e roteamento
  js/charts.js           # gráficos SVG
  js/pages/*.js          # telas
exemplos/                # extratos OFX e CSV de exemplo
test/                    # testes (node:test)
```

## Licença

MIT
