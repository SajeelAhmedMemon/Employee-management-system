# EMS — Employee Management System

A full-stack web application for managing employees, leave requests, attendance, payroll, and employee feedback. Built as a semester project for the **Fundamentals of Software Engineering (FSE)** course.

**Team:** Sajeel Ahmed & Muhammad Muhib

---

## Features

### 👥 Employee Management
- Add, edit, deactivate, or permanently delete employees
- Auto-generates a login account for each new employee
- Filter by department, status, or search by name/email
- Export employee list as CSV

### 🏢 Departments
- Create and manage departments
- Employee count per department tracked automatically

### 📅 Leave Management
- Employees can apply for leave (Annual, Sick, Emergency, Unpaid, Casual)
- Days auto-calculated as working days only (Mon–Fri)
- HR (Admin) can approve or reject requests

### 🕐 Attendance
- Mark daily attendance per employee (Present, Absent, Late, On Leave)
- Log check-in / check-out times
- Monthly report grouped by employee
- Bulk "Save All" for marking the entire team at once

### 💰 Payroll
- Set salary structures per employee (basic + allowances + deductions)
- Generate payslips for any employee/month combination
- Full payslip history

### 💬 Feedback
- Employees can submit feedback to HR (general, workload, management, facilities, HR policy, or other)
- Option to submit anonymously
- HR can review and manage submitted feedback

### 🔐 Authentication & Roles
| Role | Access |
|------|--------|
| **Admin (HR)** | Full access — employees, departments, attendance, payroll, leave approvals, feedback review |
| **Employee** | View own profile, apply for leave, view own attendance & payslip, submit feedback |

### 🌙 Dark Mode
- Toggle between light and dark themes from the login page

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Node.js + Express |
| Database | SQLite|
| Auth | JWT|


## How to Run a project

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher

### 1. Clone the repository
```bash
git clone https://github.com/your-username/ems.git
cd ems
```

### 2. Install dependencies
```bash
cd ems-backend
npm install
```

### 3. Configure environment
Create a `.env` file inside `ems-backend/` (use `.env.example` as reference):
```env
PORT=3000
JWT_SECRET=your_secret_key_here
JWT_EXPIRES_IN=8h
```

### 4. Start the backend
```bash
npm start
```
Server runs at `http://localhost:3000`. The database and default accounts are created automatically on first run.

### 5. Open the frontend
Open `Fronted/login.html` directly in your browser.

---

## Default Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin (HR) | `admin@ems.com` | `admin123` |
| Employee | `ali@ems.com` | `ali123` |
| Employee | `sara@ems.com` | `sara123` |

---

## License

MIT — feel free to use, modify, and distribute.
