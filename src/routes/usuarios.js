const express = require('express');
const { badRequest, notFound } = require('../errors');
const { hashSenha, validarSenha, exigirPapel } = require('../lib/auth');

const PAPEIS = ['admin', 'analista', 'cliente'];
const CAMPOS = 'u.id, u.nome, u.email, u.papel, u.empresa_id, u.ativo, u.ultimo_acesso, u.criado_em, e.razao_social AS empresa_nome';

function usuariosRouter(db) {
  const router = express.Router();
  router.use(exigirPapel('admin'));

  const find = (id) => {
    const row = db.prepare(`SELECT ${CAMPOS} FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id WHERE u.id = ?`).get(id);
    if (!row) throw notFound('Usuário não encontrado');
    return row;
  };

  function validar(body, atual) {
    const dados = {};
    if (body.nome !== undefined) {
      dados.nome = String(body.nome).trim();
      if (!dados.nome) throw badRequest('Informe o nome');
    }
    if (body.email !== undefined) {
      dados.email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) throw badRequest('E-mail inválido');
    }
    if (body.papel !== undefined) {
      if (!PAPEIS.includes(body.papel)) throw badRequest('Perfil inválido');
      dados.papel = body.papel;
    }
    if (body.empresa_id !== undefined) dados.empresa_id = body.empresa_id ? Number(body.empresa_id) : null;
    if (body.ativo !== undefined) dados.ativo = body.ativo ? 1 : 0;
    if (body.senha) {
      if (!validarSenha(body.senha)) throw badRequest('A senha deve ter pelo menos 8 caracteres');
      dados.senha_hash = hashSenha(body.senha);
    }

    const papel = dados.papel ?? atual?.papel;
    const empresaId = dados.empresa_id !== undefined ? dados.empresa_id : atual?.empresa_id;
    if (papel === 'cliente') {
      if (!empresaId || !db.prepare('SELECT 1 FROM empresas WHERE id = ?').get(empresaId)) {
        throw badRequest('Usuários do perfil cliente precisam estar vinculados a uma empresa');
      }
    } else dados.empresa_id = null;
    return dados;
  }

  router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT ${CAMPOS} FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id ORDER BY u.nome COLLATE NOCASE`).all());
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    if (!body.nome || !body.email || !body.papel || !body.senha) throw badRequest('Nome, e-mail, perfil e senha são obrigatórios');
    const d = validar(body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, empresa_id) VALUES (?, ?, ?, ?, ?)')
      .run(d.nome, d.email, d.senha_hash, d.papel, d.empresa_id ?? null);
    res.status(201).json(find(lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const atual = find(req.params.id);
    const d = validar(req.body || {}, atual);
    if (Number(req.params.id) === req.user.id && (d.ativo === 0 || (d.papel && d.papel !== 'admin'))) {
      throw badRequest('Você não pode desativar nem rebaixar o seu próprio usuário');
    }
    const cols = Object.keys(d);
    if (cols.length) db.prepare(`UPDATE usuarios SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => d[c]), req.params.id);
    if (d.senha_hash || d.ativo === 0) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(req.params.id);
    res.json(find(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    find(req.params.id);
    if (Number(req.params.id) === req.user.id) throw badRequest('Você não pode excluir o seu próprio usuário');
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { usuariosRouter };
