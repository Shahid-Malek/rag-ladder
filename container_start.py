"""Refuse an unbounded runtime mount, then run the single app worker."""
import os
from pathlib import Path


def check_runtime(path: Path) -> None:
    stat = os.statvfs(path)
    if not os.path.ismount(path) or not 0 < stat.f_blocks * stat.f_frsize <= 1024**3:
        raise RuntimeError("Runtime must be a dedicated filesystem of at most 1 GiB")
    if not os.access(path, os.W_OK):
        raise RuntimeError("Runtime mount must be writable by UID 10001")


if __name__ == "__main__":
    check_runtime(Path("/app/.cache/stage2"))
    os.umask(0o077)
    import watchdog
    raise SystemExit(watchdog.supervise(Path("/app/.cache/stage2")))
