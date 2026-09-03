from pathlib import Path

OLD_CACHE = "field-coach-app-shell-v8-20260903-customer-list-stable-actions"
NEW_CACHE = "field-coach-app-shell-v11-20260903-live-feed-company-team-preview"
OLD_MIGRATION = Path("supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql")
NEW_MIGRATION = Path("supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql")

if not OLD_MIGRATION.exists():
    raise SystemExit(f"missing source migration: {OLD_MIGRATION}")
if NEW_MIGRATION.exists():
    raise SystemExit(f"destination migration already exists: {NEW_MIGRATION}")

NEW_MIGRATION.parent.mkdir(parents=True, exist_ok=True)
OLD_MIGRATION.replace(NEW_MIGRATION)

for file_name in (
    "sale-completion-runtime.test.mjs",
    "customer-list-stable-actions.test.mjs",
    "organization-access-gate.test.mjs",
):
    path = Path(file_name)
    source = path.read_text(encoding="utf-8")
    count = source.count(OLD_CACHE)
    if count != 1:
        raise SystemExit(f"{file_name}: expected one stale cache assertion, found {count}")
    path.write_text(source.replace(OLD_CACHE, NEW_CACHE, 1), encoding="utf-8")

contract = Path("live-feed-comments-contract.test.mjs")
source = contract.read_text(encoding="utf-8")
old_reference = "./supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql"
new_reference = "./supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql"
if source.count(old_reference) != 1:
    raise SystemExit("Live Feed contract migration reference did not match exactly once")
contract.write_text(source.replace(old_reference, new_reference, 1), encoding="utf-8")

docs = Path("docs/live-feed-comments-preview.md")
source = docs.read_text(encoding="utf-8")
source = source.replace(
    "After an isolated Supabase branch is explicitly approved and created, apply only the consolidated migration and run:",
    "After an isolated Supabase branch is explicitly approved and created, apply only `supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql` and run:",
)
source = source.replace(
    "The preview source now uses one consolidated, independently fail-closed migration and scoped v2 RPCs.",
    "The preview source now uses one consolidated, independently fail-closed migration stored outside the production migration directory, plus scoped v2 RPCs.",
)
docs.write_text(source, encoding="utf-8")

print("Moved the preview migration outside the production migration path and aligned cache assertions.")
