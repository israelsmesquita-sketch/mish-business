const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente, SENHA } = require('./helpers');

let ctx;
before(async () => (ctx = await iniciar()));
after(() => ctx.server.close());

test('rotas protegidas exigem login', async () => {
  const api = cliente(ctx.base);
  assert.equal((await api('/empresas')).status, 401);
  assert.equal((await api('/auth/me')).status, 401);
});

test('login com senha errada falha e com senha certa cria sessão HttpOnly', async () => {
  const api = cliente(ctx.base);
  assert.equal((await api.login('admin@teste.com', 'errada')).status, 401);

  const ok = await api.login('ADMIN@teste.com');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.papel, 'admin');
  assert.equal(ok.body.senha_hash, undefined);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/);

  assert.equal((await api('/auth/me')).body.email, 'admin@teste.com');
  assert.equal((await api('/auth/logout', 'POST')).status, 204);
  assert.equal((await api('/auth/me')).status, 401);
});

test('requisições sem o cabeçalho anti-CSRF são recusadas', async () => {
  const api = cliente(ctx.base);
  await api.login('admin@teste.com');
  const res = await api('/empresas', 'POST', { razao_social: 'X' }, { csrf: false });
  assert.equal(res.status, 403);
});

test('login bloqueia após muitas tentativas', async () => {
  const api = cliente(ctx.base);
  for (let i = 0; i < 10; i++) await api.login('bloqueio@teste.com', 'x');
  assert.equal((await api.login('bloqueio@teste.com', 'x')).status, 429);
});

test('perfis: cliente vê só a própria empresa e apenas consulta', async () => {
  const admin = cliente(ctx.base);
  await admin.login('admin@teste.com');
  const { body: e1 } = await admin('/empresas', 'POST', { razao_social: 'Empresa Um', cnpj: '11.111.111/0001-11' });
  const { body: e2 } = await admin('/empresas', 'POST', { razao_social: 'Empresa Dois' });

  assert.equal((await admin('/usuarios', 'POST', { nome: 'C', email: 'c@teste.com', papel: 'cliente', senha: SENHA })).status, 400);
  assert.equal((await admin('/usuarios', 'POST', { nome: 'C', email: 'c@teste.com', papel: 'cliente', empresa_id: e1.id, senha: 'curta' })).status, 400);
  assert.equal((await admin('/usuarios', 'POST', { nome: 'C', email: 'c@teste.com', papel: 'cliente', empresa_id: e1.id, senha: SENHA })).status, 201);
  assert.equal((await admin('/usuarios', 'POST', { nome: 'An', email: 'an@teste.com', papel: 'analista', senha: SENHA })).status, 201);

  const cli = cliente(ctx.base);
  await cli.login('c@teste.com');
  const lista = await cli('/empresas');
  assert.deepEqual(lista.body.map((e) => e.id), [e1.id]);
  assert.equal((await cli(`/empresas/${e1.id}/bi`)).status, 200);
  assert.equal((await cli(`/empresas/${e2.id}`)).status, 404);
  assert.equal((await cli(`/empresas/${e1.id}/categorias`, 'POST', { nome: 'X', tipo: 'receita', grupo: 'outros' })).status, 403);
  assert.equal((await cli('/usuarios')).status, 403);
  assert.equal((await cli('/bi/carteira')).status, 403);

  const an = cliente(ctx.base);
  await an.login('an@teste.com');
  assert.equal((await an('/empresas')).body.length, 2);
  assert.equal((await an('/bi/carteira')).status, 200);
  assert.equal((await an('/usuarios')).status, 403);
  assert.equal((await an(`/empresas/${e2.id}`, 'DELETE')).status, 403);
});

test('troca de senha invalida a senha antiga', async () => {
  const admin = cliente(ctx.base);
  await admin.login('admin@teste.com');
  await admin('/usuarios', 'POST', { nome: 'T', email: 't@teste.com', papel: 'analista', senha: SENHA });

  const t = cliente(ctx.base);
  await t.login('t@teste.com');
  assert.equal((await t('/auth/senha', 'POST', { senha_atual: 'errada', nova_senha: 'nova-senha-456' })).status, 400);
  assert.equal((await t('/auth/senha', 'POST', { senha_atual: SENHA, nova_senha: 'nova-senha-456' })).status, 204);
  assert.equal((await t('/auth/me')).status, 200);
  assert.equal((await cliente(ctx.base).login('t@teste.com')).status, 401);
  assert.equal((await cliente(ctx.base).login('t@teste.com', 'nova-senha-456')).status, 200);
});
