from datetime import datetime, timedelta
from app.database import Base, engine, SessionLocal
from app import models, auth
from app.config import get_settings

Base.metadata.create_all(bind=engine)
s = get_settings()
db = SessionLocal()

def dept(name, desc=""):
    d = db.query(models.Department).filter_by(name=name).first()
    if not d:
        d = models.Department(name=name, description=desc)
        db.add(d); db.flush()
    return d

def user(full, email, pwd, role, dept_id=None):
    u = db.query(models.User).filter_by(email=email).first()
    if not u:
        u = models.User(full_name=full, email=email, hashed_password=auth.get_password_hash(pwd), role=models.Role(role), department_id=dept_id)
        db.add(u); db.flush()
    return u

a = dept("Accounts", "Finance")
h = dept("HR", "Human Resources")
i = dept("IT", "Technology")

admin = user("System Admin", s.admin_email, s.default_admin_password, "admin", None)
mgr_a = user("Alice Manager", "alice.accounts@example.com", "Passw0rd!", "manager", a.id)
mgr_h = user("Bob HR", "bob.hr@example.com", "Passw0rd!", "manager", h.id)
staff_a = user("Carol Finance", "carol.accounts@example.com", "Passw0rd!", "staff", a.id)
staff_h = user("Dave HR", "dave.hr@example.com", "Passw0rd!", "staff", h.id)

for title, dept_obj, assignee, creator, days in [
    ("Close monthly books", a, staff_a, mgr_a, 5),
    ("Recruit junior engineer", h, staff_h, mgr_h, 7),
]:
    t = db.query(models.Task).filter_by(title=title).first()
    if not t:
        t = models.Task(title=title, description=f"{title} details", status=models.TaskStatus.pending, start_date=datetime.utcnow(), end_date=datetime.utcnow()+timedelta(days=days), department_id=dept_obj.id, assigned_to_id=assignee.id, created_by_id=creator.id)
        db.add(t)

for ev in [
    ("Company town hall", None, 2),
    ("Payroll cutoff", a.id, 1),
    ("Onboarding session", h.id, 3),
]:
    title, dept_id, days = ev
    if not db.query(models.Event).filter_by(title=title).first():
        db.add(models.Event(title=title, description=f"{title} notice", scheduled_at=datetime.utcnow()+timedelta(days=days), department_id=dept_id))

for donor_name in ["Acme Corp", "Global Aid"]:
    if not db.query(models.Donor).filter_by(name=donor_name).first():
        d = models.Donor(name=donor_name, email=f"{donor_name.replace(' ','').lower()}@example.com")
        db.add(d); db.flush()
        db.add(models.Donation(donor_id=d.id, amount=1000, currency="USD"))

if not db.query(models.Campaign).first():
    db.add(models.Campaign(name="School Fund", goal_amount=50000, start_date=datetime.utcnow(), end_date=datetime.utcnow()+timedelta(days=60)))

if not db.query(models.Project).first():
    pr = models.Project(name="Water Project", description="Clean water", budget=20000, start_date=datetime.utcnow())
    db.add(pr); db.flush(); db.add(models.Beneficiary(name="Community A", project_id=pr.id))

db.commit(); db.close()
print("Seed complete")
