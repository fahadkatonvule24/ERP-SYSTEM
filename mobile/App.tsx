import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Button, FlatList, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios, { AxiosInstance } from "axios";
import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import Constants from "expo-constants";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackScreenProps } from "@react-navigation/native-stack";
import appConfig from "./app.json";

type Role = "admin" | "manager" | "staff" | "collaborator";
type TaskStatus = "pending" | "in_progress" | "done" | "blocked";

type User = { id: number; full_name: string; email: string; role: Role; department_id?: number | null; active?: boolean };
type Task = { id: number; title: string; description?: string; status: TaskStatus; start_date: string; end_date: string; completed_at?: string | null; department_id: number; assigned_to_id: number; created_by_id: number; assignee?: User | null };
type Event = { id: number; title: string; description?: string; scheduled_at: string; department_id?: number | null };
type Comment = { id: number; body: string; created_at: string; user_id: number };
type Resource = { id: number; filename: string; uploaded_at: string; owner_id: number };
type Department = { id: number; name: string; description?: string | null };
type Message = { id: number; sender_id: number; recipient_id?: number | null; department_id?: number | null; subject: string; body: string; created_at: string };
type PerformanceLog = { id: number; user_id: number; task_id?: number | null; score: number; note?: string | null; created_by_id: number; created_at: string };
type RequestTicket = { id: number; requester_id: number; department_id: number; type: string; payload?: string | null; status: string; created_at: string; resolved_at?: string | null };
type AccessGrant = { id: number; user_id: number; resource_type: string; resource_id: string; permission: string; department_id?: number | null; created_at: string };
type ActivityLog = { id: number; actor_id?: number | null; action: string; detail?: string | null; created_at: string };
type DraftMessage = { subject: string; body: string; recipient_id?: string; department_id?: string };
type RequestAttachment = { id: number; request_id: number; filename: string; uploaded_at: string; uploaded_by_id: number };
type Donor = { id: number; name: string; email?: string | null; phone?: string | null; address?: string | null; created_at: string };
type Donation = { id: number; donor_id: number; amount: number; currency: string; date?: string | null; method?: string | null; recurring: boolean; note?: string | null };
type Volunteer = { id: number; name: string; email?: string | null; phone?: string | null; skills?: string | null; hours: number; active: boolean; created_at: string };
type Campaign = { id: number; name: string; goal_amount?: number | null; description?: string | null; start_date?: string | null; end_date?: string | null };
type Project = { id: number; name: string; description?: string | null; budget?: number | null; progress?: string | null; start_date?: string | null; end_date?: string | null };
type Beneficiary = { id: number; name: string; contact?: string | null; notes?: string | null; project_id?: number | null };
type RequestAudit = { id: number; request_id: number; actor_id?: number | null; action: string; from_status?: string | null; to_status?: string | null; note?: string | null; created_at: string };
type ProjectBeneficiaryStat = { project_id: number; project_name: string; beneficiaries: number };
type DonorSummary = { donor_id: number; donor_name: string; total_amount: number };
type MonthlyDonationStat = { month: string; amount: number };
type PerformanceScoreEntry = { score: number; created_at: string };
type PerformanceSummary = { user_id: number; user_name: string; role: Role; department_id?: number | null; avg_score: number; total_logs: number; last_score?: number | null; last_logged_at?: string | null; recent_scores: PerformanceScoreEntry[] };
type ReportOverview = { departments: number; users_total: number; users_active: number; tasks_total: number; tasks_completed: number; tasks_overdue: number; requests_pending: number; events_upcoming: number; donors_total: number; donations_total: number; donations_amount: number; volunteers_total: number; projects_total: number; beneficiaries_total: number };
type ReportPrograms = { projects_total: number; beneficiaries_total: number; beneficiaries_by_project: ProjectBeneficiaryStat[]; programs_tasks_done: number; programs_tasks_pending: number; upcoming_program_events: number };
type ReportFundraising = { donors_total: number; donations_total: number; donations_amount: number; recurring_donations: number; donations_by_donor: DonorSummary[]; donations_by_month: MonthlyDonationStat[] };

const palette = {
  bg: "#f3f4f6",
  card: "#ffffff",
  primary: "#2563eb",
  accent: "#0ea5e9",
  danger: "#b91c1c",
  text: "#1f2937",
  muted: "#6b7280",
};
const resolveApiBaseUrl = () => {
  const envUrl =
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    (Constants.manifest?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    ((Constants as any)?.manifest2?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    (appConfig as { expo?: { extra?: { apiUrl?: string } } })?.expo?.extra?.apiUrl ??
    (typeof process !== "undefined" ? (process as any)?.env?.EXPO_PUBLIC_API_URL : undefined);
  if (envUrl) return envUrl.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest?.hostUri ??
    (Constants as any)?.manifest2?.extra?.expoClient?.hostUri;
  if (hostUri) {
    const host = hostUri.replace(/^(.*:\/\/)/, "").split(":")[0];
    if (host) return `http://${host}:8000`;
  }
  return "http://127.0.0.1:8000";
};

const API_URL = resolveApiBaseUrl();
const DISPLAY_API_URL = API_URL;

type RootStackParamList = { Login: undefined; Home: undefined; Task: { taskId: number } };
const Stack = createNativeStackNavigator<RootStackParamList>();

const useApi = (token: string | null): AxiosInstance =>
  useMemo(() => {
    const instance = axios.create({ baseURL: API_URL, timeout: 10000 });
    if (token) instance.defaults.headers.common.Authorization = `Bearer ${token}`;
    return instance;
  }, [token]);

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [apiError, setApiError] = useState<string | null>(null);
  const api = useApi(token);

  useEffect(() => {
    (async () => {
      const resetFlag = await AsyncStorage.getItem("token_reset_done");
      if (!resetFlag) {
        await AsyncStorage.removeItem("token");
        await AsyncStorage.setItem("token_reset_done", "yes");
        setToken(null);
      } else {
        const stored = await AsyncStorage.getItem("token");
        if (stored) setToken(stored);
      }
    })();
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    (async () => {
      try {
        const me = await api.get<User>("/auth/me");
        setUser(me.data);
      } catch {
        Alert.alert("Session expired", "Please sign in again.");
        await handleLogout();
      }
    })();
  }, [token]);

  const checkHealth = async () => {
    try {
      const res = await axios.get(`${API_URL}/health`, { timeout: 5000 });
      if (res.status === 200) {
        setApiStatus("ok");
        setApiError(null);
      } else {
        setApiStatus("error");
        setApiError(`Health returned ${res.status}`);
      }
    } catch (err: any) {
      setApiStatus("error");
      setApiError(err?.message || "Health failed");
    }
  };

  const handleLogin = async (email: string, password: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const form = new URLSearchParams();
      form.append("username", email.trim());
      form.append("password", password);
      const res = await axios.post(`${API_URL}/auth/token`, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      });
      await AsyncStorage.setItem("token", res.data.access_token);
      setToken(res.data.access_token);
      setApiStatus("ok");
      setApiError(null);
    } catch (err: any) {
      setApiStatus("error");
      const msg =
        err?.code === "ECONNABORTED"
          ? `Login timed out. Check that ${API_URL} is reachable.`
          : err?.response?.data?.detail ?? err?.message ?? "Check credentials";
      setApiError(msg);
      setAuthError(msg);
      Alert.alert("Login failed", msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setToken(null);
    setUser(null);
    await AsyncStorage.removeItem("token");
    await AsyncStorage.removeItem("token_reset_done");
  };

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator>
        {!token ? (
          <Stack.Screen name="Login" options={{ headerShown: false }}>
            {() => <LoginScreen onLogin={handleLogin} loading={authLoading} error={authError} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Home" options={{ headerShown: false }}>
              {(props) =>
                user ? (
                  <HomeScreen
                    {...props}
                    api={api}
                    user={user}
                    apiStatus={apiStatus}
                    apiError={apiError}
                    onCheckHealth={checkHealth}
                    onLogout={handleLogout}
                  />
                ) : (
                  <SafeAreaView style={styles.centered}>
                    <ActivityIndicator />
                  </SafeAreaView>
                )
              }
            </Stack.Screen>
            <Stack.Screen name="Task" options={{ title: "Task detail" }}>
              {(props) => <TaskDetailScreen {...props} api={api} user={user} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const LoginScreen = ({
  onLogin,
  loading,
  error,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}) => {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("changeme");
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>ERP System</Text>
      <Text style={styles.label}>Email</Text>
      <TextInput style={styles.input} value={email} autoCapitalize="none" onChangeText={setEmail} />
      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} value={password} secureTextEntry onChangeText={setPassword} autoCapitalize="none" />
      <Button title={loading ? "Signing in..." : "Sign in"} onPress={() => onLogin(email, password)} disabled={loading} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Text style={styles.apiHint}>API: {DISPLAY_API_URL}</Text>
      <Text style={styles.hint}>Default admin: admin@example.com / changeme</Text>
    </SafeAreaView>
  );
};

const HomeScreen = ({
  navigation,
  api,
  user,
  apiStatus,
  apiError,
  onCheckHealth,
  onLogout,
}: NativeStackScreenProps<RootStackParamList, "Home"> & {
  api: AxiosInstance;
  user: User;
  apiStatus: "unknown" | "ok" | "error";
  apiError: string | null;
  onCheckHealth: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
}) => {
  const [sharedEvents, setSharedEvents] = useState<Event[]>([]);
  const [deptEvents, setDeptEvents] = useState<Event[]>([]);
  const [deptTasks, setDeptTasks] = useState<Task[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [sharedTasks, setSharedTasks] = useState<Task[]>([]);
  const [inbox, setInbox] = useState<Message[]>([]);
  const [sent, setSent] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptResources, setDeptResources] = useState<Resource[]>([]);
  const [requests, setRequests] = useState<RequestTicket[]>([]);
  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([]);
  const [requestAudits, setRequestAudits] = useState<RequestAudit[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [overviewReport, setOverviewReport] = useState<ReportOverview | null>(null);
  const [programsReport, setProgramsReport] = useState<ReportPrograms | null>(null);
  const [fundraisingReport, setFundraisingReport] = useState<ReportFundraising | null>(null);
  const [drafts, setDrafts] = useState<DraftMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"shared" | "department" | "my" | "completed" | "messages" | "requests" | "fundraising" | "programs" | "people" | "reports" | "admin">("shared");

  const [taskForm, setTaskForm] = useState({ title: "", description: "", start_date: "", end_date: "", department_id: "", assigned_to_id: "" });
  const [userForm, setUserForm] = useState({ full_name: "", email: "", password: "", role: "staff", department_id: "" });
  const [messageForm, setMessageForm] = useState({ subject: "", body: "", recipient_id: "", department_id: "" });
  const [emailForm, setEmailForm] = useState({ to_email: "", subject: "", body: "" });
  const [perfForm, setPerfForm] = useState({ user_id: "", task_id: "", score: "", note: "" });
  const [requestForm, setRequestForm] = useState({ type: "", payload: "", department_id: "" });
  const [leaveForm, setLeaveForm] = useState({ start_date: "", end_date: "", reason: "", coverage_plan: "", contact: "" });
  const [procurementForm, setProcurementForm] = useState({ item: "", quantity: "1", estimated_cost: "", vendor: "", justification: "" });
  const [travelForm, setTravelForm] = useState({ destination: "", start_date: "", end_date: "", purpose: "", estimated_cost: "", advance_needed: false });
  const [grantForm, setGrantForm] = useState({ user_id: "", resource_type: "", resource_id: "", permission: "", department_id: "" });
  const [eventForm, setEventForm] = useState({ title: "", description: "", scheduled_at: "", department_id: "" });
  const [meetingForm, setMeetingForm] = useState({ title: "", description: "", scheduled_at: "", department_id: "" });
  const [donorForm, setDonorForm] = useState({ name: "", email: "", phone: "", address: "" });
  const [donationForm, setDonationForm] = useState({ donor_id: "", amount: "", currency: "USD", method: "", recurring: false, note: "" });
  const [campaignForm, setCampaignForm] = useState({ name: "", goal_amount: "", description: "", start_date: "", end_date: "" });
  const [projectForm, setProjectForm] = useState({ name: "", description: "", budget: "", progress: "", start_date: "", end_date: "" });
  const [beneficiaryForm, setBeneficiaryForm] = useState({ name: "", contact: "", notes: "", project_id: "" });
  const [volunteerForm, setVolunteerForm] = useState({ name: "", email: "", phone: "", skills: "", hours: "0" });
  const [projectSearch, setProjectSearch] = useState("");
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [donorSearch, setDonorSearch] = useState("");
  const [donationSearch, setDonationSearch] = useState("");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [performanceReport, setPerformanceReport] = useState<PerformanceSummary[]>([]);
  const [showOverviewReport, setShowOverviewReport] = useState(true);
  const [showProgramsReport, setShowProgramsReport] = useState(false);
  const [showFundraisingReport, setShowFundraisingReport] = useState(false);
  const [showPerformanceReport, setShowPerformanceReport] = useState(false);
  const [showUsersReport, setShowUsersReport] = useState(false);
  const [showExportsReport, setShowExportsReport] = useState(false);
  const [showDepartmentForm, setShowDepartmentForm] = useState(false);
  const [departmentForm, setDepartmentForm] = useState({ name: "", description: "" });
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [projectEdit, setProjectEdit] = useState({ name: "", description: "", budget: "", progress: "", start_date: "", end_date: "" });
  const [beneficiaryEdit, setBeneficiaryEdit] = useState({ name: "", contact: "", notes: "", project_id: "" });
  const [campaignEdit, setCampaignEdit] = useState({ name: "", goal_amount: "", description: "", start_date: "", end_date: "" });
  const [donorEdit, setDonorEdit] = useState({ name: "", email: "", phone: "", address: "" });
  const [donationEdit, setDonationEdit] = useState({ donor_id: "", amount: "", currency: "USD", method: "", recurring: false, note: "" });
  const [adminLogForm, setAdminLogForm] = useState({ action: "", detail: "" });
  const [resourceDeptId, setResourceDeptId] = useState("");
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [expandedBeneficiaryId, setExpandedBeneficiaryId] = useState<number | null>(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState<number | null>(null);
  const [expandedDonorId, setExpandedDonorId] = useState<number | null>(null);
  const [expandedDonationId, setExpandedDonationId] = useState<number | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingBeneficiaryId, setEditingBeneficiaryId] = useState<number | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [editingDonorId, setEditingDonorId] = useState<number | null>(null);
  const [editingDonationId, setEditingDonationId] = useState<number | null>(null);
  const [showSharedTaskForm, setShowSharedTaskForm] = useState(false);
  const [showDeptTaskForm, setShowDeptTaskForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [showProcurementForm, setShowProcurementForm] = useState(false);
  const [showTravelForm, setShowTravelForm] = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [showPerfForm, setShowPerfForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showAdminLogForm, setShowAdminLogForm] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showDonorForm, setShowDonorForm] = useState(false);
  const [showDonationForm, setShowDonationForm] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showBeneficiaryForm, setShowBeneficiaryForm] = useState(false);
  const [showVolunteerForm, setShowVolunteerForm] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [requestAttachments, setRequestAttachments] = useState<RequestAttachment[]>([]);
  const [requestResponse, setRequestResponse] = useState({ subject: "", body: "" });
  const [requestStatusUpdate, setRequestStatusUpdate] = useState<"" | "approved" | "rejected">("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestDetailsLoading, setRequestDetailsLoading] = useState(false);
  const [requestUploadBusy, setRequestUploadBusy] = useState(false);

  const isAdmin = user.role === "admin";
  const isManager = user.role === "manager";
  const canManageNgo = isAdmin || isManager;
  const roleOptions: Role[] = ["admin", "manager", "staff", "collaborator"];
  const getDepartmentName = (departmentId?: number | null) => {
    if (!departmentId) return "No department";
    const dept = departments.find((d) => d.id === departmentId);
    return dept ? dept.name : `Dept ${departmentId}`;
  };
  const getUserName = (userId?: number | null) => {
    if (!userId) return "Unknown user";
    const found = users.find((u) => u.id === userId);
    return found ? `${found.full_name} (${found.role})` : `User ${userId}`;
  };
  const getDonorName = (donorId?: number | null) => {
    if (!donorId) return "Unknown donor";
    const donor = donors.find((d) => d.id === donorId);
    return donor ? donor.name : `Donor ${donorId}`;
  };
  const getProjectName = (projectId?: number | null) => {
    if (!projectId) return "No project";
    const project = projects.find((p) => p.id === projectId);
    return project ? project.name : `Project ${projectId}`;
  };
  const parsePayload = (payload?: string | null) => {
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  };
  const formatPayloadValue = (value: unknown) => {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return formatDate(value);
      return value;
    }
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (value === null || value === undefined) return "n/a";
    return String(value);
  };
  const getPayloadLines = (payload?: string | null) => {
    const parsed = parsePayload(payload);
    if (!parsed || typeof parsed !== "object") return payload ? [payload] : [];
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
      const label = key.replace(/_/g, " ");
      return `${label}: ${formatPayloadValue(value)}`;
    });
  };
  const pinnedRequests = requests.filter((r) => {
    const requester = users.find((u) => u.id === r.requester_id);
    const inDepartment = user.department_id ? r.department_id === user.department_id : true;
    return requester?.role === "admin" && inDepartment;
  });
  const buildReportParams = () => {
    const params: { start_date?: string; end_date?: string } = {};
    const start = reportStartDate.trim();
    const end = reportEndDate.trim();
    if (start) params.start_date = `${start}T00:00:00`;
    if (end) params.end_date = `${end}T23:59:59`;
    return Object.keys(params).length ? params : null;
  };
  const confirmDelete = (label: string, onConfirm: () => void) => {
    Alert.alert(`Delete ${label}?`, "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onConfirm },
    ]);
  };
  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => `${p.name} ${p.description ?? ""} ${p.progress ?? ""}`.toLowerCase().includes(q));
  }, [projectSearch, projects]);
  const filteredBeneficiaries = useMemo(() => {
    const q = beneficiarySearch.trim().toLowerCase();
    if (!q) return beneficiaries;
    return beneficiaries.filter((b) => {
      const projectName = getProjectName(b.project_id);
      return `${b.name} ${b.contact ?? ""} ${b.notes ?? ""} ${projectName}`.toLowerCase().includes(q);
    });
  }, [beneficiarySearch, beneficiaries, projects]);
  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q));
  }, [campaignSearch, campaigns]);
  const filteredDonors = useMemo(() => {
    const q = donorSearch.trim().toLowerCase();
    if (!q) return donors;
    return donors.filter((d) => `${d.name} ${d.email ?? ""} ${d.phone ?? ""} ${d.address ?? ""}`.toLowerCase().includes(q));
  }, [donorSearch, donors]);
  const filteredDonations = useMemo(() => {
    const q = donationSearch.trim().toLowerCase();
    if (!q) return donations;
    return donations.filter((d) => {
      const donorName = getDonorName(d.donor_id);
      return `${donorName} ${d.amount} ${d.currency} ${d.method ?? ""} ${d.note ?? ""}`.toLowerCase().includes(q);
    });
  }, [donationSearch, donations, donors]);
  const performanceMaxScore = useMemo(() => {
    const max = performanceReport.reduce((acc, row) => (row.avg_score > acc ? row.avg_score : acc), 0);
    return max > 0 ? max : 1;
  }, [performanceReport]);
  const reportUsers = useMemo(() => {
    if (!isManager) return users;
    return users.filter((u) => u.department_id === user.department_id);
  }, [isManager, user.department_id, users]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const reportParams = buildReportParams();
      const reportConfig = reportParams ? { params: reportParams } : undefined;
      const [shared, deptEvt, deptT, mine, done, inboxRes, sentRes, usersRes, deptRes, reqRes, grantsRes, allTasksRes, activityRes, donorsRes, donationsRes, volunteersRes, campaignsRes, projectsRes, beneficiariesRes, overviewRes, programsRes, fundraisingRes, performanceRes] = await Promise.all([
        api.get<Event[]>("/events/shared"),
        api.get<Event[]>("/events/department"),
        api.get<Task[]>("/tasks/department"),
        api.get<Task[]>("/tasks/my"),
        api.get<Task[]>("/tasks/completed"),
        api.get<Message[]>("/messages/inbox"),
        api.get<Message[]>("/messages/sent"),
        api.get<User[]>("/users"),
        api.get<Department[]>("/departments"),
        api.get<RequestTicket[]>("/requests"),
        api.get<AccessGrant[]>("/access-grants"),
        api.get<Task[]>("/tasks/all"),
        (canManageNgo ? api.get<ActivityLog[]>("/activity") : Promise.resolve({ data: [] as ActivityLog[] })),
        (canManageNgo ? api.get<Donor[]>("/donors") : Promise.resolve({ data: [] as Donor[] })),
        (canManageNgo ? api.get<Donation[]>("/donations") : Promise.resolve({ data: [] as Donation[] })),
        (canManageNgo ? api.get<Volunteer[]>("/volunteers") : Promise.resolve({ data: [] as Volunteer[] })),
        api.get<Campaign[]>("/campaigns"),
        api.get<Project[]>("/projects"),
        api.get<Beneficiary[]>("/beneficiaries"),
        (canManageNgo ? api.get<ReportOverview>("/reports/overview") : Promise.resolve({ data: null as ReportOverview | null })),
        (canManageNgo ? api.get<ReportPrograms>("/reports/programs", reportConfig) : Promise.resolve({ data: null as ReportPrograms | null })),
        (canManageNgo ? api.get<ReportFundraising>("/reports/fundraising", reportConfig) : Promise.resolve({ data: null as ReportFundraising | null })),
        (canManageNgo ? api.get<PerformanceSummary[]>("/reports/performance") : Promise.resolve({ data: [] as PerformanceSummary[] })),
      ]);
      setSharedEvents(shared.data);
      setDeptEvents(deptEvt.data);
      setDeptTasks(deptT.data);
      setMyTasks(mine.data);
      setCompletedTasks(done.data);
      setInbox(inboxRes.data);
      setSent(sentRes.data);
      setUsers(usersRes.data);
      setDepartments(deptRes.data);
      setRequests(reqRes.data);
      setAccessGrants(grantsRes.data);
      setSharedTasks(allTasksRes.data);
      setActivityLog(activityRes.data ?? []);
      setDonors(donorsRes.data ?? []);
      setDonations(donationsRes.data ?? []);
      setVolunteers(volunteersRes.data ?? []);
      setCampaigns(campaignsRes.data ?? []);
      setProjects(projectsRes.data ?? []);
      setBeneficiaries(beneficiariesRes.data ?? []);
      setOverviewReport(overviewRes.data);
      setProgramsReport(programsRes.data);
      setFundraisingReport(fundraisingRes.data);
      setPerformanceReport(performanceRes.data ?? []);
      let deptIdToUse = resourceDeptId || (user.department_id ? String(user.department_id) : "");
      if (!deptIdToUse && deptRes.data.length > 0) {
        deptIdToUse = String(deptRes.data[0].id);
      }
      if (deptIdToUse) {
        setResourceDeptId(deptIdToUse);
        const resList = await api.get<Resource[]>(`/resources/department/${deptIdToUse}`);
        setDeptResources(resList.data);
      } else {
        setDeptResources([]);
      }
    } catch {
      Alert.alert("Error", "Could not load dashboards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const loadDrafts = async () => {
      const saved = await AsyncStorage.getItem("message_drafts");
      if (saved) {
        setDrafts(JSON.parse(saved));
      }
    };
    void loadDrafts();
  }, []);

  const setStatus = async (taskId: number, status: TaskStatus) => {
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      await loadAll();
    } catch {
      Alert.alert("Unable to update task");
    }
  };

  const deleteTask = async (taskId: number) => {
    try {
      await api.delete(`/tasks/${taskId}`);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete task", err?.response?.data?.detail ?? "");
    }
  };

  const createTask = async () => {
    if (!taskForm.title || !taskForm.start_date || !taskForm.end_date || !taskForm.department_id || !taskForm.assigned_to_id) {
      Alert.alert("Missing fields", "Title, dates, department, and assignee are required.");
      return;
    }
    try {
      await api.post("/tasks", {
        ...taskForm,
        department_id: Number(taskForm.department_id),
        assigned_to_id: Number(taskForm.assigned_to_id),
      });
      setTaskForm({ title: "", description: "", start_date: "", end_date: "", department_id: "", assigned_to_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create task", err?.response?.data?.detail ?? "");
    }
  };

  const createUser = async () => {
    if (!userForm.email || !userForm.password || !userForm.full_name) {
      Alert.alert("Missing fields", "Name, email, and password are required.");
      return;
    }
    try {
      await api.post("/users", {
        full_name: userForm.full_name,
        email: userForm.email,
        password: userForm.password,
        role: userForm.role,
        department_id: userForm.department_id ? Number(userForm.department_id) : null,
        active: true,
      });
      setUserForm({ full_name: "", email: "", password: "", role: "staff", department_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create user", err?.response?.data?.detail ?? "");
    }
  };

  const updateExistingUser = async () => {
    if (!editUserId) {
      Alert.alert("Select a user first");
      return;
    }
    const payload: any = {};
    if (userForm.full_name) payload.full_name = userForm.full_name;
    if (userForm.role) payload.role = userForm.role;
    if (userForm.password) payload.password = userForm.password;
    if (userForm.department_id) payload.department_id = Number(userForm.department_id);
    if (typeof userForm.role === "string") payload.role = userForm.role;
    try {
      await api.patch(`/users/${editUserId}`, payload);
      Alert.alert("Updated", "User updated");
      setUserForm({ full_name: "", email: "", password: "", role: "staff", department_id: "" });
      setEditUserId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to update user", err?.response?.data?.detail ?? "");
    }
  };

  const deleteExistingUser = async (userId: number) => {
    try {
      await api.delete(`/users/${userId}`);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete user", err?.response?.data?.detail ?? "");
    }
  };

  const sendMessage = async () => {
    if (!messageForm.subject || !messageForm.body) {
      Alert.alert("Missing fields", "Subject and body are required.");
      return;
    }
    try {
      await api.post("/messages", {
        subject: messageForm.subject,
        body: messageForm.body,
        recipient_id: messageForm.recipient_id ? Number(messageForm.recipient_id) : null,
        department_id: messageForm.department_id ? Number(messageForm.department_id) : null,
      });
      setMessageForm({ subject: "", body: "", recipient_id: "", department_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to send message", err?.response?.data?.detail ?? "");
    }
  };

  const logPerformance = async () => {
    if (!perfForm.user_id || !perfForm.score) {
      Alert.alert("Missing fields", "User and score are required.");
      return;
    }
    try {
      await api.post("/performance", {
        user_id: Number(perfForm.user_id),
        task_id: perfForm.task_id ? Number(perfForm.task_id) : null,
        score: Number(perfForm.score),
        note: perfForm.note,
      });
      setPerfForm({ user_id: "", task_id: "", score: "", note: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to log performance", err?.response?.data?.detail ?? "");
    }
  };

  const submitRequest = async () => {
    if (!requestForm.type) {
      Alert.alert("Missing fields", "Type is required.");
      return;
    }
    try {
      await api.post("/requests", {
        type: requestForm.type,
        payload: requestForm.payload,
        department_id: requestForm.department_id ? Number(requestForm.department_id) : undefined,
      });
      setRequestForm({ type: "", payload: "", department_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to submit request", err?.response?.data?.detail ?? "");
    }
  };

  const submitLeaveRequest = async () => {
    if (!leaveForm.start_date || !leaveForm.end_date || !leaveForm.reason) {
      Alert.alert("Missing fields", "Dates and reason are required.");
      return;
    }
    try {
      await api.post("/workflows/leave", {
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        reason: leaveForm.reason,
        coverage_plan: leaveForm.coverage_plan || undefined,
        contact: leaveForm.contact || undefined,
      });
      setLeaveForm({ start_date: "", end_date: "", reason: "", coverage_plan: "", contact: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to submit leave request", err?.response?.data?.detail ?? "");
    }
  };

  const submitProcurementRequest = async () => {
    if (!procurementForm.item || !procurementForm.quantity || !procurementForm.estimated_cost) {
      Alert.alert("Missing fields", "Item, quantity, and cost are required.");
      return;
    }
    try {
      await api.post("/workflows/procurement", {
        item: procurementForm.item,
        quantity: Number(procurementForm.quantity),
        estimated_cost: Number(procurementForm.estimated_cost),
        vendor: procurementForm.vendor || undefined,
        justification: procurementForm.justification || undefined,
      });
      setProcurementForm({ item: "", quantity: "1", estimated_cost: "", vendor: "", justification: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to submit procurement request", err?.response?.data?.detail ?? "");
    }
  };

  const submitTravelRequest = async () => {
    if (!travelForm.destination || !travelForm.start_date || !travelForm.end_date || !travelForm.purpose) {
      Alert.alert("Missing fields", "Destination, dates, and purpose are required.");
      return;
    }
    try {
      await api.post("/workflows/travel", {
        destination: travelForm.destination,
        start_date: travelForm.start_date,
        end_date: travelForm.end_date,
        purpose: travelForm.purpose,
        estimated_cost: travelForm.estimated_cost ? Number(travelForm.estimated_cost) : 0,
        advance_needed: travelForm.advance_needed,
      });
      setTravelForm({ destination: "", start_date: "", end_date: "", purpose: "", estimated_cost: "", advance_needed: false });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to submit travel request", err?.response?.data?.detail ?? "");
    }
  };

  const updateRequestStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/requests/${id}`, { status });
      await loadAll();
      if (selectedRequestId === id) {
        await loadRequestAudits(id);
      }
    } catch (err: any) {
      Alert.alert("Unable to update request", err?.response?.data?.detail ?? "");
    }
  };

  const loadRequestAttachments = async (requestId: number) => {
    setRequestDetailsLoading(true);
    try {
      const res = await api.get<RequestAttachment[]>(`/requests/${requestId}/attachments`);
      setRequestAttachments(res.data);
    } catch (err: any) {
      Alert.alert("Unable to load request files", err?.response?.data?.detail ?? "");
    } finally {
      setRequestDetailsLoading(false);
    }
  };

  const loadRequestAudits = async (requestId: number) => {
    try {
      const res = await api.get<RequestAudit[]>(`/requests/${requestId}/audit`);
      setRequestAudits(res.data);
    } catch (err: any) {
      Alert.alert("Unable to load audit trail", err?.response?.data?.detail ?? "");
    }
  };

  const uploadRequestAttachment = async () => {
    if (!selectedRequestId) return;
    setRequestUploadBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const form = new FormData();
      form.append("file", { uri: asset.uri, name: asset.name || "upload", type: asset.mimeType || "application/octet-stream" } as any);
      await api.post(`/requests/${selectedRequestId}/attachments`, form, { headers: { "Content-Type": "multipart/form-data" } });
      await loadRequestAttachments(selectedRequestId);
    } catch (err: any) {
      Alert.alert("Unable to upload file", err?.response?.data?.detail ?? "");
    } finally {
      setRequestUploadBusy(false);
    }
  };

  const downloadRequestAttachment = async (file: RequestAttachment) => {
    if (Platform.OS !== "web" || typeof document === "undefined" || typeof URL === "undefined") {
      Alert.alert("Download", "Downloads are available on web.");
      return;
    }
    try {
      const res = await api.get(`/requests/attachments/${file.id}/download`, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      Alert.alert("Unable to download file", err?.response?.data?.detail ?? "");
    }
  };

  const sendRequestResponse = async () => {
    if (!selectedRequestId) return;
    if (!requestResponse.subject && !requestResponse.body) {
      Alert.alert("Missing fields", "Subject or body is required.");
      return;
    }
    setRequestBusy(true);
    try {
      await api.post(`/requests/${selectedRequestId}/respond`, {
        subject: requestResponse.subject || "Request response",
        body: requestResponse.body || "",
        status: requestStatusUpdate || undefined,
      });
      setRequestResponse({ subject: "", body: "" });
      setRequestStatusUpdate("");
      await loadAll();
      await loadRequestAudits(selectedRequestId);
    } catch (err: any) {
      Alert.alert("Unable to send response", err?.response?.data?.detail ?? "");
    } finally {
      setRequestBusy(false);
    }
  };

  const createGrant = async () => {
    if (!grantForm.user_id || !grantForm.resource_type || !grantForm.resource_id || !grantForm.permission) {
      Alert.alert("Missing fields", "User, resource, and permission are required.");
      return;
    }
    try {
      await api.post("/access-grants", {
        user_id: Number(grantForm.user_id),
        resource_type: grantForm.resource_type,
        resource_id: grantForm.resource_id,
        permission: grantForm.permission,
        department_id: grantForm.department_id ? Number(grantForm.department_id) : undefined,
      });
      setGrantForm({ user_id: "", resource_type: "", resource_id: "", permission: "", department_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create grant", err?.response?.data?.detail ?? "");
    }
  };
  const createEvent = async () => {
    if (!eventForm.title || !eventForm.scheduled_at) {
      Alert.alert("Missing fields", "Title and schedule are required.");
      return;
    }
    try {
      await api.post("/events", {
        title: eventForm.title,
        description: eventForm.description,
        scheduled_at: eventForm.scheduled_at,
        department_id: eventForm.department_id ? Number(eventForm.department_id) : null,
      });
      setEventForm({ title: "", description: "", scheduled_at: "", department_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create event", err?.response?.data?.detail ?? "");
    }
  };

  const createMeeting = async () => {
    if (!meetingForm.title || !meetingForm.scheduled_at) {
      Alert.alert("Missing fields", "Title and schedule are required.");
      return;
    }
    try {
      await api.post("/meetings", {
        title: meetingForm.title,
        description: meetingForm.description,
        scheduled_at: meetingForm.scheduled_at,
        department_id: meetingForm.department_id ? Number(meetingForm.department_id) : null,
      });
      setMeetingForm({ title: "", description: "", scheduled_at: "", department_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to schedule meeting", err?.response?.data?.detail ?? "");
    }
  };

  const saveDepartment = async () => {
    if (!departmentForm.name) {
      Alert.alert("Missing fields", "Department name is required.");
      return;
    }
    try {
      if (editingDepartmentId) {
        await api.patch(`/departments/${editingDepartmentId}`, {
          name: departmentForm.name,
          description: departmentForm.description || undefined,
        });
      } else {
        await api.post("/departments", {
          name: departmentForm.name,
          description: departmentForm.description || undefined,
        });
      }
      setDepartmentForm({ name: "", description: "" });
      setEditingDepartmentId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to save department", err?.response?.data?.detail ?? "");
    }
  };

  const startDepartmentEdit = (dept: Department) => {
    setEditingDepartmentId(dept.id);
    setDepartmentForm({ name: dept.name, description: dept.description || "" });
    setShowDepartmentForm(true);
  };

  const cancelDepartmentEdit = () => {
    setEditingDepartmentId(null);
    setDepartmentForm({ name: "", description: "" });
  };

  const createDonor = async () => {
    if (!donorForm.name) {
      Alert.alert("Missing fields", "Donor name is required.");
      return;
    }
    try {
      await api.post("/donors", {
        name: donorForm.name,
        email: donorForm.email || undefined,
        phone: donorForm.phone || undefined,
        address: donorForm.address || undefined,
      });
      setDonorForm({ name: "", email: "", phone: "", address: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create donor", err?.response?.data?.detail ?? "");
    }
  };

  const createDonation = async () => {
    if (!donationForm.donor_id || !donationForm.amount) {
      Alert.alert("Missing fields", "Donor and amount are required.");
      return;
    }
    try {
      await api.post("/donations", {
        donor_id: Number(donationForm.donor_id),
        amount: Number(donationForm.amount),
        currency: donationForm.currency || "USD",
        method: donationForm.method || undefined,
        recurring: donationForm.recurring,
        note: donationForm.note || undefined,
      });
      setDonationForm({ donor_id: "", amount: "", currency: "USD", method: "", recurring: false, note: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create donation", err?.response?.data?.detail ?? "");
    }
  };

  const createCampaign = async () => {
    if (!campaignForm.name) {
      Alert.alert("Missing fields", "Campaign name is required.");
      return;
    }
    try {
      await api.post("/campaigns", {
        name: campaignForm.name,
        goal_amount: campaignForm.goal_amount ? Number(campaignForm.goal_amount) : undefined,
        description: campaignForm.description || undefined,
        start_date: campaignForm.start_date || undefined,
        end_date: campaignForm.end_date || undefined,
      });
      setCampaignForm({ name: "", goal_amount: "", description: "", start_date: "", end_date: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create campaign", err?.response?.data?.detail ?? "");
    }
  };

  const createProject = async () => {
    if (!projectForm.name) {
      Alert.alert("Missing fields", "Project name is required.");
      return;
    }
    try {
      await api.post("/projects", {
        name: projectForm.name,
        description: projectForm.description || undefined,
        budget: projectForm.budget ? Number(projectForm.budget) : undefined,
        progress: projectForm.progress || undefined,
        start_date: projectForm.start_date || undefined,
        end_date: projectForm.end_date || undefined,
      });
      setProjectForm({ name: "", description: "", budget: "", progress: "", start_date: "", end_date: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create project", err?.response?.data?.detail ?? "");
    }
  };

  const createBeneficiary = async () => {
    if (!beneficiaryForm.name) {
      Alert.alert("Missing fields", "Beneficiary name is required.");
      return;
    }
    try {
      await api.post("/beneficiaries", {
        name: beneficiaryForm.name,
        contact: beneficiaryForm.contact || undefined,
        notes: beneficiaryForm.notes || undefined,
        project_id: beneficiaryForm.project_id ? Number(beneficiaryForm.project_id) : undefined,
      });
      setBeneficiaryForm({ name: "", contact: "", notes: "", project_id: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create beneficiary", err?.response?.data?.detail ?? "");
    }
  };

  const createVolunteer = async () => {
    if (!volunteerForm.name) {
      Alert.alert("Missing fields", "Volunteer name is required.");
      return;
    }
    try {
      await api.post("/volunteers", {
        name: volunteerForm.name,
        email: volunteerForm.email || undefined,
        phone: volunteerForm.phone || undefined,
        skills: volunteerForm.skills || undefined,
        hours: volunteerForm.hours ? Number(volunteerForm.hours) : 0,
        active: true,
      });
      setVolunteerForm({ name: "", email: "", phone: "", skills: "", hours: "0" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to create volunteer", err?.response?.data?.detail ?? "");
    }
  };

  const normalizeDateInput = (value?: string | null) => (value ? value.split("T")[0] : "");

  const startProjectEdit = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectEdit({
      name: project.name,
      description: project.description || "",
      budget: project.budget ? String(project.budget) : "",
      progress: project.progress || "",
      start_date: normalizeDateInput(project.start_date),
      end_date: normalizeDateInput(project.end_date),
    });
  };

  const saveProjectEdit = async () => {
    if (!editingProjectId) return;
    try {
      await api.patch(`/projects/${editingProjectId}`, {
        name: projectEdit.name || undefined,
        description: projectEdit.description || undefined,
        budget: projectEdit.budget ? Number(projectEdit.budget) : undefined,
        progress: projectEdit.progress || undefined,
        start_date: projectEdit.start_date || undefined,
        end_date: projectEdit.end_date || undefined,
      });
      setEditingProjectId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to update project", err?.response?.data?.detail ?? "");
    }
  };

  const startBeneficiaryEdit = (beneficiary: Beneficiary) => {
    setEditingBeneficiaryId(beneficiary.id);
    setBeneficiaryEdit({
      name: beneficiary.name,
      contact: beneficiary.contact || "",
      notes: beneficiary.notes || "",
      project_id: beneficiary.project_id ? String(beneficiary.project_id) : "",
    });
  };

  const saveBeneficiaryEdit = async () => {
    if (!editingBeneficiaryId) return;
    try {
      await api.patch(`/beneficiaries/${editingBeneficiaryId}`, {
        name: beneficiaryEdit.name || undefined,
        contact: beneficiaryEdit.contact || undefined,
        notes: beneficiaryEdit.notes || undefined,
        project_id: beneficiaryEdit.project_id ? Number(beneficiaryEdit.project_id) : undefined,
      });
      setEditingBeneficiaryId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to update beneficiary", err?.response?.data?.detail ?? "");
    }
  };

  const startCampaignEdit = (campaign: Campaign) => {
    setEditingCampaignId(campaign.id);
    setCampaignEdit({
      name: campaign.name,
      goal_amount: campaign.goal_amount ? String(campaign.goal_amount) : "",
      description: campaign.description || "",
      start_date: normalizeDateInput(campaign.start_date),
      end_date: normalizeDateInput(campaign.end_date),
    });
  };

  const saveCampaignEdit = async () => {
    if (!editingCampaignId) return;
    try {
      await api.patch(`/campaigns/${editingCampaignId}`, {
        name: campaignEdit.name || undefined,
        goal_amount: campaignEdit.goal_amount ? Number(campaignEdit.goal_amount) : undefined,
        description: campaignEdit.description || undefined,
        start_date: campaignEdit.start_date || undefined,
        end_date: campaignEdit.end_date || undefined,
      });
      setEditingCampaignId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to update campaign", err?.response?.data?.detail ?? "");
    }
  };

  const startDonorEdit = (donor: Donor) => {
    setEditingDonorId(donor.id);
    setDonorEdit({
      name: donor.name,
      email: donor.email || "",
      phone: donor.phone || "",
      address: donor.address || "",
    });
  };

  const saveDonorEdit = async () => {
    if (!editingDonorId) return;
    try {
      await api.patch(`/donors/${editingDonorId}`, {
        name: donorEdit.name || undefined,
        email: donorEdit.email || undefined,
        phone: donorEdit.phone || undefined,
        address: donorEdit.address || undefined,
      });
      setEditingDonorId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to update donor", err?.response?.data?.detail ?? "");
    }
  };

  const startDonationEdit = (donation: Donation) => {
    setEditingDonationId(donation.id);
    setDonationEdit({
      donor_id: String(donation.donor_id),
      amount: String(donation.amount),
      currency: donation.currency,
      method: donation.method || "",
      recurring: donation.recurring,
      note: donation.note || "",
    });
  };

  const saveDonationEdit = async () => {
    if (!editingDonationId) return;
    try {
      await api.patch(`/donations/${editingDonationId}`, {
        donor_id: donationEdit.donor_id ? Number(donationEdit.donor_id) : undefined,
        amount: donationEdit.amount ? Number(donationEdit.amount) : undefined,
        currency: donationEdit.currency || undefined,
        method: donationEdit.method || undefined,
        recurring: donationEdit.recurring,
        note: donationEdit.note || undefined,
      });
      setEditingDonationId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to update donation", err?.response?.data?.detail ?? "");
    }
  };

  const deleteProject = async (project: Project) => {
    try {
      await api.delete(`/projects/${project.id}`);
      if (expandedProjectId === project.id) setExpandedProjectId(null);
      if (editingProjectId === project.id) setEditingProjectId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete project", err?.response?.data?.detail ?? "");
    }
  };

  const deleteBeneficiary = async (beneficiary: Beneficiary) => {
    try {
      await api.delete(`/beneficiaries/${beneficiary.id}`);
      if (expandedBeneficiaryId === beneficiary.id) setExpandedBeneficiaryId(null);
      if (editingBeneficiaryId === beneficiary.id) setEditingBeneficiaryId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete beneficiary", err?.response?.data?.detail ?? "");
    }
  };

  const deleteCampaign = async (campaign: Campaign) => {
    try {
      await api.delete(`/campaigns/${campaign.id}`);
      if (expandedCampaignId === campaign.id) setExpandedCampaignId(null);
      if (editingCampaignId === campaign.id) setEditingCampaignId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete campaign", err?.response?.data?.detail ?? "");
    }
  };

  const deleteDonor = async (donor: Donor) => {
    try {
      await api.delete(`/donors/${donor.id}`);
      if (expandedDonorId === donor.id) setExpandedDonorId(null);
      if (editingDonorId === donor.id) setEditingDonorId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete donor", err?.response?.data?.detail ?? "");
    }
  };

  const deleteDonation = async (donation: Donation) => {
    try {
      await api.delete(`/donations/${donation.id}`);
      if (expandedDonationId === donation.id) setExpandedDonationId(null);
      if (editingDonationId === donation.id) setEditingDonationId(null);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete donation", err?.response?.data?.detail ?? "");
    }
  };

  const downloadCsv = async (dataset: string, filename: string, params?: { start_date?: string; end_date?: string }) => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      Alert.alert("Export unavailable", "CSV export is available on web.");
      return;
    }
    try {
      const res = await api.get(`/reports/exports/${dataset}`, { responseType: "blob", params });
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      Alert.alert("Unable to export", err?.response?.data?.detail ?? "");
    }
  };

  const deleteEvent = async (eventId: number) => {
    try {
      await api.delete(`/events/${eventId}`);
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to delete event", err?.response?.data?.detail ?? "");
    }
  };

  const sendTaskToAdmin = async (taskId: number) => {
    try {
      await api.post(`/tasks/${taskId}/send-to-admin`);
      Alert.alert("Sent", "Task sent to admin for review.");
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to send to admin", err?.response?.data?.detail ?? "");
    }
  };

  const queueExternalEmail = async () => {
    if (!emailForm.to_email || !emailForm.subject) {
      Alert.alert("Missing fields", "Email and subject are required.");
      return;
    }
    try {
      await api.post("/messages/email", emailForm);
      setEmailForm({ to_email: "", subject: "", body: "" });
      Alert.alert("Queued", "Email queued for delivery");
    } catch (err: any) {
      Alert.alert("Unable to queue email", err?.response?.data?.detail ?? "");
    }
  };

  const saveDraft = async () => {
    if (!messageForm.subject && !messageForm.body) {
      Alert.alert("Nothing to save");
      return;
    }
    const nextDrafts = [...drafts, { subject: messageForm.subject, body: messageForm.body, recipient_id: messageForm.recipient_id, department_id: messageForm.department_id }];
    setDrafts(nextDrafts);
    await AsyncStorage.setItem("message_drafts", JSON.stringify(nextDrafts));
    Alert.alert("Draft saved");
  };

  const clearDrafts = async () => {
    setDrafts([]);
    await AsyncStorage.removeItem("message_drafts");
  };

  const logAdminActivity = async () => {
    if (!adminLogForm.action) {
      Alert.alert("Missing fields", "Action is required.");
      return;
    }
    try {
      await api.post("/activity", { action: adminLogForm.action, detail: adminLogForm.detail });
      setAdminLogForm({ action: "", detail: "" });
      await loadAll();
    } catch (err: any) {
      Alert.alert("Unable to log admin activity", err?.response?.data?.detail ?? "");
    }
  };

  const refreshDeptResources = async () => {
    if (!resourceDeptId) {
      setDeptResources([]);
      return;
    }
    try {
      const resList = await api.get<Resource[]>(`/resources/department/${resourceDeptId}`);
      setDeptResources(resList.data);
    } catch {
      Alert.alert("Unable to load department resources");
    }
  };

  useEffect(() => {
    void refreshDeptResources();
  }, [resourceDeptId]);

  const RolePicker = ({ value, onChange }: { value: Role; onChange: (next: Role) => void }) => (
    <View style={styles.row}>
      {roleOptions.map((role) => {
        const active = role === value;
        return (
          <TouchableOpacity key={role} style={[styles.chip, active && styles.chipActive]} onPress={() => onChange(role)}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{role}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const UserPicker = ({
    label,
    selectedId,
    onSelect,
    allowClear = false,
    placeholder = "Search user by name or email",
  }: {
    label: string;
    selectedId: number | null;
    onSelect: (next: User | null) => void;
    allowClear?: boolean;
    placeholder?: string;
  }) => {
    const [query, setQuery] = useState("");
    const [showAll, setShowAll] = useState(false);
    const matches = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return users
        .filter((u) => `${u.full_name} ${u.email} ${u.role}`.toLowerCase().includes(q))
        .slice(0, 6);
    }, [query, users]);
    useEffect(() => {
      if (query.trim()) setShowAll(false);
    }, [query]);
    const selected = users.find((u) => u.id === selectedId);
    const options = showAll ? users : matches;
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>{label}</Text>
        {selected ? <Text style={styles.meta}>Selected: {selected.full_name} ({selected.role})</Text> : null}
        <TextInput style={styles.input} placeholder={placeholder} value={query} onChangeText={setQuery} autoCapitalize="none" />
        <View style={styles.row}>
          <TouchableOpacity style={styles.linkButton} onPress={() => setShowAll((prev) => !prev)}>
            <Text style={styles.linkButtonText}>{showAll ? "Hide users" : "Browse users"}</Text>
          </TouchableOpacity>
        </View>
        {options.length > 0 && (
          <View style={styles.selectList}>
            {options.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.selectItem}
                onPress={() => {
                  onSelect(u);
                  setQuery("");
                  setShowAll(false);
                }}
              >
                <Text style={styles.selectItemText}>
                  {u.full_name} ({u.role}) - {u.email}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {allowClear && selectedId ? (
          <TouchableOpacity style={styles.linkButton} onPress={() => onSelect(null)}>
            <Text style={styles.linkButtonText}>Clear selection</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const DepartmentPicker = ({
    label,
    selectedId,
    onSelect,
    allowClear = false,
    placeholder = "Search department",
  }: {
    label: string;
    selectedId: number | null;
    onSelect: (next: Department | null) => void;
    allowClear?: boolean;
    placeholder?: string;
  }) => {
    const [query, setQuery] = useState("");
    const matches = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
        return departments
          .filter((d) => `${d.name} ${d.description ?? ""} ${d.id}`.toLowerCase().includes(q))
          .slice(0, 6);
    }, [query, departments]);
    const selected = departments.find((d) => d.id === selectedId);
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>{label}</Text>
        {selected ? <Text style={styles.meta}>Selected: {selected.name}</Text> : null}
        <TextInput style={styles.input} placeholder={placeholder} value={query} onChangeText={setQuery} autoCapitalize="none" />
        {matches.length > 0 && (
          <View style={styles.selectList}>
            {matches.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={styles.selectItem}
                onPress={() => {
                  onSelect(d);
                  setQuery("");
                }}
              >
                <Text style={styles.selectItemText}>
                  {d.name} (#{d.id})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {allowClear && selectedId ? (
          <TouchableOpacity style={styles.linkButton} onPress={() => onSelect(null)}>
            <Text style={styles.linkButtonText}>Clear selection</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const DonorPicker = ({
    label,
    selectedId,
    onSelect,
    allowClear = false,
    placeholder = "Search donor by name or email",
  }: {
    label: string;
    selectedId: number | null;
    onSelect: (next: Donor | null) => void;
    allowClear?: boolean;
    placeholder?: string;
  }) => {
    const [query, setQuery] = useState("");
    const matches = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return donors
        .filter((d) => `${d.name} ${d.email ?? ""} ${d.phone ?? ""}`.toLowerCase().includes(q))
        .slice(0, 6);
    }, [query, donors]);
    const selected = donors.find((d) => d.id === selectedId);
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>{label}</Text>
        {selected ? <Text style={styles.meta}>Selected: {selected.name}</Text> : null}
        <TextInput style={styles.input} placeholder={placeholder} value={query} onChangeText={setQuery} autoCapitalize="none" />
        {matches.length > 0 && (
          <View style={styles.selectList}>
            {matches.map((d) => (
              <TouchableOpacity
                key={d.id}
                style={styles.selectItem}
                onPress={() => {
                  onSelect(d);
                  setQuery("");
                }}
              >
                <Text style={styles.selectItemText}>
                  {d.name} ({d.email || "no email"})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {allowClear && selectedId ? (
          <TouchableOpacity style={styles.linkButton} onPress={() => onSelect(null)}>
            <Text style={styles.linkButtonText}>Clear selection</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const ProjectPicker = ({
    label,
    selectedId,
    onSelect,
    allowClear = false,
    placeholder = "Search project",
  }: {
    label: string;
    selectedId: number | null;
    onSelect: (next: Project | null) => void;
    allowClear?: boolean;
    placeholder?: string;
  }) => {
    const [query, setQuery] = useState("");
    const matches = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return projects
        .filter((p) => `${p.name} ${p.progress ?? ""}`.toLowerCase().includes(q))
        .slice(0, 6);
    }, [query, projects]);
    const selected = projects.find((p) => p.id === selectedId);
    return (
      <View style={{ marginBottom: 8 }}>
        <Text style={styles.label}>{label}</Text>
        {selected ? <Text style={styles.meta}>Selected: {selected.name}</Text> : null}
        <TextInput style={styles.input} placeholder={placeholder} value={query} onChangeText={setQuery} autoCapitalize="none" />
        {matches.length > 0 && (
          <View style={styles.selectList}>
            {matches.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.selectItem}
                onPress={() => {
                  onSelect(p);
                  setQuery("");
                }}
              >
                <Text style={styles.selectItemText}>
                  {p.name} ({p.progress || "no status"})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {allowClear && selectedId ? (
          <TouchableOpacity style={styles.linkButton} onPress={() => onSelect(null)}>
            <Text style={styles.linkButtonText}>Clear selection</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const TaskList = ({ tasks }: { tasks: Task[] }) => (
    <View>
      {tasks.map((task) => {
        const overdue = task.status !== "done" && new Date(task.end_date) < new Date();
        return (
          <TouchableOpacity key={task.id} style={[styles.card, overdue && styles.cardOverdue]} onPress={() => navigation.navigate("Task", { taskId: task.id })}>
            <Text style={styles.cardTitle}>{task.title}</Text>
            {task.description ? <Text style={styles.cardBody}>{task.description}</Text> : null}
            <Text style={styles.meta}>Start: {formatDate(task.start_date)} - End: {formatDate(task.end_date)}</Text>
            <Text style={[styles.meta, overdue && styles.metaOverdue]}>
              Status: {task.status}
              {overdue ? " (overdue)" : ""}
            </Text>
            {task.completed_at ? <Text style={styles.meta}>Completed: {formatDate(task.completed_at)}</Text> : null}
            {task.status !== "done" && (
              <View style={styles.row}>
                <TouchableOpacity style={styles.button} onPress={() => setStatus(task.id, "in_progress")}>
                  <Text style={styles.buttonText}>Start</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => setStatus(task.id, "done")}>
                  <Text style={styles.buttonText}>Complete</Text>
                </TouchableOpacity>
                {(isAdmin || isManager || task.assigned_to_id === user.id) && (
                  <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => deleteTask(task.id)}>
                    <Text style={styles.buttonText}>Delete</Text>
                  </TouchableOpacity>
                )}
                {!isAdmin && (
                  <TouchableOpacity style={styles.button} onPress={() => sendTaskToAdmin(task.id)}>
                    <Text style={styles.buttonText}>Send to admin</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const EventList = ({ events }: { events: Event[] }) => (
    <View>
      {events.map((evt) => (
        <View key={evt.id} style={styles.card}>
          <Text style={styles.cardTitle}>{evt.title}</Text>
          {evt.description ? <Text style={styles.cardBody}>{evt.description}</Text> : null}
          <Text style={styles.meta}>Scheduled: {formatDate(evt.scheduled_at)}</Text>
          {(isAdmin || isManager) && (
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => deleteEvent(evt.id)}>
                <Text style={styles.buttonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const MessageList = ({ items }: { items: Message[] }) => (
    <View>
      {items.map((msg) => (
        <View key={msg.id} style={styles.card}>
          <Text style={styles.cardTitle}>{msg.subject}</Text>
          <Text style={styles.cardBody}>{msg.body}</Text>
          <Text style={styles.meta}>From: {getUserName(msg.sender_id)} - To: {msg.recipient_id ? getUserName(msg.recipient_id) : "All"}</Text>
          <Text style={styles.meta}>At: {formatDate(msg.created_at)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ERP System</Text>
          <Text style={styles.subtitle}>NGO workspace - {user.full_name} ({user.role}) - {getDepartmentName(user.department_id)}</Text>
          <Text style={styles.apiHint}>API: {DISPLAY_API_URL}</Text>
          <Text style={styles.apiHint}>
            Status: {apiStatus === "ok" ? "connected" : apiStatus === "error" ? `error${apiError ? ` (${apiError})` : ""}` : "checking..."}
          </Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={onCheckHealth}>
              <Text style={styles.buttonText}>Test API</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={onLogout}>
              <Text style={styles.buttonText}>Reset session</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Button title="Logout" onPress={onLogout} />
      </View>

      <View style={styles.tabs}>
        <Tab label="Shared" active={activeTab === "shared"} onPress={() => setActiveTab("shared")} />
        <Tab label="Department" active={activeTab === "department"} onPress={() => setActiveTab("department")} />
        <Tab label="My Tasks" active={activeTab === "my"} onPress={() => setActiveTab("my")} />
        <Tab label="Completed" active={activeTab === "completed"} onPress={() => setActiveTab("completed")} />
        <Tab label="Programs" active={activeTab === "programs"} onPress={() => setActiveTab("programs")} />
        <Tab label="Fundraising" active={activeTab === "fundraising"} onPress={() => setActiveTab("fundraising")} />
        <Tab label="Messages" active={activeTab === "messages"} onPress={() => setActiveTab("messages")} />
        <Tab label="Requests" active={activeTab === "requests"} onPress={() => setActiveTab("requests")} />
        {canManageNgo && <Tab label="People" active={activeTab === "people"} onPress={() => setActiveTab("people")} />}
        {canManageNgo && <Tab label="Reports" active={activeTab === "reports"} onPress={() => setActiveTab("reports")} />}
        {canManageNgo && <Tab label="Admin" active={activeTab === "admin"} onPress={() => setActiveTab("admin")} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {activeTab === "shared" && (
          <>
            {isAdmin && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Create shared/any task</Text>
                  <Button title={showSharedTaskForm ? "Hide" : "Show"} onPress={() => setShowSharedTaskForm(!showSharedTaskForm)} />
                </View>
                {showSharedTaskForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Title" value={taskForm.title} onChangeText={(v) => setTaskForm({ ...taskForm, title: v })} />
                    <TextInput style={styles.input} placeholder="Description" value={taskForm.description} onChangeText={(v) => setTaskForm({ ...taskForm, description: v })} />
                    <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={taskForm.start_date} onChangeText={(v) => setTaskForm({ ...taskForm, start_date: v })} />
                    <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={taskForm.end_date} onChangeText={(v) => setTaskForm({ ...taskForm, end_date: v })} />
                    <DepartmentPicker
                      label="Department"
                      selectedId={taskForm.department_id ? Number(taskForm.department_id) : null}
                      onSelect={(dept) => setTaskForm({ ...taskForm, department_id: dept ? String(dept.id) : "" })}
                    />
                    <UserPicker
                      label="Assignee"
                      selectedId={taskForm.assigned_to_id ? Number(taskForm.assigned_to_id) : null}
                      onSelect={(next) => setTaskForm({ ...taskForm, assigned_to_id: next ? String(next.id) : "" })}
                    />
                    <Button title="Create task" onPress={createTask} />
                  </>
                )}
              </View>
            )}
            <Text style={styles.sectionTitle}>Shared notices</Text>
            <EventList events={sharedEvents} />
            <Text style={styles.sectionTitle}>Shared tasks</Text>
            <TaskList tasks={sharedTasks} />
          </>
        )}

        {activeTab === "department" && (
          <>
            <Text style={styles.sectionTitle}>Department events</Text>
            <EventList events={deptEvents} />
            {(isAdmin || isManager) && (
              <>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.cardTitle}>Create event</Text>
                    <Button title={showEventForm ? "Hide" : "Show"} onPress={() => setShowEventForm(!showEventForm)} />
                  </View>
                  {showEventForm && (
                    <>
                      <TextInput style={styles.input} placeholder="Title" value={eventForm.title} onChangeText={(v) => setEventForm({ ...eventForm, title: v })} />
                      <TextInput style={styles.input} placeholder="Description" value={eventForm.description} onChangeText={(v) => setEventForm({ ...eventForm, description: v })} />
                      <TextInput style={styles.input} placeholder="Scheduled at (YYYY-MM-DD HH:MM)" value={eventForm.scheduled_at} onChangeText={(v) => setEventForm({ ...eventForm, scheduled_at: v })} />
                      <DepartmentPicker
                        label="Department (optional)"
                        selectedId={eventForm.department_id ? Number(eventForm.department_id) : null}
                        onSelect={(dept) => setEventForm({ ...eventForm, department_id: dept ? String(dept.id) : "" })}
                        allowClear
                      />
                      <Button title="Create event" onPress={createEvent} />
                    </>
                  )}
                </View>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.cardTitle}>Schedule meeting</Text>
                    <Button title={showMeetingForm ? "Hide" : "Show"} onPress={() => setShowMeetingForm(!showMeetingForm)} />
                  </View>
                  {showMeetingForm && (
                    <>
                      <TextInput style={styles.input} placeholder="Title" value={meetingForm.title} onChangeText={(v) => setMeetingForm({ ...meetingForm, title: v })} />
                      <TextInput style={styles.input} placeholder="Description" value={meetingForm.description} onChangeText={(v) => setMeetingForm({ ...meetingForm, description: v })} />
                      <TextInput style={styles.input} placeholder="Scheduled at (YYYY-MM-DD HH:MM)" value={meetingForm.scheduled_at} onChangeText={(v) => setMeetingForm({ ...meetingForm, scheduled_at: v })} />
                      <DepartmentPicker
                        label="Department (optional)"
                        selectedId={meetingForm.department_id ? Number(meetingForm.department_id) : null}
                        onSelect={(dept) => setMeetingForm({ ...meetingForm, department_id: dept ? String(dept.id) : "" })}
                        allowClear
                      />
                      <Button title="Schedule meeting" onPress={createMeeting} />
                    </>
                  )}
                </View>
              </>
            )}
            {pinnedRequests.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Pinned admin requests</Text>
                {pinnedRequests.map((r) => (
                  <View key={r.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{r.type}</Text>
                    <Text style={styles.meta}>{getDepartmentName(r.department_id)} - By {getUserName(r.requester_id)}</Text>
                    {r.payload ? <Text style={styles.cardBody}>{r.payload}</Text> : null}
                  </View>
                ))}
              </>
            )}
            <Text style={styles.sectionTitle}>Department tasks</Text>
            <TaskList tasks={deptTasks} />
            {(isAdmin || isManager) && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Create task</Text>
                  <Button title={showDeptTaskForm ? "Hide" : "Show"} onPress={() => setShowDeptTaskForm(!showDeptTaskForm)} />
                </View>
                {showDeptTaskForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Title" value={taskForm.title} onChangeText={(v) => setTaskForm({ ...taskForm, title: v })} />
                    <TextInput style={styles.input} placeholder="Description" value={taskForm.description} onChangeText={(v) => setTaskForm({ ...taskForm, description: v })} />
                    <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={taskForm.start_date} onChangeText={(v) => setTaskForm({ ...taskForm, start_date: v })} />
                    <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={taskForm.end_date} onChangeText={(v) => setTaskForm({ ...taskForm, end_date: v })} />
                    <DepartmentPicker
                      label="Department"
                      selectedId={taskForm.department_id ? Number(taskForm.department_id) : null}
                      onSelect={(dept) => setTaskForm({ ...taskForm, department_id: dept ? String(dept.id) : "" })}
                    />
                    <UserPicker
                      label="Assignee"
                      selectedId={taskForm.assigned_to_id ? Number(taskForm.assigned_to_id) : null}
                      onSelect={(next) => setTaskForm({ ...taskForm, assigned_to_id: next ? String(next.id) : "" })}
                    />
                    <Button title="Create task" onPress={createTask} />
                  </>
                )}
              </View>
            )}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Department resources</Text>
              <DepartmentPicker
                label="Department"
                selectedId={resourceDeptId ? Number(resourceDeptId) : null}
                onSelect={(dept) => setResourceDeptId(dept ? String(dept.id) : "")}
                allowClear
              />
              <Button title="Refresh resources" onPress={refreshDeptResources} />
              {deptResources.map((res) => (
                <Text key={res.id} style={styles.meta}>
                  #{res.id} {res.filename} (owner {res.owner_id})
                </Text>
              ))}
            </View>
          </>
        )}

        {activeTab === "my" && (
          <>
            <Text style={styles.sectionTitle}>My tasks</Text>
            <TaskList tasks={myTasks} />
          </>
        )}

        {activeTab === "completed" && (
          <>
            <Text style={styles.sectionTitle}>Completed tasks</Text>
            <TaskList tasks={completedTasks} />
          </>
        )}

        {activeTab === "programs" && (
          <>
            <Text style={styles.sectionTitle}>Projects</Text>
            {canManageNgo && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Create project</Text>
                  <Button title={showProjectForm ? "Hide" : "Show"} onPress={() => setShowProjectForm(!showProjectForm)} />
                </View>
                {showProjectForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Project name" value={projectForm.name} onChangeText={(v) => setProjectForm({ ...projectForm, name: v })} />
                    <TextInput style={styles.input} placeholder="Description" value={projectForm.description} onChangeText={(v) => setProjectForm({ ...projectForm, description: v })} />
                    <TextInput style={styles.input} placeholder="Budget" value={projectForm.budget} onChangeText={(v) => setProjectForm({ ...projectForm, budget: v })} />
                    <TextInput style={styles.input} placeholder="Progress (planning, in_progress)" value={projectForm.progress} onChangeText={(v) => setProjectForm({ ...projectForm, progress: v })} />
                    <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={projectForm.start_date} onChangeText={(v) => setProjectForm({ ...projectForm, start_date: v })} />
                    <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={projectForm.end_date} onChangeText={(v) => setProjectForm({ ...projectForm, end_date: v })} />
                    <Button title="Create project" onPress={createProject} />
                  </>
                )}
              </View>
            )}
            <TextInput
              style={styles.input}
              placeholder="Search projects"
              value={projectSearch}
              onChangeText={setProjectSearch}
              autoCapitalize="none"
            />
            {filteredProjects.map((p) => {
              const isExpanded = expandedProjectId === p.id;
              const isEditing = editingProjectId === p.id;
              return (
                <View key={p.id} style={styles.card}>
                  <TouchableOpacity
                    onPress={() => {
                      setExpandedProjectId(isExpanded ? null : p.id);
                      if (isExpanded) setEditingProjectId(null);
                    }}
                  >
                    <Text style={styles.cardTitle}>{p.name}</Text>
                    <Text style={styles.meta}>{isExpanded ? "Tap to collapse" : "Tap to expand"}</Text>
                  </TouchableOpacity>
                  {isExpanded && (
                    <>
                      {isEditing ? (
                        <>
                          <TextInput style={styles.input} placeholder="Project name" value={projectEdit.name} onChangeText={(v) => setProjectEdit({ ...projectEdit, name: v })} />
                          <TextInput style={styles.input} placeholder="Description" value={projectEdit.description} onChangeText={(v) => setProjectEdit({ ...projectEdit, description: v })} />
                          <TextInput style={styles.input} placeholder="Budget" value={projectEdit.budget} onChangeText={(v) => setProjectEdit({ ...projectEdit, budget: v })} />
                          <TextInput style={styles.input} placeholder="Progress" value={projectEdit.progress} onChangeText={(v) => setProjectEdit({ ...projectEdit, progress: v })} />
                          <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={projectEdit.start_date} onChangeText={(v) => setProjectEdit({ ...projectEdit, start_date: v })} />
                          <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={projectEdit.end_date} onChangeText={(v) => setProjectEdit({ ...projectEdit, end_date: v })} />
                          <View style={styles.row}>
                            <TouchableOpacity style={styles.button} onPress={saveProjectEdit}>
                              <Text style={styles.buttonText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => setEditingProjectId(null)}>
                              <Text style={styles.buttonText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <>
                          {p.description ? <Text style={styles.cardBody}>{p.description}</Text> : null}
                          <Text style={styles.meta}>Budget: {p.budget ?? "n/a"} - Progress: {p.progress ?? "n/a"}</Text>
                          <Text style={styles.meta}>Start: {formatDate(p.start_date)} - End: {formatDate(p.end_date)}</Text>
                          {canManageNgo && (
                            <View style={styles.row}>
                              <TouchableOpacity style={styles.button} onPress={() => startProjectEdit(p)}>
                                <Text style={styles.buttonText}>Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.button, styles.buttonDanger]}
                                onPress={() => confirmDelete(`project "${p.name}"`, () => deleteProject(p))}
                              >
                                <Text style={styles.buttonText}>Delete</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </>
                      )}
                    </>
                  )}
                </View>
              );
            })}

            <Text style={styles.sectionTitle}>Beneficiaries</Text>
            {canManageNgo && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Add beneficiary</Text>
                  <Button title={showBeneficiaryForm ? "Hide" : "Show"} onPress={() => setShowBeneficiaryForm(!showBeneficiaryForm)} />
                </View>
                {showBeneficiaryForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Beneficiary name" value={beneficiaryForm.name} onChangeText={(v) => setBeneficiaryForm({ ...beneficiaryForm, name: v })} />
                    <TextInput style={styles.input} placeholder="Contact" value={beneficiaryForm.contact} onChangeText={(v) => setBeneficiaryForm({ ...beneficiaryForm, contact: v })} />
                    <TextInput style={[styles.input, { height: 80 }]} placeholder="Notes" multiline value={beneficiaryForm.notes} onChangeText={(v) => setBeneficiaryForm({ ...beneficiaryForm, notes: v })} />
                    <ProjectPicker
                      label="Project (optional)"
                      selectedId={beneficiaryForm.project_id ? Number(beneficiaryForm.project_id) : null}
                      onSelect={(project) => setBeneficiaryForm({ ...beneficiaryForm, project_id: project ? String(project.id) : "" })}
                      allowClear
                    />
                    <Button title="Save beneficiary" onPress={createBeneficiary} />
                  </>
                )}
              </View>
            )}
            <TextInput
              style={styles.input}
              placeholder="Search beneficiaries"
              value={beneficiarySearch}
              onChangeText={setBeneficiarySearch}
              autoCapitalize="none"
            />
            {filteredBeneficiaries.map((b) => {
              const isExpanded = expandedBeneficiaryId === b.id;
              const isEditing = editingBeneficiaryId === b.id;
              return (
                <View key={b.id} style={styles.card}>
                  <TouchableOpacity
                    onPress={() => {
                      setExpandedBeneficiaryId(isExpanded ? null : b.id);
                      if (isExpanded) setEditingBeneficiaryId(null);
                    }}
                  >
                    <Text style={styles.cardTitle}>{b.name}</Text>
                    <Text style={styles.meta}>{isExpanded ? "Tap to collapse" : "Tap to expand"}</Text>
                  </TouchableOpacity>
                  {isExpanded && (
                    <>
                      {isEditing ? (
                        <>
                          <TextInput style={styles.input} placeholder="Beneficiary name" value={beneficiaryEdit.name} onChangeText={(v) => setBeneficiaryEdit({ ...beneficiaryEdit, name: v })} />
                          <TextInput style={styles.input} placeholder="Contact" value={beneficiaryEdit.contact} onChangeText={(v) => setBeneficiaryEdit({ ...beneficiaryEdit, contact: v })} />
                          <TextInput style={[styles.input, { height: 80 }]} placeholder="Notes" multiline value={beneficiaryEdit.notes} onChangeText={(v) => setBeneficiaryEdit({ ...beneficiaryEdit, notes: v })} />
                          <ProjectPicker
                            label="Project (optional)"
                            selectedId={beneficiaryEdit.project_id ? Number(beneficiaryEdit.project_id) : null}
                            onSelect={(project) => setBeneficiaryEdit({ ...beneficiaryEdit, project_id: project ? String(project.id) : "" })}
                            allowClear
                          />
                          <View style={styles.row}>
                            <TouchableOpacity style={styles.button} onPress={saveBeneficiaryEdit}>
                              <Text style={styles.buttonText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => setEditingBeneficiaryId(null)}>
                              <Text style={styles.buttonText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={styles.meta}>Project: {getProjectName(b.project_id)}</Text>
                          {b.contact ? <Text style={styles.meta}>Contact: {b.contact}</Text> : null}
                          {b.notes ? <Text style={styles.cardBody}>{b.notes}</Text> : null}
                          {canManageNgo && (
                            <View style={styles.row}>
                              <TouchableOpacity style={styles.button} onPress={() => startBeneficiaryEdit(b)}>
                                <Text style={styles.buttonText}>Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.button, styles.buttonDanger]}
                                onPress={() => confirmDelete(`beneficiary "${b.name}"`, () => deleteBeneficiary(b))}
                              >
                                <Text style={styles.buttonText}>Delete</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </>
                      )}
                    </>
                  )}
                </View>
              );
            })}
          </>
        )}

        {activeTab === "fundraising" && (
          <>
            <Text style={styles.sectionTitle}>Campaigns</Text>
            {canManageNgo && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Create campaign</Text>
                  <Button title={showCampaignForm ? "Hide" : "Show"} onPress={() => setShowCampaignForm(!showCampaignForm)} />
                </View>
                {showCampaignForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Campaign name" value={campaignForm.name} onChangeText={(v) => setCampaignForm({ ...campaignForm, name: v })} />
                    <TextInput style={styles.input} placeholder="Goal amount" value={campaignForm.goal_amount} onChangeText={(v) => setCampaignForm({ ...campaignForm, goal_amount: v })} />
                    <TextInput style={styles.input} placeholder="Description" value={campaignForm.description} onChangeText={(v) => setCampaignForm({ ...campaignForm, description: v })} />
                    <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={campaignForm.start_date} onChangeText={(v) => setCampaignForm({ ...campaignForm, start_date: v })} />
                    <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={campaignForm.end_date} onChangeText={(v) => setCampaignForm({ ...campaignForm, end_date: v })} />
                    <Button title="Create campaign" onPress={createCampaign} />
                  </>
                )}
              </View>
            )}
            <TextInput
              style={styles.input}
              placeholder="Search campaigns"
              value={campaignSearch}
              onChangeText={setCampaignSearch}
              autoCapitalize="none"
            />
            {filteredCampaigns.map((c) => {
              const isExpanded = expandedCampaignId === c.id;
              const isEditing = editingCampaignId === c.id;
              return (
                <View key={c.id} style={styles.card}>
                  <TouchableOpacity
                    onPress={() => {
                      setExpandedCampaignId(isExpanded ? null : c.id);
                      if (isExpanded) setEditingCampaignId(null);
                    }}
                  >
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    <Text style={styles.meta}>{isExpanded ? "Tap to collapse" : "Tap to expand"}</Text>
                  </TouchableOpacity>
                  {isExpanded && (
                    <>
                      {isEditing ? (
                        <>
                          <TextInput style={styles.input} placeholder="Campaign name" value={campaignEdit.name} onChangeText={(v) => setCampaignEdit({ ...campaignEdit, name: v })} />
                          <TextInput style={styles.input} placeholder="Goal amount" value={campaignEdit.goal_amount} onChangeText={(v) => setCampaignEdit({ ...campaignEdit, goal_amount: v })} />
                          <TextInput style={styles.input} placeholder="Description" value={campaignEdit.description} onChangeText={(v) => setCampaignEdit({ ...campaignEdit, description: v })} />
                          <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={campaignEdit.start_date} onChangeText={(v) => setCampaignEdit({ ...campaignEdit, start_date: v })} />
                          <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={campaignEdit.end_date} onChangeText={(v) => setCampaignEdit({ ...campaignEdit, end_date: v })} />
                          <View style={styles.row}>
                            <TouchableOpacity style={styles.button} onPress={saveCampaignEdit}>
                              <Text style={styles.buttonText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => setEditingCampaignId(null)}>
                              <Text style={styles.buttonText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <>
                          {c.description ? <Text style={styles.cardBody}>{c.description}</Text> : null}
                          <Text style={styles.meta}>Goal: {c.goal_amount ?? "n/a"}</Text>
                          <Text style={styles.meta}>Start: {formatDate(c.start_date)} - End: {formatDate(c.end_date)}</Text>
                          {canManageNgo && (
                            <View style={styles.row}>
                              <TouchableOpacity style={styles.button} onPress={() => startCampaignEdit(c)}>
                                <Text style={styles.buttonText}>Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.button, styles.buttonDanger]}
                                onPress={() => confirmDelete(`campaign "${c.name}"`, () => deleteCampaign(c))}
                              >
                                <Text style={styles.buttonText}>Delete</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </>
                      )}
                    </>
                  )}
                </View>
              );
            })}

            {canManageNgo ? (
              <>
                <Text style={styles.sectionTitle}>Donors</Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.cardTitle}>Add donor</Text>
                    <Button title={showDonorForm ? "Hide" : "Show"} onPress={() => setShowDonorForm(!showDonorForm)} />
                  </View>
                  {showDonorForm && (
                    <>
                      <TextInput style={styles.input} placeholder="Donor name" value={donorForm.name} onChangeText={(v) => setDonorForm({ ...donorForm, name: v })} />
                      <TextInput style={styles.input} placeholder="Email" value={donorForm.email} onChangeText={(v) => setDonorForm({ ...donorForm, email: v })} autoCapitalize="none" />
                      <TextInput style={styles.input} placeholder="Phone" value={donorForm.phone} onChangeText={(v) => setDonorForm({ ...donorForm, phone: v })} />
                      <TextInput style={[styles.input, { height: 80 }]} placeholder="Address" multiline value={donorForm.address} onChangeText={(v) => setDonorForm({ ...donorForm, address: v })} />
                      <Button title="Save donor" onPress={createDonor} />
                    </>
                  )}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Search donors"
                  value={donorSearch}
                  onChangeText={setDonorSearch}
                  autoCapitalize="none"
                />
                {filteredDonors.map((d) => {
                  const isExpanded = expandedDonorId === d.id;
                  const isEditing = editingDonorId === d.id;
                  return (
                    <View key={d.id} style={styles.card}>
                      <TouchableOpacity
                        onPress={() => {
                          setExpandedDonorId(isExpanded ? null : d.id);
                          if (isExpanded) setEditingDonorId(null);
                        }}
                      >
                        <Text style={styles.cardTitle}>{d.name}</Text>
                        <Text style={styles.meta}>{isExpanded ? "Tap to collapse" : "Tap to expand"}</Text>
                      </TouchableOpacity>
                      {isExpanded && (
                        <>
                          {isEditing ? (
                            <>
                              <TextInput style={styles.input} placeholder="Donor name" value={donorEdit.name} onChangeText={(v) => setDonorEdit({ ...donorEdit, name: v })} />
                              <TextInput style={styles.input} placeholder="Email" value={donorEdit.email} onChangeText={(v) => setDonorEdit({ ...donorEdit, email: v })} autoCapitalize="none" />
                              <TextInput style={styles.input} placeholder="Phone" value={donorEdit.phone} onChangeText={(v) => setDonorEdit({ ...donorEdit, phone: v })} />
                              <TextInput style={[styles.input, { height: 80 }]} placeholder="Address" multiline value={donorEdit.address} onChangeText={(v) => setDonorEdit({ ...donorEdit, address: v })} />
                              <View style={styles.row}>
                                <TouchableOpacity style={styles.button} onPress={saveDonorEdit}>
                                  <Text style={styles.buttonText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => setEditingDonorId(null)}>
                                  <Text style={styles.buttonText}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            </>
                          ) : (
                            <>
                              <Text style={styles.meta}>{d.email || "no email"} - {d.phone || "no phone"}</Text>
                              {d.address ? <Text style={styles.cardBody}>{d.address}</Text> : null}
                              <View style={styles.row}>
                                <TouchableOpacity style={styles.button} onPress={() => startDonorEdit(d)}>
                                  <Text style={styles.buttonText}>Edit</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.button, styles.buttonDanger]}
                                  onPress={() => confirmDelete(`donor "${d.name}"`, () => deleteDonor(d))}
                                >
                                  <Text style={styles.buttonText}>Delete</Text>
                                </TouchableOpacity>
                              </View>
                            </>
                          )}
                        </>
                      )}
                    </View>
                  );
                })}

                <Text style={styles.sectionTitle}>Donations</Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.cardTitle}>Record donation</Text>
                    <Button title={showDonationForm ? "Hide" : "Show"} onPress={() => setShowDonationForm(!showDonationForm)} />
                  </View>
                  {showDonationForm && (
                    <>
                      <DonorPicker
                        label="Donor"
                        selectedId={donationForm.donor_id ? Number(donationForm.donor_id) : null}
                        onSelect={(donor) => setDonationForm({ ...donationForm, donor_id: donor ? String(donor.id) : "" })}
                      />
                      <TextInput style={styles.input} placeholder="Amount" value={donationForm.amount} onChangeText={(v) => setDonationForm({ ...donationForm, amount: v })} />
                      <TextInput style={styles.input} placeholder="Currency (USD)" value={donationForm.currency} onChangeText={(v) => setDonationForm({ ...donationForm, currency: v })} />
                      <TextInput style={styles.input} placeholder="Method (bank, cash)" value={donationForm.method} onChangeText={(v) => setDonationForm({ ...donationForm, method: v })} />
                      <TextInput style={[styles.input, { height: 80 }]} placeholder="Note" multiline value={donationForm.note} onChangeText={(v) => setDonationForm({ ...donationForm, note: v })} />
                      <View style={styles.row}>
                        <TouchableOpacity
                          style={[styles.chip, !donationForm.recurring && styles.chipActive]}
                          onPress={() => setDonationForm({ ...donationForm, recurring: false })}
                        >
                          <Text style={[styles.chipText, !donationForm.recurring && styles.chipTextActive]}>One-time</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.chip, donationForm.recurring && styles.chipActive]}
                          onPress={() => setDonationForm({ ...donationForm, recurring: true })}
                        >
                          <Text style={[styles.chipText, donationForm.recurring && styles.chipTextActive]}>Recurring</Text>
                        </TouchableOpacity>
                      </View>
                      <Button title="Save donation" onPress={createDonation} />
                    </>
                  )}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Search donations"
                  value={donationSearch}
                  onChangeText={setDonationSearch}
                  autoCapitalize="none"
                />
                {filteredDonations.map((d) => {
                  const isExpanded = expandedDonationId === d.id;
                  const isEditing = editingDonationId === d.id;
                  return (
                    <View key={d.id} style={styles.card}>
                      <TouchableOpacity
                        onPress={() => {
                          setExpandedDonationId(isExpanded ? null : d.id);
                          if (isExpanded) setEditingDonationId(null);
                        }}
                      >
                        <Text style={styles.cardTitle}>{getDonorName(d.donor_id)}</Text>
                        <Text style={styles.meta}>{isExpanded ? "Tap to collapse" : "Tap to expand"}</Text>
                      </TouchableOpacity>
                      {isExpanded && (
                        <>
                          {isEditing ? (
                            <>
                              <DonorPicker
                                label="Donor"
                                selectedId={donationEdit.donor_id ? Number(donationEdit.donor_id) : null}
                                onSelect={(donor) => setDonationEdit({ ...donationEdit, donor_id: donor ? String(donor.id) : "" })}
                              />
                              <TextInput style={styles.input} placeholder="Amount" value={donationEdit.amount} onChangeText={(v) => setDonationEdit({ ...donationEdit, amount: v })} />
                              <TextInput style={styles.input} placeholder="Currency" value={donationEdit.currency} onChangeText={(v) => setDonationEdit({ ...donationEdit, currency: v })} />
                              <TextInput style={styles.input} placeholder="Method" value={donationEdit.method} onChangeText={(v) => setDonationEdit({ ...donationEdit, method: v })} />
                              <TextInput style={[styles.input, { height: 80 }]} placeholder="Note" multiline value={donationEdit.note} onChangeText={(v) => setDonationEdit({ ...donationEdit, note: v })} />
                              <View style={styles.row}>
                                <TouchableOpacity
                                  style={[styles.chip, !donationEdit.recurring && styles.chipActive]}
                                  onPress={() => setDonationEdit({ ...donationEdit, recurring: false })}
                                >
                                  <Text style={[styles.chipText, !donationEdit.recurring && styles.chipTextActive]}>One-time</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.chip, donationEdit.recurring && styles.chipActive]}
                                  onPress={() => setDonationEdit({ ...donationEdit, recurring: true })}
                                >
                                  <Text style={[styles.chipText, donationEdit.recurring && styles.chipTextActive]}>Recurring</Text>
                                </TouchableOpacity>
                              </View>
                              <View style={styles.row}>
                                <TouchableOpacity style={styles.button} onPress={saveDonationEdit}>
                                  <Text style={styles.buttonText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => setEditingDonationId(null)}>
                                  <Text style={styles.buttonText}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            </>
                          ) : (
                            <>
                              <Text style={styles.meta}>
                                {d.amount} {d.currency} - {d.method || "unspecified"} - {d.recurring ? "recurring" : "one-time"}
                              </Text>
                              <Text style={styles.meta}>Date: {formatDate(d.date)}</Text>
                              {d.note ? <Text style={styles.cardBody}>{d.note}</Text> : null}
                              <View style={styles.row}>
                                <TouchableOpacity style={styles.button} onPress={() => startDonationEdit(d)}>
                                  <Text style={styles.buttonText}>Edit</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.button, styles.buttonDanger]}
                                  onPress={() => confirmDelete(`donation from "${getDonorName(d.donor_id)}"`, () => deleteDonation(d))}
                                >
                                  <Text style={styles.buttonText}>Delete</Text>
                                </TouchableOpacity>
                              </View>
                            </>
                          )}
                        </>
                      )}
                    </View>
                  );
                })}
              </>
            ) : (
              <Text style={styles.meta}>Donor and donation data is restricted to managers and admins.</Text>
            )}
          </>
        )}

        {activeTab === "people" && canManageNgo && (
          <>
            <Text style={styles.sectionTitle}>Volunteers</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Add volunteer</Text>
                <Button title={showVolunteerForm ? "Hide" : "Show"} onPress={() => setShowVolunteerForm(!showVolunteerForm)} />
              </View>
              {showVolunteerForm && (
                <>
                  <TextInput style={styles.input} placeholder="Name" value={volunteerForm.name} onChangeText={(v) => setVolunteerForm({ ...volunteerForm, name: v })} />
                  <TextInput style={styles.input} placeholder="Email" value={volunteerForm.email} onChangeText={(v) => setVolunteerForm({ ...volunteerForm, email: v })} autoCapitalize="none" />
                  <TextInput style={styles.input} placeholder="Phone" value={volunteerForm.phone} onChangeText={(v) => setVolunteerForm({ ...volunteerForm, phone: v })} />
                  <TextInput style={styles.input} placeholder="Skills" value={volunteerForm.skills} onChangeText={(v) => setVolunteerForm({ ...volunteerForm, skills: v })} />
                  <TextInput style={styles.input} placeholder="Hours" value={volunteerForm.hours} onChangeText={(v) => setVolunteerForm({ ...volunteerForm, hours: v })} />
                  <Button title="Save volunteer" onPress={createVolunteer} />
                </>
              )}
            </View>
            {volunteers.map((v) => (
              <View key={v.id} style={styles.card}>
                <Text style={styles.cardTitle}>{v.name}</Text>
                <Text style={styles.meta}>{v.email || "no email"} - {v.phone || "no phone"}</Text>
                <Text style={styles.meta}>Hours: {v.hours} - {v.active ? "active" : "inactive"}</Text>
                {v.skills ? <Text style={styles.cardBody}>{v.skills}</Text> : null}
              </View>
            ))}
          </>
        )}

        {activeTab === "reports" && canManageNgo && (
          <>
            <Text style={styles.sectionTitle}>Report date range</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                placeholder="Start date (YYYY-MM-DD)"
                value={reportStartDate}
                onChangeText={setReportStartDate}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="End date (YYYY-MM-DD)"
                value={reportEndDate}
                onChangeText={setReportEndDate}
                autoCapitalize="none"
              />
              <View style={styles.row}>
                <TouchableOpacity style={styles.button} onPress={() => void loadAll()}>
                  <Text style={styles.buttonText}>Apply range</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.buttonDanger]}
                  onPress={() => {
                    setReportStartDate("");
                    setReportEndDate("");
                    void loadAll();
                  }}
                >
                  <Text style={styles.buttonText}>Clear range</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.meta}>Reports and exports use this range when provided.</Text>
            </View>

            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.sectionTitle}>Overview KPIs</Text>
              <Button title={showOverviewReport ? "Hide" : "Show"} onPress={() => setShowOverviewReport(!showOverviewReport)} />
            </View>
            {showOverviewReport && (
              <>
                {overviewReport ? (
                  <View style={styles.kpiGrid}>
                    {[
                      { label: "Departments", value: overviewReport.departments },
                      { label: "Active users", value: overviewReport.users_active },
                      { label: "Total tasks", value: overviewReport.tasks_total },
                      { label: "Completed tasks", value: overviewReport.tasks_completed },
                      { label: "Overdue tasks", value: overviewReport.tasks_overdue },
                      { label: "Pending requests", value: overviewReport.requests_pending },
                      { label: "Upcoming events", value: overviewReport.events_upcoming },
                      { label: "Donors", value: overviewReport.donors_total },
                      { label: "Donations", value: overviewReport.donations_total },
                      { label: "Donations total", value: overviewReport.donations_amount },
                      { label: "Projects", value: overviewReport.projects_total },
                      { label: "Beneficiaries", value: overviewReport.beneficiaries_total },
                    ].map((item) => (
                      <View key={item.label} style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>{item.label}</Text>
                        <Text style={styles.kpiValue}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.meta}>No overview report loaded.</Text>
                )}
              </>
            )}

            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.sectionTitle}>M&E KPIs</Text>
              <Button title={showProgramsReport ? "Hide" : "Show"} onPress={() => setShowProgramsReport(!showProgramsReport)} />
            </View>
            {showProgramsReport && (
              <>
                {programsReport ? (
                  <>
                    <View style={styles.kpiGrid}>
                      {[
                        { label: "Projects", value: programsReport.projects_total },
                        { label: "Beneficiaries", value: programsReport.beneficiaries_total },
                        { label: "Programs tasks done", value: programsReport.programs_tasks_done },
                        { label: "Programs tasks pending", value: programsReport.programs_tasks_pending },
                        { label: "Upcoming program events", value: programsReport.upcoming_program_events },
                      ].map((item) => (
                        <View key={item.label} style={styles.kpiCard}>
                          <Text style={styles.kpiLabel}>{item.label}</Text>
                          <Text style={styles.kpiValue}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.sectionTitle}>Beneficiaries by project</Text>
                    {programsReport.beneficiaries_by_project.map((row) => (
                      <View key={row.project_id} style={styles.card}>
                        <Text style={styles.cardTitle}>{row.project_name}</Text>
                        <Text style={styles.meta}>Beneficiaries: {row.beneficiaries}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <Text style={styles.meta}>No program report loaded.</Text>
                )}
              </>
            )}

            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.sectionTitle}>Donor reporting</Text>
              <Button title={showFundraisingReport ? "Hide" : "Show"} onPress={() => setShowFundraisingReport(!showFundraisingReport)} />
            </View>
            {showFundraisingReport && (
              <>
                {fundraisingReport ? (
                  <>
                    <View style={styles.kpiGrid}>
                      {[
                        { label: "Donors", value: fundraisingReport.donors_total },
                        { label: "Donations", value: fundraisingReport.donations_total },
                        { label: "Donation total", value: fundraisingReport.donations_amount },
                        { label: "Recurring gifts", value: fundraisingReport.recurring_donations },
                      ].map((item) => (
                        <View key={item.label} style={styles.kpiCard}>
                          <Text style={styles.kpiLabel}>{item.label}</Text>
                          <Text style={styles.kpiValue}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.sectionTitle}>Top donors</Text>
                    {fundraisingReport.donations_by_donor.map((row) => (
                      <View key={row.donor_id} style={styles.card}>
                        <Text style={styles.cardTitle}>{row.donor_name}</Text>
                        <Text style={styles.meta}>Total donated: {row.total_amount}</Text>
                      </View>
                    ))}
                    <Text style={styles.sectionTitle}>Donations by month</Text>
                    {fundraisingReport.donations_by_month.map((row) => (
                      <View key={row.month} style={styles.card}>
                        <Text style={styles.cardTitle}>{row.month}</Text>
                        <Text style={styles.meta}>Amount: {row.amount}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <Text style={styles.meta}>No fundraising report loaded.</Text>
                )}
              </>
            )}

            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.sectionTitle}>Performance by staff</Text>
              <Button title={showPerformanceReport ? "Hide" : "Show"} onPress={() => setShowPerformanceReport(!showPerformanceReport)} />
            </View>
            {showPerformanceReport && (
              <>
                {performanceReport.length === 0 ? (
                  <Text style={styles.meta}>No performance logs yet.</Text>
                ) : (
                  performanceReport.map((entry) => {
                    const percent = Math.round((entry.avg_score / performanceMaxScore) * 100);
                    return (
                      <View key={entry.user_id} style={styles.card}>
                        <Text style={styles.cardTitle}>{entry.user_name}</Text>
                        <Text style={styles.meta}>
                          {getDepartmentName(entry.department_id)} - {entry.role}
                        </Text>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${percent}%` }]} />
                        </View>
                        <Text style={styles.meta}>
                          Average score: {entry.avg_score.toFixed(1)} (logs: {entry.total_logs})
                        </Text>
                        {entry.last_score !== null && entry.last_score !== undefined ? (
                          <Text style={styles.meta}>
                            Last score: {entry.last_score} on {formatDate(entry.last_logged_at)}
                          </Text>
                        ) : null}
                        {entry.recent_scores.length > 0 ? (
                          <Text style={styles.meta}>
                            Recent: {entry.recent_scores.map((s) => s.score).join(", ")}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </>
            )}

            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.sectionTitle}>Users</Text>
              <Button title={showUsersReport ? "Hide" : "Show"} onPress={() => setShowUsersReport(!showUsersReport)} />
            </View>
            {showUsersReport && (
              <>
                {reportUsers.length === 0 ? (
                  <Text style={styles.meta}>No users available.</Text>
                ) : (
                  reportUsers.map((u) => (
                    <View key={u.id} style={styles.card}>
                      <Text style={styles.cardTitle}>{u.full_name}</Text>
                      <Text style={styles.meta}>Email: {u.email}</Text>
                      <Text style={styles.meta}>Role: {u.role}</Text>
                      <Text style={styles.meta}>Department: {getDepartmentName(u.department_id)}</Text>
                      <Text style={styles.meta}>Status: {u.active === false ? "inactive" : "active"}</Text>
                    </View>
                  ))
                )}
              </>
            )}

            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.sectionTitle}>Exports</Text>
              <Button title={showExportsReport ? "Hide" : "Show"} onPress={() => setShowExportsReport(!showExportsReport)} />
            </View>
            {showExportsReport && (
              <>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.button} onPress={() => downloadCsv("donors", "donors.csv")}>
                    <Text style={styles.buttonText}>Export donors</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => downloadCsv("donations", "donations.csv")}>
                    <Text style={styles.buttonText}>Export donations</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => downloadCsv("projects", "projects.csv")}>
                    <Text style={styles.buttonText}>Export projects</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.button} onPress={() => downloadCsv("beneficiaries", "beneficiaries.csv")}>
                    <Text style={styles.buttonText}>Export beneficiaries</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => downloadCsv("volunteers", "volunteers.csv")}>
                    <Text style={styles.buttonText}>Export volunteers</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => downloadCsv("requests", "requests.csv")}>
                    <Text style={styles.buttonText}>Export requests</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.button}
                    onPress={() => downloadCsv("project-outcomes", "project_outcomes.csv", buildReportParams() ?? undefined)}
                  >
                    <Text style={styles.buttonText}>Export project outcomes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.button}
                    onPress={() => downloadCsv("donor-report", "donor_report.csv", buildReportParams() ?? undefined)}
                  >
                    <Text style={styles.buttonText}>Export donor report</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}

        {activeTab === "messages" && (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Send message</Text>
                <Button title={showMessageForm ? "Hide" : "Show"} onPress={() => setShowMessageForm(!showMessageForm)} />
              </View>
              {showMessageForm && (
                <>
                  <TextInput style={styles.input} placeholder="Subject" value={messageForm.subject} onChangeText={(v) => setMessageForm({ ...messageForm, subject: v })} />
                  <TextInput style={[styles.input, { height: 80 }]} placeholder="Body" multiline value={messageForm.body} onChangeText={(v) => setMessageForm({ ...messageForm, body: v })} />
                  <UserPicker
                    label="Recipient (optional)"
                    selectedId={messageForm.recipient_id ? Number(messageForm.recipient_id) : null}
                    onSelect={(next) => setMessageForm({ ...messageForm, recipient_id: next ? String(next.id) : "" })}
                    allowClear
                  />
                  <DepartmentPicker
                    label="Department (optional)"
                    selectedId={messageForm.department_id ? Number(messageForm.department_id) : null}
                    onSelect={(dept) => setMessageForm({ ...messageForm, department_id: dept ? String(dept.id) : "" })}
                    allowClear
                  />
                  <Button title="Send" onPress={sendMessage} />
                  <View style={[styles.row, { marginTop: 8 }]}>
                    <TouchableOpacity style={styles.button} onPress={saveDraft}>
                      <Text style={styles.buttonText}>Save draft</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={clearDrafts}>
                      <Text style={styles.buttonText}>Clear drafts</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Email (Gmail or work domains)</Text>
                <Button title={showEmailForm ? "Hide" : "Show"} onPress={() => setShowEmailForm(!showEmailForm)} />
              </View>
              {showEmailForm && (
                <>
                  <TextInput style={styles.input} placeholder="to@example.com" value={emailForm.to_email} onChangeText={(v) => setEmailForm({ ...emailForm, to_email: v })} autoCapitalize="none" />
                  <TextInput style={styles.input} placeholder="Subject" value={emailForm.subject} onChangeText={(v) => setEmailForm({ ...emailForm, subject: v })} />
                  <TextInput style={[styles.input, { height: 80 }]} placeholder="Body" multiline value={emailForm.body} onChangeText={(v) => setEmailForm({ ...emailForm, body: v })} />
                  <Button title="Queue email" onPress={queueExternalEmail} />
                </>
              )}
            </View>
            {drafts.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Drafts</Text>
                {drafts.map((d, idx) => (
                  <View key={idx} style={styles.card}>
                    <Text style={styles.cardTitle}>{d.subject || "Untitled draft"}</Text>
                    {d.body ? <Text style={styles.cardBody}>{d.body}</Text> : null}
                    <Text style={styles.meta}>Recipient: {d.recipient_id || "Broadcast"} Dept: {d.department_id || "n/a"}</Text>
                  </View>
                ))}
              </>
            )}
            <Text style={styles.sectionTitle}>Inbox</Text>
            <MessageList items={inbox} />
            <Text style={styles.sectionTitle}>Sent</Text>
            <MessageList items={sent} />
          </>
        )}

            {activeTab === "requests" && (
          <>
            <Text style={styles.sectionTitle}>Workflow requests</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Leave request</Text>
                <Button title={showLeaveForm ? "Hide" : "Show"} onPress={() => setShowLeaveForm(!showLeaveForm)} />
              </View>
              {showLeaveForm && (
                <>
                  <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={leaveForm.start_date} onChangeText={(v) => setLeaveForm({ ...leaveForm, start_date: v })} />
                  <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={leaveForm.end_date} onChangeText={(v) => setLeaveForm({ ...leaveForm, end_date: v })} />
                  <TextInput style={styles.input} placeholder="Reason" value={leaveForm.reason} onChangeText={(v) => setLeaveForm({ ...leaveForm, reason: v })} />
                  <TextInput style={styles.input} placeholder="Coverage plan (optional)" value={leaveForm.coverage_plan} onChangeText={(v) => setLeaveForm({ ...leaveForm, coverage_plan: v })} />
                  <TextInput style={styles.input} placeholder="Contact while away (optional)" value={leaveForm.contact} onChangeText={(v) => setLeaveForm({ ...leaveForm, contact: v })} />
                  <Button title="Submit leave request" onPress={submitLeaveRequest} />
                </>
              )}
            </View>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Procurement request</Text>
                <Button title={showProcurementForm ? "Hide" : "Show"} onPress={() => setShowProcurementForm(!showProcurementForm)} />
              </View>
              {showProcurementForm && (
                <>
                  <TextInput style={styles.input} placeholder="Item" value={procurementForm.item} onChangeText={(v) => setProcurementForm({ ...procurementForm, item: v })} />
                  <TextInput style={styles.input} placeholder="Quantity" value={procurementForm.quantity} onChangeText={(v) => setProcurementForm({ ...procurementForm, quantity: v })} />
                  <TextInput style={styles.input} placeholder="Estimated cost" value={procurementForm.estimated_cost} onChangeText={(v) => setProcurementForm({ ...procurementForm, estimated_cost: v })} />
                  <TextInput style={styles.input} placeholder="Preferred vendor (optional)" value={procurementForm.vendor} onChangeText={(v) => setProcurementForm({ ...procurementForm, vendor: v })} />
                  <TextInput style={[styles.input, { height: 80 }]} placeholder="Justification" multiline value={procurementForm.justification} onChangeText={(v) => setProcurementForm({ ...procurementForm, justification: v })} />
                  <Button title="Submit procurement request" onPress={submitProcurementRequest} />
                </>
              )}
            </View>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Travel request</Text>
                <Button title={showTravelForm ? "Hide" : "Show"} onPress={() => setShowTravelForm(!showTravelForm)} />
              </View>
              {showTravelForm && (
                <>
                  <TextInput style={styles.input} placeholder="Destination" value={travelForm.destination} onChangeText={(v) => setTravelForm({ ...travelForm, destination: v })} />
                  <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" value={travelForm.start_date} onChangeText={(v) => setTravelForm({ ...travelForm, start_date: v })} />
                  <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" value={travelForm.end_date} onChangeText={(v) => setTravelForm({ ...travelForm, end_date: v })} />
                  <TextInput style={styles.input} placeholder="Purpose" value={travelForm.purpose} onChangeText={(v) => setTravelForm({ ...travelForm, purpose: v })} />
                  <TextInput style={styles.input} placeholder="Estimated cost" value={travelForm.estimated_cost} onChangeText={(v) => setTravelForm({ ...travelForm, estimated_cost: v })} />
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={[styles.chip, !travelForm.advance_needed && styles.chipActive]}
                      onPress={() => setTravelForm({ ...travelForm, advance_needed: false })}
                    >
                      <Text style={[styles.chipText, !travelForm.advance_needed && styles.chipTextActive]}>No advance</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.chip, travelForm.advance_needed && styles.chipActive]}
                      onPress={() => setTravelForm({ ...travelForm, advance_needed: true })}
                    >
                      <Text style={[styles.chipText, travelForm.advance_needed && styles.chipTextActive]}>Advance needed</Text>
                    </TouchableOpacity>
                  </View>
                  <Button title="Submit travel request" onPress={submitTravelRequest} />
                </>
              )}
            </View>

            {canManageNgo && (
              <>
                <Text style={styles.sectionTitle}>Pending approvals</Text>
                {requests.filter((r) => ["leave", "procurement", "travel"].includes(r.type) && r.status === "pending").map((r) => (
                  <View key={r.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{r.type} request</Text>
                    <Text style={styles.meta}>{getDepartmentName(r.department_id)} - By {getUserName(r.requester_id)}</Text>
                    {getPayloadLines(r.payload).slice(0, 3).map((line, idx) => (
                      <Text key={`${line}-${idx}`} style={styles.meta}>{line}</Text>
                    ))}
                    <View style={styles.row}>
                      <TouchableOpacity style={styles.button} onPress={() => updateRequestStatus(r.id, "approved")}>
                        <Text style={styles.buttonText}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => updateRequestStatus(r.id, "rejected")}>
                        <Text style={styles.buttonText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}

            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Submit request</Text>
                <Button title={showRequestForm ? "Hide" : "Show"} onPress={() => setShowRequestForm(!showRequestForm)} />
              </View>
              {showRequestForm && (
                <>
                  <TextInput style={styles.input} placeholder="Type (leave, expense, access)" value={requestForm.type} onChangeText={(v) => setRequestForm({ ...requestForm, type: v })} />
                  <TextInput style={[styles.input, { height: 80 }]} placeholder="Payload" multiline value={requestForm.payload} onChangeText={(v) => setRequestForm({ ...requestForm, payload: v })} />
                  <DepartmentPicker
                    label="Department (optional)"
                    selectedId={requestForm.department_id ? Number(requestForm.department_id) : null}
                    onSelect={(dept) => setRequestForm({ ...requestForm, department_id: dept ? String(dept.id) : "" })}
                    allowClear
                  />
                  <Button title="Submit" onPress={submitRequest} />
                </>
              )}
            </View>
            <View style={styles.requestsLayout}>
              <View style={styles.requestsMain}>
                <Text style={styles.sectionTitle}>Requests</Text>
                {requests.map((r) => {
                  const selected = r.id === selectedRequestId;
                  return (
                    <View key={r.id} style={[styles.card, selected && styles.cardSelected]}>
                      <Text style={styles.cardTitle}>{r.type}</Text>
                      <Text style={styles.meta}>{getDepartmentName(r.department_id)} - By {getUserName(r.requester_id)} - {r.status}</Text>
                      {getPayloadLines(r.payload).slice(0, 2).map((line, idx) => (
                        <Text key={`${line}-${idx}`} style={styles.cardBody}>{line}</Text>
                      ))}
                      <View style={styles.row}>
                        <TouchableOpacity
                          style={styles.button}
                          onPress={() => {
                            setSelectedRequestId(r.id);
                            setRequestAttachments([]);
                            setRequestAudits([]);
                            setRequestResponse({ subject: `Response: ${r.type}`, body: "" });
                            setRequestStatusUpdate("");
                            void loadRequestAttachments(r.id);
                            void loadRequestAudits(r.id);
                          }}
                        >
                          <Text style={styles.buttonText}>View</Text>
                        </TouchableOpacity>
                        {(isAdmin || isManager) && (
                          <>
                            <TouchableOpacity style={styles.button} onPress={() => updateRequestStatus(r.id, "approved")}>
                              <Text style={styles.buttonText}>Approve</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => updateRequestStatus(r.id, "rejected")}>
                              <Text style={styles.buttonText}>Reject</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}

                {selectedRequestId && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Request details</Text>
                    <Text style={styles.meta}>
                      {getDepartmentName(requests.find((r) => r.id === selectedRequestId)?.department_id)} - By {getUserName(requests.find((r) => r.id === selectedRequestId)?.requester_id)}
                    </Text>
                    {getPayloadLines(requests.find((r) => r.id === selectedRequestId)?.payload).map((line, idx) => (
                      <Text key={`${line}-${idx}`} style={styles.cardBody}>{line}</Text>
                    ))}
                    <Text style={styles.sectionTitle}>Files</Text>
                    {requestDetailsLoading ? (
                      <Text style={styles.meta}>Loading files...</Text>
                    ) : requestAttachments.length === 0 ? (
                      <Text style={styles.meta}>No files yet</Text>
                    ) : (
                      requestAttachments.map((file) => (
                        <View key={file.id} style={styles.row}>
                          <Text style={[styles.meta, { flex: 1 }]}>
                            {file.filename} (uploaded {formatDate(file.uploaded_at)})
                          </Text>
                          <TouchableOpacity style={styles.button} onPress={() => downloadRequestAttachment(file)}>
                            <Text style={styles.buttonText}>Download</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                    <TouchableOpacity style={styles.button} onPress={uploadRequestAttachment} disabled={requestUploadBusy}>
                      <Text style={styles.buttonText}>{requestUploadBusy ? "Uploading..." : "Upload file"}</Text>
                    </TouchableOpacity>
                    <Text style={styles.sectionTitle}>Respond to requester</Text>
                    <TextInput style={styles.input} placeholder="Subject" value={requestResponse.subject} onChangeText={(v) => setRequestResponse({ ...requestResponse, subject: v })} />
                    <TextInput style={[styles.input, { height: 80 }]} placeholder="Message" multiline value={requestResponse.body} onChangeText={(v) => setRequestResponse({ ...requestResponse, body: v })} />
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={[styles.chip, requestStatusUpdate === "approved" && styles.chipActive]}
                        onPress={() => setRequestStatusUpdate("approved")}
                      >
                        <Text style={[styles.chipText, requestStatusUpdate === "approved" && styles.chipTextActive]}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chip, requestStatusUpdate === "rejected" && styles.chipActive]}
                        onPress={() => setRequestStatusUpdate("rejected")}
                      >
                        <Text style={[styles.chipText, requestStatusUpdate === "rejected" && styles.chipTextActive]}>Reject</Text>
                      </TouchableOpacity>
                      {requestStatusUpdate ? <Text style={styles.meta}>Status: {requestStatusUpdate}</Text> : null}
                    </View>
                    <Button title={requestBusy ? "Sending..." : "Send response"} onPress={sendRequestResponse} disabled={requestBusy} />
                    <Text style={styles.sectionTitle}>Audit trail</Text>
                    {requestAudits.length === 0 ? (
                      <Text style={styles.meta}>No audit entries yet</Text>
                    ) : (
                      requestAudits.map((audit) => (
                        <Text key={audit.id} style={styles.meta}>
                          {formatDate(audit.created_at)} - {audit.action} {audit.from_status ? `${audit.from_status} -> ${audit.to_status}` : ""} {audit.note ? `(${audit.note})` : ""} by {audit.actor_id ?? "system"}
                        </Text>
                      ))
                    )}
                  </View>
                )}
              </View>
              <View style={styles.requestsSidebar}>
                <Text style={styles.sectionTitle}>Approved</Text>
                {requests.filter((r) => r.status === "approved").map((r) => (
                  <Text key={r.id} style={styles.meta}>
                    #{r.id} {r.type} - {getUserName(r.requester_id)}
                  </Text>
                ))}
                <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Rejected</Text>
                {requests.filter((r) => r.status === "rejected").map((r) => (
                  <Text key={r.id} style={styles.meta}>
                    #{r.id} {r.type} - {getUserName(r.requester_id)}
                  </Text>
                ))}
              </View>
            </View>
          </>
        )}

            {activeTab === "admin" && (isAdmin || isManager) && (
          <>
            {isAdmin && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Log administrative task</Text>
                  <Button title={showAdminLogForm ? "Hide" : "Show"} onPress={() => setShowAdminLogForm(!showAdminLogForm)} />
                </View>
                {showAdminLogForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Action" value={adminLogForm.action} onChangeText={(v) => setAdminLogForm({ ...adminLogForm, action: v })} />
                    <TextInput style={[styles.input, { height: 80 }]} placeholder="Detail" multiline value={adminLogForm.detail} onChangeText={(v) => setAdminLogForm({ ...adminLogForm, detail: v })} />
                    <Button title="Log" onPress={logAdminActivity} />
                  </>
                )}
              </View>
            )}
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Access grants</Text>
                <Button title={showGrantForm ? "Hide" : "Show"} onPress={() => setShowGrantForm(!showGrantForm)} />
              </View>
              {showGrantForm && (
                <>
                  <UserPicker
                    label="User"
                    selectedId={grantForm.user_id ? Number(grantForm.user_id) : null}
                    onSelect={(next) => setGrantForm({ ...grantForm, user_id: next ? String(next.id) : "" })}
                  />
                  <TextInput style={styles.input} placeholder="Resource type" value={grantForm.resource_type} onChangeText={(v) => setGrantForm({ ...grantForm, resource_type: v })} />
                  <TextInput style={styles.input} placeholder="Resource id" value={grantForm.resource_id} onChangeText={(v) => setGrantForm({ ...grantForm, resource_id: v })} />
                  <TextInput style={styles.input} placeholder="Permission (view|edit)" value={grantForm.permission} onChangeText={(v) => setGrantForm({ ...grantForm, permission: v })} />
                  <DepartmentPicker
                    label="Department (optional)"
                    selectedId={grantForm.department_id ? Number(grantForm.department_id) : null}
                    onSelect={(dept) => setGrantForm({ ...grantForm, department_id: dept ? String(dept.id) : "" })}
                    allowClear
                  />
                  <Button title="Grant" onPress={createGrant} />
                </>
              )}
              <Text style={[styles.meta, { marginTop: 8 }]}>Existing grants</Text>
              {accessGrants.map((g) => (
                <Text key={g.id} style={styles.meta}>
                  #{g.id} {getUserName(g.user_id)} {g.permission} {g.resource_type}:{g.resource_id} dept {getDepartmentName(g.department_id)}
                </Text>
              ))}
            </View>

            {isAdmin && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>{editUserId ? `Edit user #${editUserId}` : "Create user"}</Text>
                  <Button title={showUserForm ? "Hide" : "Show"} onPress={() => setShowUserForm(!showUserForm)} />
                </View>
                {showUserForm && (
                  <>
                    <TextInput style={styles.input} placeholder="Full name" value={userForm.full_name} onChangeText={(v) => setUserForm({ ...userForm, full_name: v })} />
                    {!editUserId && <TextInput style={styles.input} placeholder="Email" value={userForm.email} autoCapitalize="none" onChangeText={(v) => setUserForm({ ...userForm, email: v })} />}
                    <TextInput style={styles.input} placeholder="Password" value={userForm.password} secureTextEntry onChangeText={(v) => setUserForm({ ...userForm, password: v })} />
                    <Text style={styles.label}>Role</Text>
                    <RolePicker value={userForm.role as Role} onChange={(role) => setUserForm({ ...userForm, role })} />
                    <DepartmentPicker
                      label="Department (optional)"
                      selectedId={userForm.department_id ? Number(userForm.department_id) : null}
                      onSelect={(dept) => setUserForm({ ...userForm, department_id: dept ? String(dept.id) : "" })}
                      allowClear
                    />
                    <View style={styles.row}>
                      <Button title={editUserId ? "Update user" : "Create user"} onPress={editUserId ? updateExistingUser : createUser} />
                      {editUserId && <Button title="Cancel" onPress={() => { setEditUserId(null); setUserForm({ full_name: "", email: "", password: "", role: "staff", department_id: "" }); }} />}
                    </View>
                  </>
                )}
              </View>
            )}

            {(isAdmin || isManager) && (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>Log performance</Text>
                  <Button title={showPerfForm ? "Hide" : "Show"} onPress={() => setShowPerfForm(!showPerfForm)} />
                </View>
                {showPerfForm && (
                  <>
                    <UserPicker
                      label="User"
                      selectedId={perfForm.user_id ? Number(perfForm.user_id) : null}
                      onSelect={(next) => setPerfForm({ ...perfForm, user_id: next ? String(next.id) : "" })}
                    />
                    <TextInput style={styles.input} placeholder="Task ID (optional)" value={perfForm.task_id} onChangeText={(v) => setPerfForm({ ...perfForm, task_id: v })} />
                    <TextInput style={styles.input} placeholder="Score" value={perfForm.score} onChangeText={(v) => setPerfForm({ ...perfForm, score: v })} />
                    <TextInput style={styles.input} placeholder="Note" value={perfForm.note} onChangeText={(v) => setPerfForm({ ...perfForm, note: v })} />
                    <Button title="Save" onPress={logPerformance} />
                  </>
                )}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Activity log</Text>
                <Button title={showActivityLog ? "Hide" : "Show"} onPress={() => setShowActivityLog(!showActivityLog)} />
                <Button title="Export" onPress={() => downloadCsv("activity", "activity_log.csv")} />
              </View>
              {showActivityLog && (
                <>
                  {activityLog.length === 0 ? (
                    <Text style={styles.meta}>No activity logged yet.</Text>
                  ) : (
                    activityLog.map((a) => (
                      <Text key={a.id} style={styles.meta}>
                        {formatDate(a.created_at)} - {a.action} {a.detail ? `(${a.detail})` : ""} by {a.actor_id ?? "system"}
                      </Text>
                    ))
                  )}
                </>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Users</Text>
              {users.map((u) => (
                <View key={u.id} style={[styles.row, { alignItems: "center", marginBottom: 4 }]}>
                  <Text style={{ flex: 1, color: "#555" }}>
                    {u.id}: {u.full_name} ({u.role}) dept {getDepartmentName(u.department_id)} - {u.email} - {u.active === false ? "inactive" : "active"}
                  </Text>
                  {isAdmin && (
                    <>
                      <TouchableOpacity
                        style={styles.button}
                        onPress={() => {
                          setEditUserId(u.id);
                          setUserForm({ full_name: u.full_name, email: u.email, password: "", role: u.role, department_id: u.department_id ? String(u.department_id) : "" });
                          setShowUserForm(true);
                        }}
                      >
                        <Text style={styles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={() => deleteExistingUser(u.id)}>
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ))}
            </View>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Departments</Text>
                {isAdmin && (
                  <Button
                    title={showDepartmentForm ? "Hide" : "Add"}
                    onPress={() => {
                      if (!showDepartmentForm) {
                        cancelDepartmentEdit();
                      }
                      setShowDepartmentForm(!showDepartmentForm);
                    }}
                  />
                )}
              </View>
              {showDepartmentForm && isAdmin && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Department name"
                    value={departmentForm.name}
                    onChangeText={(v) => setDepartmentForm({ ...departmentForm, name: v })}
                  />
                  <TextInput
                    style={[styles.input, { height: 80 }]}
                    placeholder="Description"
                    value={departmentForm.description}
                    onChangeText={(v) => setDepartmentForm({ ...departmentForm, description: v })}
                    multiline
                  />
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.button} onPress={saveDepartment}>
                      <Text style={styles.buttonText}>{editingDepartmentId ? "Update" : "Create"}</Text>
                    </TouchableOpacity>
                    {editingDepartmentId && (
                      <TouchableOpacity style={[styles.button, styles.buttonDanger]} onPress={cancelDepartmentEdit}>
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}
              {departments.map((d) => (
                <View key={d.id} style={[styles.row, { alignItems: "center", marginBottom: 4 }]}>
                  <Text style={{ flex: 1, color: "#555" }}>
                    {d.id}: {d.name} {d.description ? `- ${d.description}` : ""}
                  </Text>
                  {isAdmin && (
                    <TouchableOpacity style={styles.button} onPress={() => startDepartmentEdit(d)}>
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}
    </SafeAreaView>
  );
};
const TaskDetailScreen = ({
  route,
  api,
  user,
}: NativeStackScreenProps<RootStackParamList, "Task"> & { api: AxiosInstance; user: User }) => {
  const { taskId } = route.params;
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadTask = async () => {
    setLoading(true);
    try {
      const [taskRes, commentsRes, resRes] = await Promise.all([
        api.get<Task>(`/tasks/${taskId}`),
        api.get<Comment[]>(`/tasks/${taskId}/comments`),
        api.get<Resource[]>(`/tasks/${taskId}/resources`),
      ]);
      setTask(taskRes.data);
      setComments(commentsRes.data);
      setResources(resRes.data);
    } catch {
      Alert.alert("Unable to load task");
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await api.get<User[]>("/users");
      setUsers(res.data);
    } catch {
      setUsers([]);
    }
  };

  useEffect(() => {
    void loadTask();
    void loadUsers();
  }, [taskId]);

  const setStatus = async (status: TaskStatus) => {
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      await loadTask();
    } catch {
      Alert.alert("Unable to update status");
    }
  };

  const sendToAdmin = async () => {
    try {
      await api.post(`/tasks/${taskId}/send-to-admin`);
      Alert.alert("Sent", "Task sent to admin for review.");
      await loadTask();
    } catch (err: any) {
      Alert.alert("Unable to send to admin", err?.response?.data?.detail ?? "");
    }
  };

  const submitComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    try {
      const payload = new URLSearchParams();
      payload.append("body", body);
      await api.post(`/tasks/${taskId}/comments`, payload.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      setCommentText("");
      await loadTask();
    } catch {
      Alert.alert("Unable to post comment");
    }
  };

  const uploadFile = async () => {
    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const form = new FormData();
      form.append("file", { uri: asset.uri, name: asset.name || "upload", type: asset.mimeType || "application/octet-stream" } as any);
      await api.post(`/tasks/${taskId}/upload`, form, { headers: { "Content-Type": "multipart/form-data" } });
      await loadTask();
    } catch {
      Alert.alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const getUserLabel = (userId: number) => {
    const found = users.find((u) => u.id === userId);
    return found ? found.full_name : `User ${userId}`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text>Task not found</Text>
      </SafeAreaView>
    );
  }
  const isCompleted = task.status === "done";
  const canSendToAdmin = user.role !== "admin";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.title}>{task.title}</Text>
        {task.description ? <Text style={styles.cardBody}>{task.description}</Text> : null}
        <Text style={styles.meta}>Status: {task.status}</Text>
        <Text style={styles.meta}>Start: {formatDate(task.start_date)} - End: {formatDate(task.end_date)}</Text>
        {task.completed_at ? <Text style={styles.meta}>Completed: {formatDate(task.completed_at)}</Text> : null}
        {!isCompleted && (
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={() => setStatus("in_progress")}>
              <Text style={styles.buttonText}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => setStatus("done")}>
              <Text style={styles.buttonText}>Complete</Text>
            </TouchableOpacity>
            {canSendToAdmin && (
              <TouchableOpacity style={styles.button} onPress={sendToAdmin}>
                <Text style={styles.buttonText}>Send to admin</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>Resources</Text>
        {resources.length === 0 ? (
          <Text style={styles.meta}>No files yet</Text>
        ) : (
          <FlatList
            data={resources}
            keyExtractor={(r) => String(r.id)}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{item.filename}</Text>
                <Text style={styles.meta}>Uploaded: {formatDate(item.uploaded_at)}</Text>
              </View>
            )}
          />
        )}
        <TouchableOpacity style={[styles.button, { marginTop: 8 }]} onPress={uploadFile} disabled={uploading}>
          <Text style={styles.buttonText}>{uploading ? "Uploading..." : "Upload file"}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Comments</Text>
        {comments.map((c) => (
          <View key={c.id} style={styles.card}>
            <Text style={styles.cardBody}>{c.body}</Text>
            <Text style={styles.meta}>By {getUserLabel(c.user_id)} at {formatDate(c.created_at)}</Text>
          </View>
        ))}
        <TextInput style={styles.input} placeholder="Add a comment" value={commentText} onChangeText={setCommentText} multiline />
        <Button title="Post comment" onPress={submitComment} />
      </ScrollView>
    </SafeAreaView>
  );
};

const Tab = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const formatDate = (value?: string | null) => {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg, padding: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: palette.text },
  subtitle: { fontSize: 14, color: palette.muted, marginTop: 4 },
  apiHint: { fontSize: 12, color: palette.muted, marginTop: 2 },
  label: { marginTop: 8, marginBottom: 4, color: palette.text },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: palette.card },
  tabs: { flexDirection: "row", flexWrap: "wrap", marginVertical: 16 },
  tab: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginRight: 8, marginBottom: 8, backgroundColor: "#e5e7eb", alignItems: "center" },
  tabActive: { backgroundColor: palette.primary },
  tabText: { color: palette.text, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginVertical: 8, color: palette.text },
  card: { backgroundColor: palette.card, padding: 12, borderRadius: 14, marginBottom: 10, shadowColor: "#0f172a", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  cardOverdue: { borderWidth: 1, borderColor: palette.danger },
  cardTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
  cardBody: { marginTop: 4, color: palette.text },
  meta: { marginTop: 4, color: palette.muted },
  metaOverdue: { color: palette.danger, fontWeight: "700" },
  row: { flexDirection: "row", marginTop: 8, gap: 8, alignItems: "center" },
  button: { backgroundColor: palette.primary, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  buttonDanger: { backgroundColor: palette.danger },
  buttonText: { color: "#fff", fontWeight: "700" },
  loadingOverlay: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(255,255,255,0.6)", justifyContent: "center", alignItems: "center" },
  hint: { marginTop: 8, color: palette.muted },
  errorText: { marginTop: 8, color: palette.danger, fontWeight: "600" },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#e5e7eb" },
  chipActive: { backgroundColor: palette.primary },
  chipText: { color: palette.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  selectList: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, backgroundColor: palette.card, marginBottom: 6 },
  selectItem: { paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  selectItemText: { color: palette.text },
  linkButton: { paddingVertical: 6 },
  linkButtonText: { color: palette.accent, fontWeight: "600" },
  cardSelected: { borderWidth: 1, borderColor: palette.accent },
  requestsLayout: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12 },
  requestsMain: { flex: 2, minWidth: 280 },
  requestsSidebar: { flex: 1, minWidth: 200, backgroundColor: palette.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  kpiCard: { backgroundColor: palette.card, padding: 12, borderRadius: 12, minWidth: 140, flexGrow: 1, borderWidth: 1, borderColor: "#e5e7eb" },
  kpiLabel: { color: palette.muted, fontSize: 12 },
  kpiValue: { color: palette.text, fontSize: 18, fontWeight: "700", marginTop: 4 },
  barTrack: { height: 10, borderRadius: 999, backgroundColor: "#e5e7eb", overflow: "hidden", marginTop: 8 },
  barFill: { height: 10, backgroundColor: palette.accent },
});


