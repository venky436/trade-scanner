# Authentication System

## Overview

JWT-based authentication with access tokens (15 min) + refresh tokens (7 days). Passwords hashed with bcrypt (12 rounds). Refresh tokens stored as HTTP-only cookies and persisted in PostgreSQL (hashed).

Currently admin-only — one seeded admin user. Registration endpoint exists but is not exposed in the UI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                                                              │
│  AuthProvider (context)                                      │
│    ├─ On mount: check sessionStorage for accessToken         │
│    │   ├─ Found → GET /api/user/me (verify token)            │
│    │   └─ Not found → POST /api/user/refresh (cookie)        │
│    │                                                         │
│    ├─ login(email, pw) → POST /api/user/login                │
│    │   ├─ Response: { accessToken, user }                    │
│    │   ├─ Cookie: refresh_token (HTTP-only, set by server)   │
│    │   └─ Store accessToken in sessionStorage                │
│    │                                                         │
│    ├─ logout() → POST /api/user/logout                       │
│    │   ├─ Clear sessionStorage                               │
│    │   └─ Server clears cookie + deletes refresh token       │
│    │                                                         │
│    └─ Auto-refresh: every 13 min → POST /api/user/refresh    │
│        └─ Gets new accessToken + new refresh cookie          │
│                                                              │
│  Route protection:                                           │
│    ├─ Not authenticated → redirect to /login                 │
│    └─ Already authenticated on /login → redirect to /        │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        BACKEND                               │
│                                                              │
│  Public routes (no auth):                                    │
│    POST /api/user/login                                      │
│    POST /api/user/register                                   │
│    POST /api/user/refresh                                    │
│    POST /api/user/logout                                     │
│    GET  /api/auth/login (Kite OAuth)                         │
│    GET  /api/auth/status                                     │
│                                                              │
│  Protected routes (authMiddleware):                           │
│    GET  /api/user/me                                         │
│                                                              │
│  Admin routes (authMiddleware + adminGuard):                  │
│    GET  /api/admin/accuracy                                  │
│    GET  /api/admin/signals                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Token Flow

### Login

```
Client                          Server
  │                               │
  │  POST /api/user/login         │
  │  { email, password }          │
  │──────────────────────────────>│
  │                               │  1. Find user by email
  │                               │  2. bcrypt.compare(password, hash)
  │                               │  3. Sign JWT (15 min expiry)
  │                               │  4. Generate refresh token (64-byte hex)
  │                               │  5. Hash refresh token (bcrypt, 4 rounds)
  │                               │  6. Store hash in DB (refresh_tokens table)
  │                               │  7. Set HTTP-only cookie: refresh_token
  │                               │
  │  { accessToken, user }        │
  │  + Set-Cookie: refresh_token  │
  │<──────────────────────────────│
  │                               │
  │  Store accessToken in         │
  │  sessionStorage               │
```

### Authenticated Request

```
Client                          Server
  │                               │
  │  GET /api/user/me             │
  │  Authorization: Bearer <JWT>  │
  │──────────────────────────────>│
  │                               │  authMiddleware:
  │                               │    1. Extract token from header
  │                               │    2. jwt.verify(token, secret)
  │                               │    3. Attach payload to request.user
  │                               │
  │  { user: { id, email, role }} │
  │<──────────────────────────────│
```

### Token Refresh

```
Client                          Server
  │                               │
  │  POST /api/user/refresh       │
  │  Cookie: refresh_token        │
  │──────────────────────────────>│
  │                               │  1. Read cookie
  │                               │  2. Find non-expired tokens in DB
  │                               │  3. bcrypt.compare each until match
  │                               │  4. Delete old token from DB
  │                               │  5. Generate new refresh token
  │                               │  6. Store new hash in DB
  │                               │  7. Sign new JWT
  │                               │  8. Set new cookie
  │                               │
  │  { accessToken }              │
  │  + Set-Cookie: refresh_token  │
  │<──────────────────────────────│
```

### Logout

```
Client                          Server
  │                               │
  │  POST /api/user/logout        │
  │  Cookie: refresh_token        │
  │──────────────────────────────>│
  │                               │  1. Find matching token in DB
  │                               │  2. Delete from DB
  │                               │  3. Clear cookie
  │                               │
  │  { success: true }            │
  │  + Clear-Cookie               │
  │<──────────────────────────────│
  │                               │
  │  Clear sessionStorage         │
  │  Redirect to /login           │
```

---

## Security Design

### Passwords

| Property | Value |
|----------|-------|
| Algorithm | bcrypt |
| Salt rounds | 12 |
| Min length | 8 characters |
| Storage | `password_hash` column in `users` table |

### Access Tokens (JWT)

| Property | Value |
|----------|-------|
| Algorithm | HS256 (jsonwebtoken) |
| Expiry | 15 minutes |
| Secret | `JWT_SECRET` env var (fallback: hardcoded dev secret) |
| Storage | Client `sessionStorage` (not localStorage — cleared on tab close) |
| Payload | `{ userId, email, role }` |
| Sent as | `Authorization: Bearer <token>` header |

### Refresh Tokens

| Property | Value |
|----------|-------|
| Format | 64-byte cryptographic random hex string |
| Expiry | 7 days |
| Hash algorithm | bcrypt (4 rounds — lighter than password, still secure) |
| Storage (server) | `refresh_tokens` table (hashed, not plaintext) |
| Storage (client) | HTTP-only cookie (`refresh_token`) |
| Cookie flags | `httpOnly`, `secure` (prod), `sameSite: strict` (prod) / `lax` (dev), `path: /`, `maxAge: 7 days` |
| Rotation | Old token deleted on each refresh — new token issued |

### Why This Design

- **Access token in sessionStorage**: Short-lived (15 min), cleared on tab close, not sent automatically (requires explicit `Authorization` header)
- **Refresh token as HTTP-only cookie**: Cannot be read by JavaScript (XSS-safe), sent automatically with `credentials: include`
- **Token rotation**: Each refresh deletes the old token and issues a new one — stolen refresh tokens become single-use
- **Hashed refresh tokens**: Even if DB is compromised, tokens can't be extracted

---

## Database Schema

### `users` Table

```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name        VARCHAR(100),
  role        VARCHAR(10) NOT NULL DEFAULT 'USER',  -- USER | ADMIN
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### `refresh_tokens` Table

```sql
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
  user_agent  VARCHAR(500),
  ip_address  VARCHAR(50)
);
```

---

## API Endpoints

### POST /api/user/register

Creates a new user account.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| email | string | Yes | Valid email format |
| password | string | Yes | Min 8 characters |
| name | string | No | — |

**Response:** `{ success: true, user: { id, email, name, role } }`

**Errors:**
- 400: Missing email/password, invalid email, short password
- 409: Email already registered

### POST /api/user/login

Authenticates a user and returns tokens.

| Field | Type | Required |
|-------|------|----------|
| email | string | Yes |
| password | string | Yes |

**Response:** `{ accessToken: string, user: { id, email, name, role } }` + `Set-Cookie: refresh_token`

**Errors:**
- 400: Missing fields
- 401: Invalid credentials (sanitized — never reveals whether email exists)

### POST /api/user/refresh

Issues a new access token using the refresh token cookie.

**Request:** Cookie `refresh_token` sent automatically

**Response:** `{ accessToken: string }` + `Set-Cookie: refresh_token` (rotated)

**Errors:**
- 401: No cookie, invalid/expired token

### POST /api/user/logout

Invalidates the refresh token and clears the cookie.

**Response:** `{ success: true }` + `Clear-Cookie`

### GET /api/user/me

Returns the authenticated user's profile.

**Headers:** `Authorization: Bearer <accessToken>`

**Response:** `{ user: { id, email, name, role } }`

**Errors:**
- 401: Missing/invalid token
- 404: User not found

---

## Frontend Integration

### AuthProvider (`apps/web/src/context/auth-context.tsx`)

Wraps the entire app. Manages auth state and provides `login()`, `logout()`, `user`, `isAuthenticated`, `isLoading`.

**Startup sequence:**
1. Check `sessionStorage` for cached `accessToken`
2. If found → verify with `GET /api/user/me`
3. If not found or expired → try `POST /api/user/refresh` (uses cookie)
4. If refresh fails → redirect to `/login`

**Auto-refresh:** Every 13 minutes, calls `/api/user/refresh` to get a new access token before the 15-minute expiry.

### AppShell (`apps/web/src/components/app-shell.tsx`)

- Wraps app with `AuthProvider`
- Shows loading spinner during initial auth check
- Hides navbar on `/login` page
- Redirects to `/login` if not authenticated

### Login Page (`apps/web/src/app/login/page.tsx`)

- Email + password form with validation
- Redirects to `/` if already authenticated
- Error display for failed login attempts

### Protected UI Elements

| Element | Condition | Location |
|---------|-----------|----------|
| Admin badge (Shield icon) | `user.role === "ADMIN"` | global-nav.tsx |
| Re-login button | `user.role === "ADMIN" && kiteConnected` | global-nav.tsx |
| Admin dashboard link | `user.role === "ADMIN"` | global-nav.tsx |
| User name display | Always (when logged in) | global-nav.tsx |
| Logout button | Always (when logged in) | global-nav.tsx |

---

## Seeding Admin User

```bash
npx tsx apps/server/src/scripts/seed-admin.ts
```

Seeds: `admin@tradescanner.io` / `Admin@123` with role `ADMIN`.

---

## Files

| File | Role |
|------|------|
| `apps/server/src/modules/auth/auth.service.ts` | Core auth logic: register, login, refresh, logout, getUserById |
| `apps/server/src/modules/auth/auth.routes.ts` | Fastify route handlers for all auth endpoints |
| `apps/server/src/modules/auth/auth.middleware.ts` | `authMiddleware` (JWT verify) + `adminGuard` (role check) |
| `apps/server/src/utils/jwt.ts` | JWT sign/verify, refresh token generation |
| `apps/server/src/utils/hash.ts` | bcrypt password hashing + token hashing |
| `apps/server/src/db/schema/users.ts` | Drizzle schema for `users` table |
| `apps/server/src/db/schema/refresh-tokens.ts` | Drizzle schema for `refresh_tokens` table |
| `apps/server/src/scripts/seed-admin.ts` | Admin user seeder script |
| `apps/web/src/context/auth-context.tsx` | AuthProvider with login/logout/auto-refresh |
| `apps/web/src/components/app-shell.tsx` | Auth wrapper + route protection |
| `apps/web/src/app/login/page.tsx` | Login page UI |
| `apps/web/src/app/signup/page.tsx` | Signup page UI (not linked in nav — admin creates users) |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes (prod) | `tradescanner-jwt-secret-change-in-production` | Secret for signing JWTs |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (for user + token tables) |
