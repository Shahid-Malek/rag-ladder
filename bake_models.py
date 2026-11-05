"""Build-time only: public, immutable model snapshots; verify them offline."""
import os
from pathlib import Path

MODELS = {
    "BAAI/bge-small-en-v1.5": "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
    "BAAI/bge-base-en-v1.5": "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
    "protectai/deberta-v3-base-prompt-injection-v2": "90c9989b1a342275dd0d1a95aad283c04e075671",
}


def bake() -> None:
    from huggingface_hub import snapshot_download
    for repo, revision in MODELS.items():
        snapshot = Path(snapshot_download(repo, revision=revision, token=False,
                        allow_patterns=["*.json", "*.txt", "*.safetensors", "*.model", "LICENSE*", "README.md"]))
        # Runtime constructors use the original repo names with local_files_only.
        (snapshot.parent.parent / "refs").mkdir(exist_ok=True)
        (snapshot.parent.parent / "refs" / "main").write_text(revision)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import socket
    def forbidden(*args, **kwargs):
        raise RuntimeError("Offline model verification attempted network access")
    socket.socket.connect = forbidden
    socket.create_connection = forbidden
    socket.getaddrinfo = forbidden
    from sentence_transformers import SentenceTransformer
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    for repo in list(MODELS)[:2]:
        SentenceTransformer(repo, device="cpu", local_files_only=True).encode("build verification")
    repo = list(MODELS)[2]
    tokenizer = AutoTokenizer.from_pretrained(repo, local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(repo, local_files_only=True).eval()
    model(**tokenizer("build verification", return_tensors="pt"))


def verify_parser():
    import socket
    def forbidden(*args, **kwargs): raise RuntimeError("Offline parser verification attempted network")
    socket.socket.connect = forbidden
    socket.create_connection = forbidden
    socket.getaddrinfo = forbidden
    # PyMuPDF Layout's package assets and Tesseract English must work offline too.
    import pymupdf
    import pymupdf4llm
    path = Path("/tmp/build-verification.pdf")
    with pymupdf.open() as document:
        document.new_page().insert_text((72, 72), "Synthetic offline parser verification")
        document.save(path)
    pymupdf4llm.to_markdown(str(path), page_chunks=True, show_progress=False)
    pymupdf4llm.to_markdown(str(path), page_chunks=True, show_progress=False,
                          force_ocr=True, use_ocr=True, ocr_language="eng")
    path.unlink()


if __name__ == "__main__":
    import sys
    verify_parser() if sys.argv[1:] == ["--parser-only"] else bake()
