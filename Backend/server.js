require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { setupDatabase } = require('./database');

const authRoutes       = require('./routes/auth');
const employeeRoutes   = require('./routes/employees');
const departmentRoutes = require('./routes/departments');
const leaveRoutes      = require('./routes/leaves');
const attendanceRoutes = require('./routes/attendance');
const payrollRoutes    = require('./routes/payroll');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/auth',        authRoutes);
app.use('/api/employees',   employeeRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/leaves',      leaveRoutes);
app.use('/api/attendance',  attendanceRoutes);
app.use('/api/payroll',     payrollRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'EMS Backend is running.' });
});

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route ${req.method} ${req.path} not found.` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'error', message: 'Internal server error.' });
});

async function start() {
  await setupDatabase();
  app.listen(PORT, () => {
    console.log(`\n🚀 EMS Backend running at http://localhost:${PORT}`);
    console.log('\n   Default credentials:');
    console.log('   Admin:  admin@ems.com  / admin123');
    console.log('   Ali:    ali@ems.com    / ali123');
    console.log('   Sara:   sara@ems.com   / sara123\n');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
