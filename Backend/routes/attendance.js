const express = require('express');
const { db } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/attendance?date=YYYY-MM-DD — get attendance for a date (admin) or own record (viewer)
router.get('/', authMiddleware, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    let result;
    if (req.user.role === 'admin') {
      // Return all active employees with their attendance for the date
      result = await db.execute({
        sql: `SELECT e.id as employee_id, e.full_name, e.designation, d.name as department_name,
                     a.id as attendance_id, a.status, a.check_in, a.check_out, a.notes, a.date
              FROM employees e
              LEFT JOIN departments d ON e.department_id = d.id
              LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
              WHERE e.status = 'active'
              ORDER BY e.full_name ASC`,
        args: [date]
      });
    } else {
      const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
      if (!empRes.rows.length) return res.json({ status: 'success', data: [] });
      result = await db.execute({
        sql: `SELECT a.*, e.full_name, d.name as department_name
              FROM attendance a
              JOIN employees e ON a.employee_id = e.id
              LEFT JOIN departments d ON e.department_id = d.id
              WHERE a.employee_id = ?
              ORDER BY a.date DESC LIMIT 30`,
        args: [empRes.rows[0].id]
      });
    }
    res.json({ status: 'success', data: result.rows, date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch attendance.' });
  }
});

// GET /api/attendance/monthly?employee_id=X&month=YYYY-MM — monthly report
router.get('/monthly', authMiddleware, async (req, res) => {
  const { month } = req.query; // e.g. 2026-05
  let { employee_id } = req.query;

  if (!month) return res.status(400).json({ status: 'error', message: 'Month is required (YYYY-MM).' });

  try {
    if (req.user.role !== 'admin') {
      const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
      if (!empRes.rows.length) return res.json({ status: 'success', data: [], summary: {} });
      employee_id = empRes.rows[0].id;
    }

    const whereEmp = employee_id ? 'AND a.employee_id = ?' : '';
    const args = employee_id ? [`${month}%`, employee_id] : [`${month}%`];

    const result = await db.execute({
      sql: `SELECT a.*, e.full_name, d.name as department_name
            FROM attendance a
            JOIN employees e ON a.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE a.date LIKE ? ${whereEmp}
            ORDER BY a.date ASC, e.full_name ASC`,
      args
    });

    // Summary counts
    const rows = result.rows;
    const summary = {
      total:   rows.length,
      present: rows.filter(r => r.status === 'present').length,
      absent:  rows.filter(r => r.status === 'absent').length,
      late:    rows.filter(r => r.status === 'late').length,
      leave:   rows.filter(r => r.status === 'on-leave').length,
    };

    res.json({ status: 'success', data: rows, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch monthly report.' });
  }
});

// GET /api/attendance/stats — overall stats for dashboard
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const totalEmp = await db.execute("SELECT COUNT(*) as count FROM employees WHERE status = 'active'");
    const todayAtt = await db.execute({ sql: "SELECT status, COUNT(*) as count FROM attendance WHERE date = ? GROUP BY status", args: [today] });

    const stats = { total_employees: totalEmp.rows[0].count, present: 0, absent: 0, late: 0, on_leave: 0 };
    todayAtt.rows.forEach(r => {
      if (r.status === 'present')  stats.present  = r.count;
      if (r.status === 'absent')   stats.absent   = r.count;
      if (r.status === 'late')     stats.late     = r.count;
      if (r.status === 'on-leave') stats.on_leave = r.count;
    });
    stats.not_marked = stats.total_employees - stats.present - stats.absent - stats.late - stats.on_leave;

    res.json({ status: 'success', data: stats, date: today });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch stats.' });
  }
});

// POST /api/attendance/mark — mark single employee attendance (admin only)
router.post('/mark', authMiddleware, adminOnly, async (req, res) => {
  const { employee_id, date, status, check_in, check_out, notes } = req.body;

  if (!employee_id || !date || !status)
    return res.status(400).json({ status: 'error', message: 'Employee, date, and status are required.' });

  const validStatuses = ['present', 'absent', 'late', 'on-leave'];
  if (!validStatuses.includes(status))
    return res.status(400).json({ status: 'error', message: 'Invalid status.' });

  try {
    // Upsert — update if exists, insert if not
    const existing = await db.execute({
      sql: 'SELECT id FROM attendance WHERE employee_id = ? AND date = ?',
      args: [employee_id, date]
    });

    if (existing.rows.length) {
      await db.execute({
        sql: 'UPDATE attendance SET status=?, check_in=?, check_out=?, notes=?, marked_by=? WHERE employee_id=? AND date=?',
        args: [status, check_in || null, check_out || null, notes || null, req.user.id, employee_id, date]
      });
    } else {
      await db.execute({
        sql: 'INSERT INTO attendance (employee_id, date, status, check_in, check_out, notes, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [employee_id, date, status, check_in || null, check_out || null, notes || null, req.user.id]
      });
    }

    res.json({ status: 'success', message: 'Attendance marked!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to mark attendance.' });
  }
});

// POST /api/attendance/mark-all — mark all employees at once (admin only)
router.post('/mark-all', authMiddleware, adminOnly, async (req, res) => {
  const { date, records } = req.body; // records: [{employee_id, status, check_in, check_out}]

  if (!date || !records || !Array.isArray(records))
    return res.status(400).json({ status: 'error', message: 'Date and records array are required.' });

  try {
    for (const rec of records) {
      if (!rec.employee_id || !rec.status) continue;
      const existing = await db.execute({
        sql: 'SELECT id FROM attendance WHERE employee_id = ? AND date = ?',
        args: [rec.employee_id, date]
      });
      if (existing.rows.length) {
        await db.execute({
          sql: 'UPDATE attendance SET status=?, check_in=?, check_out=?, marked_by=? WHERE employee_id=? AND date=?',
          args: [rec.status, rec.check_in || null, rec.check_out || null, req.user.id, rec.employee_id, date]
        });
      } else {
        await db.execute({
          sql: 'INSERT INTO attendance (employee_id, date, status, check_in, check_out, marked_by) VALUES (?, ?, ?, ?, ?, ?)',
          args: [rec.employee_id, date, rec.status, rec.check_in || null, rec.check_out || null, req.user.id]
        });
      }
    }
    res.json({ status: 'success', message: `Attendance saved for ${records.length} employees!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to save attendance.' });
  }
});

module.exports = router;
