"""Local, subject-isolated parsing, token chunking, embedding and retrieval."""
from __future__ import annotations

import gc
import atexit
from collections import OrderedDict
import hashlib
import importlib.metadata
import importlib.util
import json
import logging
import os
import random
import re
import sys
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import config
import protection
from config import CACHE, CAPTION_RULE, DATA, DEVICE, LEVELS, PG_DSN, ROOT, SEED, validate_collection

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
CACHE_VERSION = 1
_pg_pools = {}
_pool_lock = threading.Lock()
_bm25_cache = OrderedDict()
_bm25_lock = threading.Lock()


def postgres_pool(dsn: str | None = None):
    from psycopg_pool import ConnectionPool
    dsn = PG_DSN if dsn is None else dsn
    with _pool_lock:
        if dsn not in _pg_pools:
            # Pool errors may include connection details; API errors use safe codes instead.
            logging.getLogger("psycopg.pool").disabled = True
            import session_store
            hosted_settings = session_store.pool_settings(dsn) if config.HOSTED_MODE else {}
            _pg_pools[dsn] = ConnectionPool(dsn, min_size=1, max_size=4, timeout=5, open=True,
                                           kwargs=dict(autocommit=True, connect_timeout=5, **hosted_settings,
                                                       options=f"-c statement_timeout={config.SQL_STATEMENT_TIMEOUT_MS} "
                                                               f"-c lock_timeout={config.SQL_LOCK_TIMEOUT_MS} "
                                                               f"-c idle_in_transaction_session_timeout={config.SQL_IDLE_TRANSACTION_TIMEOUT_MS} "
                                                               f"-c transaction_timeout={config.SQL_STATEMENT_TIMEOUT_MS} "
                                                               + ("-c search_path=rag,public" if config.HOSTED_MODE else "")),
                                           close_returns=True, name="rag-db")
        return _pg_pools[dsn]


def postgres_connection(dsn: str | None = None):
    import psycopg
    from psycopg.rows import tuple_row
    from psycopg_pool import PoolTimeout
    try:
        connection = postgres_pool(dsn).getconn()
    except PoolTimeout:
        raise psycopg.OperationalError("PostgreSQL connection unavailable") from None
    connection.row_factory = tuple_row
    return connection


def close_postgres_pools() -> None:
    with _pool_lock:
        for pool in _pg_pools.values():
            pool.close()
        _pg_pools.clear()


atexit.register(close_postgres_pools)


def query_timings() -> dict:
    return dict.fromkeys(("validation", "guardrails", "history", "rewrite", "encode", "dense",
                          "bm25", "fuse", "answer", "citation_check", "total"), 0.0)


def invalidate_bm25(collection: str, signature: str | None = None) -> None:
    with _bm25_lock:
        for key in list(_bm25_cache):
            if key[0] == collection and key[1] != signature:
                del _bm25_cache[key]


def bm25_index(state: dict):
    from rank_bm25 import BM25Okapi
    key = (state["subject"], state["signature"])
    with _bm25_lock:
        if key not in _bm25_cache:
            for old in list(_bm25_cache):
                if old[0] == state["subject"]:
                    del _bm25_cache[old]
            _bm25_cache[key] = BM25Okapi([lexical_tokens(c["text"]) for c in state["chunks"]])
        _bm25_cache.move_to_end(key)
        while len(_bm25_cache) > 4:
            _bm25_cache.popitem(last=False)
        return _bm25_cache[key]


def configure_runtime() -> None:
    """Set process-start settings before loading native numerical libraries."""
    environment = dict(os.environ)
    environment["PYTHONHASHSEED"] = str(SEED)
    if sys.platform == "darwin":
        specification = importlib.util.find_spec("torch")
        if specification and specification.origin:
            directory = str(Path(specification.origin).parent / "lib")
            current = environment.get("DYLD_LIBRARY_PATH", "")
            # FAISS and PyTorch must load one shared OpenMP runtime on macOS.
            if current.split(os.pathsep)[0] != directory:
                environment["DYLD_LIBRARY_PATH"] = directory + (os.pathsep + current if current else "")
    if environment != dict(os.environ):
        os.execve(sys.executable, [sys.executable, *sys.argv], environment)


def log(message: str) -> None:
    print(time.strftime("[%H:%M:%S] ") + message, flush=True)


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def seed_everything() -> str:
    import numpy as np
    import torch
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True, warn_only=True)
    if DEVICE == "cuda":
        torch.cuda.manual_seed_all(SEED)
        return "cuda"
    if DEVICE == "mps":
        torch.mps.manual_seed(SEED)
        return "mps"
    return "cpu"


def release_memory() -> None:
    import torch
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def require_postgres() -> None:
    if config.HOSTED_MODE:
        return
    connection = postgres_connection()
    try:
        connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
    finally:
        connection.close()


def fingerprint(level: int, subject: str, device: str) -> tuple[str, list[Path]]:
    if subject not in config.load_datasets() or level not in LEVELS:
        raise ValueError("Unknown level or subject")
    files = sorted((ROOT / subject).rglob("*.pdf"))
    if not files:
        raise ValueError(f"No PDFs in {subject}")
    dependencies = ("torch", "transformers", "sentence-transformers", "llama-index-readers-file",
                    "pymupdf4llm", "docling", "docling-core", "qdrant-client", "pgvector", "faiss-cpu")
    values = {"version": CACHE_VERSION, "config": LEVELS[level], "caption_rule": CAPTION_RULE,
              "seed": SEED, "device": device,
              "packages": {name: importlib.metadata.version(name) for name in dependencies},
              "files": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest(), files


def token_count(text: str, tokenizer: Any) -> int:
    return len(tokenizer.encode(text, add_special_tokens=False))


def token_windows(text: str, tokenizer: Any, size: int, overlap: int = 0) -> list[tuple[str, int, int]]:
    """Slice source characters at tokenizer offsets, preserving punctuation and spacing."""
    offsets = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)["offset_mapping"]
    windows = []
    start = 0
    while start < len(offsets):
        end = min(start + size, len(offsets))
        left, right = offsets[start][0], offsets[end - 1][1]
        value = text[left:right]
        # Retokenizing a substring can differ at its first token.
        while token_count(value, tokenizer) > size and end > start + 1:
            end -= 1
            right = offsets[end - 1][1]
            value = text[left:right]
        if value.strip():
            windows.append((value, left, right))
        if end == len(offsets):
            break
        start = max(start + 1, end - overlap)
    return windows


def markdown_parts(text: str, initial_headings: list[str] | None = None) -> list[tuple[str, list[str], int]]:
    """Preserve heading ownership and source offsets before recursive splitting."""
    parts, headings, start = [], list(initial_headings or []), 0
    for match in re.finditer(r"(?m)^(#{1,6})\s+(.+)$", text):
        if match.start() > start:
            parts.append((text[start:match.start()], headings.copy(), start))
        depth, heading = len(match[1]), match[2].strip()
        headings = headings[:depth - 1] + [heading]
        start = match.start()
    if start < len(text):
        parts.append((text[start:], headings.copy(), start))
    return parts


def recursive_windows(text: str, tokenizer: Any, size: int, offset: int = 0,
                      separators: tuple[str, ...] = ("\n\n", "\n", ". ", " ")) -> list[tuple[str, int, int]]:
    if token_count(text, tokenizer) <= size:
        return [(text, offset, offset + len(text))] if text.strip() else []
    if not separators:
        return [(value, offset + left, offset + right) for value, left, right in token_windows(text, tokenizer, size)]
    separator = separators[0]
    boundaries = [0] + [m.end() for m in re.finditer(re.escape(separator), text)] + [len(text)]
    boundaries = sorted(set(boundaries))
    output, start, end = [], 0, 0
    for left, right in zip(boundaries, boundaries[1:]):
        if token_count(text[start:right], tokenizer) <= size:
            end = right
            continue
        if end > start:
            output.append((text[start:end], offset + start, offset + end))
        if token_count(text[left:right], tokenizer) > size:
            output.extend(recursive_windows(text[left:right], tokenizer, size, offset + left, separators[1:]))
            start = end = right
        else:
            start, end = left, right
    if end > start and text[start:end].strip():
        output.append((text[start:end], offset + start, offset + end))
    return output


def make_docling_converter(device: str = "cpu") -> Any:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    options = PdfPipelineOptions()
    options.do_ocr = True
    options.ocr_options = RapidOcrOptions(backend="onnxruntime", lang=["en"])
    options.do_table_structure = True
    options.do_picture_description = False  # Stage 2: conditional visual captions
    options.do_picture_classification = False
    options.enable_remote_services = False
    options.accelerator_options = AcceleratorOptions(device=device, num_threads=4)
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


def caption_candidates(document: Any, pages: list[dict]) -> list[dict]:
    candidates = []
    text_sizes = {p["pages"][0]: len(re.sub(r"\s", "", p["text"])) for p in pages}
    for picture in document.pictures:
        for provenance in picture.prov:
            page = document.pages[provenance.page_no]
            box = provenance.bbox
            area = abs((box.r - box.l) * (box.t - box.b))
            fraction = area / (page.size.width * page.size.height)
            reason = "large_picture" if fraction >= CAPTION_RULE["min_image_area_fraction"] else "text_poor_page"
            if fraction >= CAPTION_RULE["min_image_area_fraction"] or text_sizes[provenance.page_no] < CAPTION_RULE["min_page_text_chars"]:
                candidates.append(dict(file=pages[0]["file"], page=provenance.page_no,
                                       image=picture.self_ref, area_fraction=fraction, reason=reason))
    return candidates


def parse_file(path: Path, level: int, subject: str, converter: Any = None, force_ocr: bool = False) -> dict:
    file = path.relative_to(ROOT).as_posix()
    document = None
    if level == 1:
        from llama_index.readers.file import PDFReader
        texts = [d.text for d in PDFReader().load_data(path)]
    elif level == 2:
        import pymupdf4llm
        options = dict(force_ocr=True, use_ocr=True, ocr_language="eng") if force_ocr else {}
        texts = [p["text"] for p in pymupdf4llm.to_markdown(str(path), page_chunks=True, show_progress=False, **options)]
    else:
        result = converter.convert(path, raises_on_error=True)
        if result.status.value != "success":
            raise RuntimeError(f"Incomplete Docling conversion: {file}: {result.status}; {result.errors}")
        document = result.document
        texts = [document.export_to_markdown(page_no=n) for n in sorted(document.pages)]
    pages = [dict(subject=subject, file=file, pages=[n], heading_path=[], text=text)
             for n, text in enumerate(texts, 1)]
    return dict(pages=pages, document=document.export_to_dict() if document else None,
                caption_candidates=caption_candidates(document, pages) if document else [])


def chunk_pages(parsed: list[dict], level: int, subject: str, tokenizer: Any) -> tuple[list[dict], dict]:
    cfg, chunks, parents = LEVELS[level], [], {}

    def append(text: str, file: str, pages: list[int], headings: list[str], **extra: Any) -> None:
        if not text.strip():
            return
        count = token_count(text, tokenizer)
        if count > cfg["size"]:
            raise ValueError(f"Oversized child: {file}: {count}")
        chunks.append(dict(subject=subject, file=file, pages=sorted(set(pages)), heading_path=headings,
                           chunk_id=f"L{level}:{subject}:c{len(chunks):06d}", text=text, tokens=count, **extra))

    for entry in parsed:
        if level != 3:
            previous_headings: list[str] = []
            for page in entry["pages"]:
                parts = [(page["text"], [], 0)] if level == 1 else markdown_parts(page["text"], previous_headings)
                if parts:
                    previous_headings = parts[-1][1]
                for text, headings, offset in parts:
                    windows = token_windows(text, tokenizer, cfg["size"], cfg["overlap"]) if level == 1 else recursive_windows(text, tokenizer, cfg["size"])
                    for value, left, right in windows:
                        append(value, page["file"], page["pages"], headings,
                               char_start=offset + left, char_end=offset + right)
        else:
            from docling_core.types.doc import DoclingDocument
            from docling.chunking import HybridChunker
            from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
            document = DoclingDocument.model_validate(entry["document"])
            chunker = HybridChunker(tokenizer=HuggingFaceTokenizer(tokenizer=tokenizer, max_tokens=cfg["size"]), merge_peers=True)
            for source_number, chunk in enumerate(chunker.chunk(dl_doc=document)):
                pages = sorted({p.page_no for item in chunk.meta.doc_items for p in item.prov})
                if not pages:
                    raise ValueError("Docling chunk lacks page provenance")
                for text, left, right in token_windows(chunker.contextualize(chunk), tokenizer, cfg["size"]):
                    append(text, entry["pages"][0]["file"], pages, chunk.meta.headings or [],
                           source_items=[item.self_ref for item in chunk.meta.doc_items], span_source=source_number,
                           char_start=left, char_end=right)
    if level == 3:
        group: list[dict] = []

        def finish_parent() -> None:
            if not group:
                return
            parent_id = f"L3:{subject}:p{len(parents):06d}"
            text = "\n\n".join(child["text"] for child in group)
            parents[parent_id] = dict(subject=subject, file=group[0]["file"],
                                     pages=sorted({p for c in group for p in c["pages"]}),
                                     heading_path=group[0]["heading_path"], chunk_id=parent_id,
                                     text=text, tokens=token_count(text, tokenizer))
            for child in group:
                child["parent_id"] = parent_id

        for child in chunks:
            if group and (child["file"] != group[0]["file"] or child["heading_path"] != group[0]["heading_path"] or
                          token_count("\n\n".join(c["text"] for c in group + [child]), tokenizer) > cfg["parent_size"]):
                finish_parent()
                group = []
            group.append(child)
        finish_parent()
    return chunks, parents


def prepare(level: int, subject: str, rebuild: bool, device: str) -> dict:
    import numpy as np
    from transformers import AutoTokenizer
    signature, files = fingerprint(level, subject, device)
    directory = CACHE / f"level_{level}" / subject / signature[:16]
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "prepared.json"
    if manifest.exists() and not rebuild:
        log(f"L{level}/{subject}: parsed output, chunks and embedding cache hit")
        state = read_json(manifest)
        state["cache_hit"] = True
    else:
        parsed, parse_seconds = [], 0.0
        converter = None
        for number, path in enumerate(files, 1):
            artifact = directory / f"parsed_{number:03d}.json"
            if artifact.exists() and not rebuild:
                entry = read_json(artifact)
            else:
                log(f"L{level}/{subject}: parsing {number}/{len(files)}")
                start = time.perf_counter()
                if level == 3 and converter is None:
                    converter = make_docling_converter(device)
                entry = parse_file(path, level, subject, converter)
                entry["parse_seconds"] = time.perf_counter() - start
                save_json(artifact, entry)
            parsed.append(entry)
            parse_seconds += entry["parse_seconds"]
        del converter
        release_memory()
        tokenizer = AutoTokenizer.from_pretrained(LEVELS[level]["tokenizer"])
        log(f"L{level}/{subject}: chunking with {LEVELS[level]['chunker']}")
        start = time.perf_counter()
        chunks, parents = chunk_pages(parsed, level, subject, tokenizer)
        chunk_seconds = time.perf_counter() - start
        if not chunks:
            raise ValueError(f"Empty index: L{level}/{subject}")
        state = dict(level=level, subject=subject, signature=signature, chunks=chunks, parents=parents,
                     pages=[p for entry in parsed for p in entry["pages"]],
                     caption_candidates=[p for entry in parsed for p in entry["caption_candidates"]],
                     timings=dict(parse=parse_seconds, chunk=chunk_seconds), cache_hit=False)
        save_json(directory / "chunks.json", dict(chunks=chunks, parents=parents))
        start = time.perf_counter()
        model = load_encoder(level, device)
        log(f"L{level}/{subject}: embedding {len(chunks)} chunks on {device}")
        vectors = model.encode([c["text"] for c in chunks], batch_size=8 if level != 3 else 2,
                               normalize_embeddings=True, show_progress_bar=True).astype("float32")
        if not np.isfinite(vectors).all():
            raise ValueError("Non-finite embeddings")
        temporary = directory / "embeddings.tmp.npy"
        np.save(temporary, vectors)
        temporary.replace(directory / "embeddings.npy")
        state["timings"]["embed"] = time.perf_counter() - start
        del model
        release_memory()
        save_json(manifest, state)
    state["directory"] = directory
    state["vectors"] = np.load(directory / "embeddings.npy")
    return state


def load_encoder(level: int, device: str) -> Any:
    import torch
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(LEVELS[level]["embedding"], device=device,
                               local_files_only=config.HOSTED_MODE and level in (1, 2),
                               model_kwargs={"dtype": torch.float16 if device == "mps" else torch.float32})


def l2_dense_query(store: dict, vector: Any, count: int):
    if "session_id" in store:
        import session_store
        return session_store.dense_query(store, vector, count)
    from psycopg import sql
    query = sql.SQL("SELECT id, 1 - (embedding <=> %s) AS score FROM {} ORDER BY embedding <=> %s, id LIMIT %s").format(store["table"])
    # Keep cosine search exact even if a legacy database still has a vector index.
    with store["client"].transaction():
        store["client"].execute("SET LOCAL enable_indexscan = off")
        store["client"].execute("SET LOCAL enable_bitmapscan = off")
        store["client"].execute("SET LOCAL enable_indexonlyscan = off")
        return store["client"].execute(query, (vector, vector, count)).fetchall()


def open_store(state: dict, rebuild: bool = False, timings: dict | None = None) -> dict:
    import numpy as np
    from rank_bm25 import BM25Okapi
    level, subject, directory = state["level"], state["subject"], state["directory"]
    chunks, vectors = state["chunks"], state["vectors"]
    marker = directory / ("api_index.json" if state.get("api") and level == 2 else "index.json")
    if state.get("api") and level == 2 and directory.resolve().is_relative_to(CACHE.resolve()):
        marker = collection_directory(subject, level) / "index_state.json"
        marker.parent.mkdir(parents=True, exist_ok=True)
    cached = marker.exists() and not rebuild
    start = time.perf_counter()
    store: dict = {}
    name = f"stage1_l{level}_{subject.lower()}"
    if state.get("api"):
        name = f"stage2_l{level}_{hashlib.sha256(subject.encode()).hexdigest()[:24]}"
    if level == 1:
        import faiss
        path = directory / "index.faiss"
        if cached and path.exists():
            store["client"] = faiss.read_index(str(path))
        else:
            cached = False
            store["client"] = faiss.IndexFlatIP(vectors.shape[1])
            store["client"].add(np.ascontiguousarray(vectors))
            temporary = path.with_suffix(".tmp")
            faiss.write_index(store["client"], str(temporary))
            temporary.replace(path)
    elif level == 2:
        if config.HOSTED_MODE and state.get("api"):
            import session_store
            hosted, cached = session_store.open_vectors(state, cached)
            store.update(hosted)
        else:
            from psycopg import sql
            from pgvector.psycopg import register_vector
            connection = postgres_connection()
            try:
                register_vector(connection)
                index_signature = state["signature"]
                table = sql.Identifier(name)
                connection.execute("CREATE TABLE IF NOT EXISTS stage1_index_state (name text PRIMARY KEY, signature text NOT NULL)")
                stored = connection.execute("SELECT signature FROM stage1_index_state WHERE name = %s", (name,)).fetchone()
                cached = cached and stored is not None and stored[0] == index_signature
                connection.execute(sql.SQL("CREATE TABLE IF NOT EXISTS {} (id integer PRIMARY KEY, embedding vector({}))").format(table, sql.Literal(vectors.shape[1])))
                count = connection.execute(sql.SQL("SELECT count(*) FROM {}").format(table)).fetchone()[0]
                if not cached or count != len(chunks):
                    cached = False
                    with connection.transaction():
                        connection.execute(sql.SQL("TRUNCATE {}").format(table))
                        with connection.cursor() as cursor:
                            cursor.executemany(sql.SQL("INSERT INTO {} VALUES (%s, %s)").format(table),
                                               [(i, vector) for i, vector in enumerate(vectors)])
                        connection.execute("INSERT INTO stage1_index_state VALUES (%s, %s) ON CONFLICT (name) DO UPDATE SET signature = EXCLUDED.signature",
                                           (name, index_signature))
                store.update(client=connection, table=table)
            except Exception:
                connection.close()
                raise
    else:
        from qdrant_client import QdrantClient, models
        client = QdrantClient(path=str(directory / "qdrant"))
        if not client.collection_exists(name) or not cached or client.count(name).count != len(chunks):
            cached = False
            if client.collection_exists(name):
                client.delete_collection(name)
            client.create_collection(name, vectors_config=models.VectorParams(size=vectors.shape[1], distance=models.Distance.COSINE))
            for start_i in range(0, len(chunks), 128):
                client.upsert(name, points=[models.PointStruct(id=i, vector=vectors[i].tolist(),
                              payload={k: chunks[i][k] for k in ("subject", "file", "pages", "heading_path", "chunk_id")})
                              for i in range(start_i, min(start_i + 128, len(chunks)))])
        store.update(client=client, collection=name)
    if level != 1:
        bm25_start = time.perf_counter()
        store["bm25"] = (bm25_index(state) if level == 2 and state.get("api") else
                         BM25Okapi([lexical_tokens(c["text"]) for c in chunks]))
        if timings is not None:
            timings["bm25"] += time.perf_counter() - bm25_start
    elapsed = time.perf_counter() - start
    if cached:
        state["timings"]["index"] = read_json(marker)["seconds"]
    else:
        state["timings"]["index"] = elapsed
        save_json(marker, dict(signature=state["signature"], seconds=elapsed))
    state["index_cache_hit"] = cached
    state["index_open_seconds"] = elapsed
    if not state.get("api"):
        log(f"L{level}/{subject}: {LEVELS[level]['store']} ready ({len(chunks)} vectors; cache={cached})")
    return store


def lexical_tokens(text: str) -> list[str]:
    return re.findall(r"\w+", text.casefold()) or [""]


def fuse_rrf(dense: list[tuple[int, float]], sparse: list[tuple[int, float]], constant: int) -> list[dict]:
    merged: dict[int, dict] = {}
    for label, hits in (("dense", dense), ("bm25", sparse)):
        for rank, (index, score) in enumerate(hits, 1):
            row = merged.setdefault(index, dict(index=index, rrf_score=0.0))
            row[f"{label}_score"], row[f"{label}_rank"] = float(score), rank
            row["rrf_score"] += 1.0 / (constant + rank)
    return sorted(merged.values(), key=lambda row: (-row["rrf_score"], row["index"]))


def retrieve(state: dict, store: dict, query: str, vector: Any, timings: dict | None = None) -> dict:
    import numpy as np
    level = state["level"]
    count = min(10 if level == 1 else LEVELS[level]["candidates"], len(state["chunks"]))
    start = time.perf_counter()
    if level == 1:
        scores, ids = store["client"].search(np.asarray([vector], dtype="float32"), count)
        dense = [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i >= 0]
    elif level == 2:
        rows = l2_dense_query(store, vector, count)
        dense = [(int(i), float(s)) for i, s in rows]
    else:
        points = store["client"].query_points(store["collection"], query=vector.tolist(), limit=count,
                    with_payload=False).points
        dense = [(int(p.id), float(p.score)) for p in points]
    dense_hits = [dict(index=i, dense_score=s, score=s) for i, s in dense]
    if timings is not None:
        timings["dense"] += time.perf_counter() - start
    if level == 1:
        return dict(dense=dense_hits, fused=dense_hits, ranked=dense_hits)
    start = time.perf_counter()
    bm_scores = store["bm25"].get_scores(lexical_tokens(query))
    sparse = [(int(i), float(bm_scores[i])) for i in np.argsort(-bm_scores, kind="stable")[:count]]
    if timings is not None:
        timings["bm25"] += time.perf_counter() - start
    start = time.perf_counter()
    fused = fuse_rrf(dense, sparse, LEVELS[level]["rrf_k"])
    for row in fused:
        row["score"] = row["rrf_score"]
    if level == 3:
        fused = fused[:LEVELS[level]["rerank_top"]]
    if timings is not None:
        timings["fuse"] += time.perf_counter() - start
    return dict(dense=dense_hits, fused=fused, ranked=fused)


def contexts(state: dict, ranked: list[dict], limit: int = 10, parents: bool = True) -> list[dict]:
    output, seen = [], set()
    for hit in ranked:
        child = state["chunks"][hit["index"]]
        context = state["parents"][child["parent_id"]] if parents and "parent_id" in child else child
        if context["chunk_id"] in seen:
            continue
        seen.add(context["chunk_id"])
        output.append(dict(context, scores={k: v for k, v in hit.items() if k != "index"}, child_id=child["chunk_id"]))
        if len(output) == limit:
            break
    return output


def run_queries(state: dict, questions: list[dict], device: str, rebuild: bool = False) -> list[dict]:
    import numpy as np
    import torch
    from sentence_transformers import CrossEncoder
    level = state["level"]
    store = open_store(state, rebuild)
    model = load_encoder(level, device)
    model.encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)
    results = []
    try:
        for number, question in enumerate(questions, 1):
            raw_query = question["question"]
            query = raw_query
            start = time.perf_counter()
            vector = model.encode(query, normalize_embeddings=True, show_progress_bar=False).astype("float32")
            retrieved = retrieve(state, store, query, vector)
            elapsed = time.perf_counter() - start
            results.append(dict(question=question, retrieval=retrieved, query_seconds=elapsed))
            if number % 10 == 0:
                log(f"L{level}/{state['subject']}: retrieved {number}/{len(questions)} queries")
    finally:
        if level != 1:
            store["client"].close()
        del model, store
        release_memory()
    if level == 3:
        log(f"L3/{state['subject']}: loading local reranker on {device}")
        reranker = CrossEncoder(LEVELS[3]["reranker"], device=device, max_length=LEVELS[3]["reranker_max_length"],
                               model_kwargs={"dtype": torch.float16 if device == "mps" else torch.float32},
                               activation_fn=torch.nn.Identity())
        reranker.predict([("warmup", "warmup")])
        for number, result in enumerate(results, 1):
            start = time.perf_counter()
            candidates = result["retrieval"]["ranked"]
            scores = np.asarray(reranker.predict([(result["question"]["question"], state["chunks"][c["index"]]["text"])
                                                  for c in candidates], batch_size=2, show_progress_bar=False)).reshape(-1)
            if not np.isfinite(scores).all():
                raise ValueError("Non-finite reranker scores")
            ranked = [dict(c, rerank_score=float(score), score=float(score)) for c, score in zip(candidates, scores)]
            result["retrieval"]["ranked"] = sorted(ranked, key=lambda c: (-c["rerank_score"], c["index"]))
            result["rerank_seconds"] = time.perf_counter() - start
            result["query_seconds"] += result["rerank_seconds"]
            if number % 5 == 0:
                log(f"L3/{state['subject']}: reranked {number}/{len(results)} queries")
        del reranker
        release_memory()
    for result in results:
        start = time.perf_counter()
        result["contexts"] = contexts(state, result["retrieval"]["ranked"])
        result["query_seconds"] += time.perf_counter() - start
    return results


_ingest_lock = threading.RLock()
_encoder_lock = threading.Lock()


@lru_cache(maxsize=2)
def encoder(level: int = 1) -> Any:
    return load_encoder(level, DEVICE)


def warm_encoders() -> None:
    with _encoder_lock:
        for level in (1, 2):
            encoder(level).encode("warmup", normalize_embeddings=True, show_progress_bar=False)


def collection_directory(collection: str, level: int = 1) -> Path:
    return DATA / f"level_{level}" / validate_collection(collection)


def load_collection(collection: str, level: int = 1) -> dict:
    import numpy as np
    pointer = collection_directory(collection, level) / "active.json"
    if not pointer.exists():
        raise FileNotFoundError(f"Collection {collection} is not ingested; run --ingest-folders or upload a PDF")
    directory = (ROOT / read_json(pointer)["directory"]).resolve()
    if not directory.is_relative_to(ROOT / ".cache"):
        raise ValueError("Invalid collection pointer")
    state = read_json(directory / "prepared.json")
    if state["level"] != level or state["subject"] != collection:
        raise ValueError("Collection metadata does not match the requested level/folder")
    if any(c["subject"] != collection for c in state["chunks"]):
        raise ValueError("Collection contains chunks from another folder")
    state["directory"] = directory
    state["vectors"] = np.load(directory / "embeddings.npy")
    state["api"] = True
    return state


def activate_collection(state: dict) -> dict:
    directory = collection_directory(state["subject"], state["level"])
    save_json(directory / "active.json", dict(directory=state["directory"].relative_to(ROOT).as_posix()))
    if state["level"] == 2:
        invalidate_bm25(state["subject"], state["signature"])
    result = dict(level=state["level"], collection=state["subject"], chunks=len(state["chunks"]), signature=state["signature"])
    flagged = sum(bool(c.get("suspicious")) for c in state["chunks"])
    if flagged:
        result["flagged_chunks"] = flagged
    return result


def ingest_folder(collection: str, level: int = 1) -> dict:
    """Reuse the exact Stage 1 cache, keeping already-active uploads on subsequent runs."""
    with _ingest_lock:
        active = (collection_directory(collection, level) / "active.json").exists()
        state = load_collection(collection, level) if active else prepare(level, collection, False, DEVICE)
        state["api"] = True
        store = open_store(state)
        if level != 1:
            store["client"].close()
        return dict(activate_collection(state), already_active=active)


class DocumentError(ValueError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


def validate_upload_pdf(path: Path) -> int:
    import pymupdf
    try:
        with path.open("rb") as source:
            if not source.read(1024).lstrip().startswith(b"%PDF-"):
                raise ValueError()
        with pymupdf.open(path) as document:
            if document.is_encrypted or document.needs_pass:
                raise ValueError()
            pages = document.page_count
            if pages > config.MAX_PAGES:
                raise DocumentError(413, "document_limit", f"Document exceeds MAX_PAGES ({config.MAX_PAGES})")
            if pages < 1:
                raise ValueError()
        return pages
    except DocumentError:
        raise
    except Exception:
        raise DocumentError(422, "validation_failed", "Upload a valid unencrypted PDF") from None


def image_to_pdf(path: Path, extension: str) -> None:
    import io
    import warnings
    import pymupdf
    from PIL import Image, ImageOps
    formats = {".png":"PNG", ".jpg":"JPEG", ".jpeg":"JPEG", ".webp":"WEBP"}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if image.format != formats[extension]:
                    raise DocumentError(415, "unsupported_type", "Image format must match its extension")
                if image.width * image.height > config.MAX_IMAGE_PIXELS:
                    raise DocumentError(413, "file_too_large", "Image exceeds the 20 million pixel limit")
                image.verify()
            with Image.open(path) as image:
                image = ImageOps.exif_transpose(image)
                image.thumbnail((config.MAX_IMAGE_DIMENSION, config.MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
                clean = Image.new("RGB", image.size, "white")
                if "A" in image.getbands() or "transparency" in image.info:
                    rgba = image.convert("RGBA")
                    clean.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    clean.paste(image.convert("RGB"))
                output = io.BytesIO()
                clean.save(output, format="PNG")
        with pymupdf.open() as document:
            page = document.new_page(width=clean.width * 72/150, height=clean.height * 72/150)
            page.insert_image(page.rect, stream=output.getvalue())
            path.write_bytes(document.tobytes(garbage=4, deflate=True))
    except DocumentError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise DocumentError(413, "file_too_large", "Image exceeds the pixel limit") from None
    except Exception:
        raise DocumentError(422, "validation_failed", "Upload a valid PNG, JPEG or WebP image") from None


def limit_document_memory() -> None:
    if sys.platform != "linux":
        logging.getLogger(__name__).warning("Document RLIMIT_AS unavailable on %s; using timeout and document caps", sys.platform)
        return
    import resource
    _, hard = resource.getrlimit(resource.RLIMIT_AS)
    limit = config.DOCUMENT_MEMORY_BYTES
    if hard != resource.RLIM_INFINITY:
        limit = min(limit, hard)
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def check_extracted_size(parsed: dict) -> None:
    if len(parsed["pages"]) > config.MAX_PAGES:
        raise DocumentError(413, "document_limit", f"Document exceeds MAX_PAGES ({config.MAX_PAGES})")
    if sum(len(page["text"]) for page in parsed["pages"]) > config.MAX_EXTRACTED_CHARS:
        raise DocumentError(413, "document_limit", f"Document exceeds MAX_EXTRACTED_CHARS ({config.MAX_EXTRACTED_CHARS})")


def check_chunk_count(chunks: list) -> None:
    if len(chunks) > config.MAX_CHUNKS:
        raise DocumentError(413, "document_limit", f"Document exceeds MAX_CHUNKS ({config.MAX_CHUNKS})")


def prepare_upload(path: Path, level: int, collection: str, force_ocr: bool = False,
                   image_extension: str | None = None, scan_hidden: bool = False) -> dict:
    if image_extension:
        image_to_pdf(path, image_extension)
    pages = validate_upload_pdf(path)
    converter = make_docling_converter(DEVICE) if level == 3 else None
    parsed = parse_file(path, level, collection, converter, force_ocr=force_ocr)
    check_extracted_size(parsed)
    if scan_hidden:
        import guardrails
        parsed["hidden"] = guardrails.hidden_text_rules(path)
    if level == 3:
        import level3
        parsed = level3.add_captions(parsed, path)
        check_extracted_size(parsed)
    return dict(parsed, page_count=pages)


def parse_upload(path: Path, level: int, collection: str, timeout: float, force_ocr: bool = False,
                 image_extension: str | None = None, scan_hidden: bool = False) -> dict:
    """Bound inspection, conversion, extraction and hidden-text scanning together."""
    if config.HOSTED_MODE:
        import parser_ipc
        try:
            result = parser_ipc.parse(path, level, collection, timeout, image_extension, force_ocr, scan_hidden)
            check_extracted_size(result)
            return result
        except parser_ipc.ParserError as exc:
            raise DocumentError(exc.status, exc.code, str(exc)) from None
    import signal
    import subprocess
    output = path.parent / "parsed.json"
    command = [sys.executable, str(ROOT / "level1.py"), "--parse-upload", str(path), str(level), collection, str(output)]
    if force_ocr:
        command.append("--force-ocr")
    if image_extension:
        command.extend(["--image-extension", image_extension])
    if scan_hidden:
        command.append("--scan-hidden")
    environment = dict(os.environ)
    for name in ("MAX_PAGES", "MAX_EXTRACTED_CHARS", "MAX_CHUNKS", "DOCUMENT_MEMORY_BYTES", "MAX_PARSED_OUTPUT_BYTES",
                 "MAX_IMAGE_PIXELS", "MAX_IMAGE_DIMENSION", "GLOBAL_DAILY_PROVIDER_ATTEMPTS"):
        environment[name] = str(getattr(config, name))
    environment["STAGE1_PG_DSN"] = config.PG_DSN
    if sys.platform != "linux":
        logging.getLogger(__name__).warning("Document RLIMIT_AS unavailable on %s; using timeout and document caps", sys.platform)
    output.unlink(missing_ok=True)
    process, succeeded = None, False
    try:
        process = subprocess.Popen(command, env=environment, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=os.name != "nt")
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise TimeoutError("Document processing timed out") from None
        if not output.exists():
            raise DocumentError(422, "document_processing_failed", "Document processing failed or exceeded memory limit")
        if output.stat().st_size > config.MAX_PARSED_OUTPUT_BYTES:
            raise DocumentError(413, "document_limit", f"Document exceeds MAX_PARSED_OUTPUT_BYTES ({config.MAX_PARSED_OUTPUT_BYTES})")
        result = read_json(output)
        if "document_error" in result:
            error = result["document_error"]
            raise DocumentError(error["status"], error["code"], error["detail"])
        if process.returncode != 0:
            raise DocumentError(422, "document_processing_failed", "Document processing failed or exceeded memory limit")
        # JSON object keys are strings; the scan uses integer page numbers.
        result["hidden"] = {int(page): rules for page, rules in result.get("hidden", {}).items()}
        check_extracted_size(result)
        succeeded = True
        return result
    finally:
        if process is not None:
            if os.name != "nt":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            elif process.poll() is None:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
            process.wait()
        output.unlink(missing_ok=True)
        output.with_suffix(".json.tmp").unlink(missing_ok=True)
        if not succeeded:
            path.unlink(missing_ok=True)


class NoTextFound(ValueError):
    pass


def ingest_document(collection: str, path: Path, filename: str, level: int = 1,
                    parse_timeout: float | None = None, progress=None, guard_context: dict | None = None,
                    force_ocr: bool = False, document_hash: str | None = None, parsed: dict | None = None) -> dict:
    import numpy as np
    collection = validate_collection(collection)
    digest = document_hash or hashlib.sha256(path.read_bytes()).hexdigest()
    with _ingest_lock:
        try:
            previous = load_collection(collection, level)
        except FileNotFoundError:
            previous = None
        if previous and digest in previous.get("uploaded_hashes", []):
            return dict(activate_collection(previous), duplicate=True)
        if progress:
            progress("parsing")
        if parsed is None:
            parsed = (parse_file(path, level, collection, force_ocr=force_ocr) if parse_timeout is None else
                      parse_upload(path, level, collection, parse_timeout, force_ocr=force_ocr,
                                   scan_hidden=guard_context is not None))
        check_extracted_size(parsed)
        if force_ocr and not any(re.search(r"[^\W_]{2,}", page["text"]) for page in parsed["pages"]):
            raise NoTextFound("No usable OCR text found")
        for page in parsed["pages"]:
            page["file"] = f"{collection}/uploads/{filename}"
        if progress:
            progress("embedding")
        with _encoder_lock:
            model = encoder(level)
            chunks, _ = chunk_pages([parsed], level, collection, model.tokenizer)
            check_chunk_count(chunks)
            if not chunks:
                raise ValueError(f"PDF contains no extractable text at Level {level}")
            for number, chunk in enumerate(chunks):
                chunk["chunk_id"] = f"L{level}:{collection}:{digest[:16]}:c{number:06d}"
            if guard_context is not None:
                import guardrails
                guardrails.scan_chunks(chunks, parsed.get("hidden", {}), guard_context)
            vectors = model.encode([c["text"] for c in chunks], batch_size=8,
                                   normalize_embeddings=True, show_progress_bar=False).astype("float32")
        if not np.isfinite(vectors).all():
            raise ValueError("Non-finite embeddings")
        if previous:
            chunks = previous["chunks"] + chunks
            vectors = np.concatenate([previous["vectors"], vectors])
        signature = hashlib.sha256(((previous["signature"] if previous else "") + digest).encode()).hexdigest()
        directory = collection_directory(collection, level) / signature
        state = dict(level=level, subject=collection, signature=signature, chunks=chunks, parents={}, api=True,
                     uploaded_hashes=(previous.get("uploaded_hashes", []) if previous else []) + [digest], timings={})
        directory.mkdir(parents=True, exist_ok=True)
        # Readers keep the previous snapshot until every new artifact is safely written.
        with tempfile.TemporaryDirectory(dir=directory.parent) as temporary:
            staging = Path(temporary)
            save_json(staging / "prepared.json", state)
            np.save(staging / "embeddings.npy", vectors)
            working = dict(state, directory=staging, vectors=vectors)
            if progress:
                progress("indexing")
            store = open_store(working, rebuild=True)
            if level != 1:
                store["client"].close()
            for artifact in staging.iterdir():
                artifact.replace(directory / artifact.name)
        if guard_context is not None:
            protection.check_deadline()
        return activate_collection(dict(state, directory=directory))


def ask(collection: str, question: str, query_processing: bool = False,
        session_mode: bool = False, timings: dict | None = None, guard_context: dict | None = None) -> dict:
    import faiss
    from llm import LLMUnavailable, answer_question, unavailable_answer, validate_question
    start = time.perf_counter()
    timings = query_timings() if timings is None else timings
    validation_start = time.perf_counter()
    question = validate_question(question, preserve=session_mode)
    timings["validation"] += time.perf_counter() - validation_start
    trace = dict(level=1, collection=collection, question=question, rewritten_queries=[],
                 query_processing=False, retrieval_retry_count=0, retrieved=[], timings=timings)
    state = load_collection(collection)
    retrieval_start = time.perf_counter()
    encode_start = time.perf_counter()
    with _encoder_lock:
        vector = encoder(1).encode(question, normalize_embeddings=True, show_progress_bar=False).astype("float32")
    timings["encode"] += time.perf_counter() - encode_start
    dense_start = time.perf_counter()
    index = faiss.read_index(str(state["directory"] / "index.faiss"))
    scores, indices = index.search(vector.reshape(1, -1), min(LEVELS[1]["k"], len(state["chunks"])))
    timings["dense"] += time.perf_counter() - dense_start
    chunks = [dict(state["chunks"][int(i)], scores=dict(dense_score=float(score)))
              for i, score in zip(indices[0], scores[0]) if i >= 0]
    trace["retrieval_seconds"] = round(time.perf_counter() - retrieval_start, 4)
    trace["retrieved"] = [dict(chunk_id=c["chunk_id"], scores=c["scores"]) for c in chunks]
    try:
        result = (answer_question(question, chunks, timings=timings, session_mode=True, guard_context=guard_context)
                  if session_mode else answer_question(question, chunks, timings=timings))
    except LLMUnavailable as exc:
        trace["llm"] = exc.trace
        trace["total_seconds"] = round(time.perf_counter() - start, 4)
        timings["total"] = time.perf_counter() - start
        if not session_mode:
            exc.trace = trace
            raise
        result = dict(unavailable_answer(), trace=trace["llm"])
    trace.update(llm=result.pop("trace"), total_seconds=round(time.perf_counter() - start, 4),
                 answer=result["answer"], citations=result["citations"],
                 invalid_citations=result["invalid_citations"], citation_valid=result["citation_valid"])
    timings["total"] = time.perf_counter() - start
    if session_mode:
        trace["guardrails"] = result.pop("guardrails", {})
    return dict(result, retrieved_chunks=chunks, trace=trace)


if __name__ == "__main__":
    if len(sys.argv) >= 6 and sys.argv[1] == "--parse-upload":
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--parse-upload", nargs=4, required=True)
        parser.add_argument("--force-ocr", action="store_true")
        parser.add_argument("--scan-hidden", action="store_true")
        parser.add_argument("--image-extension")
        arguments = parser.parse_args()
        path, level, collection, output = arguments.parse_upload
        limit_document_memory()
        try:
            result = prepare_upload(Path(path), int(level), collection, arguments.force_ocr,
                                    arguments.image_extension, arguments.scan_hidden)
        except DocumentError as exc:
            result = dict(document_error=dict(status=exc.status, code=exc.code, detail=str(exc)))
        except Exception:
            result = dict(document_error=dict(status=422, code="document_processing_failed",
                                             detail="Document processing failed or exceeded memory limit"))
        save_json(Path(output), result)
    else:
        raise SystemExit("Use app.py or evaluate.py")
