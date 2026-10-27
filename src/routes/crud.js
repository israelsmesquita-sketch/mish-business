const express = require('express');
const { badRequest, notFound } = require('../errors');

/**
 * Builds list/get/create/update/delete routes for a simple table.
 * `fields` maps column name -> { required, type: 'text' | 'number' | 'integer' }.
 * `search` lists the text columns matched by the `?q=` query parameter.
 */
function crudRouter(db, { table, fields, search = [], orderBy = 'id DESC' }) {
  const router = express.Router();
  const columns = Object.keys(fields);

  function parse(body, partial) {
    const data = {};
    for (const [col, spec] of Object.entries(fields)) {
      let value = body[col];
      if (value === undefined || value === '') {
        if (spec.required && !partial) throw badRequest(`O campo "${col}" é obrigatório`);
        if (value === '' && !spec.required) data[col] = null;
        continue;
      }
      if (spec.type === 'number' || spec.type === 'integer') {
        value = Number(value);
        if (!Number.isFinite(value) || value < 0) throw badRequest(`O campo "${col}" deve ser um número não negativo`);
        if (spec.type === 'integer' && !Number.isInteger(value)) throw badRequest(`O campo "${col}" deve ser um número inteiro`);
      } else {
        value = String(value).trim();
        if (spec.required && !value) throw badRequest(`O campo "${col}" é obrigatório`);
      }
      data[col] = value;
    }
    return data;
  }

  function findById(id) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw notFound();
    return row;
  }

  router.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q && search.length) {
      const where = search.map((c) => `${c} LIKE ?`).join(' OR ');
      const params = search.map(() => `%${q}%`);
      return res.json(db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy}`).all(...params));
    }
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all());
  });

  router.get('/:id', (req, res) => res.json(findById(req.params.id)));

  router.post('/', (req, res) => {
    const data = parse(req.body || {}, false);
    const cols = Object.keys(data);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const { lastInsertRowid } = db.prepare(sql).run(...cols.map((c) => data[c]));
    res.status(201).json(findById(lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    findById(req.params.id);
    const data = parse(req.body || {}, true);
    const cols = Object.keys(data).filter((c) => columns.includes(c));
    if (cols.length) {
      const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...cols.map((c) => data[c]), req.params.id);
    }
    res.json(findById(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    findById(req.params.id);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { crudRouter };
