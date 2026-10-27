const express = require('express');
const { badRequest, notFound } = require('../errors');
const { isIsoDate } = require('../lib/datas');

/**
 * Validates `body` against `fields`. Each field spec accepts:
 *   required, type ('text' | 'number' | 'integer' | 'date' | 'enum' | 'ref' | 'bool'),
 *   values (enum), ref (table name, must belong to the same empresa), positive, signed.
 * With `partial`, missing fields are skipped (used by updates).
 */
function parseFields(db, fields, body, { partial = false, empresaId } = {}) {
  const data = {};
  for (const [col, spec] of Object.entries(fields)) {
    let value = body[col];
    if (value === undefined || value === null || value === '') {
      if (spec.required && !partial) throw badRequest(`O campo "${spec.label || col}" é obrigatório`);
      if (value !== undefined && !spec.required) data[col] = null;
      continue;
    }
    const nome = spec.label || col;
    switch (spec.type) {
      case 'number':
      case 'integer':
        value = Number(value);
        if (!Number.isFinite(value)) throw badRequest(`O campo "${nome}" deve ser numérico`);
        if (spec.type === 'integer' && !Number.isInteger(value)) throw badRequest(`O campo "${nome}" deve ser inteiro`);
        if (spec.positive && value <= 0) throw badRequest(`O campo "${nome}" deve ser maior que zero`);
        if (!spec.signed && value < 0) throw badRequest(`O campo "${nome}" não pode ser negativo`);
        if (spec.type === 'number') value = Math.round(value * 100) / 100;
        break;
      case 'date':
        if (!isIsoDate(value)) throw badRequest(`O campo "${nome}" deve ser uma data válida (AAAA-MM-DD)`);
        break;
      case 'enum':
        if (!spec.values.includes(value)) throw badRequest(`Valor inválido para "${nome}"`);
        break;
      case 'bool':
        value = value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
        break;
      case 'ref': {
        value = Number(value);
        const row = db.prepare(`SELECT 1 FROM ${spec.ref} WHERE id = ? AND empresa_id = ?`).get(value, empresaId);
        if (!row) throw badRequest(`"${nome}" não encontrado(a) nesta empresa`);
        break;
      }
      default:
        value = String(value).trim();
        if (spec.required && !value) throw badRequest(`O campo "${nome}" é obrigatório`);
    }
    data[col] = value;
  }
  return data;
}

function insert(db, table, data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return db.prepare(sql).run(...cols.map((c) => data[c])).lastInsertRowid;
}

function update(db, table, id, data, extraWhere = '', extraParams = []) {
  const cols = Object.keys(data);
  if (!cols.length) return;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? ${extraWhere}`;
  db.prepare(sql).run(...cols.map((c) => data[c]), id, ...extraParams);
}

/**
 * List/get/create/update/delete routes for a table that belongs to an empresa
 * (mounted under /api/empresas/:empresaId/...).
 */
function crudEmpresa(db, { table, fields, search = [], orderBy = 'id DESC', select = '*' }) {
  const router = express.Router({ mergeParams: true });

  function find(empresaId, id) {
    const row = db.prepare(`SELECT ${select} FROM ${table} WHERE id = ? AND empresa_id = ?`).get(id, empresaId);
    if (!row) throw notFound();
    return row;
  }

  router.get('/', (req, res) => {
    const params = [req.empresa.id];
    let where = 'empresa_id = ?';
    const q = String(req.query.q || '').trim();
    if (q && search.length) {
      where += ` AND (${search.map((c) => `${c} LIKE ?`).join(' OR ')})`;
      params.push(...search.map(() => `%${q}%`));
    }
    res.json(db.prepare(`SELECT ${select} FROM ${table} WHERE ${where} ORDER BY ${orderBy}`).all(...params));
  });

  router.get('/:id', (req, res) => res.json(find(req.empresa.id, req.params.id)));

  router.post('/', (req, res) => {
    const data = parseFields(db, fields, req.body || {}, { empresaId: req.empresa.id });
    const id = insert(db, table, { ...data, empresa_id: req.empresa.id });
    res.status(201).json(find(req.empresa.id, id));
  });

  router.put('/:id', (req, res) => {
    find(req.empresa.id, req.params.id);
    const data = parseFields(db, fields, req.body || {}, { partial: true, empresaId: req.empresa.id });
    update(db, table, req.params.id, data);
    res.json(find(req.empresa.id, req.params.id));
  });

  router.delete('/:id', (req, res) => {
    find(req.empresa.id, req.params.id);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { parseFields, insert, update, crudEmpresa };
