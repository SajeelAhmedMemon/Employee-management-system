# EMS Backend

Node.js + Express REST API for the Employee Management System.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the server:
   ```
   npm start
   ```

   Server runs at: http://localhost:3000

## Default Login Credentials

| Role   | Email             | Password   |
|--------|-------------------|------------|
| Admin  | admin@ems.com     | admin123   |
| Viewer | viewer@ems.com    | viewer123  |

## API Endpoints

### Auth
| Method | Endpoint           | Description       |
|--------|--------------------|-------------------|
| POST   | /api/auth/login    | Login, get token  |
| POST   | /api/auth/logout   | Logout            |

### Employees
| Method | Endpoint                        | Role    |
|--------|---------------------------------|---------|
| GET    | /api/employees                  | All     |
| GET    | /api/employees/:id              | All     |
| POST   | /api/employees                  | Admin   |
| PUT    | /api/employees/:id              | Admin   |
| PATCH  | /api/employees/:id/deactivate   | Admin   |
| DELETE | /api/employees/:id              | Admin   |

### Departments
| Method | Endpoint               | Role    |
|--------|------------------------|---------|
| GET    | /api/departments       | All     |
| POST   | /api/departments       | Admin   |
| PUT    | /api/departments/:id   | Admin   |
| DELETE | /api/departments/:id   | Admin   |

## Connecting Frontend

Replace these 3 placeholders in all 4 HTML files:

```js
const API_BASE = 'http://localhost:3000/api';
```

## Tech Stack
- Node.js + Express
- SQLite (via @libsql/client) — database file: ems.db
- bcryptjs — password hashing
- jsonwebtoken — JWT authentication
- cors — cross-origin requests
