---
name: workctl-task-master
description: >
  Automates task management using the workctl CLI. Handles creation, search, updates,
  bulk operations, and workflow orchestration across ClickUp/Jira-style task systems.
  Converts natural language requests into safe, structured CLI commands using JSON mode.
  Triggered when user mentions: "task", "ticket", "issue", "workctl", "update task",
  "create task", "bulk update", "search tasks".
license: Apache-2.0
metadata:
  author: agent-systems
  version: "1.0"
---

# workctl-task-master Skill

## When to Use

- User requests task creation, updates, deletion, or movement
- User asks to search or filter tasks across workspace
- User wants bulk operations on tasks (status changes, priority updates)
- User is building automation around ClickUp/Jira-style workflows
- User explicitly mentions `workctl` or CLI task orchestration

---

## Critical Gotchas (learned the hard way)

These are NOT documented in `--help` and will cost you 5+ failed commands if you don't know them:

1. **`workctl task view` does NOT return the list ID.** The JSON output only has `id, name, description, status, priority, assignees, url, createdAt, updatedAt`. There is no `list`, `listId`, or `parent` field. If you need the list ID for a known task, fall through to the ClickUp REST API (see Pattern 6).

2. **`workctl task search` has NO `--query`, `--name`, or text-search flag.** It only filters by `--status`, `--assignee`, `--include-closed`, and date ranges. You CANNOT search for a task by name or custom ID through `task search`. Do not try `--query "DEV-672"` — it will fail with `Nonexistent flag: --query`.

3. **`workctl task create` ALWAYS requires `--list <LIST_ID>`, even when creating a subtask with `--parent`.** Passing only `--parent` fails with `Missing required flag list`. You must supply the parent's list ID.

4. **Custom IDs vs internal IDs both work** in `task view <ID>` and as `--parent` values (e.g. `DEV-672` and `86ageqyxf` are interchangeable). But `task create --parent` needs the companion `--list`.

5. **Tables in markdown descriptions get mangled** by ClickUp into `[table-embed:...]` blocks on create. The content is preserved but rendering is lossy. For rich formatting prefer `--description-file` with plain markdown and avoid complex tables if fidelity matters.

6. **Use `--description-file` for any multi-line / code-fence / special-char description.** Inline `--description` with backticks or newlines is fragile to shell quoting. Write to `/tmp/foo.md` then pass `--description-file /tmp/foo.md`.

---

## Pattern 0: Skill Resolution (BEFORE executing any command)

1. Detect intent type:
   - Create → `workctl task create`
   - Read/Search → `workctl task search` or `task list`
   - Update → `workctl task update`
   - Bulk ops → `workctl task bulk`
   - Move → `workctl task move`
   - Inspect → `workctl task view`

2. Always enforce:
   - Use `--format json`
   - Prefer `task search` over `task list` unless list ID is known
   - Use `task view` before destructive updates when ID is uncertain

3. Validate required parameters:
   - create → requires `--list` (even for subtasks with `--parent`)
   - list → requires `--list`
   - move → requires `--to-list`
   - bulk → requires at least one `--set-*`

---

## Pattern 1: Task Creation

Convert natural language into structured CLI create command.

```bash
workctl task create "Fix login bug" \
  --list <LIST_ID> \
  --priority high \
  --description-file /tmp/desc.md \
  --format json
```

### Creating a subtask (common flow)

To create a subtask, you need BOTH `--parent` and `--list`. Since `task view` does not return the list ID, use the ClickUp REST API fallback:

```bash
# 1. Get the parent's list ID via ClickUp API (NOT workctl)
API_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.config/workctl/config.json'))['clickup']['apiKey'])")
LIST_ID=$(curl -s "https://api.clickup.com/api/v2/task/<PARENT_ID>" \
  -H "Authorization: $API_KEY" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['list']['id'])")

# 2. Write the description to a file (safer than inline)
cat > /tmp/subtask.md << 'EOF'
## Objetivo
...markdown body with acceptance criteria...
EOF

# 3. Create the subtask
workctl task create "Subtask title" \
  --list "$LIST_ID" \
  --parent <PARENT_ID> \
  --priority high \
  --description-file /tmp/subtask.md \
  --format json
```

The parent ID accepts both forms: `DEV-672` (custom) or `86ageqyxf` (internal).

---

## Pattern 6: Resolving list ID from a task (fallback via ClickUp REST API)

When `workctl task view` doesn't give you enough context (list ID, folder, space, custom fields, parent relationships, due dates, tags), drop to the ClickUp REST API. The workctl config at `~/.config/workctl/config.json` holds the API key and team ID:

```bash
cat ~/.config/workctl/config.json
# { "provider": "clickup", "clickup": { "apiKey": "pk_...", "teamId": "..." } }

curl -s "https://api.clickup.com/api/v2/task/<TASK_ID>" \
  -H "Authorization: <apiKey>"
```

The REST response includes `list.id`, `list.name`, `folder.id`, `space.id`, `parent`, `top_level_parent`, `custom_fields`, `custom_id`, and more — everything `workctl task view` strips out.

Use this sparingly — prefer workctl commands for routine ops — but it is the canonical escape hatch when workctl's JSON is insufficient.

---

## Pattern 1 (original snippet, kept for reference)

```bash
workctl task create "Fix login bug" \
  --list <LIST_ID> \
  --priority high \
  --description "SSO login failure on production" \
  --format json
