"""
Skill normalisation and skill -> course-term / GitHub language+keyword mapping.

Canonical keys are lower-case. Display names match the frontend taxonomy
(e.g. "Git workflow", "System design"). Matching here is exact/alias only, so it
is deterministic. Not every skill is a programming language: ``language`` is None
for tools/concepts and a keyword query is used instead.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

from .config import REPO_ROOT

# key: (display, aliases, course_terms, github_language, github_keywords)
# course_terms are matched against Coursera "Skill gain" items (exact, normalised) and,
# at lower strength, against title / learning outcomes (word boundary).
_RAW: Dict[str, Tuple[str, List[str], List[str], Optional[str], List[str]]] = {
    "python": ("Python", ["py", "python3", "python 3", "python programming"], ["python programming", "python"], "Python", []),
    "javascript": ("JavaScript", ["js", "es6", "ecmascript", "java script"], ["javascript"], "JavaScript", []),
    "typescript": ("TypeScript", ["ts"], ["typescript"], "TypeScript", []),
    "java": ("Java", ["java programming", "core java"], ["java programming", "java"], "Java", []),
    "c++": ("C++", ["cpp", "c plus plus"], ["c++", "c++ programming", "cpp"], "C++", []),
    "c": ("C", ["c programming", "c language"], ["c programming", "c (programming language)"], "C", []),
    "c#": ("C#", ["csharp", "c sharp", ".net", "dotnet"], ["c#", "c sharp", ".net framework"], "C#", []),
    "go": ("Go", ["golang"], ["go programming language", "golang"], "Go", []),
    "rust": ("Rust", [], ["rust programming", "rust (programming language)"], "Rust", []),
    "kotlin": ("Kotlin", [], ["kotlin"], "Kotlin", []),
    "swift": ("Swift", ["swift programming"], ["swift programming", "swift (programming language)"], "Swift", []),
    "r": ("R", ["r programming", "rstudio"], ["r programming", "rstudio"], "R", []),
    "php": ("PHP", [], ["php"], "PHP", []),
    "ruby": ("Ruby", ["ruby on rails", "rails"], ["ruby", "ruby on rails"], "Ruby", []),
    "sql": ("SQL", ["structured query language", "sql queries"], ["sql", "structured query language (sql)"], None, ["sql"]),
    "bash": ("Bash", ["shell scripting", "shell", "bash scripting"], ["bash (unix shell)", "shell script", "unix shell"], "Shell", []),
    "html/css": ("HTML/CSS", ["html", "css", "html5", "css3", "html & css", "cascading style sheets (css)"], ["html", "cascading style sheets (css)", "css", "html and css", "html5"], None, ["css", "html"]),
    "react": ("React", ["react.js", "reactjs", "react js"], ["react", "react.js", "reactjs"], "JavaScript", ["react"]),
    "angular": ("Angular", ["angularjs", "angular.js"], ["angular", "angularjs"], "TypeScript", ["angular"]),
    "vue": ("Vue", ["vue.js", "vuejs"], ["vue.js", "vue"], "JavaScript", ["vue"]),
    "node.js": ("Node.js", ["node", "nodejs", "node js"], ["node.js", "nodejs"], "JavaScript", ["node"]),
    "express": ("Express", ["express.js", "expressjs"], ["express.js", "expressjs"], "JavaScript", ["express"]),
    "next.js": ("Next.js", ["nextjs", "next js"], ["next.js"], "TypeScript", ["next.js"]),
    "django": ("Django", [], ["django"], "Python", ["django"]),
    "flask": ("Flask", [], ["flask"], "Python", ["flask"]),
    "fastapi": ("FastAPI", ["fast api"], ["fastapi"], "Python", ["fastapi"]),
    "spring boot": ("Spring Boot", ["spring", "spring framework"], ["spring boot", "spring framework"], "Java", ["spring"]),
    "rest apis": ("REST APIs", ["rest", "rest api", "restful", "restful api", "restful apis", "api design", "web apis"], ["restful api", "web api", "rest api", "api design", "application programming interface (api)"], None, ["rest api"]),
    "graphql": ("GraphQL", ["graph ql"], ["graphql"], None, ["graphql"]),
    "pandas": ("Pandas", ["pandas dataframe"], ["pandas"], "Python", ["pandas"]),
    "numpy": ("NumPy", ["numpy arrays"], ["numpy"], "Python", ["numpy"]),
    "data analysis": ("Data Analysis", ["data analytics", "analytics", "data analyst"], ["data analysis", "exploratory data analysis", "data analytics"], None, ["data analysis"]),
    "data visualization": ("Data Visualization", ["dataviz", "tableau", "power bi", "matplotlib", "data viz"], ["data visualization", "tableau software", "microsoft power bi", "matplotlib", "data visualization software"], None, ["data visualization"]),
    "statistics": ("Statistics", ["statistical analysis", "probability and statistics"], ["statistics", "statistical analysis", "probability & statistics", "statistical inference"], None, ["statistics"]),
    "machine learning": ("Machine Learning", ["ml", "ml engineering"], ["machine learning", "machine learning algorithms", "applied machine learning"], "Python", ["machine learning"]),
    "scikit-learn": ("Scikit-learn", ["sklearn", "scikit learn"], ["scikit-learn"], "Python", ["scikit-learn"]),
    "deep learning": ("Deep Learning", ["dl", "neural networks", "neural network"], ["deep learning", "artificial neural network", "neural networks"], "Python", ["deep learning"]),
    "tensorflow": ("TensorFlow", ["tf", "keras"], ["tensorflow", "keras"], "Python", ["tensorflow"]),
    "pytorch": ("PyTorch", ["torch"], ["pytorch"], "Python", ["pytorch"]),
    "nlp": ("NLP", ["natural language processing", "text mining"], ["natural language processing", "nlp"], "Python", ["nlp"]),
    "computer vision": ("Computer Vision", ["cv", "image processing", "opencv"], ["computer vision", "image processing", "opencv"], "Python", ["computer vision"]),
    "generative ai": ("Generative AI", ["llm", "llms", "genai", "prompt engineering", "large language models"], ["generative ai", "large language models", "prompt engineering", "chatgpt"], "Python", ["llm"]),
    "data engineering": ("Data Engineering", ["etl", "data pipelines", "data pipeline", "data warehousing"], ["data engineering", "extract, transform, load", "etl", "data pipelines", "data warehousing", "big data"], None, ["data pipeline"]),
    "apache spark": ("Apache Spark", ["spark", "pyspark"], ["apache spark", "pyspark", "spark"], None, ["spark"]),
    "postgresql": ("PostgreSQL", ["postgres", "psql"], ["postgresql", "postgres"], None, ["postgresql"]),
    "mysql": ("MySQL", [], ["mysql"], None, ["mysql"]),
    "mongodb": ("MongoDB", ["mongo", "mongo db"], ["mongodb", "nosql"], None, ["mongodb"]),
    "redis": ("Redis", [], ["redis"], None, ["redis"]),
    "databases": ("Databases", ["database design", "dbms", "database (dbms)", "relational databases", "database management"], ["database (dbms)", "database design", "relational database", "database management system", "databases"], None, ["database"]),
    "docker": ("Docker", ["container", "containers", "dockerfile", "containerization"], ["docker", "docker products", "containerization"], None, ["docker"]),
    "kubernetes": ("Kubernetes", ["k8s"], ["kubernetes"], None, ["kubernetes"]),
    "aws": ("AWS", ["amazon web services", "s3", "ec2", "lambda"], ["amazon web services", "aws", "amazon s3"], None, ["aws"]),
    "gcp": ("GCP", ["google cloud", "google cloud platform"], ["google cloud platform", "gcp"], None, ["google cloud"]),
    "azure": ("Azure", ["microsoft azure"], ["microsoft azure", "azure"], None, ["azure"]),
    "linux": ("Linux", ["unix", "ubuntu"], ["linux", "unix"], None, ["linux"]),
    "ci/cd": ("CI/CD", ["cicd", "ci cd", "continuous integration", "github actions", "jenkins", "devops"], ["continuous integration", "continuous delivery", "devops", "ci/cd", "jenkins", "github actions"], None, ["ci/cd"]),
    "terraform": ("Terraform", ["infrastructure as code", "iac"], ["terraform", "infrastructure as code"], None, ["terraform"]),
    "git workflow": ("Git workflow", ["git", "github", "version control", "gitflow"], ["git (software)", "github", "git", "version control"], None, ["git"]),
    "networking": ("Networking", ["computer networks", "tcp/ip", "networks"], ["computer networking", "network protocols", "tcp/ip", "computer network"], None, ["networking"]),
    "testing": ("Testing", ["unit testing", "jest", "vitest", "pytest", "tdd", "test automation", "qa", "software testing"], ["software testing", "unit testing", "test automation", "test-driven development", "software quality assurance"], None, ["testing"]),
    "selenium": ("Selenium", ["webdriver"], ["selenium"], None, ["selenium"]),
    "system design": ("System design", ["distributed systems", "architecture", "software architecture", "scalability", "system architecture"], ["system design", "distributed computing", "software architecture", "scalability"], None, ["system design"]),
    "microservices": ("Microservices", ["microservice"], ["microservices"], None, ["microservices"]),
    "dsa": ("Data structures & Algorithms", ["algorithms", "data structures", "data structure", "leetcode", "data structures and algorithms", "data structures & algorithms", "competitive programming"], ["algorithms", "data structure", "data structures", "algorithm design", "algorithms and data structures"], None, ["algorithm"]),
    "oop": ("OOP", ["object oriented programming", "object-oriented programming", "object-oriented programming (oop)"], ["object-oriented programming (oop)", "object-oriented design"], None, ["object oriented"]),
    "operating systems": ("Operating Systems", ["os", "operating system"], ["operating systems", "operating system"], None, ["operating system"]),
    "cybersecurity": ("Cybersecurity", ["security", "infosec", "information security", "network security", "cyber security"], ["cybersecurity", "information security", "network security", "cyber security", "penetration test"], None, ["security"]),
    "android": ("Android Development", ["android development", "android studio"], ["android development", "android studio", "android"], "Kotlin", ["android"]),
    "ios": ("iOS Development", ["ios development", "swiftui"], ["ios development", "swiftui", "ios"], "Swift", ["ios"]),
    "flutter": ("Flutter", ["dart"], ["flutter", "dart (programming language)"], "Dart", ["flutter"]),
    "react native": ("React Native", ["reactnative"], ["react native"], "JavaScript", ["react native"]),
    "ui/ux": ("UI/UX Design", ["ux", "ui", "user experience", "user interface", "figma", "ux design", "ui design"], ["user experience (ux)", "user interface (ui)", "ux design", "figma", "user experience design", "ui design"], None, ["accessibility"]),
    "agile": ("Agile", ["scrum", "agile methodology", "agile methodologies"], ["agile methodology", "scrum", "agile software development"], None, []),
    "embedded systems": ("Embedded Systems", ["embedded", "arduino", "microcontrollers", "firmware"], ["embedded systems", "arduino", "microcontroller", "internet of things"], "C", ["embedded"]),
    "blockchain": ("Blockchain", ["smart contracts", "solidity", "web3"], ["blockchain", "smart contracts", "solidity"], "Solidity", ["blockchain"]),
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


@lru_cache(maxsize=1)
def _alias_index() -> Dict[str, str]:
    idx: Dict[str, str] = {}
    for key, (display, aliases, _terms, _lang, _kw) in _RAW.items():
        for a in [key, display, *aliases]:
            idx.setdefault(_norm(a), key)
    # Reuse the verification package's synonym file where it maps onto our catalogue.
    try:
        path = REPO_ROOT / "backend" / "verification" / "data" / "skill_aliases.json"
        data = json.loads(path.read_text(encoding="utf-8")).get("skills", {})
        for name, meta in data.items():
            target = idx.get(_norm(name))
            if target:
                for syn in meta.get("synonyms", []):
                    idx.setdefault(_norm(syn), target)
    except (OSError, ValueError):
        pass
    return idx


def canonical(skill: str) -> str:
    """Canonical lower-case key for a skill name (unknown skills just normalise)."""
    n = _norm(skill)
    return _alias_index().get(n, n)


def is_known(skill: str) -> bool:
    return canonical(skill) in _RAW


def display_name(skill: str) -> str:
    key = canonical(skill)
    if key in _RAW:
        return _RAW[key][0]
    return (skill or "").strip() or key


def known_keys() -> List[str]:
    return list(_RAW.keys())


def course_terms(key: str) -> List[str]:
    return list(_RAW[key][2]) if key in _RAW else []


def github_mapping(skill: str) -> Optional[Tuple[Optional[str], List[str]]]:
    """(language, keywords) for a skill, or None when it has no GitHub mapping."""
    key = canonical(skill)
    if key not in _RAW:
        return None
    _d, _a, _t, lang, kw = _RAW[key]
    if lang is None and not kw:
        return None
    return lang, list(kw)


@lru_cache(maxsize=1)
def term_index() -> Dict[str, List[str]]:
    """normalised Coursera skill-gain term -> canonical keys it evidences."""
    idx: Dict[str, List[str]] = {}
    for key in _RAW:
        for t in _RAW[key][2]:
            idx.setdefault(_norm(t), []).append(key)
    return idx


# Generic skills that also appear in non-technical courses (public health stats, business
# analytics, UX for marketing, ...). They never make a non-tech-category course "technical".
WEAK_KEYS = frozenset({"data analysis", "data visualization", "statistics", "ui/ux", "agile", "data engineering", "testing", "networking", "r"})
