"""Runtime configuration; private dataset metadata is optional and loaded on demand."""
from pathlib import Path
import os
import json
import re

from dotenv import load_dotenv

def _env(name: str, default: str = "") -> str:
    return os.getenv(name) or default


def load_datasets() -> dict[str, str]:
    """Read optional private dataset metadata; never load the example implicitly."""
    path = ROOT / "datasets.local.json"
    if not path.exists():
        return {}
    try:
        datasets = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ValueError("Invalid datasets.local.json") from None
    if not isinstance(datasets, dict):
        raise ValueError("Invalid datasets.local.json")
    for name, questions in datasets.items():
        validate_collection(name)
        if (not isinstance(questions, str) or not questions.strip()
                or Path(questions).is_absolute()
                or not (ROOT / questions).resolve().is_relative_to(ROOT.resolve())):
            raise ValueError("Invalid dataset question path")
    return datasets


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
# Disable ONNX Runtime telemetry before any native models are imported.
os.environ["ORT_DISABLE_TELEMETRY"] = _env("ORT_DISABLE_TELEMETRY", "1")
os.environ["OMP_NUM_THREADS"] = _env("OMP_NUM_THREADS", "1")
os.environ["MKL_NUM_THREADS"] = _env("MKL_NUM_THREADS", "1")
os.environ["TOKENIZERS_PARALLELISM"] = _env("TOKENIZERS_PARALLELISM", "false")
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = _env("PYTORCH_ENABLE_MPS_FALLBACK", "1")
CACHE = ROOT / ".cache" / "stage1"
SEED = 42
PG_DSN = _env("NEON_DATABASE_URL", _env("STAGE1_PG_DSN"))
# Conditional captioning: detected pictures >=5% of a page, or pictures on text-poor pages.
CAPTION_RULE = {"min_image_area_fraction": 0.05, "min_page_text_chars": 80}
LEVELS = {
    1: dict(parser="llamaindex_pdf", chunker="fixed", size=400, overlap=40,
            embedding="BAAI/bge-small-en-v1.5", tokenizer="BAAI/bge-small-en-v1.5",
            store="faiss", retrieval="dense", k=5),
    # Pinned PyMuPDF4LLM defaults to layout extraction with automatic OCR.
    2: dict(parser="pymupdf4llm", chunker="markdown_recursive", size=400, overlap=0,
            embedding="BAAI/bge-base-en-v1.5", tokenizer="BAAI/bge-base-en-v1.5",
            store="pgvector", retrieval="hybrid_rrf", rrf_k=60, candidates=20, k=5),
    3: dict(parser="docling+rapidocr", chunker="docling_hybrid+parent_child",
            size=400, overlap=0, parent_size=1500,
            embedding="BAAI/bge-m3", tokenizer="BAAI/bge-m3", store="qdrant",
            retrieval="hybrid_rerank", rrf_k=60, candidates=20, rerank_top=20,
            reranker="BAAI/bge-reranker-v2-m3", reranker_max_length=512, k=5),
}


def detect_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


DEVICE = "cpu" if _env("PARSER_MODE") == "true" else detect_device()
DATA = ROOT / ".cache" / "stage2"
APP_API_KEYS = tuple(k.strip() for k in _env("APP_API_KEYS", "").split(",") if k.strip())
ASK_RATE_LIMIT = _env("ASK_RATE_LIMIT", "10/minute")
INGEST_RATE_LIMIT = _env("INGEST_RATE_LIMIT", "3/minute")
MAX_QUESTION_CHARS = int(_env("MAX_QUESTION_CHARS", "2000"))
MAX_UPLOAD_BYTES = int(_env("MAX_UPLOAD_MB", "25")) * 1024 * 1024
LLM_MIN_INTERVAL = float(_env("LLM_MIN_INTERVAL_SECONDS", "6"))
LLM_TIMEOUT = float(_env("LLM_TIMEOUT_SECONDS", "45"))
LLM_ATTEMPTS = int(_env("LLM_ATTEMPTS", "3"))
LLM_MAX_TOKENS = int(_env("LLM_MAX_TOKENS", "700"))
OPENROUTER_MODEL = "nvidia/nemotron-3.5-super-vl:free"
LLM_CHAIN = [
    dict(provider="groq", model="openai/gpt-oss-120b", key_index=1, key_env="GROQ_KEY_1"),
    dict(provider="groq", model="openai/gpt-oss-120b", key_index=2, key_env="GROQ_KEY_2"),
    dict(provider="openrouter", model=OPENROUTER_MODEL, key_index=1, key_env="OPENROUTER_KEY_1"),
    dict(provider="openrouter", model=OPENROUTER_MODEL, key_index=2, key_env="OPENROUTER_KEY_2"),
]
for entry in LLM_CHAIN:
    entry["min_interval_seconds"] = float(_env(entry["key_env"] + "_INTERVAL_SECONDS", str(LLM_MIN_INTERVAL)))
LLM_URLS = {"groq": "https://api.groq.com/openai/v1/chat/completions",
            "openrouter": "https://openrouter.ai/api/v1/chat/completions"}
VISION_CHAIN = [entry for entry in LLM_CHAIN if entry["provider"] == "openrouter"]
L3_MIN_RERANK_SCORE = float(_env("L3_MIN_RERANK_SCORE", "0.35"))
VISUAL_CUES = r"\b(diagram|figure|architecture|flowchart|plot|graph|chart)\b"


def validate_collection(collection: str) -> str:
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", collection):
        raise ValueError("Collection must be 1–64 letters, digits, underscores or hyphens, starting with a letter")
    return collection


TURNSTILE_ENABLED = _env("TURNSTILE_ENABLED", "true").lower() == "true"
TURNSTILE_SECRET = _env("TURNSTILE_SECRET", "")
CORS_ORIGINS = tuple(value.strip() for value in _env("CORS_ORIGINS", "").split(",") if value.strip())
TRUSTED_PROXY_IPS = _env("TRUSTED_PROXY_IPS", "")
SESSION_MAX_DOCS = int(_env("SESSION_MAX_DOCS", "2"))
SESSION_MAX_QUESTIONS = int(_env("SESSION_MAX_QUESTIONS", "10"))
SESSION_IDLE_MINUTES = int(_env("SESSION_IDLE_MINUTES", "60"))
SESSION_ABSOLUTE_MINUTES = int(_env("SESSION_ABSOLUTE_MINUTES", "120"))
DEMO_MAX_UPLOAD_BYTES = int(_env("DEMO_MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))
DEMO_MAX_PAGES = int(_env("DEMO_MAX_PAGES", "30"))
DEMO_PARSE_TIMEOUT_SECONDS = float(_env("DEMO_PARSE_TIMEOUT_SECONDS", "120"))
DEMO_NOTICE = _env("DEMO_NOTICE", "This demo processes files temporarily on our server. Your question, relevant excerpts and recent Level 2 conversation are sent to external AI providers. Neon stores Level 2 embeddings and conversation history, plus session metadata. Some free AI services may retain prompts or use them for training. Ending or timing out a session requests deletion of live files, embeddings and conversation; cleanup may be delayed. Provider records and database backups may remain longer. Application logs contain operational metadata, not your document or question text. Use only non-sensitive material you are permitted to share.")
HISTORY_TOKEN_BUDGET = int(_env("HISTORY_TOKEN_BUDGET", "1200"))
HISTORY_ANSWER_TURNS = int(_env("HISTORY_ANSWER_TURNS", "3"))
INJECTION_BLOCK_THRESHOLD = float(_env("INJECTION_BLOCK_THRESHOLD", "0.995"))
DOC_FLAG_THRESHOLD = float(_env("DOC_FLAG_THRESHOLD", "0.50"))
DOC_BLOCK_THRESHOLD = float(_env("DOC_BLOCK_THRESHOLD", "0.90"))
MAX_JSON_BODY_BYTES = int(_env("MAX_JSON_BODY_BYTES", str(16 * 1024)))
MULTIPART_OVERHEAD_BYTES = int(_env("MULTIPART_OVERHEAD_BYTES", str(64 * 1024)))
MAX_UPLOAD_BODY_BYTES = int(_env("MAX_UPLOAD_BODY_BYTES", str(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES)))
DEMO_MAX_UPLOAD_BODY_BYTES = int(_env("DEMO_MAX_UPLOAD_BODY_BYTES", str(DEMO_MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES)))
MAX_PAGES = int(_env("MAX_PAGES", str(DEMO_MAX_PAGES)))
MAX_EXTRACTED_CHARS = int(_env("MAX_EXTRACTED_CHARS", "1000000"))
MAX_PARSED_OUTPUT_BYTES = int(_env("MAX_PARSED_OUTPUT_BYTES", str(16 * 1024 * 1024)))
MAX_CHUNKS = int(_env("MAX_CHUNKS", "2000"))
DOCUMENT_MEMORY_BYTES = int(_env("DOCUMENT_MEMORY_BYTES", str(4 * 1024**3)))
MAX_IMAGE_PIXELS = int(_env("MAX_IMAGE_PIXELS", "20000000"))
MAX_IMAGE_DIMENSION = int(_env("MAX_IMAGE_DIMENSION", "2000"))
MAX_CONCURRENT_INGESTS = int(_env("MAX_CONCURRENT_INGESTS", "1"))
MAX_CONCURRENT_QUESTIONS = int(_env("MAX_CONCURRENT_QUESTIONS", "2"))
CAPACITY_RETRY_AFTER_SECONDS = int(_env("CAPACITY_RETRY_AFTER_SECONDS", "10"))
GLOBAL_DAILY_PROVIDER_ATTEMPTS = int(_env("GLOBAL_DAILY_PROVIDER_ATTEMPTS", "1000"))
SESSION_MAX_FAILED_ATTEMPTS = int(_env("SESSION_MAX_FAILED_ATTEMPTS", "3"))

# Hosted mode is the safe default; local administrative access requires explicit opt-out.
HOSTED_MODE = _env("HOSTED_MODE", "true").lower()
if HOSTED_MODE not in ("true", "false"):
    raise ValueError("HOSTED_MODE must be true or false")
HOSTED_MODE = HOSTED_MODE == "true"
PUBLIC_ORIGIN = _env("PUBLIC_ORIGIN")
TURNSTILE_SITE_KEY = _env("TURNSTILE_SITE_KEY")
TURNSTILE_HOSTNAME = _env("TURNSTILE_HOSTNAME")
TURNSTILE_ACTION = _env("TURNSTILE_ACTION", "session_start")
IP_REQUESTS_PER_MINUTE = int(_env("IP_REQUESTS_PER_MINUTE", "60"))
MAX_RATE_IPS = int(_env("MAX_RATE_IPS", "4096"))
STATUS_RATE_LIMIT = _env("STATUS_RATE_LIMIT", "30/minute")
MAX_ACTIVE_SESSIONS = int(_env("MAX_ACTIVE_SESSIONS", "4"))
MAX_RUNTIME_BYTES = int(_env("MAX_RUNTIME_BYTES", str(512 * 1024**2)))
MAX_DATABASE_BYTES = int(_env("MAX_DATABASE_BYTES", str(250 * 1024**2)))
INGEST_RESERVE_BYTES = int(_env("INGEST_RESERVE_BYTES", str(64 * 1024**2)))
REQUEST_TIMEOUT_SECONDS = float(_env("REQUEST_TIMEOUT_SECONDS", "90"))
INGEST_TIMEOUT_SECONDS = float(_env("INGEST_TIMEOUT_SECONDS", "180"))
LLM_TOTAL_TIMEOUT_SECONDS = float(_env("LLM_TOTAL_TIMEOUT_SECONDS", "60"))
MAX_PROVIDER_RESPONSE_BYTES = int(_env("MAX_PROVIDER_RESPONSE_BYTES", str(64 * 1024)))
MAX_ANSWER_CHARS = int(_env("MAX_ANSWER_CHARS", "8000"))
MAX_RESPONSE_BYTES = int(_env("MAX_RESPONSE_BYTES", str(2 * 1024**2)))
SQL_STATEMENT_TIMEOUT_MS = int(_env("SQL_STATEMENT_TIMEOUT_MS", "10000"))
SQL_LOCK_TIMEOUT_MS = int(_env("SQL_LOCK_TIMEOUT_MS", "2000"))
SQL_IDLE_TRANSACTION_TIMEOUT_MS = int(_env("SQL_IDLE_TRANSACTION_TIMEOUT_MS", "10000"))

for _name in ("MAX_ACTIVE_SESSIONS", "MAX_RUNTIME_BYTES", "MAX_DATABASE_BYTES", "INGEST_RESERVE_BYTES",
              "IP_REQUESTS_PER_MINUTE", "MAX_RATE_IPS", "REQUEST_TIMEOUT_SECONDS", "INGEST_TIMEOUT_SECONDS",
              "LLM_TOTAL_TIMEOUT_SECONDS", "MAX_PROVIDER_RESPONSE_BYTES", "MAX_ANSWER_CHARS", "MAX_RESPONSE_BYTES",
              "SQL_STATEMENT_TIMEOUT_MS", "SQL_LOCK_TIMEOUT_MS", "SQL_IDLE_TRANSACTION_TIMEOUT_MS"):
    if not 0 < globals()[_name] < float("inf"):
        raise ValueError("Invalid positive setting: " + _name)

MAX_DB_ACTIVE_SECONDS_PER_DAY = int(_env("MAX_DB_ACTIVE_SECONDS_PER_DAY", "3600"))
DB_ACTIVITY_WINDOW_SECONDS = 600
if not 600 <= MAX_DB_ACTIVE_SECONDS_PER_DAY <= 3600:
    raise ValueError("Invalid database activity budget")

MAX_TRACE_BYTES = int(_env("MAX_TRACE_BYTES", str(1024 * 1024)))
if MAX_TRACE_BYTES <= 0:
    raise ValueError("Invalid trace byte limit")
