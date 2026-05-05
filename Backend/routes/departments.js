const express = require('express');
const { db } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments — get all departments with employee count
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT d.*, COUNT(e.id) as employee_count
      FROM departments d
      LEFT JOIN employees e ON e.department_id = d.id
      GROUP BY d.id
      ORDER BY d.name ASC
    `);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch departments.' });
  }
});

// POST /api/departments — create department (Admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Department name is required.' });
  }

  try {
    const existing = await db.execute({
      sql: 'SELECT id FROM departments WHERE name = ?',
      args: [name.trim()]
    });
    if (existing.rows.length) {
      return res.status(409).json({ status: 'error', message: 'Error: Department name already exists.' });
    }

    const result = await db.execute({
      sql: 'INSERT INTO departments (name) VALUES (?)',
      args: [name.trim()]
    });

    res.status(201).json({ status: 'success', message: 'Department created!', id: Number(result.lastInsertRowid) });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to create department.' });
  }
});

// PUT /api/departments/:id — rename department (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name } = req.body;
  const { id } = req.params;

  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: 'Department name is required.' });
  }

  try {
    const existing = await db.execute({ sql: 'SELECT id FROM departments WHERE id = ?', args: [id] });
    if (!existing.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Department not found.' });
    }

    // Check name not taken by another department
    const nameCheck = await db.execute({
      sql: 'SELECT id FROM departments WHERE name = ? AND id != ?',
      args: [name.trim(), id]
    });
    if (nameCheck.rows.length) {
      return res.status(409).json({ status: 'error', message: 'Error: Department name already exists.' });
    }

    await db.execute({ sql: 'UPDATE departments SET name = ? WHERE id = ?', args: [name.trim(), id] });
    res.json({ status: 'success', message: 'Department renamed!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to rename department.' });
  }
});

// DELETE /api/departments/:id — delete department (Admin only, only if no employees)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await db.execute({ sql: 'SELECT id FROM departments WHERE id = ?', args: [id] });
    if (!existing.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Department not found.' });
    }

    const empCheck = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM employees WHERE department_id = ?',
      args: [id]
    });
    if (empCheck.rows[0].count > 0) {
      return res.status(409).json({ status: 'error', message: 'Cannot delete: employees are assigned to this department.' });
    }

    await db.execute({ sql: 'DELETE FROM departments WHERE id = ?', args: [id] });
    res.json({ status: 'success', message: 'Department deleted.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to delete department.' });
  }
});

module.exports = router;
