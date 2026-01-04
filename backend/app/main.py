import csv
import hashlib
import io
import json
import os
import secrets
import smtplib
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from email.message import EmailMessage

from . import auth, models, schemas
from .config import get_settings
from .database import Base, engine, get_db, SessionLocal


settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(f"{token}{settings.secret_key}".encode()).hexdigest()


def _issue_refresh_token(db: Session, user_id: int) -> str:
    raw = secrets.token_urlsafe(48)
    token_hash = _hash_refresh_token(raw)
    expires = datetime.utcnow() + timedelta(minutes=settings.refresh_token_expire_minutes)
    record = models.RefreshToken(user_id=user_id, token_hash=token_hash, expires_at=expires)
    db.add(record)
    db.commit()
    return raw


def _revoke_refresh_token(db: Session, token_hash: str):
    db.query(models.RefreshToken).filter(models.RefreshToken.token_hash == token_hash).update({"revoked": True})
    db.commit()


def _send_email(to_email: str, subject: str, body: str):
    if not settings.smtp_host or not settings.smtp_from:
        return False, "SMTP not configured"
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        if settings.smtp_tls:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            server.starttls()
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)
        server.quit()
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _email_worker():
    # simple loop to deliver queued emails
    while True:
        db = SessionLocal()
        try:
            queued = (
                db.query(models.EmailQueue)
                .filter(models.EmailQueue.status == "queued")
                .order_by(models.EmailQueue.created_at.asc())
                .limit(10)
                .all()
            )
            for item in queued:
                ok, err = _send_email(item.to_email, item.subject, item.body)
                if ok:
                    item.status = "sent"
                    item.last_error = None
                else:
                    item.status = "error"
                    item.last_error = err
                db.commit()
        finally:
            db.close()
        time.sleep(15)


def seed_admin():
    db = SessionLocal()
    try:
        admin = (
            db.query(models.User)
            .filter(models.User.email == settings.admin_email)
            .first()
        )
        if not admin:
            dept = models.Department(name="Administration", description="System administrators")
            db.add(dept)
            db.flush()
            if len(settings.default_admin_password) < settings.password_min_length:
                raise RuntimeError("default_admin_password too short; update your environment")
            admin_user = models.User(
                full_name="System Admin",
                email=settings.admin_email,
                hashed_password=auth.get_password_hash(settings.default_admin_password),
                department_id=dept.id,
                role=models.Role.admin,
            )
            db.add(admin_user)
            db.commit()
    finally:
        db.close()


def seed_ngo_data():
    if not settings.seed_ngo_data:
        return
    db = SessionLocal()
    try:
        seed_password = settings.seed_user_password
        if len(seed_password) < settings.password_min_length:
            raise RuntimeError("seed_user_password too short; update your environment")

        def ensure_department(name: str, description: str):
            dept = db.query(models.Department).filter(models.Department.name == name).first()
            if dept:
                return dept
            dept = models.Department(name=name, description=description)
            db.add(dept)
            db.flush()
            return dept

        def ensure_user(full_name: str, email: str, role: models.Role, dept_id: int | None):
            user = db.query(models.User).filter(models.User.email == email).first()
            if user:
                return user
            user = models.User(
                full_name=full_name,
                email=email,
                hashed_password=auth.get_password_hash(seed_password),
                department_id=dept_id,
                role=role,
                active=True,
            )
            db.add(user)
            db.flush()
            return user

        def ensure_event(title: str, description: str, scheduled_at: datetime, department_id: int | None):
            existing = db.query(models.Event).filter(models.Event.title == title).first()
            if existing:
                return existing
            event = models.Event(
                title=title,
                description=description,
                scheduled_at=scheduled_at,
                department_id=department_id,
            )
            db.add(event)
            return event

        def ensure_task(
            title: str,
            description: str,
            status: models.TaskStatus,
            start_date: datetime,
            end_date: datetime,
            department_id: int,
            assigned_to_id: int,
            created_by_id: int,
            completed_at: datetime | None = None,
        ):
            existing = db.query(models.Task).filter(models.Task.title == title).first()
            if existing:
                return existing
            task = models.Task(
                title=title,
                description=description,
                status=status,
                start_date=start_date,
                end_date=end_date,
                department_id=department_id,
                assigned_to_id=assigned_to_id,
                created_by_id=created_by_id,
                completed_at=completed_at,
            )
            db.add(task)
            return task

        def ensure_request(
            req_type: str,
            payload: str,
            status: str,
            requester_id: int,
            department_id: int,
            resolved_at: datetime | None = None,
        ):
            existing = (
                db.query(models.RequestTicket)
                .filter(
                    models.RequestTicket.type == req_type,
                    models.RequestTicket.requester_id == requester_id,
                )
                .first()
            )
            if existing:
                return existing
            req = models.RequestTicket(
                requester_id=requester_id,
                department_id=department_id,
                type=req_type,
                payload=payload,
                status=status,
                resolved_at=resolved_at,
            )
            db.add(req)
            return req

        def ensure_message(
            subject: str,
            body: str,
            sender_id: int,
            recipient_id: int | None = None,
            department_id: int | None = None,
        ):
            existing = (
                db.query(models.Message)
                .filter(
                    models.Message.subject == subject,
                    models.Message.sender_id == sender_id,
                )
                .first()
            )
            if existing:
                return existing
            msg = models.Message(
                sender_id=sender_id,
                recipient_id=recipient_id,
                department_id=department_id,
                subject=subject,
                body=body,
            )
            db.add(msg)
            return msg

        def ensure_donor(name: str, email: str | None, phone: str | None, address: str | None):
            donor = db.query(models.Donor).filter(models.Donor.name == name).first()
            if donor:
                return donor
            donor = models.Donor(name=name, email=email, phone=phone, address=address)
            db.add(donor)
            db.flush()
            return donor

        def ensure_donation(donor_id: int, amount: int, currency: str, method: str, note: str):
            existing = (
                db.query(models.Donation)
                .filter(models.Donation.donor_id == donor_id, models.Donation.amount == amount)
                .first()
            )
            if existing:
                return existing
            donation = models.Donation(
                donor_id=donor_id,
                amount=amount,
                currency=currency,
                method=method,
                note=note,
            )
            db.add(donation)
            return donation

        def ensure_campaign(name: str, goal_amount: int, description: str, start_date: datetime, end_date: datetime):
            campaign = db.query(models.Campaign).filter(models.Campaign.name == name).first()
            if campaign:
                return campaign
            campaign = models.Campaign(
                name=name,
                goal_amount=goal_amount,
                description=description,
                start_date=start_date,
                end_date=end_date,
            )
            db.add(campaign)
            return campaign

        def ensure_project(name: str, description: str, budget: int, progress: str, start_date: datetime, end_date: datetime | None):
            project = db.query(models.Project).filter(models.Project.name == name).first()
            if project:
                return project
            project = models.Project(
                name=name,
                description=description,
                budget=budget,
                progress=progress,
                start_date=start_date,
                end_date=end_date,
            )
            db.add(project)
            db.flush()
            return project

        def ensure_beneficiary(name: str, project_id: int, notes: str):
            existing = (
                db.query(models.Beneficiary)
                .filter(models.Beneficiary.name == name, models.Beneficiary.project_id == project_id)
                .first()
            )
            if existing:
                return existing
            beneficiary = models.Beneficiary(name=name, notes=notes, project_id=project_id)
            db.add(beneficiary)
            return beneficiary

        def ensure_volunteer(name: str, email: str, phone: str, skills: str, hours: int):
            volunteer = db.query(models.Volunteer).filter(models.Volunteer.email == email).first()
            if volunteer:
                return volunteer
            volunteer = models.Volunteer(
                name=name,
                email=email,
                phone=phone,
                skills=skills,
                hours=hours,
                active=True,
            )
            db.add(volunteer)
            return volunteer

        def ensure_access_grant(
            user_id: int,
            resource_type: str,
            resource_id: str,
            permission: str,
            department_id: int | None,
        ):
            existing = (
                db.query(models.AccessGrant)
                .filter(
                    models.AccessGrant.user_id == user_id,
                    models.AccessGrant.resource_type == resource_type,
                    models.AccessGrant.resource_id == resource_id,
                    models.AccessGrant.permission == permission,
                )
                .first()
            )
            if existing:
                return existing
            grant = models.AccessGrant(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                permission=permission,
                department_id=department_id,
            )
            db.add(grant)
            return grant

        departments = {
            "Administration": "Leadership, governance, and compliance",
            "Programs": "Program delivery and field operations",
            "Monitoring & Evaluation": "Impact tracking and learning",
            "Finance & Grants": "Budgeting, accounting, and donor reporting",
            "Human Resources": "People operations and safeguarding",
            "Operations & Logistics": "Procurement, logistics, and facilities",
            "Partnerships & Fundraising": "Donor relations and fundraising",
            "Communications": "Media, brand, and outreach",
            "IT & Data": "Systems and data management",
            "Safeguarding & Compliance": "Policy, risk, and compliance",
        }
        dept_objs = {name: ensure_department(name, desc) for name, desc in departments.items()}

        users_spec = [
            ("Executive Director", "director@ngo.example", models.Role.manager, "Administration"),
            ("Grace Program Manager", "grace.programs@ngo.example", models.Role.manager, "Programs"),
            ("Peter Field Officer", "peter.field@ngo.example", models.Role.staff, "Programs"),
            ("Lilian M&E Lead", "lilian.me@ngo.example", models.Role.manager, "Monitoring & Evaluation"),
            ("Jacob Finance Manager", "jacob.finance@ngo.example", models.Role.manager, "Finance & Grants"),
            ("Sarah HR Manager", "sarah.hr@ngo.example", models.Role.manager, "Human Resources"),
            ("Michael Operations Manager", "michael.ops@ngo.example", models.Role.manager, "Operations & Logistics"),
            ("Rita Partnerships Lead", "rita.partnerships@ngo.example", models.Role.manager, "Partnerships & Fundraising"),
            ("David Comms Officer", "david.comms@ngo.example", models.Role.staff, "Communications"),
            ("Evelyn IT Officer", "evelyn.it@ngo.example", models.Role.staff, "IT & Data"),
            ("Nora Safeguarding Officer", "nora.safeguarding@ngo.example", models.Role.staff, "Safeguarding & Compliance"),
        ]
        users = {}
        for full_name, email, role, dept_name in users_spec:
            dept = dept_objs.get(dept_name)
            users[email] = ensure_user(full_name, email, role, dept.id if dept else None)

        admin_user = db.query(models.User).filter(models.User.email == settings.admin_email).first()
        exec_user = users.get("director@ngo.example") or admin_user

        now = datetime.utcnow()
        ensure_event(
            "All-staff meeting",
            "Monthly update and Q&A session",
            now + timedelta(days=7),
            None,
        )
        ensure_event(
            "Board meeting",
            "Quarterly governance review",
            now + timedelta(days=21),
            None,
        )
        ensure_event(
            "Programs weekly sync",
            "Weekly field operations sync",
            now + timedelta(days=3),
            dept_objs["Programs"].id,
        )
        ensure_event(
            "Finance close-out",
            "Month-end reconciliation and reporting",
            now + timedelta(days=2),
            dept_objs["Finance & Grants"].id,
        )
        ensure_event(
            "Safeguarding training",
            "Staff refresher on safeguarding policies",
            now + timedelta(days=14),
            dept_objs["Safeguarding & Compliance"].id,
        )

        task_specs = [
            {
                "title": "Field monitoring visit - North Zone",
                "description": "Collect beneficiary feedback and update indicators.",
                "status": models.TaskStatus.in_progress,
                "start_date": now - timedelta(days=1),
                "end_date": now + timedelta(days=3),
                "department": "Programs",
                "assignee": "peter.field@ngo.example",
                "creator": "grace.programs@ngo.example",
            },
            {
                "title": "Finalize Q1 donor report",
                "description": "Compile narrative and finance sections for donor reporting.",
                "status": models.TaskStatus.pending,
                "start_date": now - timedelta(days=2),
                "end_date": now + timedelta(days=6),
                "department": "Finance & Grants",
                "assignee": "jacob.finance@ngo.example",
                "creator": "director@ngo.example",
            },
            {
                "title": "Quarterly impact dashboard",
                "description": "Publish M&E dashboard and share insights.",
                "status": models.TaskStatus.done,
                "start_date": now - timedelta(days=12),
                "end_date": now - timedelta(days=5),
                "completed_at": now - timedelta(days=4),
                "department": "Monitoring & Evaluation",
                "assignee": "lilian.me@ngo.example",
                "creator": "director@ngo.example",
            },
            {
                "title": "Volunteer onboarding - January",
                "description": "Prepare orientation and assign mentors.",
                "status": models.TaskStatus.in_progress,
                "start_date": now,
                "end_date": now + timedelta(days=7),
                "department": "Human Resources",
                "assignee": "sarah.hr@ngo.example",
                "creator": "director@ngo.example",
            },
            {
                "title": "Procure hygiene kits",
                "description": "Source vendors and confirm delivery schedule.",
                "status": models.TaskStatus.pending,
                "start_date": now - timedelta(days=1),
                "end_date": now + timedelta(days=5),
                "department": "Operations & Logistics",
                "assignee": "michael.ops@ngo.example",
                "creator": "director@ngo.example",
            },
            {
                "title": "Grant pipeline review",
                "description": "Update partners and identify next grant opportunities.",
                "status": models.TaskStatus.pending,
                "start_date": now,
                "end_date": now + timedelta(days=10),
                "department": "Partnerships & Fundraising",
                "assignee": "rita.partnerships@ngo.example",
                "creator": "director@ngo.example",
            },
            {
                "title": "Draft community newsletter",
                "description": "Share program highlights and upcoming events.",
                "status": models.TaskStatus.in_progress,
                "start_date": now,
                "end_date": now + timedelta(days=4),
                "department": "Communications",
                "assignee": "david.comms@ngo.example",
                "creator": "rita.partnerships@ngo.example",
            },
            {
                "title": "Security patching and backups",
                "description": "Apply critical updates and verify backup integrity.",
                "status": models.TaskStatus.pending,
                "start_date": now,
                "end_date": now + timedelta(days=4),
                "department": "IT & Data",
                "assignee": "evelyn.it@ngo.example",
                "creator": "director@ngo.example",
            },
            {
                "title": "Safeguarding training rollout",
                "description": "Coordinate sessions across departments.",
                "status": models.TaskStatus.pending,
                "start_date": now + timedelta(days=1),
                "end_date": now + timedelta(days=12),
                "department": "Safeguarding & Compliance",
                "assignee": "nora.safeguarding@ngo.example",
                "creator": "sarah.hr@ngo.example",
            },
            {
                "title": "Finalize monthly payroll",
                "description": "Process payroll and archive approvals.",
                "status": models.TaskStatus.done,
                "start_date": now - timedelta(days=10),
                "end_date": now - timedelta(days=6),
                "completed_at": now - timedelta(days=5),
                "department": "Finance & Grants",
                "assignee": "jacob.finance@ngo.example",
                "creator": "director@ngo.example",
            },
        ]
        for spec in task_specs:
            dept = dept_objs.get(spec["department"])
            assignee = users.get(spec["assignee"])
            creator = users.get(spec["creator"]) or exec_user
            if not dept or not assignee or not creator:
                continue
            ensure_task(
                title=spec["title"],
                description=spec["description"],
                status=spec["status"],
                start_date=spec["start_date"],
                end_date=spec["end_date"],
                department_id=dept.id,
                assigned_to_id=assignee.id,
                created_by_id=creator.id,
                completed_at=spec.get("completed_at"),
            )

        request_specs = [
            {
                "type": "leave",
                "payload": "Annual leave request for 5 days in February.",
                "status": "pending",
                "department": "Programs",
                "requester": "peter.field@ngo.example",
            },
            {
                "type": "procurement",
                "payload": "Request for hygiene kits (USD 3,500) for outreach.",
                "status": "approved",
                "department": "Operations & Logistics",
                "requester": "michael.ops@ngo.example",
                "resolved_at": now - timedelta(days=1),
            },
            {
                "type": "travel",
                "payload": "Site visit to District B for M&E data collection.",
                "status": "rejected",
                "department": "Monitoring & Evaluation",
                "requester": "lilian.me@ngo.example",
                "resolved_at": now - timedelta(days=2),
            },
            {
                "type": "expense",
                "payload": "Reimbursement for outreach materials (USD 120).",
                "status": "pending",
                "department": "Communications",
                "requester": "david.comms@ngo.example",
            },
        ]
        for spec in request_specs:
            dept = dept_objs.get(spec["department"])
            requester = users.get(spec["requester"])
            if not dept or not requester:
                continue
            ensure_request(
                req_type=spec["type"],
                payload=spec["payload"],
                status=spec["status"],
                requester_id=requester.id,
                department_id=dept.id,
                resolved_at=spec.get("resolved_at"),
            )

        if exec_user:
            ensure_message(
                subject="Welcome to the NGO ERP",
                body="Please review your tasks, submit requests, and keep updates current.",
                sender_id=exec_user.id,
            )
            ensure_message(
                subject="Monthly reporting deadlines",
                body="Programs and M&E: submit activity reports by the 25th.",
                sender_id=exec_user.id,
                department_id=dept_objs["Programs"].id,
            )

        donors = [
            ("Global Aid Foundation", "contact@globalaid.org", "+1-555-100-200", "New York, USA"),
            ("Hope Trust", "grants@hopetrust.org", "+44-20-555-1000", "London, UK"),
            ("Community Partners Fund", "info@cpf.org", "+254-700-555-010", "Nairobi, KE"),
        ]
        for name, email, phone, address in donors:
            donor = ensure_donor(name, email, phone, address)
            ensure_donation(
                donor_id=donor.id,
                amount=50000 if name == "Global Aid Foundation" else 25000 if name == "Hope Trust" else 10000,
                currency="USD",
                method="bank_transfer",
                note="Seeded donation",
            )

        ensure_campaign(
            "Clean Water Initiative",
            150000,
            "Borehole rehabilitation and safe water access.",
            now - timedelta(days=20),
            now + timedelta(days=120),
        )
        ensure_campaign(
            "Girls Education Fund",
            50000,
            "Scholarships and school supplies for girls.",
            now - timedelta(days=10),
            now + timedelta(days=90),
        )

        water_project = ensure_project(
            "Rural Water Access",
            "Improve safe water access in rural communities.",
            80000,
            "in_progress",
            now - timedelta(days=30),
            None,
        )
        ensure_beneficiary("Village A", water_project.id, "Primary water point rehab")
        ensure_beneficiary("Village B", water_project.id, "Community well drilling")

        health_project = ensure_project(
            "Maternal Health Outreach",
            "Expand maternal health services and referrals.",
            60000,
            "planning",
            now - timedelta(days=5),
            now + timedelta(days=180),
        )
        ensure_beneficiary("Clinic Alpha", health_project.id, "Training midwives and staff")
        ensure_beneficiary("Clinic Beta", health_project.id, "Supply essential equipment")

        ensure_volunteer(
            "Amina Volunteer",
            "amina.volunteer@ngo.example",
            "+254-701-555-010",
            "Community mobilization, WASH training",
            24,
        )
        ensure_volunteer(
            "John Volunteer",
            "john.volunteer@ngo.example",
            "+254-701-555-011",
            "Data collection, translation",
            16,
        )

        partnerships_lead = users.get("rita.partnerships@ngo.example")
        finance_manager = users.get("jacob.finance@ngo.example")
        if partnerships_lead:
            ensure_access_grant(
                user_id=partnerships_lead.id,
                resource_type="donors",
                resource_id="all",
                permission="view",
                department_id=dept_objs["Partnerships & Fundraising"].id,
            )
        if finance_manager:
            ensure_access_grant(
                user_id=finance_manager.id,
                resource_type="donations",
                resource_id="all",
                permission="edit",
                department_id=dept_objs["Finance & Grants"].id,
            )

        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.upload_dir, "requests").mkdir(parents=True, exist_ok=True)
    if settings.secret_key == "change-me" and settings.environment.lower() == "prod":
        raise RuntimeError("Set SECRET_KEY in production")
    if settings.smtp_host:
        t = threading.Thread(target=_email_worker, daemon=True)
        t.start()
    seed_admin()
    seed_ngo_data()


def log_activity(db: Session, actor_id: Optional[int], action: str, detail: Optional[str] = None):
    entry = models.ActivityLog(actor_id=actor_id, action=action, detail=detail)
    db.add(entry)
    db.commit()


def log_request_audit(
    db: Session,
    request_id: int,
    actor_id: Optional[int],
    action: str,
    from_status: Optional[str] = None,
    to_status: Optional[str] = None,
    note: Optional[str] = None,
):
    entry = models.RequestAudit(
        request_id=request_id,
        actor_id=actor_id,
        action=action,
        from_status=from_status,
        to_status=to_status,
        note=note,
    )
    db.add(entry)
    db.commit()


def serialize_payload(payload: dict) -> str:
    return json.dumps(payload, default=str, ensure_ascii=True)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/token", response_model=schemas.Token)
def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    access_token = auth.create_access_token(data={"sub": str(user.id)})
    refresh_token = _issue_refresh_token(db, user.id)
    return {"access_token": access_token, "token_type": "bearer", "refresh_token": refresh_token}


@app.post("/auth/refresh", response_model=schemas.Token)
def refresh_token(payload: schemas.RefreshRequest, db: Session = Depends(get_db)):
    token_hash = _hash_refresh_token(payload.refresh_token)
    record = (
        db.query(models.RefreshToken)
        .filter(
            models.RefreshToken.token_hash == token_hash,
            models.RefreshToken.revoked.is_(False),
            models.RefreshToken.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = db.get(models.User, record.user_id)
    if not user or not user.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    # rotate
    record.revoked = True
    db.commit()
    new_refresh = _issue_refresh_token(db, user.id)
    access_token = auth.create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer", "refresh_token": new_refresh}


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: schemas.RefreshRequest, db: Session = Depends(get_db)):
    token_hash = _hash_refresh_token(payload.refresh_token)
    _revoke_refresh_token(db, token_hash)


@app.get("/auth/me", response_model=schemas.UserRead)
def read_users_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@app.post("/departments", response_model=schemas.DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(
    dept: schemas.DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin)),
):
    existing = db.query(models.Department).filter(models.Department.name == dept.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department already exists")
    db_dept = models.Department(**dept.model_dump())
    db.add(db_dept)
    db.commit()
    db.refresh(db_dept)
    log_activity(db, current_user.id, "department_create", f"Department {db_dept.id}")
    return db_dept


@app.patch("/departments/{department_id}", response_model=schemas.DepartmentRead)
def update_department(
    department_id: int,
    dept_update: schemas.DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin)),
):
    dept = db.get(models.Department, department_id)
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    data = dept_update.model_dump(exclude_none=True)
    if "name" in data:
        existing = (
            db.query(models.Department)
            .filter(models.Department.name == data["name"], models.Department.id != department_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department already exists")
    for field, value in data.items():
        setattr(dept, field, value)
    db.commit()
    db.refresh(dept)
    log_activity(db, current_user.id, "department_update", f"Department {dept.id}")
    return dept


@app.get("/departments", response_model=List[schemas.DepartmentRead])
def list_departments(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    return db.query(models.Department).all()


@app.post("/users", response_model=schemas.UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    # managers can only create within their department and cannot create admins
    if current_user.role == models.Role.manager:
        if user_in.role == models.Role.admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers cannot create admins")
        if user_in.department_id not in (None, current_user.department_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only create users in their department")
        user_department_id = current_user.department_id
    else:
        user_department_id = user_in.department_id
    if len(user_in.password) < settings.password_min_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {settings.password_min_length} characters",
        )
    if db.query(models.User).filter(models.User.email == user_in.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    hashed_password = auth.get_password_hash(user_in.password)
    user_data = user_in.model_dump(exclude={"password"})
    user_data["department_id"] = user_department_id
    db_user = models.User(**user_data, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    log_activity(db, current_user.id, "user_create", f"User {db_user.id}")
    return db_user


@app.get("/users", response_model=List[schemas.UserRead])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.User)
    if current_user.role == models.Role.manager:
        query = query.filter(models.User.department_id == current_user.department_id)
    elif current_user.role not in [models.Role.admin]:
        query = query.filter(models.User.department_id == current_user.department_id)
    return query.all()


@app.patch("/users/{user_id}", response_model=schemas.UserRead)
def update_user(
    user_id: int,
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_user = db.get(models.User, user_id)
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_user.role == models.Role.manager:
        if db_user.department_id != current_user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only update their department")
        if user_update.role == models.Role.admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers cannot promote to admin")
        if user_update.department_id not in (None, current_user.department_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only move users inside their department")
    for field, value in user_update.model_dump(exclude_none=True).items():
        if field == "password":
            if len(value) < settings.password_min_length:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Password must be at least {settings.password_min_length} characters",
                )
            setattr(db_user, "hashed_password", auth.get_password_hash(value))
        else:
            setattr(db_user, field, value)
    db.commit()
    db.refresh(db_user)
    log_activity(db, current_user.id, "user_update", f"User {db_user.id}")
    return db_user


@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_user = db.get(models.User, user_id)
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_user.role == models.Role.manager and db_user.department_id != current_user.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only remove their department users")
    if current_user.role == models.Role.manager and db_user.role == models.Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers cannot delete admins")
    active_tasks = db.query(models.Task).filter(models.Task.assigned_to_id == user_id, models.Task.status != models.TaskStatus.done).count()
    if active_tasks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User has active tasks; reassign before delete")
    db.delete(db_user)
    db.commit()
    log_activity(db, current_user.id, "user_delete", f"User {user_id}")


@app.post("/tasks", response_model=schemas.TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(
    task_in: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dept = db.get(models.Department, task_in.department_id)
    if not dept:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department not found")
    assignee = db.get(models.User, task_in.assigned_to_id)
    if not assignee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignee not found")
    if current_user.role == models.Role.manager and current_user.department_id != task_in.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only create tasks in their department")
    if current_user.role == models.Role.staff:
        if current_user.department_id != task_in.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff can only create tasks in their department")
        if current_user.id != task_in.assigned_to_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff can only assign tasks to themselves")
    if task_in.end_date < task_in.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be after start date")
    payload = task_in.model_dump()
    db_task = models.Task(**payload, created_by_id=current_user.id)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    log_activity(db, current_user.id, "task_create", f"Task {db_task.id}")
    return db_task


def _task_guard(task: models.Task, user: models.User):
    if user.role == models.Role.admin:
        return
    if user.role == models.Role.manager and user.department_id != task.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed outside department")
    if user.role == models.Role.staff and user.id not in [task.assigned_to_id]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Task not assigned to you")


@app.get("/tasks/my", response_model=List[schemas.TaskRead])
def list_my_tasks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    tasks = (
        db.query(models.Task)
        .filter(models.Task.assigned_to_id == current_user.id)
        .order_by(models.Task.end_date.asc())
        .all()
    )
    return tasks


@app.get("/tasks/department", response_model=List[schemas.TaskRead])
def list_department_tasks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dept_id = current_user.department_id
    if dept_id is None:
        return []
    query = (
        db.query(models.Task)
        .filter(models.Task.department_id == dept_id)
        .order_by(models.Task.end_date.asc())
    )
    return query.all()


@app.get("/tasks/all", response_model=List[schemas.TaskRead])
def list_all_tasks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.Task).order_by(models.Task.end_date.asc())
    if current_user.role == models.Role.manager:
        query = query.filter(models.Task.department_id == current_user.department_id)
    elif current_user.role == models.Role.staff:
        query = query.filter(models.Task.assigned_to_id == current_user.id)
    return query.all()


@app.get("/tasks/completed", response_model=List[schemas.TaskRead])
def list_completed_tasks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.Task).filter(models.Task.status == models.TaskStatus.done)
    if current_user.role == models.Role.staff:
        query = query.filter(models.Task.assigned_to_id == current_user.id)
    elif current_user.role == models.Role.manager:
        query = query.filter(models.Task.department_id == current_user.department_id)
    return query.order_by(models.Task.completed_at.desc().nulls_last()).all()


@app.get("/tasks/{task_id}", response_model=schemas.TaskRead)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    return db_task


@app.patch("/tasks/{task_id}", response_model=schemas.TaskRead)
def update_task(
    task_id: int,
    task_update: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    if current_user.role == models.Role.staff:
        allowed_fields = {"status", "description", "due_date", "start_date", "end_date"}
    elif current_user.role == models.Role.manager:
        allowed_fields = {"status", "description", "due_date", "start_date", "end_date"}
    else:
        allowed_fields = set(task_update.model_fields.keys())
    for field, value in task_update.model_dump(exclude_none=True).items():
        if field not in allowed_fields:
            continue
        setattr(db_task, field, value)
    if db_task.end_date < db_task.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be after start date")
    if db_task.status == models.TaskStatus.done and db_task.completed_at is None:
        db_task.completed_at = datetime.utcnow()
    elif db_task.status != models.TaskStatus.done:
        db_task.completed_at = None
    db.commit()
    db.refresh(db_task)
    log_activity(db, current_user.id, "task_update", f"Task {db_task.id}")
    return db_task


@app.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        if current_user.department_id != db_task.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only delete tasks in their department")
    elif current_user.role == models.Role.staff:
        if db_task.assigned_to_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff can only delete their own tasks")
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete tasks")
    db.delete(db_task)
    db.commit()
    log_activity(db, current_user.id, "task_delete", f"Task {task_id}")


@app.post("/tasks/{task_id}/send-to-admin", response_model=schemas.TaskRead)
def send_task_to_admin(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    admin_user = (
        db.query(models.User)
        .filter(models.User.role == models.Role.admin, models.User.active.is_(True))
        .order_by(models.User.id.asc())
        .first()
    )
    if not admin_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No admin available to review")
    db_task.assigned_to_id = admin_user.id
    db.commit()
    db.refresh(db_task)
    log_activity(db, current_user.id, "task_escalate_admin", f"Task {task_id} -> admin {admin_user.id}")
    return db_task


@app.post("/events", response_model=schemas.EventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    event_in: schemas.EventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    if current_user.role == models.Role.manager and event_in.department_id not in (
        current_user.department_id,
        None,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only post to their department or shared")
    if event_in.department_id is not None and not db.get(models.Department, event_in.department_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department not found")
    db_event = models.Event(**event_in.model_dump())
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event


@app.get("/events/shared", response_model=List[schemas.EventRead])
def shared_events(db: Session = Depends(get_db), _: models.User = Depends(auth.get_current_user)):
    events = (
        db.query(models.Event)
        .filter(models.Event.department_id.is_(None))
        .order_by(models.Event.scheduled_at.asc())
        .all()
    )
    return events


@app.get("/events/department", response_model=List[schemas.EventRead])
def department_events(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    if current_user.department_id is None:
        return []
    events = (
        db.query(models.Event)
        .filter(models.Event.department_id == current_user.department_id)
        .order_by(models.Event.scheduled_at.asc())
        .all()
    )
    return events


@app.patch("/events/{event_id}", response_model=schemas.EventRead)
def update_event(
    event_id: int,
    event_update: schemas.EventUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_event = db.get(models.Event, event_id)
    if not db_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if current_user.role == models.Role.manager:
        if db_event.department_id != current_user.department_id or db_event.department_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers cannot modify shared or other department events")
    elif current_user.role != models.Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to update events")
    for field, value in event_update.model_dump(exclude_none=True).items():
        if field == "department_id" and current_user.role == models.Role.manager and value != current_user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot move events outside your department")
        setattr(db_event, field, value)
    db.commit()
    db.refresh(db_event)
    log_activity(db, current_user.id, "event_update", f"Event {db_event.id}")
    return db_event


@app.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_event = db.get(models.Event, event_id)
    if not db_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if current_user.role == models.Role.manager:
        if db_event.department_id != current_user.department_id or db_event.department_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers cannot delete shared or other department events")
    elif current_user.role != models.Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete events")
    db.delete(db_event)
    db.commit()
    log_activity(db, current_user.id, "event_delete", f"Event {event_id}")


@app.post("/meetings", response_model=schemas.EventRead, status_code=status.HTTP_201_CREATED)
def schedule_meeting(
    meeting: schemas.EventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.role == models.Role.manager and meeting.department_id not in (current_user.department_id, None):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only schedule meetings for their department or shared")
    if current_user.role == models.Role.staff and meeting.department_id not in (current_user.department_id, None):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff can only schedule meetings for their department or shared")
    if meeting.department_id is not None and not db.get(models.Department, meeting.department_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department not found")
    payload = meeting.model_dump()
    if not payload.get("description"):
        payload["description"] = "Scheduled meeting"
    db_event = models.Event(**payload)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    log_activity(db, current_user.id, "meeting_schedule", f"Meeting {db_event.id}")
    return db_event


@app.post("/tasks/{task_id}/comments", response_model=schemas.CommentRead, status_code=status.HTTP_201_CREATED)
def add_comment(
    task_id: int,
    body: str = Form(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    comment = models.Comment(body=body, task_id=task_id, user_id=current_user.id)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@app.get("/tasks/{task_id}/comments", response_model=List[schemas.CommentRead])
def list_comments(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    return db.query(models.Comment).filter(models.Comment.task_id == task_id).order_by(models.Comment.created_at.asc()).all()


@app.post("/tasks/{task_id}/upload", response_model=schemas.ResourceRead, status_code=status.HTTP_201_CREATED)
async def upload_resource(
    task_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    ext = Path(file.filename).suffix.lower()
    if ext not in settings.allowed_upload_extensions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File type not allowed")
    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
    safe_name = f"{task_id}_{int(datetime.utcnow().timestamp())}_{secrets.token_hex(4)}{ext}"
    save_path = os.path.join(settings.upload_dir, safe_name)
    with open(save_path, "wb") as buffer:
        buffer.write(data)
    resource = models.Resource(
        filename=file.filename,
        file_path=save_path,
        owner_id=current_user.id,
        task_id=task_id,
        department_id=db_task.department_id,
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


@app.get("/tasks/{task_id}/resources", response_model=List[schemas.ResourceRead])
def list_task_resources(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_task = db.get(models.Task, task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _task_guard(db_task, current_user)
    return (
        db.query(models.Resource)
        .filter(models.Resource.task_id == task_id)
        .order_by(models.Resource.uploaded_at.desc())
        .all()
    )


@app.get("/resources/department/{department_id}", response_model=List[schemas.ResourceRead])
def list_department_resources(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        if current_user.department_id != department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only view their department resources")
    else:
        if current_user.department_id != department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this department resources")
    return (
        db.query(models.Resource)
        .filter(models.Resource.department_id == department_id)
        .order_by(models.Resource.uploaded_at.desc())
        .all()
    )


@app.post("/performance", response_model=schemas.PerformanceLogRead, status_code=status.HTTP_201_CREATED)
def log_performance(
    entry: schemas.PerformanceLogCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    if current_user.role == models.Role.manager:
        target_user = db.get(models.User, entry.user_id)
        if not target_user or target_user.department_id != current_user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only log within their department")
    perf = models.PerformanceLog(
        user_id=entry.user_id,
        task_id=entry.task_id,
        score=entry.score,
        note=entry.note,
        created_by_id=current_user.id,
    )
    db.add(perf)
    db.commit()
    db.refresh(perf)
    log_activity(db, current_user.id, "performance_log", f"User {entry.user_id}, score {entry.score}")
    return perf


@app.get("/performance/user/{user_id}", response_model=List[schemas.PerformanceLogRead])
def get_user_performance(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.role == models.Role.manager:
        target = db.get(models.User, user_id)
        if not target or target.department_id != current_user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    elif current_user.role == models.Role.staff and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return (
        db.query(models.PerformanceLog)
        .filter(models.PerformanceLog.user_id == user_id)
        .order_by(models.PerformanceLog.created_at.desc())
        .all()
    )


@app.post("/messages", response_model=schemas.MessageRead, status_code=status.HTTP_201_CREATED)
def send_message(
    message: schemas.MessageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_msg = models.Message(
        sender_id=current_user.id,
        recipient_id=message.recipient_id,
        department_id=message.department_id,
        subject=message.subject,
        body=message.body,
    )
    db.add(db_msg)
    # stub: queue email if direct recipient
    if message.recipient_id:
        recipient = db.get(models.User, message.recipient_id)
        if recipient:
            eq = models.EmailQueue(to_email=recipient.email, subject=message.subject, body=message.body)
            db.add(eq)
    db.commit()
    db.refresh(db_msg)
    log_activity(db, current_user.id, "message_send", f"Message {db_msg.id}")
    return db_msg


@app.post("/messages/email", status_code=status.HTTP_202_ACCEPTED)
def queue_external_email(
    email: schemas.OutboundEmail,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    queue_entry = models.EmailQueue(to_email=email.to_email, subject=email.subject, body=email.body, status="queued")
    db.add(queue_entry)
    db.commit()
    log_activity(db, current_user.id, "email_queue", f"Email to {email.to_email}")
    return {"status": "queued"}


@app.get("/messages/inbox", response_model=List[schemas.MessageRead])
def inbox(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    msgs = (
        db.query(models.Message)
        .filter(
            (models.Message.recipient_id == current_user.id)
            | (models.Message.recipient_id.is_(None))
            | (models.Message.department_id == current_user.department_id)
        )
        .order_by(models.Message.created_at.desc())
        .all()
    )
    return msgs


@app.get("/messages/sent", response_model=List[schemas.MessageRead])
def sent(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Message)
        .filter(models.Message.sender_id == current_user.id)
        .order_by(models.Message.created_at.desc())
        .all()
    )


@app.get("/dashboards/shared")
def shared_dashboard(
    db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)
):
    notices = (
        db.query(models.Event)
        .filter(models.Event.department_id.is_(None))
        .order_by(models.Event.scheduled_at.asc())
        .all()
    )
    return {"user": current_user.full_name, "events": notices}


@app.get("/dashboards/department")
def department_dashboard(
    db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)
):
    dept_id = current_user.department_id
    if dept_id is None:
        return {"message": "User has no department", "tasks": [], "events": []}
    tasks = (
        db.query(models.Task)
        .filter(models.Task.department_id == dept_id)
        .order_by(models.Task.end_date.asc())
        .all()
    )
    events = (
        db.query(models.Event)
        .filter(models.Event.department_id == dept_id)
        .order_by(models.Event.scheduled_at.asc())
        .all()
    )
    return {"department_id": dept_id, "tasks": tasks, "events": events}


@app.get("/dashboards/my")
def my_dashboard(
    db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)
):
    tasks = (
        db.query(models.Task)
        .filter(models.Task.assigned_to_id == current_user.id)
        .order_by(models.Task.end_date.asc())
        .all()
    )
    events = (
        db.query(models.Event)
        .filter(
            (models.Event.department_id == current_user.department_id)
            | (models.Event.department_id.is_(None))
        )
        .order_by(models.Event.scheduled_at.asc())
        .all()
    )
    return {"user": current_user.full_name, "tasks": tasks, "events": events}


# Reports and exports


def csv_response(filename: str, headers: list[str], rows: list[list[object]]) -> Response:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/reports/overview", response_model=schemas.ReportOverview)
def report_overview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    now = datetime.utcnow()
    def dept_name_for(dept_id: Optional[int]) -> Optional[str]:
        if not dept_id:
            return None
        dept = db.get(models.Department, dept_id)
        return dept.name if dept else None

    def is_programs_scope(name: Optional[str]) -> bool:
        return name in ["Programs", "Monitoring & Evaluation"]

    def is_fundraising_scope(name: Optional[str]) -> bool:
        return name in ["Partnerships & Fundraising", "Finance & Grants"]

    def is_hr_scope(name: Optional[str]) -> bool:
        return name in ["Human Resources"]

    if current_user.role == models.Role.manager:
        dept_id = current_user.department_id
        if not dept_id:
            return {
                "departments": 0,
                "users_total": 0,
                "users_active": 0,
                "tasks_total": 0,
                "tasks_completed": 0,
                "tasks_overdue": 0,
                "requests_pending": 0,
                "events_upcoming": 0,
                "donors_total": 0,
                "donations_total": 0,
                "donations_amount": 0,
                "volunteers_total": 0,
                "projects_total": 0,
                "beneficiaries_total": 0,
            }
        dept_name = dept_name_for(dept_id)
        users = db.query(models.User).filter(models.User.department_id == dept_id).all()
        tasks = db.query(models.Task).filter(models.Task.department_id == dept_id).all()
        requests = db.query(models.RequestTicket).filter(models.RequestTicket.department_id == dept_id).all()
        events = db.query(models.Event).filter(models.Event.department_id == dept_id).all()
        donors = db.query(models.Donor).all() if is_fundraising_scope(dept_name) else []
        donations = db.query(models.Donation).all() if is_fundraising_scope(dept_name) else []
        volunteers = db.query(models.Volunteer).all() if is_hr_scope(dept_name) else []
        projects = db.query(models.Project).all() if is_programs_scope(dept_name) else []
        beneficiaries = db.query(models.Beneficiary).all() if is_programs_scope(dept_name) else []
        departments_count = 1
    else:
        users = db.query(models.User).all()
        tasks = db.query(models.Task).all()
        requests = db.query(models.RequestTicket).all()
        events = db.query(models.Event).all()
        donors = db.query(models.Donor).all()
        donations = db.query(models.Donation).all()
        volunteers = db.query(models.Volunteer).all()
        projects = db.query(models.Project).all()
        beneficiaries = db.query(models.Beneficiary).all()
        departments_count = db.query(models.Department).count()
    tasks_completed = sum(1 for t in tasks if t.status == models.TaskStatus.done)
    tasks_overdue = sum(1 for t in tasks if t.status != models.TaskStatus.done and t.end_date < now)
    requests_pending = sum(1 for r in requests if r.status == "pending")
    events_upcoming = sum(1 for e in events if e.scheduled_at >= now)
    donations_amount = sum(d.amount for d in donations)
    return {
        "departments": departments_count,
        "users_total": len(users),
        "users_active": sum(1 for u in users if u.active),
        "tasks_total": len(tasks),
        "tasks_completed": tasks_completed,
        "tasks_overdue": tasks_overdue,
        "requests_pending": requests_pending,
        "events_upcoming": events_upcoming,
        "donors_total": len(donors),
        "donations_total": len(donations),
        "donations_amount": donations_amount,
        "volunteers_total": len(volunteers),
        "projects_total": len(projects),
        "beneficiaries_total": len(beneficiaries),
    }


@app.get("/reports/programs", response_model=schemas.ReportPrograms)
def report_programs(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    now = datetime.utcnow()
    if current_user.role == models.Role.manager:
        if not current_user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department required")
        dept = db.get(models.Department, current_user.department_id) if current_user.department_id else None
        dept_name = dept.name if dept else None
        if dept_name not in ["Programs", "Monitoring & Evaluation"]:
            return {
                "projects_total": 0,
                "beneficiaries_total": 0,
                "beneficiaries_by_project": [],
                "programs_tasks_done": 0,
                "programs_tasks_pending": 0,
                "upcoming_program_events": 0,
            }
    projects_query = db.query(models.Project)
    if start_date:
        projects_query = projects_query.filter(models.Project.start_date >= start_date)
    if end_date:
        projects_query = projects_query.filter(models.Project.start_date <= end_date)
    projects = projects_query.all()
    beneficiaries = db.query(models.Beneficiary).all()
    tasks = db.query(models.Task).all()
    events = db.query(models.Event).all()
    programs_dept = db.query(models.Department).filter(models.Department.name == "Programs").first()
    program_tasks = [t for t in tasks if programs_dept and t.department_id == programs_dept.id]
    program_events = [e for e in events if programs_dept and e.department_id == programs_dept.id]
    beneficiaries_by_project = []
    for project in projects:
        count = sum(1 for b in beneficiaries if b.project_id == project.id)
        beneficiaries_by_project.append({"project_id": project.id, "project_name": project.name, "beneficiaries": count})
    if start_date or end_date:
        project_ids = {p.id for p in projects}
        beneficiaries_total = sum(1 for b in beneficiaries if b.project_id in project_ids)
    else:
        beneficiaries_total = len(beneficiaries)
    return {
        "projects_total": len(projects),
        "beneficiaries_total": beneficiaries_total,
        "beneficiaries_by_project": beneficiaries_by_project,
        "programs_tasks_done": sum(1 for t in program_tasks if t.status == models.TaskStatus.done),
        "programs_tasks_pending": sum(1 for t in program_tasks if t.status != models.TaskStatus.done),
        "upcoming_program_events": sum(1 for e in program_events if e.scheduled_at >= now),
    }


@app.get("/reports/fundraising", response_model=schemas.ReportFundraising)
def report_fundraising(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    if current_user.role == models.Role.manager:
        dept = db.get(models.Department, current_user.department_id) if current_user.department_id else None
        dept_name = dept.name if dept else None
        if dept_name not in ["Partnerships & Fundraising", "Finance & Grants"]:
            return {
                "donors_total": 0,
                "donations_total": 0,
                "donations_amount": 0,
                "recurring_donations": 0,
                "donations_by_donor": [],
                "donations_by_month": [],
            }
    donors = db.query(models.Donor).all()
    donations_query = db.query(models.Donation)
    if start_date:
        donations_query = donations_query.filter(models.Donation.date >= start_date)
    if end_date:
        donations_query = donations_query.filter(models.Donation.date <= end_date)
    donations = donations_query.all()
    donor_lookup = {d.id: d.name for d in donors}
    totals_by_donor: dict[int, int] = {}
    totals_by_month: dict[str, int] = {}
    for donation in donations:
        totals_by_donor[donation.donor_id] = totals_by_donor.get(donation.donor_id, 0) + donation.amount
        if donation.date:
            month = donation.date.strftime("%Y-%m")
            totals_by_month[month] = totals_by_month.get(month, 0) + donation.amount
    donations_by_donor = [
        {"donor_id": donor_id, "donor_name": donor_lookup.get(donor_id, f"Donor {donor_id}"), "total_amount": amount}
        for donor_id, amount in totals_by_donor.items()
    ]
    donations_by_donor.sort(key=lambda row: row["total_amount"], reverse=True)
    donations_by_month = [{"month": month, "amount": amount} for month, amount in totals_by_month.items()]
    donations_by_month.sort(key=lambda row: row["month"])
    donors_in_range = {donation.donor_id for donation in donations}
    return {
        "donors_total": len(donors_in_range) if start_date or end_date else len(donors),
        "donations_total": len(donations),
        "donations_amount": sum(d.amount for d in donations),
        "recurring_donations": sum(1 for d in donations if d.recurring),
        "donations_by_donor": donations_by_donor,
        "donations_by_month": donations_by_month,
    }


@app.get("/reports/performance", response_model=List[schemas.PerformanceSummary])
def report_performance(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    users_query = db.query(models.User)
    if current_user.role == models.Role.manager:
        if not current_user.department_id:
            return []
        users_query = users_query.filter(models.User.department_id == current_user.department_id)
    users = users_query.all()
    if not users:
        return []
    user_ids = [u.id for u in users]
    logs = (
        db.query(models.PerformanceLog)
        .filter(models.PerformanceLog.user_id.in_(user_ids))
        .order_by(models.PerformanceLog.created_at.desc())
        .all()
    )
    logs_by_user: dict[int, list[models.PerformanceLog]] = {}
    for log in logs:
        logs_by_user.setdefault(log.user_id, []).append(log)
    summaries = []
    for user in users:
        user_logs = logs_by_user.get(user.id, [])
        total_logs = len(user_logs)
        avg_score = sum(l.score for l in user_logs) / total_logs if total_logs else 0.0
        last_log = user_logs[0] if user_logs else None
        recent_scores = [{"score": l.score, "created_at": l.created_at} for l in user_logs[:5]]
        summaries.append(
            {
                "user_id": user.id,
                "user_name": user.full_name,
                "role": user.role,
                "department_id": user.department_id,
                "avg_score": avg_score,
                "total_logs": total_logs,
                "last_score": last_log.score if last_log else None,
                "last_logged_at": last_log.created_at if last_log else None,
                "recent_scores": recent_scores,
            }
        )
    summaries.sort(key=lambda row: (row["avg_score"], row["total_logs"]), reverse=True)
    return summaries


@app.get("/reports/exports/{dataset}")
def export_report_dataset(
    dataset: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    dataset = dataset.lower()
    dept_name = None
    if current_user.role == models.Role.manager:
        dept = db.get(models.Department, current_user.department_id) if current_user.department_id else None
        dept_name = dept.name if dept else None
        if dataset in ["donors", "donations", "donor-report"] and dept_name not in ["Partnerships & Fundraising", "Finance & Grants"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed for this department")
        if dataset in ["projects", "beneficiaries", "project-outcomes"] and dept_name not in ["Programs", "Monitoring & Evaluation"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed for this department")
        if dataset in ["volunteers"] and dept_name not in ["Human Resources"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed for this department")
    if dataset == "donors":
        donors = db.query(models.Donor).order_by(models.Donor.created_at.asc()).all()
        rows = [[d.id, d.name, d.email or "", d.phone or "", d.address or "", d.created_at.isoformat()] for d in donors]
        return csv_response("donors.csv", ["id", "name", "email", "phone", "address", "created_at"], rows)
    if dataset == "donations":
        donors = {d.id: d.name for d in db.query(models.Donor).all()}
        donations_query = db.query(models.Donation)
        if start_date:
            donations_query = donations_query.filter(models.Donation.date >= start_date)
        if end_date:
            donations_query = donations_query.filter(models.Donation.date <= end_date)
        donations = donations_query.order_by(models.Donation.date.asc()).all()
        rows = [
            [
                d.id,
                d.donor_id,
                donors.get(d.donor_id, ""),
                d.amount,
                d.currency,
                d.date.isoformat() if d.date else "",
                d.method or "",
                "yes" if d.recurring else "no",
                d.note or "",
            ]
            for d in donations
        ]
        return csv_response("donations.csv", ["id", "donor_id", "donor_name", "amount", "currency", "date", "method", "recurring", "note"], rows)
    if dataset == "projects":
        projects = db.query(models.Project).order_by(models.Project.start_date.asc().nulls_last()).all()
        rows = [
            [
                p.id,
                p.name,
                p.description or "",
                p.budget or "",
                p.progress or "",
                p.start_date.isoformat() if p.start_date else "",
                p.end_date.isoformat() if p.end_date else "",
            ]
            for p in projects
        ]
        return csv_response("projects.csv", ["id", "name", "description", "budget", "progress", "start_date", "end_date"], rows)
    if dataset == "beneficiaries":
        projects = {p.id: p.name for p in db.query(models.Project).all()}
        beneficiaries = db.query(models.Beneficiary).order_by(models.Beneficiary.id.asc()).all()
        rows = [
            [
                b.id,
                b.name,
                b.contact or "",
                b.notes or "",
                b.project_id or "",
                projects.get(b.project_id, ""),
            ]
            for b in beneficiaries
        ]
        return csv_response("beneficiaries.csv", ["id", "name", "contact", "notes", "project_id", "project_name"], rows)
    if dataset == "volunteers":
        volunteers = db.query(models.Volunteer).order_by(models.Volunteer.created_at.asc()).all()
        rows = [
            [
                v.id,
                v.name,
                v.email or "",
                v.phone or "",
                v.skills or "",
                v.hours,
                "active" if v.active else "inactive",
                v.created_at.isoformat(),
            ]
            for v in volunteers
        ]
        return csv_response("volunteers.csv", ["id", "name", "email", "phone", "skills", "hours", "status", "created_at"], rows)
    if dataset == "requests":
        requests_query = db.query(models.RequestTicket)
        if current_user.role == models.Role.manager and current_user.department_id:
            requests_query = requests_query.filter(models.RequestTicket.department_id == current_user.department_id)
        requests = requests_query.order_by(models.RequestTicket.created_at.desc()).all()
        rows = [
            [
                r.id,
                r.type,
                r.status,
                r.requester_id,
                r.department_id,
                r.created_at.isoformat(),
                r.resolved_at.isoformat() if r.resolved_at else "",
                r.payload or "",
            ]
            for r in requests
        ]
        return csv_response("requests.csv", ["id", "type", "status", "requester_id", "department_id", "created_at", "resolved_at", "payload"], rows)
    if dataset == "project-outcomes":
        projects_query = db.query(models.Project)
        if start_date:
            projects_query = projects_query.filter(models.Project.start_date >= start_date)
        if end_date:
            projects_query = projects_query.filter(models.Project.start_date <= end_date)
        projects = projects_query.order_by(models.Project.start_date.asc().nulls_last()).all()
        beneficiaries = db.query(models.Beneficiary).all()
        rows = []
        for project in projects:
            count = sum(1 for b in beneficiaries if b.project_id == project.id)
            rows.append(
                [
                    project.id,
                    project.name,
                    project.start_date.isoformat() if project.start_date else "",
                    project.end_date.isoformat() if project.end_date else "",
                    count,
                ]
            )
        return csv_response("project_outcomes.csv", ["project_id", "project_name", "start_date", "end_date", "beneficiaries"], rows)
    if dataset == "donor-report":
        donations_query = db.query(models.Donation)
        if start_date:
            donations_query = donations_query.filter(models.Donation.date >= start_date)
        if end_date:
            donations_query = donations_query.filter(models.Donation.date <= end_date)
        donations = donations_query.all()
        totals_by_donor: dict[int, int] = {}
        for donation in donations:
            totals_by_donor[donation.donor_id] = totals_by_donor.get(donation.donor_id, 0) + donation.amount
        donor_lookup = {d.id: d.name for d in db.query(models.Donor).all()}
        rows = [
            [donor_id, donor_lookup.get(donor_id, ""), amount]
            for donor_id, amount in totals_by_donor.items()
        ]
        rows.sort(key=lambda row: row[2], reverse=True)
        return csv_response("donor_report.csv", ["donor_id", "donor_name", "amount_total"], rows)
    if dataset == "activity":
        users_query = db.query(models.User)
        logs_query = db.query(models.ActivityLog)
        if current_user.role == models.Role.manager and current_user.department_id:
            users_query = users_query.filter(models.User.department_id == current_user.department_id)
            dept_user_ids = [u.id for u in users_query]
            logs_query = logs_query.filter(models.ActivityLog.actor_id.in_(dept_user_ids))
        users = {u.id: u.full_name for u in users_query.all()}
        logs = logs_query.order_by(models.ActivityLog.created_at.desc()).all()
        rows = [
            [
                log.id,
                log.created_at.isoformat(),
                log.actor_id or "",
                users.get(log.actor_id, "") if log.actor_id else "",
                log.action,
                log.detail or "",
            ]
            for log in logs
        ]
        return csv_response("activity_log.csv", ["id", "created_at", "actor_id", "actor_name", "action", "detail"], rows)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown dataset")

# Donors & donations


@app.post("/donors", response_model=schemas.DonorRead, status_code=status.HTTP_201_CREATED)
def create_donor(
    donor: schemas.DonorCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_donor = models.Donor(**donor.model_dump())
    db.add(db_donor)
    db.commit()
    db.refresh(db_donor)
    log_activity(db, current_user.id, "donor_create", f"Donor {db_donor.id}")
    return db_donor


@app.patch("/donors/{donor_id}", response_model=schemas.DonorRead)
def update_donor(
    donor_id: int,
    donor_update: schemas.DonorUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_donor = db.get(models.Donor, donor_id)
    if not db_donor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor not found")
    for field, value in donor_update.model_dump(exclude_none=True).items():
        setattr(db_donor, field, value)
    db.commit()
    db.refresh(db_donor)
    log_activity(db, current_user.id, "donor_update", f"Donor {db_donor.id}")
    return db_donor


@app.delete("/donors/{donor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_donor(
    donor_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_donor = db.get(models.Donor, donor_id)
    if not db_donor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor not found")
    has_donations = db.query(models.Donation).filter(models.Donation.donor_id == donor_id).first()
    if has_donations:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delete donations before removing donor")
    db.delete(db_donor)
    log_activity(db, current_user.id, "donor_delete", f"Donor {donor_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/donors", response_model=List[schemas.DonorRead])
def list_donors(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    return db.query(models.Donor).order_by(models.Donor.created_at.desc()).all()


@app.post("/donations", response_model=schemas.DonationRead, status_code=status.HTTP_201_CREATED)
def create_donation(
    donation: schemas.DonationCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    donor = db.get(models.Donor, donation.donor_id)
    if not donor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor not found")
    data = donation.model_dump()
    if not data.get("date"):
        data["date"] = datetime.utcnow()
    db_donation = models.Donation(**data)
    db.add(db_donation)
    db.commit()
    db.refresh(db_donation)
    log_activity(db, current_user.id, "donation_create", f"Donation {db_donation.id}")
    return db_donation


@app.patch("/donations/{donation_id}", response_model=schemas.DonationRead)
def update_donation(
    donation_id: int,
    donation_update: schemas.DonationUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_donation = db.get(models.Donation, donation_id)
    if not db_donation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donation not found")
    data = donation_update.model_dump(exclude_none=True)
    if "donor_id" in data:
        if not db.get(models.Donor, data["donor_id"]):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donor not found")
    for field, value in data.items():
        setattr(db_donation, field, value)
    db.commit()
    db.refresh(db_donation)
    log_activity(db, current_user.id, "donation_update", f"Donation {db_donation.id}")
    return db_donation


@app.delete("/donations/{donation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_donation(
    donation_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_donation = db.get(models.Donation, donation_id)
    if not db_donation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Donation not found")
    db.delete(db_donation)
    log_activity(db, current_user.id, "donation_delete", f"Donation {donation_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/donations", response_model=List[schemas.DonationRead])
def list_donations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    query = db.query(models.Donation).join(models.Donor)
    if current_user.role == models.Role.manager:
        # assume donor address or dept not linked; no strict filter available; return all
        pass
    return query.order_by(models.Donation.date.desc()).all()


# Volunteers


@app.post("/volunteers", response_model=schemas.VolunteerRead, status_code=status.HTTP_201_CREATED)
def create_volunteer(
    volunteer: schemas.VolunteerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_vol = models.Volunteer(**volunteer.model_dump())
    db.add(db_vol)
    db.commit()
    db.refresh(db_vol)
    log_activity(db, current_user.id, "volunteer_create", f"Volunteer {db_vol.id}")
    return db_vol


@app.get("/volunteers", response_model=List[schemas.VolunteerRead])
def list_volunteers(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    return db.query(models.Volunteer).order_by(models.Volunteer.created_at.desc()).all()


# Campaigns


@app.post("/campaigns", response_model=schemas.CampaignRead, status_code=status.HTTP_201_CREATED)
def create_campaign(
    campaign: schemas.CampaignCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_c = models.Campaign(**campaign.model_dump())
    db.add(db_c)
    db.commit()
    db.refresh(db_c)
    log_activity(db, current_user.id, "campaign_create", f"Campaign {db_c.id}")
    return db_c


@app.patch("/campaigns/{campaign_id}", response_model=schemas.CampaignRead)
def update_campaign(
    campaign_id: int,
    campaign_update: schemas.CampaignUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_campaign = db.get(models.Campaign, campaign_id)
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    for field, value in campaign_update.model_dump(exclude_none=True).items():
        setattr(db_campaign, field, value)
    db.commit()
    db.refresh(db_campaign)
    log_activity(db, current_user.id, "campaign_update", f"Campaign {db_campaign.id}")
    return db_campaign


@app.delete("/campaigns/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_campaign = db.get(models.Campaign, campaign_id)
    if not db_campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    db.delete(db_campaign)
    log_activity(db, current_user.id, "campaign_delete", f"Campaign {campaign_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/campaigns", response_model=List[schemas.CampaignRead])
def list_campaigns(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return db.query(models.Campaign).order_by(models.Campaign.start_date.asc().nulls_last()).all()


# Projects & beneficiaries


@app.post("/projects", response_model=schemas.ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    project: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_p = models.Project(**project.model_dump())
    db.add(db_p)
    db.commit()
    db.refresh(db_p)
    log_activity(db, current_user.id, "project_create", f"Project {db_p.id}")
    return db_p


@app.patch("/projects/{project_id}", response_model=schemas.ProjectRead)
def update_project(
    project_id: int,
    project_update: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_project = db.get(models.Project, project_id)
    if not db_project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    for field, value in project_update.model_dump(exclude_none=True).items():
        setattr(db_project, field, value)
    db.commit()
    db.refresh(db_project)
    log_activity(db, current_user.id, "project_update", f"Project {db_project.id}")
    return db_project


@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_project = db.get(models.Project, project_id)
    if not db_project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    has_beneficiaries = db.query(models.Beneficiary).filter(models.Beneficiary.project_id == project_id).first()
    if has_beneficiaries:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delete beneficiaries before removing project")
    db.delete(db_project)
    log_activity(db, current_user.id, "project_delete", f"Project {project_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/projects", response_model=List[schemas.ProjectRead])
def list_projects(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return db.query(models.Project).order_by(models.Project.start_date.asc().nulls_last()).all()


@app.post("/beneficiaries", response_model=schemas.BeneficiaryRead, status_code=status.HTTP_201_CREATED)
def create_beneficiary(
    bene: schemas.BeneficiaryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    if bene.project_id and not db.get(models.Project, bene.project_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project not found")
    db_b = models.Beneficiary(**bene.model_dump())
    db.add(db_b)
    db.commit()
    db.refresh(db_b)
    log_activity(db, current_user.id, "beneficiary_create", f"Beneficiary {db_b.id}")
    return db_b


@app.patch("/beneficiaries/{beneficiary_id}", response_model=schemas.BeneficiaryRead)
def update_beneficiary(
    beneficiary_id: int,
    bene_update: schemas.BeneficiaryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_bene = db.get(models.Beneficiary, beneficiary_id)
    if not db_bene:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beneficiary not found")
    data = bene_update.model_dump(exclude_none=True)
    if "project_id" in data and data["project_id"]:
        if not db.get(models.Project, data["project_id"]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project not found")
    for field, value in data.items():
        setattr(db_bene, field, value)
    db.commit()
    db.refresh(db_bene)
    log_activity(db, current_user.id, "beneficiary_update", f"Beneficiary {db_bene.id}")
    return db_bene


@app.delete("/beneficiaries/{beneficiary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_beneficiary(
    beneficiary_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_bene = db.get(models.Beneficiary, beneficiary_id)
    if not db_bene:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beneficiary not found")
    db.delete(db_bene)
    log_activity(db, current_user.id, "beneficiary_delete", f"Beneficiary {beneficiary_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/beneficiaries", response_model=List[schemas.BeneficiaryRead])
def list_beneficiaries(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return db.query(models.Beneficiary).order_by(models.Beneficiary.id.desc()).all()


# Newsletter / inquiries / tickets


@app.post("/newsletter/subscribe", response_model=schemas.NewsletterSubscriptionRead, status_code=status.HTTP_201_CREATED)
def subscribe_newsletter(
    sub: schemas.NewsletterSubscriptionCreate,
    db: Session = Depends(get_db),
):
    existing = db.query(models.NewsletterSubscription).filter(models.NewsletterSubscription.email == sub.email).first()
    if existing:
        return existing
    db_sub = models.NewsletterSubscription(email=sub.email)
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub


@app.get("/newsletter", response_model=List[schemas.NewsletterSubscriptionRead])
def list_newsletter(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    return db.query(models.NewsletterSubscription).order_by(models.NewsletterSubscription.created_at.desc()).all()


@app.post("/inquiries", response_model=schemas.InquiryRead, status_code=status.HTTP_201_CREATED)
def create_inquiry(
    inquiry: schemas.InquiryCreate,
    db: Session = Depends(get_db),
):
    db_inq = models.Inquiry(**inquiry.model_dump())
    db.add(db_inq)
    db.commit()
    db.refresh(db_inq)
    return db_inq


@app.get("/inquiries", response_model=List[schemas.InquiryRead])
def list_inquiries(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    return db.query(models.Inquiry).order_by(models.Inquiry.created_at.desc()).all()


@app.post("/tickets", response_model=schemas.SupportTicketRead, status_code=status.HTTP_201_CREATED)
def create_ticket(
    ticket: schemas.SupportTicketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_t = models.SupportTicket(
        user_id=ticket.user_id or current_user.id,
        subject=ticket.subject,
        body=ticket.body,
    )
    db.add(db_t)
    db.commit()
    db.refresh(db_t)
    log_activity(db, current_user.id, "ticket_create", f"Ticket {db_t.id}")
    return db_t


@app.get("/tickets", response_model=List[schemas.SupportTicketRead])
def list_tickets(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    query = db.query(models.SupportTicket)
    if current_user.role == models.Role.manager:
        dept_user_ids = [u.id for u in db.query(models.User.id).filter(models.User.department_id == current_user.department_id)]
        query = query.filter(models.SupportTicket.user_id.in_(dept_user_ids))
    return query.order_by(models.SupportTicket.created_at.desc()).all()


@app.get("/activity", response_model=List[schemas.ActivityLogRead])
def list_activity(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    query = db.query(models.ActivityLog)
    if current_user.role == models.Role.manager:
        # filter to activity by users in their department
        dept_user_ids = [u.id for u in db.query(models.User.id).filter(models.User.department_id == current_user.department_id)]
        query = query.filter(models.ActivityLog.actor_id.in_(dept_user_ids))
    return query.order_by(models.ActivityLog.created_at.desc()).limit(200).all()


@app.post("/activity", response_model=schemas.ActivityLogRead, status_code=status.HTTP_201_CREATED)
def create_activity_entry(
    entry: schemas.AdminLogCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin)),
):
    log_entry = models.ActivityLog(actor_id=current_user.id, action=entry.action, detail=entry.detail)
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry


# Access grants


@app.post("/access-grants", response_model=schemas.AccessGrantRead, status_code=status.HTTP_201_CREATED)
def create_access_grant(
    grant: schemas.AccessGrantCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    if current_user.role == models.Role.manager:
        if grant.department_id not in (None, current_user.department_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only grant within their department")
        # enforce grant to users inside department
        target = db.get(models.User, grant.user_id)
        if not target or target.department_id != current_user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not in your department")
    db_grant = models.AccessGrant(**grant.model_dump())
    db.add(db_grant)
    db.commit()
    db.refresh(db_grant)
    log_activity(db, current_user.id, "access_grant", f"Grant {db_grant.permission} on {db_grant.resource_type}:{db_grant.resource_id} to {db_grant.user_id}")
    return db_grant


@app.get("/access-grants", response_model=List[schemas.AccessGrantRead])
def list_access_grants(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.AccessGrant)
    if current_user.role == models.Role.manager:
        query = query.filter(models.AccessGrant.department_id == current_user.department_id)
    elif current_user.role not in [models.Role.admin]:
        query = query.filter(models.AccessGrant.user_id == current_user.id)
    return query.order_by(models.AccessGrant.created_at.desc()).all()


# Department-scoped requests/approvals


@app.post("/requests", response_model=schemas.RequestTicketRead, status_code=status.HTTP_201_CREATED)
def create_request(
    req: schemas.RequestTicketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dept_id = req.department_id or current_user.department_id
    if not dept_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department is required")
    db_req = models.RequestTicket(
        requester_id=current_user.id,
        department_id=dept_id,
        type=req.type,
        payload=req.payload,
    )
    db.add(db_req)
    db.commit()
    db.refresh(db_req)
    log_activity(db, current_user.id, "request_create", f"Request {db_req.id}")
    log_request_audit(db, db_req.id, current_user.id, "created", to_status=db_req.status)
    return db_req


@app.post("/workflows/leave", response_model=schemas.RequestTicketRead, status_code=status.HTTP_201_CREATED)
def create_leave_request(
    leave: schemas.LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dept_id = current_user.department_id
    if not dept_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department is required")
    payload = serialize_payload(leave.model_dump())
    db_req = models.RequestTicket(
        requester_id=current_user.id,
        department_id=dept_id,
        type="leave",
        payload=payload,
        status="pending",
    )
    db.add(db_req)
    db.commit()
    db.refresh(db_req)
    log_activity(db, current_user.id, "workflow_leave_create", f"Request {db_req.id}")
    log_request_audit(db, db_req.id, current_user.id, "created", to_status=db_req.status)
    return db_req


@app.post("/workflows/procurement", response_model=schemas.RequestTicketRead, status_code=status.HTTP_201_CREATED)
def create_procurement_request(
    procurement: schemas.ProcurementRequestCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dept_id = current_user.department_id
    if not dept_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department is required")
    payload = serialize_payload(procurement.model_dump())
    db_req = models.RequestTicket(
        requester_id=current_user.id,
        department_id=dept_id,
        type="procurement",
        payload=payload,
        status="pending",
    )
    db.add(db_req)
    db.commit()
    db.refresh(db_req)
    log_activity(db, current_user.id, "workflow_procurement_create", f"Request {db_req.id}")
    log_request_audit(db, db_req.id, current_user.id, "created", to_status=db_req.status)
    return db_req


@app.post("/workflows/travel", response_model=schemas.RequestTicketRead, status_code=status.HTTP_201_CREATED)
def create_travel_request(
    travel: schemas.TravelRequestCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    dept_id = current_user.department_id
    if not dept_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department is required")
    payload = serialize_payload(travel.model_dump())
    db_req = models.RequestTicket(
        requester_id=current_user.id,
        department_id=dept_id,
        type="travel",
        payload=payload,
        status="pending",
    )
    db.add(db_req)
    db.commit()
    db.refresh(db_req)
    log_activity(db, current_user.id, "workflow_travel_create", f"Request {db_req.id}")
    log_request_audit(db, db_req.id, current_user.id, "created", to_status=db_req.status)
    return db_req


@app.get("/requests", response_model=List[schemas.RequestTicketRead])
def list_requests(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.RequestTicket)
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        query = query.filter(models.RequestTicket.department_id == current_user.department_id)
    else:
        query = query.filter(models.RequestTicket.requester_id == current_user.id)
    return query.order_by(models.RequestTicket.created_at.desc()).all()


@app.patch("/requests/{request_id}", response_model=schemas.RequestTicketRead)
def update_request(
    request_id: int,
    update: schemas.RequestTicketUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_req = db.get(models.RequestTicket, request_id)
    if not db_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if current_user.role == models.Role.manager and db_req.department_id != current_user.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify other departments")
    prev_status = db_req.status
    data = update.model_dump(exclude_none=True)
    if "status" in data:
        if data["status"] not in ("pending", "approved", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")
        db_req.status = data["status"]
    if db_req.status in ("approved", "rejected") and db_req.resolved_at is None:
        db_req.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(db_req)
    log_activity(db, current_user.id, "request_update", f"Request {db_req.id} -> {db_req.status}")
    if db_req.status != prev_status:
        log_request_audit(db, db_req.id, current_user.id, "status_change", from_status=prev_status, to_status=db_req.status)
        message = models.Message(
            sender_id=current_user.id,
            recipient_id=db_req.requester_id,
            department_id=db_req.department_id,
            subject=f"Request {db_req.type} {db_req.status}",
            body=f"Your request #{db_req.id} was marked {db_req.status}.",
        )
        db.add(message)
        db.commit()
    return db_req


@app.get("/requests/{request_id}/audit", response_model=List[schemas.RequestAuditRead])
def list_request_audits(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_req = db.get(models.RequestTicket, request_id)
    if not db_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        if current_user.department_id != db_req.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    elif current_user.id != db_req.requester_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return (
        db.query(models.RequestAudit)
        .filter(models.RequestAudit.request_id == request_id)
        .order_by(models.RequestAudit.created_at.desc())
        .all()
    )


@app.get("/requests/{request_id}/attachments", response_model=List[schemas.RequestAttachmentRead])
def list_request_attachments(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_req = db.get(models.RequestTicket, request_id)
    if not db_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        if current_user.department_id != db_req.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    elif current_user.id != db_req.requester_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return (
        db.query(models.RequestAttachment)
        .filter(models.RequestAttachment.request_id == request_id)
        .order_by(models.RequestAttachment.uploaded_at.desc())
        .all()
    )


@app.post("/requests/{request_id}/attachments", response_model=schemas.RequestAttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_request_attachment(
    request_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_req = db.get(models.RequestTicket, request_id)
    if not db_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        if current_user.department_id != db_req.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    elif current_user.id != db_req.requester_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    ext = Path(file.filename).suffix.lower()
    if ext not in settings.allowed_upload_extensions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File type not allowed")
    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
    request_dir = os.path.join(settings.upload_dir, "requests")
    Path(request_dir).mkdir(parents=True, exist_ok=True)
    safe_name = f"request_{request_id}_{int(datetime.utcnow().timestamp())}_{secrets.token_hex(4)}{ext}"
    save_path = os.path.join(request_dir, safe_name)
    with open(save_path, "wb") as buffer:
        buffer.write(data)
    attachment = models.RequestAttachment(
        request_id=request_id,
        filename=file.filename,
        file_path=save_path,
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@app.get("/requests/attachments/{attachment_id}/download")
def download_request_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    attachment = db.get(models.RequestAttachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    db_req = db.get(models.RequestTicket, attachment.request_id)
    if not db_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if current_user.role == models.Role.admin:
        pass
    elif current_user.role == models.Role.manager:
        if current_user.department_id != db_req.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    elif current_user.id != db_req.requester_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return FileResponse(attachment.file_path, filename=attachment.filename)


@app.post("/requests/{request_id}/respond", status_code=status.HTTP_202_ACCEPTED)
def respond_request(
    request_id: int,
    response: schemas.RequestResponse,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(models.Role.admin, models.Role.manager)),
):
    db_req = db.get(models.RequestTicket, request_id)
    if not db_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    message = models.Message(
        sender_id=current_user.id,
        recipient_id=db_req.requester_id,
        department_id=db_req.department_id,
        subject=response.subject,
        body=response.body,
    )
    db.add(message)
    prev_status = db_req.status
    if response.status:
        if response.status not in ("pending", "approved", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")
        db_req.status = response.status
        if response.status in ("approved", "rejected") and db_req.resolved_at is None:
            db_req.resolved_at = datetime.utcnow()
    db.commit()
    log_activity(db, current_user.id, "request_response", f"Request {db_req.id}")
    if response.status and db_req.status != prev_status:
        log_request_audit(
            db,
            db_req.id,
            current_user.id,
            "status_change",
            from_status=prev_status,
            to_status=db_req.status,
            note=response.subject,
        )
    log_request_audit(db, db_req.id, current_user.id, "response", note=response.subject)
    return {"status": "sent"}
