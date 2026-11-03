"""
Structured catalogue of technical roles (Part 3). Data only: every skill name must resolve
through ``skill_map`` (enforced by tests). Tiers: core (weight 3), important (2), nice (1).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Dict, List, Literal

from pydantic import BaseModel, Field

from . import skill_map
from .config import ROLE_TIER_WEIGHTS

Tier = Literal["core", "important", "nice"]


class RoleSkill(BaseModel):
    skill: str            # display name
    key: str              # canonical key
    tier: Tier
    weight: float


class Role(BaseModel):
    id: str
    title: str
    family: str
    summary: str
    skills: List[RoleSkill] = Field(min_length=1)


# id: (title, family, summary, core, important, nice)
_ROLES = {
    "frontend-developer": ("Frontend Developer", "Web", "Builds accessible, interactive user interfaces for the web.",
        ["JavaScript", "HTML/CSS", "React"], ["TypeScript", "Git workflow", "REST APIs", "Testing"], ["UI/UX Design", "Next.js", "Agile"]),
    "backend-python": ("Python Backend Engineer", "Web", "Designs and ships Python services, APIs and data access layers.",
        ["Python", "REST APIs", "SQL"], ["PostgreSQL", "Docker", "Git workflow", "Testing"], ["FastAPI", "Redis", "CI/CD", "System design"]),
    "backend-node": ("Node.js Backend Engineer", "Web", "Builds server-side JavaScript/TypeScript services and APIs.",
        ["Node.js", "JavaScript", "REST APIs"], ["SQL", "MongoDB", "Git workflow", "Testing", "Docker"], ["TypeScript", "Redis", "CI/CD"]),
    "backend-java": ("Java Backend Engineer", "Web", "Develops enterprise Java services with Spring.",
        ["Java", "Spring Boot", "SQL", "REST APIs"], ["OOP", "Microservices", "Git workflow", "Testing", "Docker"], ["Kubernetes", "AWS", "System design"]),
    "full-stack-developer": ("Full-Stack Developer", "Web", "Owns features end to end across UI, API and database.",
        ["JavaScript", "React", "Node.js", "SQL", "REST APIs"], ["HTML/CSS", "TypeScript", "Git workflow", "Docker", "Testing"], ["MongoDB", "AWS", "CI/CD"]),
    "data-analyst": ("Data Analyst", "Data", "Turns raw data into insight with queries, statistics and dashboards.",
        ["SQL", "Data Analysis", "Data Visualization", "Statistics"], ["Python", "Pandas"], ["R", "Databases", "Git workflow"]),
    "data-scientist": ("Data Scientist", "Data", "Builds statistical and machine-learning models to answer business questions.",
        ["Python", "Statistics", "Machine Learning", "Pandas", "SQL"], ["NumPy", "Scikit-learn", "Data Visualization", "Deep Learning"], ["Git workflow", "Apache Spark", "Docker"]),
    "ml-engineer": ("Machine Learning Engineer", "Data", "Trains, evaluates and deploys machine-learning systems in production.",
        ["Python", "Machine Learning", "Deep Learning", "PyTorch"], ["TensorFlow", "Scikit-learn", "NumPy", "Docker", "Git workflow", "SQL"], ["AWS", "Kubernetes", "CI/CD", "Data Engineering"]),
    "data-engineer": ("Data Engineer", "Data", "Builds reliable data pipelines and warehouses.",
        ["Python", "SQL", "Data Engineering", "Apache Spark"], ["Databases", "PostgreSQL", "Docker", "AWS", "Linux"], ["Kubernetes", "CI/CD", "Terraform", "Git workflow"]),
    "nlp-genai-engineer": ("NLP / GenAI Engineer", "Data", "Builds language and generative-AI features on top of modern models.",
        ["Python", "NLP", "Generative AI", "Machine Learning"], ["Deep Learning", "PyTorch", "REST APIs", "Git workflow", "Docker"], ["FastAPI", "AWS", "SQL"]),
    "devops-engineer": ("DevOps Engineer", "Infrastructure", "Automates build, release and operation of software.",
        ["Linux", "Docker", "Kubernetes", "CI/CD"], ["Terraform", "AWS", "Bash", "Git workflow", "Networking"], ["Python", "Azure", "GCP"]),
    "cloud-engineer": ("Cloud Engineer", "Infrastructure", "Designs and operates cloud infrastructure.",
        ["AWS", "Linux", "Networking", "Terraform"], ["Docker", "Kubernetes", "Bash", "CI/CD", "Cybersecurity"], ["Azure", "GCP", "Python"]),
    "qa-automation": ("QA Automation Engineer", "Quality", "Designs automated test suites and quality gates.",
        ["Testing", "Selenium", "Git workflow"], ["Python", "CI/CD", "REST APIs", "SQL", "Agile"], ["JavaScript", "Docker"]),
    "android-developer": ("Android Developer", "Mobile", "Builds native Android applications.",
        ["Kotlin", "Android Development", "Java", "REST APIs"], ["OOP", "Testing", "SQL", "Git workflow"], ["Flutter", "CI/CD"]),
    "ios-developer": ("iOS Developer", "Mobile", "Builds native iOS applications.",
        ["Swift", "iOS Development", "OOP", "REST APIs"], ["Testing", "Git workflow", "CI/CD"], ["Flutter", "React Native"]),
    "cross-platform-mobile": ("Cross-Platform Mobile Developer", "Mobile", "Ships iOS and Android apps from one codebase.",
        ["React Native", "JavaScript", "React", "REST APIs"], ["TypeScript", "Git workflow", "Testing", "Flutter"], ["Android Development", "iOS Development", "CI/CD"]),
    "security-analyst": ("Cybersecurity Analyst", "Security", "Detects, investigates and reduces security risk.",
        ["Cybersecurity", "Networking", "Linux", "Bash"], ["Python", "Operating Systems", "AWS", "SQL"], ["Git workflow", "Docker", "Terraform"]),
    "systems-engineer-cpp": ("C++ Systems Engineer", "Systems", "Writes performance-critical systems software.",
        ["C++", "C", "Data structures & Algorithms", "Operating Systems", "Linux"], ["OOP", "Git workflow", "Testing", "System design", "Networking"], ["Python", "Bash", "CI/CD"]),
    "embedded-engineer": ("Embedded Software Engineer", "Systems", "Develops firmware for constrained devices.",
        ["C", "Embedded Systems", "C++", "Operating Systems"], ["Linux", "Networking", "Testing", "Git workflow"], ["Python", "Bash"]),
    "software-engineer": ("Software Engineer (Generalist)", "Software", "Solid engineering fundamentals applicable across stacks.",
        ["Data structures & Algorithms", "OOP", "Git workflow", "System design", "Testing"], ["Python", "SQL", "REST APIs", "Docker"], ["CI/CD", "Agile", "Linux"]),
}


@lru_cache(maxsize=1)
def load_catalogue() -> Dict[str, Role]:
    roles: Dict[str, Role] = {}
    for rid, (title, family, summary, core, important, nice) in _ROLES.items():
        skills, seen = [], set()
        for tier, names in (("core", core), ("important", important), ("nice", nice)):
            for name in names:
                key = skill_map.canonical(name)
                if key in seen:
                    continue
                seen.add(key)
                skills.append(RoleSkill(skill=skill_map.display_name(name), key=key, tier=tier, weight=ROLE_TIER_WEIGHTS[tier]))
        roles[rid] = Role(id=rid, title=title, family=family, summary=summary, skills=skills)
    return roles


def get_role(role_id: str) -> Role | None:
    return load_catalogue().get(role_id)
