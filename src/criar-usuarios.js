// Prepara o ambiente real: cria os dois salões (se não existirem) e um usuário para cada perfil,
// com senha forte gerada na hora. `npm run usuarios` — as senhas aparecem UMA vez no terminal.
// Usuários que já existem não são alterados.
const crypto = require('node:crypto');
const { openDatabase, criarPlanoDeContas } = require('./db');
const { hashSenha } = require('./lib/auth');

const SALOES = [
  ['Mish Barber LTDA', 'Mish Barber'],
  ['Espaço GP LTDA', 'Espaço GP'],
];

// [nome, e-mail (login), perfil, salão] — troque os e-mails pelos reais antes de rodar, se quiser.
const USUARIOS = [
  ['Israel Mesquita', 'israelsmesquita@gmail.com', 'admin', null],
  ['Analista BPO Mish', 'analista@mishbusiness.com.br', 'analista', null],
  ['Dono(a) Mish Barber', 'dono@mishbarber.com.br', 'cliente', 'Mish Barber'],
  ['Dono(a) Espaço GP', 'dono@espacogp.com.br', 'cliente', 'Espaço GP'],
];

const PERFIL = { admin: 'Administrador', analista: 'Analista BPO', cliente: 'Dono(a) do salão' };

const db = openDatabase();
for (const [razao, fantasia] of SALOES) {
  if (!db.prepare('SELECT 1 FROM empresas WHERE nome_fantasia = ?').get(fantasia)) {
    const id = db.prepare('INSERT INTO empresas (razao_social, nome_fantasia) VALUES (?, ?)').run(razao, fantasia).lastInsertRowid;
    criarPlanoDeContas(db, id);
    console.log(`Salão criado: ${fantasia}`);
  }
}

console.log('\nUsuários (guarde as senhas agora; peça para cada um trocar em "Alterar senha"):\n');
for (const [nome, email, papel, salao] of USUARIOS) {
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    console.log(`  ${email.padEnd(32)} já existe — mantido`);
    continue;
  }
  const empresaId = salao ? db.prepare('SELECT id FROM empresas WHERE nome_fantasia = ?').get(salao).id : null;
  const senha = crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, empresa_id) VALUES (?, ?, ?, ?, ?)').run(nome, email, hashSenha(senha), papel, empresaId);
  console.log(`  ${email.padEnd(32)} senha: ${senha}   (${PERFIL[papel]}${salao ? ' · ' + salao : ''})`);
}
