"""Apply per-user RLS to project_nano_sandbox. Does not touch engine tables."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection


def apply_rls(conn: Connection, is_pg: bool) -> None:
    if not is_pg:
        for stmt in (
            "ALTER TABLE threads ADD COLUMN owner_id TEXT",
            "ALTER TABLE projects ADD COLUMN owner_id TEXT",
        ):
            try:
                conn.execute(text(stmt))
            except Exception:
                pass
        return

    prefix = "project_nano_sandbox"
    for stmt in (
        f"ALTER TABLE {prefix}.threads ADD COLUMN IF NOT EXISTS owner_id TEXT",
        f"ALTER TABLE {prefix}.projects ADD COLUMN IF NOT EXISTS owner_id TEXT",
        f"CREATE INDEX IF NOT EXISTS threads_owner_idx ON {prefix}.threads (owner_id)",
        f"CREATE INDEX IF NOT EXISTS projects_owner_idx ON {prefix}.projects (owner_id)",
        f"ALTER TABLE {prefix}.profiles ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {prefix}.user_settings ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {prefix}.threads ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {prefix}.projects ENABLE ROW LEVEL SECURITY",
    ):
        try:
            conn.execute(text(stmt))
        except Exception:
            pass

    has_auth = False
    try:
        row = conn.execute(
            text(
                "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'auth' AND p.proname = 'uid'"
            )
        ).first()
        has_auth = bool(row)
    except Exception:
        has_auth = False

    uid_or = " OR id = COALESCE(auth.uid()::text, '')" if has_auth else ""
    owner_or = " OR owner_id = COALESCE(auth.uid()::text, '')" if has_auth else ""
    user_or = " OR user_id = COALESCE(auth.uid()::text, '')" if has_auth else ""

    policies = [
        (
            f"{prefix}.profiles",
            "profiles_self",
            f"(id = COALESCE(current_setting('app.user_id', true), ''){uid_or})",
        ),
        (
            f"{prefix}.user_settings",
            "settings_self",
            f"(user_id = COALESCE(current_setting('app.user_id', true), ''){user_or})",
        ),
        (
            f"{prefix}.threads",
            "threads_owner",
            f"(owner_id IS NULL OR owner_id = COALESCE(current_setting('app.user_id', true), ''){owner_or})",
        ),
        (
            f"{prefix}.projects",
            "projects_owner",
            f"(owner_id IS NULL OR owner_id = COALESCE(current_setting('app.user_id', true), ''){owner_or})",
        ),
    ]
    for table, name, using in policies:
        try:
            conn.execute(text(f"DROP POLICY IF EXISTS {name} ON {table}"))
            conn.execute(
                text(
                    f"CREATE POLICY {name} ON {table} FOR ALL USING {using} WITH CHECK {using}"
                )
            )
        except Exception:
            pass
