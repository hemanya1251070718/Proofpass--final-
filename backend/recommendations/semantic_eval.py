"""
Offline evaluation of skill-NAME matching: alias vs Sentence-Transformers vs hybrid.

Run (needs `pip install sentence-transformers`, ~1 GB incl. torch):
    python -m backend.recommendations.semantic_eval

Semantic similarity here only resolves what a *name* refers to. It never awards or changes
evidence state, and it is not wired into scoring (see EVALUATION RESULT in the docs).
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import time

from . import skill_map

# (input phrase, expected canonical key or None).  Manually labelled.
ALIAS_CASES = [
    ("React.js", "react"), ("ReactJS", "react"), ("Node", "node.js"), ("NodeJS", "node.js"), ("Postgres", "postgresql"),
    ("k8s", "kubernetes"), ("Amazon Web Services", "aws"), ("JS", "javascript"), ("TS", "typescript"), ("Py", "python"),
    ("scikit learn", "scikit-learn"), ("GitHub Actions", "ci/cd"), ("Unit Testing", "testing"), ("Golang", "go"),
    ("C Sharp", "c#"), ("Google Cloud", "gcp"), ("MS Azure", "azure"), ("Microsoft Azure", "azure"), ("DSA", "dsa"),
    ("Version Control", "git workflow"), ("RESTful APIs", "rest apis"), ("Natural Language Processing", "nlp"),
    ("LLMs", "generative ai"), ("Dockerfile", "docker"), ("Infrastructure as Code", "terraform"), ("PyTorch", "pytorch"),
    ("Java", "java"), ("JavaScript", "javascript"), ("React Native", "react native"), ("Figma", "ui/ux"),
]
PARAPHRASE_CASES = [
    ("Cascading Style Sheets", "html/css"), ("Web page styling", "html/css"), ("Kubernetes orchestration", "kubernetes"),
    ("Amazon cloud services", "aws"), ("Neural nets", "deep learning"), ("Natural language understanding", "nlp"),
    ("Large language model applications", "generative ai"), ("Relational database design", "databases"),
    ("Object oriented design", "oop"), ("Test automation frameworks", "testing"), ("Mobile apps for Android phones", "android"),
    ("Distributed system architecture", "system design"), ("Server-side JavaScript", "node.js"), ("ML modelling", "machine learning"),
    ("Predictive modelling", "machine learning"), ("Exploratory analysis of datasets", "data analysis"),
    ("Dashboards and charts", "data visualization"), ("Linux command line", "linux"), ("Shell scripts", "bash"),
    ("Continuous integration pipelines", "ci/cd"), ("Penetration testing", "cybersecurity"),
    ("Microcontroller programming", "embedded systems"), ("Image recognition", "computer vision"),
    ("Big data processing", "apache spark"), ("Containerisation", "docker"),
]
NEGATIVE_CASES = [(p, None) for p in [
    "Photoshop", "Public speaking", "Leadership", "Project management", "Microsoft Excel", "Salesforce", "SAP ERP",
    "Accounting", "Graphic design", "Video editing", "Technical writing", "Customer support", "Spanish language",
    "Go-to-market strategy", "Swift delivery logistics", "Reactive programming", "Express shipping", "R&D management",
    "Rust removal", "Ruby gemstones", "Spring season sales", "Flask of water", "Coffee brewing", "Negotiation",
]]
CASES = ALIAS_CASES + PARAPHRASE_CASES + NEGATIVE_CASES


def alias_predict(text: str):
    key = skill_map.canonical(text)
    return key if skill_map.is_known(text) else None


class Semantic:
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer
        t0 = time.perf_counter()
        self.model = SentenceTransformer(model_name, device="cpu")
        self.load_s = time.perf_counter() - t0
        self.labels, self.keys = [], []
        for key in skill_map.known_keys():
            names = {skill_map.display_name(key), key}
            names |= {a for a, k in skill_map._alias_index().items() if k == key}
            for n in sorted(names):
                self.labels.append(n)
                self.keys.append(key)
        self.matrix = self.model.encode(self.labels, normalize_embeddings=True, convert_to_numpy=True)

    def predict(self, text: str):
        v = self.model.encode([text], normalize_embeddings=True, convert_to_numpy=True)[0]
        sims = self.matrix @ v
        i = int(sims.argmax())
        return self.keys[i], float(sims[i])


def metrics(preds, cases):
    tp = sum(1 for p, (_t, e) in zip(preds, cases) if p is not None and p == e)
    fp_wrong = sum(1 for p, (_t, e) in zip(preds, cases) if p is not None and e is not None and p != e)
    fp_neg = sum(1 for p, (_t, e) in zip(preds, cases) if p is not None and e is None)
    made = tp + fp_wrong + fp_neg
    positives = sum(1 for _t, e in cases if e is not None)
    return {"predictions_made": made, "true_matches": tp, "wrong_skill": fp_wrong, "false_matches_on_negatives": fp_neg,
            "precision": round(tp / made, 3) if made else None, "recall": round(tp / positives, 3)}


def main() -> int:
    out = {"cases": {"alias_group": len(ALIAS_CASES), "paraphrase_group": len(PARAPHRASE_CASES), "negatives": len(NEGATIVE_CASES)}}
    t0 = time.perf_counter()
    alias_preds = [alias_predict(t) for t, _ in CASES]
    out["alias_total_ms"] = round((time.perf_counter() - t0) * 1000, 3)
    out["alias"] = metrics(alias_preds, CASES)
    out["alias_wrong_or_missed"] = [(t, e, p) for (t, e), p in zip(CASES, alias_preds) if p != e]
    try:
        sem = Semantic()
    except Exception as exc:  # pragma: no cover - environment dependent
        out["semantic"] = f"unavailable: {type(exc).__name__}: {exc}"
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 1
    raw = []
    lat = []
    for t, _ in CASES:
        s = time.perf_counter()
        raw.append(sem.predict(t))
        lat.append((time.perf_counter() - s) * 1000)
    out["semantic_model_load_s"] = round(sem.load_s, 2)
    out["semantic_latency_ms"] = {"median": round(statistics.median(lat), 1), "p95": round(sorted(lat)[int(len(lat) * 0.95) - 1], 1)}
    try:
        import psutil  # optional
        out["process_rss_mb"] = round(psutil.Process(os.getpid()).memory_info().rss / 1e6)
    except Exception:
        out["process_rss_mb"] = "psutil not installed"
    out["thresholds"] = {}
    for tau in (0.50, 0.60, 0.70, 0.80):
        sem_preds = [k if s >= tau else None for k, s in raw]
        hybrid = [a if a is not None else sp for a, sp in zip(alias_preds, sem_preds)]
        out["thresholds"][str(tau)] = {
            "semantic_only": metrics(sem_preds, CASES), "hybrid_alias_then_semantic": metrics(hybrid, CASES),
            "hybrid_errors": [(t, e, p) for (t, e), p in zip(CASES, hybrid) if p != e and p is not None],
        }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
