const crypto = require('node:crypto');
const { createApp } = require('./app');
const { openDatabase } = require('./db');
const { hashSenha } = require('./lib/auth');
const { agendarTrinks } = require('./lib/trinks-robo');

const PORT = Number(process.env.PORT) || 3000;
const db = openDatabase();

// First run: create the initial administrator so someone can log in.
if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
  const email = (process.env.MISH_ADMIN_EMAIL || 'admin@mish.local').toLowerCase();
  const senha = process.env.MISH_ADMIN_SENHA || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('Administrador', ?, ?, 'admin')").run(email, hashSenha(senha));
  console.log('Usuário administrador criado:');
  console.log(`  e-mail: ${email}`);
  if (!process.env.MISH_ADMIN_SENHA) console.log(`  senha:  ${senha}  (altere após o primeiro acesso)`);
}

createApp(db).listen(PORT, () => {
  console.log(`Mish Business rodando em http://localhost:${PORT}`);
});
agendarTrinks(db);
