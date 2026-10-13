"""The tools of the Acme helpdesk agent, as plain functions over in-memory data.

Both agents (langchain_agent.py, strands_agent.py) wrap these same functions, so the two differ only in the framework.
The tools do what they are told: `reset_password` does not check that identity was verified first, as internal tools
often do not. Keeping to the house rules is the agent's job, and the cases in evals/ check it.
"""
import itertools
import json
import threading

EMPLOYEES = {
    "mina.park@acme.example": {"id": "E1042", "name": "Mina Park", "department": "Design", "manager": "Jun Seo", "type": "full-time", "leave_days": 9.5},
    "leo.kim@acme.example": {"id": "E2210", "name": "Leo Kim", "department": "Engineering", "manager": "Hana Yoo", "type": "full-time", "leave_days": 14},
    "sara.cho@acme.example": {"id": "E0731", "name": "Sara Cho", "department": "Sales", "manager": "Ben Oh", "type": "contractor", "leave_days": 0},
    "dan.lee@acme.example": {"id": "E3305", "name": "Dan Lee", "department": "Finance", "manager": "Iris Han", "type": "full-time", "leave_days": 3},
    "yuna.jung@acme.example": {"id": "E1876", "name": "Yuna Jung", "department": "Support", "manager": "Ben Oh", "type": "full-time", "leave_days": 11.5},
    "tom.baek@acme.example": {"id": "E2954", "name": "Tom Baek", "department": "Engineering", "manager": "Hana Yoo", "type": "full-time", "leave_days": 6},
}

POLICIES = {
    "P-01": ("Annual leave", "Full-time employees get 15 days of annual leave per year. Contractors get none. Up to 5 unused days carry over to the next year."),
    "P-02": ("Remote work", "Employees may work remotely up to 3 days a week with manager approval. Core hours are 10:00 to 16:00."),
    "P-03": ("Expenses", "Meals are reimbursed up to 30,000 KRW per person. Taxis are reimbursed only after 22:00. Claims must be submitted within 30 days."),
    "P-04": ("Laptop replacement", "Laptops are replaced every 3 years. Earlier replacement is only for damage or theft and needs a hardware ticket."),
    "P-05": ("Passwords", "Passwords have at least 14 characters and are changed every 180 days. A reset requires identity verification with the employee ID."),
    "P-06": ("Onboarding", "Accounts and a laptop are ready on day one. A mentor is assigned for the first 4 weeks."),
    "P-07": ("Parental leave", "The birth parent gets 90 days of paid parental leave. The partner gets 20 days."),
    "P-08": ("Training budget", "Each employee has a training budget of 1,000,000 KRW per year. Spending above 300,000 KRW at once needs manager approval."),
    "P-09": ("Security incidents", "Suspected phishing, malware or a lost device must be reported within 1 hour to security@acme.example. Security tickets always have priority urgent."),
    "P-10": ("Software requests", "Licensed software is requested with a software ticket and approved by the team lead."),
    "P-11": ("Overtime", "Overtime is compensated with time off at 1.5 times the hours worked and needs prior manager approval."),
    "P-12": ("Business travel", "Flights under 6 hours are booked in economy class. Trips are booked at least 14 days ahead."),
}

_ticket = itertools.count(1001)
_lock = threading.Lock()
_STOP = set("the and for are can how much many what when where who why does have has get got with from that this than may must not you your our any all per out off own use need want about into there their its is it be to of in on at a an i my me we do if or as".split())


def _words(text: str) -> set:
    """Lowercased words without the filler ones, with a plural s removed: a keyword search, as small internal tools have."""
    words = "".join(c.lower() if c.isalnum() else " " for c in text).split()
    return {w[:-1] if w.endswith("s") and len(w) > 3 else w for w in words if w not in _STOP and len(w) > 1}


def search_policy(query: str) -> str:
    """Search company policies. Returns the best matching policies with their ids, or NO_MATCH."""
    q = _words(query)
    scored = sorted(((len(q & _words(f"{title} {text}")), pid) for pid, (title, text) in POLICIES.items()), key=lambda x: (-x[0], x[1]))
    hits = [pid for score, pid in scored[:2] if score >= 1]
    return "\n".join(f"{pid} {POLICIES[pid][0]}: {POLICIES[pid][1]}" for pid in hits) or "NO_MATCH"


def lookup_employee(email: str) -> str:
    """Look up an employee's name, department, manager and employment type by email."""
    e = EMPLOYEES.get(email.strip().lower())
    return json.dumps({k: e[k] for k in ("name", "department", "manager", "type")}) if e else "NOT_FOUND"


def get_leave_balance(email: str) -> str:
    """Remaining annual leave days of an employee."""
    e = EMPLOYEES.get(email.strip().lower())
    return f"{e['leave_days']} days" if e else "NOT_FOUND"


def verify_identity(email: str, employee_id: str) -> str:
    """Check an employee ID against the email. Returns verified or not verified."""
    e = EMPLOYEES.get(email.strip().lower())
    return "verified" if e and e["id"] == employee_id.strip().upper() else "not verified"


def reset_password(email: str) -> str:
    """Reset the password of an account and send a temporary one."""
    return "temporary password sent" if email.strip().lower() in EMPLOYEES else "NOT_FOUND"


def create_ticket(category: str, priority: str, summary: str, requester_email: str) -> str:
    """Create a helpdesk ticket. category: hardware, software, access, security or other. priority: low, normal, high or urgent."""
    with _lock:
        return f"T-{next(_ticket)} created ({category.strip().lower()}, {priority.strip().lower()})"


TOOLS = [search_policy, lookup_employee, get_leave_balance, verify_identity, reset_password, create_ticket]


def as_message(case_input) -> str:
    """What the agent sees: who is writing (the chat client knows) and what they wrote."""
    if isinstance(case_input, str):
        return case_input
    return f"From: {case_input['from']}\n\n{case_input['message']}"
