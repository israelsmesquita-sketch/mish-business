const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razao_social TEXT NOT NULL,
    nome_fantasia TEXT,
    cnpj TEXT UNIQUE,
    email TEXT,
    telefone TEXT,
    responsavel TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin', 'analista', 'cliente')),
    empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
    ativo INTEGER NOT NULL DEFAULT 1,
    ultimo_acesso TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (papel <> 'cliente' OR empresa_id IS NOT NULL)
  );

  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contas_bancarias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    descricao TEXT NOT NULL,
    banco TEXT,
    agencia TEXT,
    conta TEXT,
    saldo_inicial REAL NOT NULL DEFAULT 0,
    data_saldo_inicial TEXT
  );

  -- grupo define a linha da DRE em que a categoria entra.
  CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
    grupo TEXT NOT NULL CHECK (grupo IN (
      'receita_operacional', 'deducoes', 'custos', 'despesas_operacionais',
      'receitas_financeiras', 'despesas_financeiras', 'outros'
    )),
    UNIQUE (empresa_id, nome)
  );

  -- Contas a pagar (despesa) e a receber (receita). Status é derivado:
  -- pago quando há data de pagamento, atrasado quando vencido, aberto caso contrário.
  CREATE TABLE IF NOT EXISTS lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
    descricao TEXT NOT NULL,
    contraparte TEXT,
    categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    conta_id INTEGER REFERENCES contas_bancarias(id) ON DELETE SET NULL,
    valor REAL NOT NULL CHECK (valor > 0),
    competencia TEXT NOT NULL,
    vencimento TEXT NOT NULL,
    pagamento TEXT,
    documento TEXT,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lanc_empresa ON lancamentos (empresa_id, vencimento);

  -- Transações importadas do extrato bancário (valor com sinal: + crédito, - débito).
  CREATE TABLE IF NOT EXISTS extrato (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    conta_id INTEGER NOT NULL REFERENCES contas_bancarias(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    fitid TEXT NOT NULL,
    lancamento_id INTEGER UNIQUE REFERENCES lancamentos(id) ON DELETE SET NULL,
    importado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (conta_id, fitid)
  );
  CREATE INDEX IF NOT EXISTS idx_extrato_conta ON extrato (conta_id, data);
`;

function openDatabase(file = process.env.MISH_DB || path.join(__dirname, '..', 'data', 'mish.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// node:sqlite has no transaction helper, so wrap BEGIN/COMMIT/ROLLBACK manually.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const PLANO_DE_CONTAS_PADRAO = [
  ['Venda de produtos', 'receita', 'receita_operacional'],
  ['Prestação de serviços', 'receita', 'receita_operacional'],
  ['Rendimentos financeiros', 'receita', 'receitas_financeiras'],
  ['Outras receitas', 'receita', 'outros'],
  ['Impostos sobre vendas', 'despesa', 'deducoes'],
  ['Custo de mercadorias / insumos', 'despesa', 'custos'],
  ['Folha de pagamento', 'despesa', 'despesas_operacionais'],
  ['Pró-labore', 'despesa', 'despesas_operacionais'],
  ['Aluguel e condomínio', 'despesa', 'despesas_operacionais'],
  ['Energia, água e internet', 'despesa', 'despesas_operacionais'],
  ['Marketing', 'despesa', 'despesas_operacionais'],
  ['Serviços de terceiros', 'despesa', 'despesas_operacionais'],
  ['Software e assinaturas', 'despesa', 'despesas_operacionais'],
  ['Tarifas bancárias', 'despesa', 'despesas_financeiras'],
  ['Juros e multas', 'despesa', 'despesas_financeiras'],
  ['Outras despesas', 'despesa', 'outros'],
];

function criarPlanoDeContas(db, empresaId) {
  const ins = db.prepare('INSERT OR IGNORE INTO categorias (empresa_id, nome, tipo, grupo) VALUES (?, ?, ?, ?)');
  for (const [nome, tipo, grupo] of PLANO_DE_CONTAS_PADRAO) ins.run(empresaId, nome, tipo, grupo);
}

module.exports = { openDatabase, transaction, criarPlanoDeContas };
