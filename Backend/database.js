const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = createClient({
  url: `file:${path.join(__dirname, 'ems.db')}`
});

async function setupDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      employee_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      designation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      department_id INTEGER REFERENCES departments(id),
      user_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      employee_id INTEGER,
      performed_by INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present',
      check_in TEXT,
      check_out TEXT,
      notes TEXT,
      marked_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, date)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS salaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id),
      basic_salary REAL NOT NULL DEFAULT 0,
      house_allowance REAL NOT NULL DEFAULT 0,
      transport_allowance REAL NOT NULL DEFAULT 0,
      medical_allowance REAL NOT NULL DEFAULT 0,
      other_allowance REAL NOT NULL DEFAULT 0,
      tax_deduction REAL NOT NULL DEFAULT 0,
      other_deduction REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS payslips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      month TEXT NOT NULL,
      basic_salary REAL NOT NULL DEFAULT 0,
      house_allowance REAL NOT NULL DEFAULT 0,
      transport_allowance REAL NOT NULL DEFAULT 0,
      medical_allowance REAL NOT NULL DEFAULT 0,
      other_allowance REAL NOT NULL DEFAULT 0,
      gross_salary REAL NOT NULL DEFAULT 0,
      tax_deduction REAL NOT NULL DEFAULT 0,
      other_deduction REAL NOT NULL DEFAULT 0,
      total_deductions REAL NOT NULL DEFAULT 0,
      net_salary REAL NOT NULL DEFAULT 0,
      days_present INTEGER DEFAULT 0,
      days_absent INTEGER DEFAULT 0,
      generated_by INTEGER REFERENCES users(id),
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, month)
    )
  `);

  // Seed only if no users exist
  const existing = await db.execute('SELECT COUNT(*) as count FROM users');
  if (existing.rows[0].count === 0) {
    const adminHash = await bcrypt.hash('admin123', 10);
    await db.execute({
      sql: 'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      args: ['admin@ems.com', adminHash, 'admin']
    });

    // Seed departments
    await db.execute("INSERT INTO departments (name) VALUES ('Engineering')");
    await db.execute("INSERT INTO departments (name) VALUES ('Human Resources')");
    await db.execute("INSERT INTO departments (name) VALUES ('Finance')");
    await db.execute("INSERT INTO departments (name) VALUES ('Marketing')");

    // Seed employees WITH linked user accounts
    const emp1Hash = await bcrypt.hash('ali123', 10);
    const emp2Hash = await bcrypt.hash('sara123', 10);
    const emp3Hash = await bcrypt.hash('bilal123', 10);

    // Insert user accounts for employees
    const u1 = await db.execute({ sql: 'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', args: ['ali@ems.com', emp1Hash, 'viewer'] });
    const u2 = await db.execute({ sql: 'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', args: ['sara@ems.com', emp2Hash, 'viewer'] });
    const u3 = await db.execute({ sql: 'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', args: ['bilal@ems.com', emp3Hash, 'viewer'] });

    // Insert employees linked to users
    const e1 = await db.execute({ sql: `INSERT INTO employees (full_name, email, phone, designation, status, department_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: ['Ali Hassan', 'ali@ems.com', '+92 300 1234567', 'Software Engineer', 'active', 1, Number(u1.lastInsertRowid)] });
    const e2 = await db.execute({ sql: `INSERT INTO employees (full_name, email, phone, designation, status, department_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: ['Sara Khan', 'sara@ems.com', '+92 321 9876543', 'HR Manager', 'active', 2, Number(u2.lastInsertRowid)] });
    const e3 = await db.execute({ sql: `INSERT INTO employees (full_name, email, phone, designation, status, department_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: ['Bilal Ahmed', 'bilal@ems.com', '+92 333 4567890', 'Financial Analyst', 'inactive', 3, Number(u3.lastInsertRowid)] });

    // Update users with employee_id
    await db.execute({ sql: 'UPDATE users SET employee_id = ? WHERE id = ?', args: [Number(e1.lastInsertRowid), Number(u1.lastInsertRowid)] });
    await db.execute({ sql: 'UPDATE users SET employee_id = ? WHERE id = ?', args: [Number(e2.lastInsertRowid), Number(u2.lastInsertRowid)] });
    await db.execute({ sql: 'UPDATE users SET employee_id = ? WHERE id = ?', args: [Number(e3.lastInsertRowid), Number(u3.lastInsertRowid)] });

    console.log('✅ Database seeded');
    console.log('   Admin:  admin@ems.com / admin123');
    console.log('   Employee accounts:');
    console.log('   Ali Hassan:   ali@ems.com   / ali123');
    console.log('   Sara Khan:    sara@ems.com  / sara123');
    console.log('   Bilal Ahmed:  bilal@ems.com / bilal123');
  }

  console.log('✅ Database ready');
}

module.exports = { db, setupDatabase };
