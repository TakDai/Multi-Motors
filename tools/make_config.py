"""Write the PHP configuration of the community server from environment
variables (GitHub secrets at deploy time).

Usage: python tools/make_config.py build/api/config.php
"""
import os, sys


def php_str(v):
    # Single-quoted PHP string: only \\ and \' are special
    return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"


def main(out):
    env = lambda k: os.environ.get(k, "")
    dsn = f"mysql:host={env('MM_DB_HOST')};dbname={env('MM_DB_NAME')};charset=utf8mb4"
    items = {
        "db_dsn": dsn, "db_user": env("MM_DB_USER"), "db_pass": env("MM_DB_PASS"),
        "admin_email": env("MM_ADMIN_EMAIL"), "google_client_id": env("MM_GOOGLE_CLIENT_ID"),
        "mail_from": env("MM_MAIL_FROM"), "site_url": env("MM_SITE_URL"), "export_key": env("MM_EXPORT_KEY"),
    }
    body = "\n".join(f"    {php_str(k)} => {php_str(v)}," for k, v in items.items())
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"<?php\n// Generated at deploy time from the GitHub secrets. Do not commit.\nreturn [\n{body}\n];\n")
    print(f"configuration écrite dans {out}")


if __name__ == "__main__":
    main(sys.argv[1])
