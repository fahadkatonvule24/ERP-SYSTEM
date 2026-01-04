# CEHURD ERP starter

A lightweight ERP starter that covers departments, role-based access, task assignment, notices/events, and resource sharing. It ships with a FastAPI backend (SQLite by default) and an Expo React Native app you can push to Play Store/App Store.

## Stack
- Backend: FastAPI, SQLAlchemy, JWT auth, SQLite (swap to Postgres via `DATABASE_URL`)
- Mobile: Expo + React Native (React Navigation + Axios + AsyncStorage + DocumentPicker)

## Backend
```
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Defaults:
- Admin bootstrap: `admin@example.com` / `changeme` (set in `backend/app/config.py` or `.env`)
- Uploads: saved to `./uploads`

Key endpoints (Bearer token required after login):
- `POST /auth/token` (OAuth2, email/password) -> JWT
- `GET /auth/me` -> current user
- `POST /departments` (admin) -> create department
- `POST /users` (admin) -> create users
- `POST /tasks` (admin/manager) -> assign tasks to users/departments
- `GET /tasks/my`, `GET /tasks/department`, `GET /tasks/{id}`, `PATCH /tasks/{id}`
- `POST /events` (admin/manager) -> shared or per-department notices, ordered by schedule
- `GET /events/shared`, `GET /events/department`
- `POST /tasks/{id}/upload` (any assignee/manager/admin) -> attach files
- `POST /tasks/{id}/comments`, `GET /tasks/{id}/comments`
- Dashboards: `/dashboards/shared`, `/dashboards/department`, `/dashboards/my`

## Mobile (Expo)
```
cd mobile
npm install
npm run start      # choose Android/iOS/Web
```
Configure API base:
- Update `API_URL` in `mobile/App.tsx` to point to your backend (e.g., LAN IP instead of localhost for devices/emulators).

Features in the starter app:
- Email/password login (uses backend JWT)
- Navigation stack with dashboard tabs and task detail screens
- Shared notices, department notices/tasks, and personal tasks views
- Task detail includes status updates, comments, and file uploads (DocumentPicker)
- Simple theming; ready to brand for store submission

## Configuration and production
- Security: rotate `secret_key` and `default_admin_password`, set `allowed_origins` to your domains, and enforce HTTPS/TLS on deploy. Passwords require a minimum length (configurable via `password_min_length`).
- Database: set `DATABASE_URL` in `.env` (e.g., Postgres `postgresql+psycopg2://user:pass@host/db`). Alembic is configured (`backend/alembic.ini` + `backend/alembic/env.py`); run `alembic revision --autogenerate -m "init"` then `alembic upgrade head` after updating models.
- Store release: convert Expo project to EAS build, update icons/splash/slug, and follow Google/Apple store submission guides.
- NGO demo data: set `SEED_NGO_DATA=1` (and optionally `SEED_USER_PASSWORD=...`) before starting the backend to seed departments, users, tasks, requests, and fundraising data.
