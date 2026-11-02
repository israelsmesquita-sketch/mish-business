# Mish Business — gestão de salões

Painel de gestão inteligente para os salões **Mish Barber** e **Espaço GP**, com visão de B.I. e BPO: poucos números, todos ligados entre si, e cada alerta vira uma ação.

## As 4 abas

| Aba | Para que serve |
|---|---|
| **Painel** | Os salões lado a lado: faturamento, despesas, resultado, ticket médio e atendimentos, sempre comparados com o período anterior. Alertas que viram ações e ranking dos profissionais. |
| **Financeiro** | 100% receitas e despesas: visão geral (para onde vai e de onde vem o dinheiro), listas de receitas e despesas e DRE. Clicar numa categoria abre as despesas dela. |
| **Pessoas** | Faturamento e indicadores de cada profissional (atendimentos, serviços, ticket médio, % de produtos, meta, nota dos pilares). Clicar no **nome** abre o perfil: faturamento mês a mês, serviços realizados, notas dos pilares, alertas e plano de ação. |
| **Ajustes** | Só a equipe Mish: Trinks (robô e envio manual), profissionais, pilares, salões, usuários, plano de contas e conciliação bancária. |

**Painéis expansíveis:** clique em ⤢ para ampliar um painel; os outros encolhem numa faixa com o número principal. Clique de novo (ou Esc) para voltar.

**Período único:** o filtro de datas no topo vale para todas as telas.

## Perfis de acesso

| Perfil | O que pode fazer |
|---|---|
| **Administrador** | Tudo, incluindo usuários e exclusão de salões |
| **Analista BPO** | Opera os dois salões: financeiro, Trinks, equipe e ações |
| **Dono(a) do salão** | Vê somente o próprio salão; avalia a equipe (pilares) e cuida do plano de ação; o financeiro é só consulta |

Para criar os usuários reais (com senhas fortes geradas na hora) e os dois salões:

```bash
npm run usuarios
```

As senhas aparecem uma única vez no terminal. Os e-mails ficam em `src/criar-usuarios.js` — troque pelos reais antes de rodar, se quiser.

## Dados do Trinks (robô diário)

O Trinks é a fonte do faturamento: cada serviço/produto vendido, por profissional e cliente. Cada coleta:
1. entra no Trinks pelo navegador, **um salão depois do outro (Mish Barber → Espaço GP)**;
2. baixa o relatório de atendimentos dos últimos 3 dias (corrige cancelamentos e ajustes);
3. grava os atendimentos, cria profissionais novos automaticamente e lança a **receita diária** no financeiro — Pessoas e Financeiro partem do mesmo número.

### Instalar o robô (uma vez, no servidor ou no computador que fica ligado)

```bash
npm install playwright
npx playwright install chromium
cp config/trinks.exemplo.json config/trinks.json
```

Em `config/trinks.json`, cole em `urlRelatorio` o endereço do relatório de atendimentos por profissional de cada salão (abra o relatório no Trinks e copie a URL da barra do navegador) e ajuste os `passos` (preencher datas, clicar em filtrar). Logins e senhas **nunca** vão no arquivo — use variáveis de ambiente:

```bash
export TRINKS_MISH_USUARIO="..."  TRINKS_MISH_SENHA="..."
export TRINKS_GP_USUARIO="..."    TRINKS_GP_SENHA="..."
export TRINKS_HORARIO="06:30"     # coleta automática todo dia neste horário
```

- **Mesmo navegador:** `perfilNavegador` guarda o navegador do robô numa pasta; o login do Trinks fica salvo de um dia para o outro.
- **Usar o seu Chrome já aberto:** abra o Chrome com `--remote-debugging-port=9222` e defina `TRINKS_CDP=http://localhost:9222`.
- **Ver o robô trabalhando** (para ajustar os passos na primeira vez): `TRINKS_HEADLESS=0 npm run trinks`.
- **Coletar agora:** botão em *Ajustes › Trinks* ou `npm run trinks`.
- Se algo falhar, o histórico em *Ajustes › Trinks* mostra o erro e uma foto da tela é salva em `data/trinks/`.
- **Plano B:** exporte o relatório no Trinks (Excel/CSV) e envie em *Ajustes › Trinks › Enviar relatório*.

Colunas reconhecidas no relatório: Data, Profissional, Cliente, Serviço/Item, Tipo (serviço/produto), Valor e, se houver, ID/Comanda. Formatos: `.xlsx`, `.csv` e "Excel" em HTML.

## Indicadores e alertas

- **Atendimento** = visita do cliente (mesmo cliente no mesmo dia conta uma vez). **Ticket médio** = faturamento ÷ atendimentos.
- Comparação: mês corrente × mesmos dias do mês anterior; outros períodos × mesmo número de dias antes.
- **Meta**: meta mensal proporcional ao período, com projeção de fechamento no ritmo atual.
- **Pilares** (padrão: Técnica, Atendimento, Pontualidade, Vendas, Postura e equipe): nota de 0 a 10 por mês, editáveis em *Ajustes › Pilares*.
- Alertas automáticos: margem baixa ou negativa, queda de faturamento, despesa que disparou, contas vencidas, Trinks desatualizado; por profissional, projeção abaixo de 80% da meta, queda de faturamento, ticket abaixo da média do salão, pouca venda de produtos e pilar abaixo de 7. Cada alerta tem **Criar ação** com a sugestão preenchida.

### Financeiro e BPO (continua disponível)

Contas a pagar e receber com parcelas, baixa e estorno; DRE gerencial (caixa ou competência) com exportação para Excel e PDF; conciliação bancária OFX/CSV em *Ajustes*. Login com sessão segura, senhas com hash scrypt, proteção CSRF e contra força bruta.

## Tecnologias

- [Node.js](https://nodejs.org/) 22.5+ com SQLite nativo (`node:sqlite`), sem módulos nativos para compilar
- [Express 5](https://expressjs.com/) — a única dependência
- Frontend em HTML, CSS e JavaScript puros (módulos ES, sem build), com gráficos em SVG, tema claro e escuro e layout responsivo

## Como rodar

```bash
npm install
npm run seed     # opcional: demonstração com Mish Barber e Espaço GP (profissionais e números fictícios)
npm start        # http://localhost:3000
npm run usuarios # ambiente real: cria os salões e um usuário por perfil
```

**Primeiro acesso:** se o banco não tiver usuários, o servidor cria um administrador e mostra a senha no console. Para definir as credenciais você mesmo, use `MISH_ADMIN_EMAIL` e `MISH_ADMIN_SENHA`.

**Usuários de demonstração** (criados pelo `npm run seed`; senha `mish12345`, use só em ambiente de teste):

| E-mail | Perfil |
|---|---|
| `admin@mish.local` | Administrador |
| `analista@mish.local` | Analista BPO |
| `dono1@mish.local` | Dono(a) — Mish Barber |
| `dono2@mish.local` | Dono(a) — Espaço GP |

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
| `TRINKS_HORARIO` | — | Horário da coleta diária do Trinks (ex.: `06:30`) |
| `TRINKS_CONFIG` | `config/trinks.json` | Arquivo de configuração do robô |
| `TRINKS_HEADLESS` | — | `0` para ver o navegador do robô |
| `TRINKS_CDP` | — | Usar um Chrome já aberto (ex.: `http://localhost:9222`) |

## Testes

```bash
npm test
```

Cobrem leitura dos relatórios do Trinks (CSV, XLSX, HTML), importação sem duplicar, receita diária, indicadores de pessoas, pilares, ações, permissões do dono, autenticação e perfis, CSRF, bloqueio de força bruta, isolamento entre empresas, lançamentos e parcelas, importação OFX/CSV, conciliação automática e manual, DRE, B.I., fluxo de caixa e exportação CSV.

## API (resumo)

Todas as rotas exigem login, exceto `/api/health` e `/api/auth/login`. Requisições que alteram dados precisam do cabeçalho `X-Requested-With: mish`.

| Rota | Descrição |
|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/senha` | Sessão |
| `/api/usuarios` | Usuários (admin) |
| `GET /api/painel` | Painel de gestão: salões, alertas, ranking e série de 12 meses |
| `/api/pilares` | Pilares de avaliação |
| `GET /api/trinks/status` · `POST /api/trinks/sincronizar` | Robô do Trinks |
| `/api/empresas/:id/pessoas[/:cid]` (+ `PUT /:cid/avaliacao`) | Indicadores da equipe e perfil do profissional |
| `/api/empresas/:id/colaboradores` · `/acoes` | Profissionais e plano de ação |
| `/api/empresas/:id/trinks` (+ `POST /importar`) | Histórico e envio manual do relatório do Trinks |
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
  lib/indicadores.js     # faturamento, equipe, comparação de períodos e alertas
  lib/trinks.js          # leitura do relatório do Trinks e importação
  lib/trinks-robo.js     # robô de navegador e agendamento diário
  lib/planilha.js        # leitor de CSV, XLSX e HTML sem dependências
  routes/                # auth, usuarios, empresas, painel, pessoas, pilares, trinks, lancamentos, conciliacao, bi, relatorios
config/trinks.exemplo.json # modelo de configuração do robô do Trinks
public/
  index.html, styles.css
  js/main.js             # login, menu e roteamento
  js/charts.js           # gráficos SVG
  js/pages/*.js          # telas: painel, financeiro, pessoas, perfil, ajustes (+ telas de cadastro)
exemplos/                # extratos OFX e CSV de exemplo
test/                    # testes (node:test)
```

## Licença

MIT
