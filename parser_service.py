"""Secretless parser supervisor: one isolated child, socket bytes only."""
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time

import parser_ipc as ipc


class ParserRestart(Exception):
    pass


def worker_environment():
    return dict(PATH="/opt/venv/bin:/usr/local/bin:/usr/bin:/bin", HOME="/tmp", TMPDIR="/tmp",
                PYTHON_DOTENV_DISABLED="1", PYTHONDONTWRITEBYTECODE="1", PARSER_MODE="true",
                HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", ORT_DISABLE_TELEMETRY="1",
                OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1",
                TESSDATA_PREFIX="/usr/share/tesseract-ocr/5/tessdata")


def run_job(stream, request, scratch):
    request = ipc.validate_request(request)
    process = None
    try:
        path = scratch / "document.pdf"
        with path.open("wb") as output:
            left = request["length"]
            while left:
                block = ipc.receive_exact(stream, min(left, 65536))
                output.write(block)
                left -= len(block)
        output = scratch / "parsed.json"
        command = [sys.executable, "/app/parser_worker.py", str(path), str(output), json.dumps(request)]
        process = subprocess.Popen(command, env=worker_environment(), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   close_fds=True, start_new_session=True)
        end = time.monotonic() + request["timeout"]
        while process.poll() is None:
            readable, _, _ = select.select([stream], [], [], .1)
            if readable or time.monotonic() >= end:
                raise ParserRestart()
        if process.returncode != 0 or not output.is_file() or output.stat().st_size > ipc.MAX_OUTPUT:
            raise ParserRestart()
        value = json.loads(output.read_bytes())
        if "error" not in value:
            value = {"result": ipc.validate_result(value, request["collection"])}
        ipc.send_frame(stream, value, ipc.MAX_OUTPUT)
    except (OSError, EOFError, ValueError, KeyError, TypeError, ParserRestart):
        try: ipc.send_frame(stream, {"error": {"status": 503, "code": "parser_unavailable"}}, ipc.MAX_OUTPUT)
        except OSError: pass
        raise ParserRestart() from None
    finally:
        if process is not None:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait()


def serve():
    # Only this socket volume is shared; job files stay on the parser's private tmpfs.
    os.umask(0o077)
    time.sleep(int(os.getenv("PARSER_RESTART_DELAY_SECONDS", "3")))
    path = Path(ipc.SOCKET)
    path.unlink(missing_ok=True)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(str(path))
        path.chmod(0o660)
        listener.listen(2)
        while True:
            stream, _ = listener.accept()
            with stream:
                stream.settimeout(15)
                try:
                    request = ipc.receive_frame(stream, 2048)
                    if request == {"health": True}:
                        ipc.send_frame(stream, {"ok": True}, 1024)
                        continue
                    ipc.validate_request(request)
                    with tempfile.TemporaryDirectory(dir="/app/.cache/parser") as directory:
                        run_job(stream, request, Path(directory))
                except ParserRestart:
                    return 70
                except (OSError, EOFError, ValueError, TypeError):
                    try: ipc.send_frame(stream, {"error": {"status": 503, "code": "parser_unavailable"}}, 1024)
                    except OSError: pass


if __name__ == "__main__":
    if sys.argv[1:] == ["--health"]:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
            stream.settimeout(2)
            stream.connect(ipc.SOCKET)
            ipc.send_frame(stream, {"health": True}, 1024)
            if ipc.receive_frame(stream, 1024) != {"ok": True}: raise SystemExit(1)
    else:
        raise SystemExit(serve())
