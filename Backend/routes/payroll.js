const express = require('express');
const { db } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/payroll/salaries — get all employee salaries (admin) or own (viewer)
router.get('/salaries', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await db.execute(`
        SELECT e.id as employee_id, e.full_name, e.designation, d.name as department_name,
               s.id as salary_id, s.basic_salary, s.house_allowance, s.transport_allowance,
               s.medical_allowance, s.other_allowance, s.tax_deduction, s.other_deduction,
               (s.basic_salary + s.house_allowance + s.transport_allowance + s.medical_allowance + s.other_allowance) as gross_salary,
               (s.basic_salary + s.house_allowance + s.transport_allowance + s.medical_allowance + s.other_allowance - s.tax_deduction - s.other_deduction) as net_salary
        FROM employees e
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN salaries s ON s.employee_id = e.id
        WHERE e.status = 'active'
        ORDER BY e.full_name ASC
      `);
    } else {
      const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
      if (!empRes.rows.length) return res.json({ status: 'success', data: [] });
      result = await db.execute({
        sql: `SELECT e.id as employee_id, e.full_name, e.designation, d.name as department_name,
                     s.basic_salary, s.house_allowance, s.transport_allowance,
                     s.medical_allowance, s.other_allowance, s.tax_deduction, s.other_deduction,
                     (s.basic_salary + s.house_allowance + s.transport_allowance + s.medical_allowance + s.other_allowance) as gross_salary,
                     (s.basic_salary + s.house_allowance + s.transport_allowance + s.medical_allowance + s.other_allowance - s.tax_deduction - s.other_deduction) as net_salary
              FROM employees e
              LEFT JOIN departments d ON e.department_id = d.id
              LEFT JOIN salaries s ON s.employee_id = e.id
              WHERE e.id = ?`,
        args: [empRes.rows[0].id]
      });
    }
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch salaries.' });
  }
});

// POST /api/payroll/salaries — set or update salary for employee (admin only)
router.post('/salaries', authMiddleware, adminOnly, async (req, res) => {
  const { employee_id, basic_salary, house_allowance, transport_allowance, medical_allowance, other_allowance, tax_deduction, other_deduction } = req.body;

  if (!employee_id || basic_salary === undefined)
    return res.status(400).json({ status: 'error', message: 'Employee and basic salary are required.' });

  try {
    const emp = await db.execute({ sql: 'SELECT id FROM employees WHERE id = ?', args: [employee_id] });
    if (!emp.rows.length) return res.status(404).json({ status: 'error', message: 'Employee not found.' });

    const existing = await db.execute({ sql: 'SELECT id FROM salaries WHERE employee_id = ?', args: [employee_id] });

    if (existing.rows.length) {
      await db.execute({
        sql: `UPDATE salaries SET basic_salary=?, house_allowance=?, transport_allowance=?,
              medical_allowance=?, other_allowance=?, tax_deduction=?, other_deduction=?,
              updated_at=CURRENT_TIMESTAMP WHERE employee_id=?`,
        args: [basic_salary||0, house_allowance||0, transport_allowance||0, medical_allowance||0, other_allowance||0, tax_deduction||0, other_deduction||0, employee_id]
      });
    } else {
      await db.execute({
        sql: `INSERT INTO salaries (employee_id, basic_salary, house_allowance, transport_allowance, medical_allowance, other_allowance, tax_deduction, other_deduction)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [employee_id, basic_salary||0, house_allowance||0, transport_allowance||0, medical_allowance||0, other_allowance||0, tax_deduction||0, other_deduction||0]
      });
    }

    res.json({ status: 'success', message: 'Salary updated successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to update salary.' });
  }
});

// POST /api/payroll/generate — generate payslip for employee+month (admin only)
router.post('/generate', authMiddleware, adminOnly, async (req, res) => {
  const { employee_id, month } = req.body; // month: YYYY-MM

  if (!employee_id || !month)
    return res.status(400).json({ status: 'error', message: 'Employee and month are required.' });

  try {
    // Get salary structure
    const salRes = await db.execute({ sql: 'SELECT * FROM salaries WHERE employee_id = ?', args: [employee_id] });
    if (!salRes.rows.length)
      return res.status(400).json({ status: 'error', message: 'No salary structure found. Please set salary first.' });

    const s = salRes.rows[0];

    // Get attendance for the month
    const attRes = await db.execute({
      sql: `SELECT status, COUNT(*) as count FROM attendance
            WHERE employee_id = ? AND date LIKE ?
            GROUP BY status`,
      args: [employee_id, `${month}%`]
    });

    let days_present = 0, days_absent = 0;
    attRes.rows.forEach(r => {
      if (r.status === 'present' || r.status === 'late') days_present += Number(r.count);
      if (r.status === 'absent') days_absent += Number(r.count);
    });

    const gross_salary    = s.basic_salary + s.house_allowance + s.transport_allowance + s.medical_allowance + s.other_allowance;
    const total_deductions = Number(s.tax_deduction) + Number(s.other_deduction);
    const net_salary       = gross_salary - total_deductions;

    // Upsert payslip
    const existing = await db.execute({ sql: 'SELECT id FROM payslips WHERE employee_id = ? AND month = ?', args: [employee_id, month] });

    if (existing.rows.length) {
      await db.execute({
        sql: `UPDATE payslips SET basic_salary=?, house_allowance=?, transport_allowance=?,
              medical_allowance=?, other_allowance=?, gross_salary=?, tax_deduction=?,
              other_deduction=?, total_deductions=?, net_salary=?, days_present=?, days_absent=?,
              generated_by=? WHERE employee_id=? AND month=?`,
        args: [s.basic_salary, s.house_allowance, s.transport_allowance, s.medical_allowance,
               s.other_allowance, gross_salary, s.tax_deduction, s.other_deduction,
               total_deductions, net_salary, days_present, days_absent, req.user.id, employee_id, month]
      });
    } else {
      await db.execute({
        sql: `INSERT INTO payslips (employee_id, month, basic_salary, house_allowance, transport_allowance,
              medical_allowance, other_allowance, gross_salary, tax_deduction, other_deduction,
              total_deductions, net_salary, days_present, days_absent, generated_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [employee_id, month, s.basic_salary, s.house_allowance, s.transport_allowance,
               s.medical_allowance, s.other_allowance, gross_salary, s.tax_deduction,
               s.other_deduction, total_deductions, net_salary, days_present, days_absent, req.user.id]
      });
    }

    // Return full payslip with employee details
    const empRes = await db.execute({
      sql: `SELECT e.*, d.name as department_name FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id WHERE e.id = ?`,
      args: [employee_id]
    });

    res.json({
      status: 'success',
      message: 'Payslip generated!',
      payslip: {
        employee: empRes.rows[0],
        month,
        basic_salary: s.basic_salary,
        house_allowance: s.house_allowance,
        transport_allowance: s.transport_allowance,
        medical_allowance: s.medical_allowance,
        other_allowance: s.other_allowance,
        gross_salary,
        tax_deduction: s.tax_deduction,
        other_deduction: s.other_deduction,
        total_deductions,
        net_salary,
        days_present,
        days_absent
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Failed to generate payslip.' });
  }
});

// GET /api/payroll/payslips — get payslip history
router.get('/payslips', authMiddleware, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await db.execute(`
        SELECT p.*, e.full_name, e.designation, d.name as department_name
        FROM payslips p
        JOIN employees e ON p.employee_id = e.id
        LEFT JOIN departments d ON e.department_id = d.id
        ORDER BY p.month DESC, e.full_name ASC
      `);
    } else {
      const empRes = await db.execute({ sql: 'SELECT id FROM employees WHERE user_id = ?', args: [req.user.id] });
      if (!empRes.rows.length) return res.json({ status: 'success', data: [] });
      result = await db.execute({
        sql: `SELECT p.*, e.full_name, e.designation, d.name as department_name
              FROM payslips p JOIN employees e ON p.employee_id = e.id
              LEFT JOIN departments d ON e.department_id = d.id
              WHERE p.employee_id = ? ORDER BY p.month DESC`,
        args: [empRes.rows[0].id]
      });
    }
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch payslips.' });
  }
});

module.exports = router;
