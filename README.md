# Mish Business 1.0

Sistema de gestão empresarial para pequenos negócios: **clientes, produtos e estoque, vendas e financeiro** em um único painel web.

## Funcionalidades

- **Painel**: vendas do mês, ticket médio, saldo financeiro, produtos com estoque baixo, mais vendidos e últimas vendas.
- **Clientes**: cadastro com nome, e-mail, telefone, CPF/CNPJ e endereço; busca e edição.
- **Produtos e estoque**: preço, custo, margem calculada, estoque atual e estoque mínimo (com alerta).
- **Vendas**: venda com vários itens, cliente opcional (consumidor final), desconto e forma de pagamento (dinheiro, PIX, cartão, boleto).
  - A venda dá **baixa automática no estoque** e lança a **receita no financeiro**.
  - O **cancelamento** devolve os itens ao estoque e remove a receita.
- **Financeiro**: lançamentos de receitas e despesas com categoria e data.

## Tecnologias

- [Node.js](https://nodejs.org/) 22.5+ com o SQLite nativo (`node:sqlite`), sem dependências nativas para compilar
- [Express 5](https://expressjs.com/) para a API REST
- Frontend em HTML, CSS e JavaScript puros (sem build), com tema claro e escuro e layout responsivo

## Como rodar

```bash
npm install
npm run seed   # opcional: insere dados de exemplo
npm start      # http://localhost:3000
```

Variáveis de ambiente:

| Variável  | Padrão         | Descrição               |
|-----------|----------------|-------------------------|
| `PORT`    | `3000`         | Porta do servidor       |
| `MISH_DB` | `data/mish.db` | Caminho do banco SQLite |

Para desenvolvimento com recarga automática: `npm run dev`.

## Testes

```bash
npm test
```

## API

| Método         | Rota                       | Descrição                                  |
|----------------|----------------------------|--------------------------------------------|
| GET            | `/api/health`              | Status da aplicação                        |
| GET            | `/api/dashboard`           | Indicadores do painel                      |
| GET/POST       | `/api/clientes`            | Listar (`?q=` para busca) / criar          |
| GET/PUT/DELETE | `/api/clientes/:id`        | Detalhar / atualizar / excluir             |
| GET/POST       | `/api/produtos`            | Listar (`?q=`) / criar                     |
| GET/PUT/DELETE | `/api/produtos/:id`        | Detalhar / atualizar / excluir             |
| GET/POST       | `/api/lancamentos`         | Listar (`?q=`) / criar lançamento          |
| GET/PUT/DELETE | `/api/lancamentos/:id`     | Detalhar / atualizar / excluir             |
| GET/POST       | `/api/vendas`              | Listar / registrar venda                   |
| GET            | `/api/vendas/:id`          | Detalhes da venda com itens                |
| POST           | `/api/vendas/:id/cancelar` | Cancelar venda (estorna estoque e receita) |

Exemplo de venda:

```json
POST /api/vendas
{
  "cliente_id": 1,
  "itens": [{ "produto_id": 2, "quantidade": 3 }],
  "desconto": 10,
  "forma_pagamento": "pix"
}
```

## Estrutura

```
src/
  app.js               # montagem do Express e rotas
  db.js                # esquema SQLite e helper de transação
  routes/crud.js       # rotas CRUD genéricas com validação
  routes/vendas.js     # vendas, baixa de estoque e cancelamento
  routes/dashboard.js  # indicadores do painel
  seed.js              # dados de exemplo
public/                # interface web
test/                  # testes da API (node:test)
```

## Licença

MIT
