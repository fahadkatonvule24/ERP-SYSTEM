from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr

from .models import Role, TaskStatus


class DepartmentBase(BaseModel):
    name: str
    description: Optional[str] = None


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class DepartmentRead(DepartmentBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class UserBase(BaseModel):
    full_name: str
    email: EmailStr
    department_id: Optional[int] = None
    role: Role = Role.staff
    active: bool = True


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    department_id: Optional[int] = None
    role: Optional[Role] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class UserRead(UserBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.pending
    start_date: datetime
    end_date: datetime
    due_date: Optional[datetime] = None
    department_id: int
    assigned_to_id: int


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    assigned_to_id: Optional[int] = None
    department_id: Optional[int] = None


class TaskRead(TaskBase):
    id: int
    created_by_id: int
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    assignee: Optional[UserRead] = None

    model_config = ConfigDict(from_attributes=True)


class EventBase(BaseModel):
    title: str
    description: Optional[str] = None
    scheduled_at: datetime
    department_id: Optional[int] = None


class EventCreate(EventBase):
    pass


class EventRead(EventBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    department_id: Optional[int] = None


class ResourceRead(BaseModel):
    id: int
    filename: str
    file_path: str
    uploaded_at: datetime
    owner_id: int
    task_id: Optional[int]
    department_id: Optional[int]

    model_config = ConfigDict(from_attributes=True)


class CommentBase(BaseModel):
    body: str
    task_id: int


class CommentCreate(CommentBase):
    user_id: int


class CommentRead(CommentBase):
    id: int
    created_at: datetime
    user_id: int

    model_config = ConfigDict(from_attributes=True)


class PerformanceLogCreate(BaseModel):
    user_id: int
    task_id: Optional[int] = None
    score: int
    note: Optional[str] = None


class PerformanceLogRead(PerformanceLogCreate):
    id: int
    created_by_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    subject: str
    body: str
    recipient_id: Optional[int] = None  # null = broadcast
    department_id: Optional[int] = None


class MessageRead(MessageCreate):
    id: int
    sender_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class OutboundEmail(BaseModel):
    to_email: EmailStr
    subject: str
    body: str


class DonorCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class DonorRead(DonorCreate):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DonorUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class DonationCreate(BaseModel):
    donor_id: int
    amount: int
    currency: str = "USD"
    date: Optional[datetime] = None
    method: Optional[str] = None
    recurring: bool = False
    note: Optional[str] = None


class DonationRead(DonationCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class DonationUpdate(BaseModel):
    donor_id: Optional[int] = None
    amount: Optional[int] = None
    currency: Optional[str] = None
    date: Optional[datetime] = None
    method: Optional[str] = None
    recurring: Optional[bool] = None
    note: Optional[str] = None


class VolunteerCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    skills: Optional[str] = None
    hours: int = 0
    active: bool = True


class VolunteerRead(VolunteerCreate):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CampaignCreate(BaseModel):
    name: str
    goal_amount: Optional[int] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class CampaignRead(CampaignCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    goal_amount: Optional[int] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    budget: Optional[int] = None
    progress: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ProjectRead(ProjectCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    budget: Optional[int] = None
    progress: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class BeneficiaryCreate(BaseModel):
    name: str
    contact: Optional[str] = None
    notes: Optional[str] = None
    project_id: Optional[int] = None


class BeneficiaryRead(BeneficiaryCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class BeneficiaryUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None
    project_id: Optional[int] = None


class NewsletterSubscriptionCreate(BaseModel):
    email: EmailStr


class NewsletterSubscriptionRead(NewsletterSubscriptionCreate):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InquiryCreate(BaseModel):
    name: str
    email: EmailStr
    message: str


class InquiryRead(InquiryCreate):
    id: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupportTicketCreate(BaseModel):
    subject: str
    body: str
    user_id: Optional[int] = None


class SupportTicketRead(SupportTicketCreate):
    id: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityLogRead(BaseModel):
    id: int
    actor_id: Optional[int]
    action: str
    detail: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccessGrantCreate(BaseModel):
    user_id: int
    resource_type: str
    resource_id: str
    permission: str
    department_id: Optional[int] = None


class AdminLogCreate(BaseModel):
    action: str
    detail: Optional[str] = None


class AccessGrantRead(AccessGrantCreate):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RequestTicketCreate(BaseModel):
    type: str
    payload: Optional[str] = None
    department_id: Optional[int] = None


class RequestTicketUpdate(BaseModel):
    status: Optional[str] = None


class LeaveRequestCreate(BaseModel):
    start_date: datetime
    end_date: datetime
    reason: str
    coverage_plan: Optional[str] = None
    contact: Optional[str] = None


class ProcurementRequestCreate(BaseModel):
    item: str
    quantity: int
    estimated_cost: float
    vendor: Optional[str] = None
    justification: Optional[str] = None


class TravelRequestCreate(BaseModel):
    destination: str
    start_date: datetime
    end_date: datetime
    purpose: str
    estimated_cost: float
    advance_needed: bool = False


class RequestResponse(BaseModel):
    subject: str
    body: str
    status: Optional[str] = None


class RequestTicketRead(BaseModel):
    id: int
    requester_id: int
    department_id: int
    type: str
    payload: Optional[str]
    status: str
    created_at: datetime
    resolved_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class RequestAttachmentRead(BaseModel):
    id: int
    request_id: int
    filename: str
    uploaded_at: datetime
    uploaded_by_id: int

    model_config = ConfigDict(from_attributes=True)


class RequestAuditRead(BaseModel):
    id: int
    request_id: int
    actor_id: Optional[int]
    action: str
    from_status: Optional[str]
    to_status: Optional[str]
    note: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectBeneficiaryStat(BaseModel):
    project_id: int
    project_name: str
    beneficiaries: int


class DonorSummary(BaseModel):
    donor_id: int
    donor_name: str
    total_amount: int


class MonthlyDonationStat(BaseModel):
    month: str
    amount: int


class PerformanceScoreEntry(BaseModel):
    score: int
    created_at: datetime


class PerformanceSummary(BaseModel):
    user_id: int
    user_name: str
    role: Role
    department_id: Optional[int] = None
    avg_score: float
    total_logs: int
    last_score: Optional[int] = None
    last_logged_at: Optional[datetime] = None
    recent_scores: List[PerformanceScoreEntry]


class ReportOverview(BaseModel):
    departments: int
    users_total: int
    users_active: int
    tasks_total: int
    tasks_completed: int
    tasks_overdue: int
    requests_pending: int
    events_upcoming: int
    donors_total: int
    donations_total: int
    donations_amount: int
    volunteers_total: int
    projects_total: int
    beneficiaries_total: int


class ReportPrograms(BaseModel):
    projects_total: int
    beneficiaries_total: int
    beneficiaries_by_project: List[ProjectBeneficiaryStat]
    programs_tasks_done: int
    programs_tasks_pending: int
    upcoming_program_events: int


class ReportFundraising(BaseModel):
    donors_total: int
    donations_total: int
    donations_amount: int
    recurring_donations: int
    donations_by_donor: List[DonorSummary]
    donations_by_month: List[MonthlyDonationStat]


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None


class TokenData(BaseModel):
    user_id: Optional[int] = None


class RefreshRequest(BaseModel):
    refresh_token: str
