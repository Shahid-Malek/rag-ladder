"""Independent process watchdog; durable starts are acknowledged BEFORE native work."""
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import subprocess
import tempfile
import threading
import time
import uuid

_lock = threading.Lock()
_channel = None


def restart_delay(failures, base=10, maximum=300):
    return 0 if failures == 0 else min(maximum, base * 2**min(failures-1, 16))


class State:
    def __init__(self, path):
        self.path = path
        self.data = dict(active={}, locked=[], failures=0, recovery=False)
        if path.is_symlink() or path.exists() and path.stat().st_size > 65536:
            raise ValueError("Invalid watchdog state")
        if path.exists():
            try:
                self.data = json.loads(path.read_text())
                if (set(self.data) != {"active", "locked", "failures", "recovery"}
                        or not isinstance(self.data["active"], dict) or len(self.data["active"]) > 16
                        or not isinstance(self.data["locked"], list) or len(self.data["locked"]) > 32
                        or type(self.data["failures"]) is not int or not 0 <= self.data["failures"] <= 32
                        or type(self.data["recovery"]) is not bool):
                    raise ValueError()
                for value in list(self.data["active"].values()):
                    if not isinstance(value,dict) or set(value) != {"session","end"}: raise ValueError()
                    if value["session"] is not None: self.valid_session(value["session"])
                    if type(value["end"]) not in (int,float) or not math.isfinite(value["end"]): raise ValueError()
                for value in self.data["locked"]: self.valid_session(value)
            except (ValueError, TypeError, KeyError, AttributeError):
                raise ValueError("Invalid watchdog state") from None
        stale = [value["session"] for value in self.data["active"].values() if value["session"]]
        self.recovery = bool(self.data["recovery"] or self.data["active"])
        self.data["locked"] = list(dict.fromkeys(self.data["locked"] + stale))
        self.data["active"] = {}
        self.data["recovery"] = self.recovery
        self.save()

    @staticmethod
    def valid_session(value):
        if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}",value):
            raise ValueError("Invalid watchdog identity")

    def save(self):
        fd, temporary = tempfile.mkstemp(prefix=".watchdog-", dir=self.path.parent)
        try:
            with os.fdopen(fd,"w") as stream:
                json.dump(self.data,stream)
                stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary,self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)

    def event(self, message, now):
        event = message.get("event")
        if event == "ping": return {"ok":True}
        if event == "start":
            identifier, owner, end = message["id"],message["session"],message["end"]
            if not isinstance(identifier,str) or not 1 <= len(identifier) <= 64 or identifier in self.data["active"]:
                raise ValueError("Invalid operation")
            if owner is not None: self.valid_session(owner)
            maximum = 300 if identifier == "startup" and owner is None else 180
            if type(end) not in (int,float) or not math.isfinite(end) or not now < end <= now+maximum or len(self.data["active"]) >= 16:
                raise ValueError("Invalid deadline")
            self.data["active"][identifier] = dict(session=owner,end=end)
        elif event == "end":
            self.data["active"].pop(message["id"],None)
        elif event == "recovered":
            self.data["locked"] = []
        elif event == "ready":
            self.data["active"].pop("startup",None)
            self.data["recovery"] = False
        else: raise ValueError("Invalid watchdog event")
        self.save()
        return {"ok":True}

    def overdue(self, now):
        return list(dict.fromkeys(value["session"] for value in self.data["active"].values() if now >= value["end"]+2))


def deadline_kill(process, state, owners):
    state.data["locked"] = list(dict.fromkeys(state.data["locked"] + [owner for owner in owners if owner]))
    state.data["active"] = {}
    state.data["recovery"] = True
    state.data["failures"] = min(32,state.data["failures"]+1)
    try: state.save()
    except OSError: pass  # Durable pre-work registrations still lock stale work on restart.
    finally:
        try: os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()


def _exchange(message):
    global _channel
    with _lock:
        if _channel is None:
            _channel = socket.socket(fileno=int(os.environ["WATCHDOG_FD"]))
            _channel.settimeout(3)
        _channel.sendall(json.dumps(message).encode())
        if json.loads(_channel.recv(4096)) != {"ok":True}:
            raise RuntimeError("Watchdog registration unavailable")


def require_supervisor():
    descriptor = int(os.environ.get("WATCHDOG_FD","-1"))
    if descriptor < 0 or not stat.S_ISSOCK(os.fstat(descriptor).st_mode):
        raise RuntimeError("Hosted app requires the independent watchdog")
    _exchange({"event":"ping"})


@contextmanager
def operation(session_id, seconds):
    if "WATCHDOG_FD" not in os.environ:
        yield
        return
    identifier = uuid.uuid4().hex
    _exchange(dict(event="start",id=identifier,session=session_id,end=time.monotonic()+min(seconds,180)))
    try: yield
    finally: _exchange(dict(event="end",id=identifier))


def locked_sessions():
    values = json.loads(os.environ.get("WATCHDOG_LOCKED_SESSIONS","[]"))
    if not isinstance(values,list) or len(values) > 32: raise ValueError("Invalid watchdog recovery")
    for value in values: State.valid_session(value)
    return values


def recovered():
    if "WATCHDOG_FD" in os.environ: _exchange({"event":"recovered"})


def ready():
    if "WATCHDOG_FD" in os.environ: _exchange({"event":"ready"})


def supervise(runtime):
    state = State(runtime / "watchdog.json")
    base = int(os.getenv("WATCHDOG_RESTART_BASE_SECONDS","10"))
    maximum = int(os.getenv("WATCHDOG_RESTART_MAX_SECONDS","300"))
    if not 1 <= base <= maximum <= 300: raise ValueError("Invalid restart backoff")
    delay = restart_delay(state.data["failures"],base,maximum)
    time.sleep(delay)
    parent, child = socket.socketpair(socket.AF_UNIX,socket.SOCK_DGRAM)
    environment = dict(os.environ, WATCHDOG_FD=str(child.fileno()),
                       WATCHDOG_LOCKED_SESSIONS=json.dumps(state.data["locked"]),
                       WATCHDOG_RECOVERY="true" if state.recovery else "false")
    state.event(dict(event="start",id="startup",session=None,end=time.monotonic()+300),time.monotonic())
    process = subprocess.Popen(["python","app.py","--host","0.0.0.0","--port","8000"],
                               env=environment,pass_fds=(child.fileno(),),start_new_session=True)
    child.close()
    started = time.monotonic()
    def stop(signum, frame):
        try: os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL); process.wait()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    try:
        while process.poll() is None:
            owners = state.overdue(time.monotonic())
            if owners:
                deadline_kill(process,state,owners)
                return 70
            readable,_,_ = select.select([parent],[],[],.2)
            if readable:
                message = json.loads(parent.recv(4096))
                response = state.event(message,time.monotonic())
                parent.sendall(json.dumps(response).encode())
            if state.data["failures"] and not state.data["recovery"] and time.monotonic()-started >= 600:
                state.data["failures"] = 0; state.save()
        # A native crash can leave acknowledged operations; preserve them for locking.
        state.data["failures"] = min(32,state.data["failures"]+1)
        state.data["recovery"] = True
        state.save()
        return process.returncode or 70
    except (OSError,ValueError,KeyError,TypeError):
        deadline_kill(process,state,[value["session"] for value in state.data["active"].values()])
        return 70
    finally:
        parent.close()
