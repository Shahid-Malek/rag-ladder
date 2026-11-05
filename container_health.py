"""Cached app readiness only; no Neon/provider/model call."""
import json
import urllib.request

if __name__ == "__main__":
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open("http://127.0.0.1:8000/health", timeout=3) as response:
        if response.status != 200 or json.loads(response.read(4096)).get("ok") is not True:
            raise SystemExit(1)
