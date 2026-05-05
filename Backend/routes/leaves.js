const express = require('express');
const { db } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

function calcDays(start, end) {
  const s = new Date(start), e = new Date(end);
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// GET /api/leaves — admin sees all, viewer sees only their own
router.get('/', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await db.execute(`
        SELECT l.*, e.full_name, e.designation, d.name as department_name, u.email as reviewed_by_email
        FROM leaves l
        JOIN employees e ON l.employee_id = e.id
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN users u ON l.reviewed_by = u.id
        ORDER BY l.created_at DESC
      `);
    } else {
      // Find employee linked to this user
      const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
      if (!empRes.rows.length) return res.json({ status: 'success', data: [] });
      result = await db.execute({
        sql: `SELECT l.*, e.full_name, e.designation, d.name as department_name
              FROM leaves l
              JOIN employees e ON l.employee_id = e.id
              LEFT JOIN departments d ON e.department_id = d.id
              WHERE l.employee_id = ?
              ORDER BY l.created_at DESC`,
        args: [empRes.rows[0].id]
      });
    }
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch leaves.' });
  }
});

// GET /api/leaves/stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    let where = '';
    let args  = [];
    if (req.user.role !== 'admin') {
      const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
      if (!empRes.rows.length) return res.json({ status: 'success', data: { total:0, pending:0, approved:0, rejected:0 } });
      where = 'WHERE employee_id = ?';
      args  = [empRes.rows[0].id];
    }
    const total    = await db.execute({ sql: `SELECT COUNT(*) as count FROM leaves ${where}`, args });
    const pending  = await db.execute({ sql: `SELECT COUNT(*) as count FROM leaves ${where ? where + " AND status='pending'" : "WHERE status='pending'"}`, args });
    const approved = await db.execute({ sql: `SELECT COUNT(*) as count FROM leaves ${where ? where + " AND status='approved'" : "WHERE status='approved'"}`, args });
    const rejected = await db.execute({ sql: `SELECT COUNT(*) as count FROM leaves ${where ? where + " AND status='rejected'" : "WHERE status='rejected'"}`, args });
    res.json({ status: 'success', data: { total: total.rows[0].count, pending: pending.rows[0].count, approved: approved.rows[0].count, rejected: rejected.rows[0].count } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch stats.' });
  }
});

// POST /api/leaves — admin applies on behalf of anyone, viewer applies for themselves
router.post('/', authMiddleware, async (req, res) => {
  let { employee_id, leave_type, start_date, end_date, reason } = req.body;

  // If viewer, force their own employee_id
  if (req.user.role !== 'admin') {
    const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
    if (!empRes.rows.length)
      return res.status(403).json({ status: 'error', message: 'No employee record linked to your account.' });
    employee_id = empRes.rows[0].id;
  }

  if (!employee_id || !leave_type || !start_date || !end_date)
    return res.status(400).json({ status: 'error', message: 'Employee, type, start and end dates are required.' });
  if (new Date(end_date) < new Date(start_date))
    return res.status(400).json({ status: 'error', message: 'End date cannot be before start date.' });

  const days = calcDays(start_date, end_date);
  if (days === 0)
    return res.status(400).json({ status: 'error', message: 'Leave cannot be on weekends only.' });

  try {
    const emp = await db.execute({ sql: 'SELECT id FROM employees WHERE id = ?', args: [employee_id] });
    if (!emp.rows.length)
      return res.status(404).json({ status: 'error', message: 'Employee not found.' });

    const overlap = await db.execute({
      sql: `SELECT id FROM leaves WHERE employee_id = ? AND status != 'rejected' AND (start_date <= ? AND end_date >= ?)`,
      args: [employee_id, end_date, start_date]
    });
    if (overlap.rows.length)
      return res.status(409).json({ status: 'error', message: 'Error: A leave request already exists for this period.' });

    const result = await db.execute({
      sql: `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, days, reason, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      args: [employee_id, leave_type, start_date, end_date, days, reason || null]
    });

    res.status(201).json({ status: 'success', message: `Leave request submitted! (${days} working day${days>1?'s':''})`, id: Number(result.lastInsertRowid) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to submit leave.' });
  }
});

// PATCH /api/leaves/:id/approve — admin only
router.patch('/:id/approve', authMiddleware, adminOnly, async (req, res) => {
  try {
    const ex = await db.execute({ sql: 'SELECT id, status FROM leaves WHERE id = ?', args: [req.params.id] });
    if (!ex.rows.length) return res.status(404).json({ status: 'error', message: 'Not found.' });
    if (ex.rows[0].status === 'approved') return res.status(400).json({ status: 'error', message: 'Already approved.' });
    await db.execute({ sql: "UPDATE leaves SET status='approved', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?", args: [req.user.id, req.params.id] });
    res.json({ status: 'success', message: 'Leave approved!' });
  } catch (err) { res.status(500).json({ status: 'error', message: 'Failed to approve.' }); }
});

// PATCH /api/leaves/:id/reject — admin only
router.patch('/:id/reject', authMiddleware, adminOnly, async (req, res) => {
  try {
    const ex = await db.execute({ sql: 'SELECT id, status FROM leaves WHERE id = ?', args: [req.params.id] });
    if (!ex.rows.length) return res.status(404).json({ status: 'error', message: 'Not found.' });
    if (ex.rows[0].status === 'rejected') return res.status(400).json({ status: 'error', message: 'Already rejected.' });
    await db.execute({ sql: "UPDATE leaves SET status='rejected', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?", args: [req.user.id, req.params.id] });
    res.json({ status: 'success', message: 'Leave rejected.' });
  } catch (err) { res.status(500).json({ status: 'error', message: 'Failed to reject.' }); }
});

// DELETE /api/leaves/:id — admin or owner can delete pending
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const ex = await db.execute({ sql: 'SELECT l.*, e.user_id FROM leaves l JOIN employees e ON l.employee_id = e.id WHERE l.id = ?', args: [req.params.id] });
    if (!ex.rows.length) return res.status(404).json({ status: 'error', message: 'Not found.' });
    if (ex.rows[0].status !== 'pending') return res.status(400).json({ status: 'error', message: 'Only pending requests can be deleted.' });
    if (req.user.role !== 'admin' && ex.rows[0].user_id !== req.user.id)
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    await db.execute({ sql: 'DELETE FROM leaves WHERE id = ?', args: [req.params.id] });
    res.json({ status: 'success', message: 'Leave request deleted.' });
  } catch (err) { res.status(500).json({ status: 'error', message: 'Failed to delete.' }); }
});

module.exports = router;
