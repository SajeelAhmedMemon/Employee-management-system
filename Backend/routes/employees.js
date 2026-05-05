const express = require('express');
const bcrypt  = require('bcryptjs');
const { db }  = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

async function logAction(actionType, employeeId, performedBy, details = '') {
  await db.execute({
    sql: 'INSERT INTO audit_logs (action_type, employee_id, performed_by, details) VALUES (?, ?, ?, ?)',
    args: [actionType, employeeId, performedBy, details]
  });
}

// GET /api/employees — admin gets all, viewer gets only their own
router.get('/', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await db.execute(`
        SELECT e.*, d.name as department_name
        FROM employees e
        LEFT JOIN departments d ON e.department_id = d.id
        ORDER BY e.created_at DESC
      `);
    } else {
      // Viewer only sees their own record
      result = await db.execute({
        sql: `SELECT e.*, d.name as department_name
              FROM employees e
              LEFT JOIN departments d ON e.department_id = d.id
              WHERE e.user_id = ?`,
        args: [req.user.id]
      });
    }
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch employees.' });
  }
});

// GET /api/employees/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT e.*, d.name as department_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.id = ?`,
      args: [req.params.id]
    });
    if (!result.rows.length)
      return res.status(404).json({ status: 'error', message: 'Employee not found.' });

    // Viewer can only view their own profile
    if (req.user.role !== 'admin' && result.rows[0].user_id !== req.user.id)
      return res.status(403).json({ status: 'error', message: 'Access denied.' });

    const logs = await db.execute({
      sql: `SELECT al.*, u.email as performed_by_email
            FROM audit_logs al
            LEFT JOIN users u ON al.performed_by = u.id
            WHERE al.employee_id = ?
            ORDER BY al.created_at DESC LIMIT 10`,
      args: [req.params.id]
    });

    res.json({ status: 'success', data: result.rows[0], audit_logs: logs.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch employee.' });
  }
});

// POST /api/employees — auto-creates user account for the employee
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  const { full_name, email, phone, designation, status, department_id } = req.body;

  if (!full_name || !email || !designation)
    return res.status(400).json({ status: 'error', message: 'Name, email, and designation are required.' });

  try {
    // Check duplicate email in employees
    const empCheck = await db.execute({ sql: 'SELECT id FROM employees WHERE email = ?', args: [email.trim().toLowerCase()] });
    if (empCheck.rows.length)
      return res.status(409).json({ status: 'error', message: 'Error: Email already exists.' });

    // Check duplicate email in users
    const userCheck = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.trim().toLowerCase()] });
    if (userCheck.rows.length)
      return res.status(409).json({ status: 'error', message: 'Error: Email already exists.' });

    // Auto-generate password: first name + 123 (e.g. ali123)
    const firstName    = full_name.trim().split(' ')[0].toLowerCase();
    const autoPassword = `${firstName}123`;
    const passwordHash = await bcrypt.hash(autoPassword, 10);

    // Create user account
    const userResult = await db.execute({
      sql: 'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      args: [email.trim().toLowerCase(), passwordHash, 'viewer']
    });
    const userId = Number(userResult.lastInsertRowid);

    // Create employee linked to user
    const empResult = await db.execute({
      sql: `INSERT INTO employees (full_name, email, phone, designation, status, department_id, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [full_name.trim(), email.trim().toLowerCase(), phone || null, designation.trim(), status || 'active', department_id || null, userId]
    });
    const empId = Number(empResult.lastInsertRowid);

    // Update user with employee_id
    await db.execute({ sql: 'UPDATE users SET employee_id = ? WHERE id = ?', args: [empId, userId] });

    await logAction('INSERT', empId, req.user.id, `Employee ${full_name} added`);

    res.status(201).json({
      status: 'success',
      message: `Employee added! Login: ${email.trim().toLowerCase()} / ${autoPassword}`,
      id: empId,
      login: { email: email.trim().toLowerCase(), password: autoPassword }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to add employee.' });
  }
});

// PUT /api/employees/:id
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  const { full_name, email, phone, designation, status, department_id } = req.body;
  const { id } = req.params;

  if (!full_name || !email || !designation)
    return res.status(400).json({ status: 'error', message: 'Name, email, and designation are required.' });

  try {
    const existing = await db.execute({ sql: 'SELECT id, user_id FROM employees WHERE id = ?', args: [id] });
    if (!existing.rows.length)
      return res.status(404).json({ status: 'error', message: 'Employee not found.' });

    const emailCheck = await db.execute({ sql: 'SELECT id FROM employees WHERE email = ? AND id != ?', args: [email.trim().toLowerCase(), id] });
    if (emailCheck.rows.length)
      return res.status(409).json({ status: 'error', message: 'Error: Email already exists.' });

    await db.execute({
      sql: `UPDATE employees SET full_name=?, email=?, phone=?, designation=?, status=?, department_id=? WHERE id=?`,
      args: [full_name.trim(), email.trim().toLowerCase(), phone || null, designation.trim(), status || 'active', department_id || null, id]
    });

    // Also update email in users table
    const userId = existing.rows[0].user_id;
    if (userId) {
      await db.execute({ sql: 'UPDATE users SET email = ? WHERE id = ?', args: [email.trim().toLowerCase(), userId] });
    }

    await logAction('UPDATE', id, req.user.id, `Employee ${full_name} updated`);
    res.json({ status: 'success', message: 'Employee updated successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to update employee.' });
  }
});

// PATCH /api/employees/:id/deactivate
router.patch('/:id/deactivate', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await db.execute({ sql: 'SELECT id, full_name FROM employees WHERE id = ?', args: [id] });
    if (!existing.rows.length)
      return res.status(404).json({ status: 'error', message: 'Employee not found.' });

    await db.execute({ sql: "UPDATE employees SET status = 'inactive' WHERE id = ?", args: [id] });
    await logAction('DEACTIVATE', id, req.user.id, `Employee ${existing.rows[0].full_name} deactivated`);
    res.json({ status: 'success', message: 'Employee deactivated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to deactivate employee.' });
  }
});

// DELETE /api/employees/:id
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await db.execute({ sql: 'SELECT id, full_name, user_id FROM employees WHERE id = ?', args: [id] });
    if (!existing.rows.length)
      return res.status(404).json({ status: 'error', message: 'Employee not found.' });

    await db.execute({ sql: 'DELETE FROM employees WHERE id = ?', args: [id] });

    // Also delete the linked user account
    if (existing.rows[0].user_id) {
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [existing.rows[0].user_id] });
    }

    await logAction('DELETE', id, req.user.id, `Employee ${existing.rows[0].full_name} deleted`);
    res.json({ status: 'success', message: 'Employee deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to delete employee.' });
  }
});

module.exports = router;
