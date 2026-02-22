#!/usr/bin/env python3
import json
import sys
from yt_dlp import YoutubeDL


def main() -> int:
    if len(sys.argv) < 2:
        print("Missing URL", file=sys.stderr)
        return 2

    url = sys.argv[1]
    cookie_file = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
    }
    if cookie_file:
        opts["cookiefile"] = cookie_file

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False, process=False)

        if info is None:
            print("Could not extract video info", file=sys.stderr)
            return 1

        payload = {
            "id": info.get("id", ""),
            "formats": info.get("formats", []),
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
