---
name: sdd-ff
description: Fast-forward SDD planning (proposal → specs → design → tasks, sin apply). Delega al sub-agente sdd-orchestrator. Usar cuando el usuario tipea /sdd-ff <change-name> o pide "planificá rápido en SDD", "fast-forward SDD", "plan SDD sin implementar".
---

# /sdd-ff

Launch the `sdd-orchestrator` sub-agent in fast-forward planning mode.

## Action

Call the Agent tool:

- `subagent_type`: `sdd-orchestrator`
- `description`: `SDD fast-forward: <change-name>`
- `prompt`: |
    The user invoked `/sdd-ff` with arguments: `{ARGS}`.

    Run proposal → specs → design → tasks back-to-back. Do NOT run apply or verify.

    First-time setup (if not cached):
    1. Ask execution mode (default interactive)
    2. Ask artifact store (default pandorica)
    3. Run SDD init guard

    Return the final result contract.

## After Return

Relay `executive_summary` and `next_recommended` to the user.
