const express = require('express');
const { exigirPapel } = require('../lib/auth');
const { parseFields, insert, update } = require('./crud');
const { notFound } = require('../errors');

const FIELDS = { nome: { required: true }, descricao: { label: 'descrição' }, ordem: { type: 'integer' } };

/** Pilares de avaliação, comuns a todos os salões. Só a equipe Mish altera. */
function pilaresRouter(db) {
  const router = express.Router();
  const find = (id) => {
    const row = db.prepare('SELECT * FROM pilares WHERE id = ?').get(id);
    if (!row) throw notFound('Pilar não encontrado');
    return row;
  };

  router.get('/', (req, res) => res.json(db.prepare('SELECT * FROM pilares ORDER BY ordem, nome').all()));
  router.post('/', exigirPapel('admin', 'analista'), (req, res) => res.status(201).json(find(insert(db, 'pilares', parseFields(db, FIELDS, req.body || {})))));
  router.put('/:id', exigirPapel('admin', 'analista'), (req, res) => {
    find(req.params.id);
    update(db, 'pilares', req.params.id, parseFields(db, FIELDS, req.body || {}, { partial: true }));
    res.json(find(req.params.id));
  });
  router.delete('/:id', exigirPapel('admin', 'analista'), (req, res) => {
    find(req.params.id);
    db.prepare('DELETE FROM pilares WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });
  return router;
}

module.exports = { pilaresRouter };
