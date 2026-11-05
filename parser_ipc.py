"""Bounded Unix-socket byte protocol; parser replies are untrusted input."""
import json
import re
import socket
import struct
from pathlib import Path

SOCKET = "/run/parser-ipc/parser.sock"
MAX_UPLOAD = 5 * 1024**2
MAX_OUTPUT = 16 * 1024**2
MAX_CHARS = 1000000
HIDDEN_RULES = {"hidden_small_font", "hidden_outside_page", "hidden_white_text"}


class ParserError(Exception):
    def __init__(self, status=503, code="parser_unavailable"):
        self.status, self.code = status, code
        super().__init__("Document exceeds processing limits" if status == 413 else
                         "Upload a supported, valid document" if status in (415, 422) else
                         "Document processing unavailable; try again shortly")


def receive_exact(stream, size):
    output = bytearray()
    while len(output) < size:
        part = stream.recv(min(65536, size-len(output)))
        if not part:
            raise EOFError("Incomplete parser message")
        output.extend(part)
    return bytes(output)


def receive_frame(stream, maximum):
    size = struct.unpack("!I", receive_exact(stream, 4))[0]
    if not 0 < size <= maximum:
        raise ValueError("Parser message exceeds limit")
    return json.loads(receive_exact(stream, size))


def send_frame(stream, value, maximum):
    data = json.dumps(value, ensure_ascii=False).encode()
    if not 0 < len(data) <= maximum:
        raise ValueError("Parser message exceeds limit")
    stream.sendall(struct.pack("!I", len(data)) + data)


def validate_request(value):
    if not isinstance(value, dict) or set(value) != {"level", "collection", "length", "timeout", "image_extension", "force_ocr", "scan_hidden"}:
        raise ValueError("Invalid parse request")
    if (type(value["level"]) is not int or value["level"] not in (1, 2)
            or type(value["length"]) is not int or not 0 < value["length"] <= MAX_UPLOAD
            or type(value["timeout"]) not in (int, float) or not 0 < value["timeout"] <= 120
            or not isinstance(value["collection"], str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", value["collection"])
            or type(value["force_ocr"]) is not bool or type(value["scan_hidden"]) is not bool
            or value["image_extension"] not in (None, ".png", ".jpg", ".jpeg", ".webp")
            or value["level"] == 1 and value["image_extension"] is not None):
        raise ValueError("Invalid parse request")
    return value


def validate_result(value, collection):
    if not isinstance(value, dict) or type(value.get("page_count")) is not int or not 1 <= value["page_count"] <= 30:
        raise ValueError("Invalid page count")
    pages = value.get("pages")
    if not isinstance(pages, list) or not 1 <= len(pages) <= value["page_count"] or value.get("document") is not None or value.get("caption_candidates") != []:
        raise ValueError("Invalid parsed pages")
    characters = 0
    clean = []
    for number, page in enumerate(pages, 1):
        if (not isinstance(page, dict) or page.get("subject") != collection or page.get("pages") != [number]
                or not isinstance(page.get("text"), str) or page.get("heading_path") != []
                or not isinstance(page.get("file"), str) or len(page["file"]) > 256):
            raise ValueError("Invalid parsed page")
        characters += len(page["text"])
        clean.append({key: page[key] for key in ("subject", "file", "pages", "heading_path", "text")})
    if characters > MAX_CHARS:
        raise ValueError("Parsed text exceeds limit")
    hidden = value.get("hidden", {})
    if not isinstance(hidden, dict) or len(hidden) > value["page_count"]:
        raise ValueError("Invalid hidden text flags")
    normalized = {}
    for page, rules in hidden.items():
        if (not str(page).isdigit() or not 1 <= int(page) <= value["page_count"] or not isinstance(rules, list)
                or len(rules) > 3 or any(not isinstance(rule, str) or rule not in HIDDEN_RULES for rule in rules)):
            raise ValueError("Invalid hidden text flags")
        normalized[int(page)] = rules
    return dict(pages=clean, page_count=value["page_count"], hidden=normalized, document=None, caption_candidates=[])


def parse(path: Path, level, collection, timeout, image_extension=None, force_ocr=False, scan_hidden=False):
    size = path.stat().st_size
    request = dict(level=level, collection=collection, length=size, timeout=min(timeout, 120),
                   image_extension=image_extension, force_ocr=force_ocr, scan_hidden=scan_hidden)
    try:
        validate_request(request)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
            stream.settimeout(timeout)
            stream.connect(SOCKET)
            send_frame(stream, request, 2048)
            with path.open("rb") as source:
                sent = 0
                while block := source.read(65536):
                    sent += len(block)
                    if sent > size: raise ValueError("Upload changed")
                    stream.sendall(block)
                if sent != size: raise ValueError("Upload changed")
            response = receive_frame(stream, MAX_OUTPUT)
        if not isinstance(response, dict): raise ValueError("Invalid response")
        if "error" in response:
            error = response["error"]
            known = {"validation_failed": 422, "document_limit": 413, "file_too_large": 413, "unsupported_type": 415,
                     "document_processing_failed": 422}
            if isinstance(error, dict) and known.get(error.get("code")) == error.get("status"):
                raise ParserError(error["status"], error["code"])
            raise ParserError()
        return validate_result(response["result"], collection)
    except ParserError:
        raise
    except (OSError, EOFError, ValueError, KeyError, TypeError, OverflowError):
        raise ParserError() from None
