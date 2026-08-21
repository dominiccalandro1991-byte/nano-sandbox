from pathlib import Path

BANNED = "hlwqtlrkwhuogcwnhjrs"
SKIP_PARTS = {"_next", "node_modules", ".git", "__pycache__"}


def test_no_deprecated_supabase_ref():
    root = Path(__file__).resolve().parents[2]
    hits = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(p in SKIP_PARTS for p in path.parts):
            continue
        if path.suffix.lower() not in {".py", ".js", ".ts", ".html", ".css", ".md", ".sql", ".yml", ".json", ".txt", ".example"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if BANNED in text:
            hits.append(str(path.relative_to(root)))
    assert hits == [], f"deprecated supabase ref still present in {hits}"
