"""Native document operations run only in the parser container's private job directory."""
import json
from pathlib import Path
import sys

import level1


def main():
    path, output = map(Path, sys.argv[1:3])
    request = json.loads(sys.argv[3])
    try:
        level1.limit_document_memory()
        result = level1.prepare_upload(path, request["level"], request["collection"], request["force_ocr"],
                                       request["image_extension"], request["scan_hidden"])
    except level1.DocumentError as error:
        result = {"error": {"status": error.status, "code": error.code}}
    except Exception:
        return 70
    data = json.dumps(result).encode()
    if len(data) > 16 * 1024**2: return 70
    output.write_bytes(data)
    return 0


if __name__ == "__main__": raise SystemExit(main())
