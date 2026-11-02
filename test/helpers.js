const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { hashSenha } = require('../src/lib/auth');

const SENHA = 'senha-forte-123';

/** Starts the app on a random port with an in-memory database and an admin user. */
async function iniciar() {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('Admin', 'admin@teste.com', ?, 'admin')").run(hashSenha(SENHA));
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return { db, server, base };
}

/** Minimal HTTP client that keeps the session cookie, like a browser would. */
function cliente(base) {
  let cookie = '';
  async function call(path, method = 'GET', body, { csrf = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-Requested-With'] = 'mish';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const tipo = res.headers.get('content-type') || '';
    const corpo = res.status === 204 ? null : tipo.includes('json') ? await res.json() : await res.text();
    return { status: res.status, body: corpo, headers: res.headers };
  }
  call.login = (email, senha = SENHA) => call('/auth/login', 'POST', { email, senha });
  return call;
}

module.exports = { iniciar, cliente, SENHA };
