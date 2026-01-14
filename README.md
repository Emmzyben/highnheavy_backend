# HighnHeavy Backend API

Backend server for the HighnHeavy logistics platform built with Node.js, Express, and MySQL.

## Features

- ✅ RESTful API with Express.js
- ✅ MySQL database integration
- ✅ JWT authentication
- ✅ Password hashing with bcrypt
- ✅ CORS support
- ✅ Environment-based configuration
- ✅ Development mode with nodemon

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MySQL (v8.0 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`:
   - Set your MySQL credentials
   - Set a strong JWT secret
   - Configure other settings as needed

4. Create the MySQL database:
```sql
CREATE DATABASE highnheavy;
```

5. Run the database schema:
```bash
mysql -u root -p highnheavy < ../highnheavy_schema_mysql.sql
```

### Running the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will run on `http://localhost:5000` by default.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user

### Health Check
- `GET /health` - Server health status
- `GET /` - API information

## Project Structure

```
backend/
├── config/
│   └── database.js       # MySQL connection configuration
├── middleware/
│   └── auth.js          # Authentication middleware
├── routes/
│   └── auth.js          # Authentication routes
├── server.js            # Main application file
├── .env.example         # Environment variables template
├── .gitignore          # Git ignore rules
└── package.json        # Project dependencies
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | development |
| `PORT` | Server port | 5000 |
| `DB_HOST` | MySQL host | localhost |
| `DB_USER` | MySQL username | root |
| `DB_PASSWORD` | MySQL password | - |
| `DB_NAME` | Database name | highnheavy |
| `DB_PORT` | MySQL port | 3306 |
| `JWT_SECRET` | JWT secret key | - |
| `JWT_EXPIRE` | JWT expiration | 30d |
| `BCRYPT_ROUNDS` | Bcrypt salt rounds | 10 |

## Security

- Passwords are hashed using bcrypt
- JWT tokens for authentication
- Input validation on all endpoints
- CORS configuration
- Environment-based secrets

## License

ISC
# highnheavy_backend
