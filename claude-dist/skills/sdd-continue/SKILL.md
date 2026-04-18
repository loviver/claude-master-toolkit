---
name: sdd-continue
description: Continúa un SDD change en progreso ejecutando la siguiente fase dependency-ready. Delega al sub-agente sdd-orchestrator. Usar cuando el usuario tipea /sdd-continue [change-name] o pide "seguí con el SDD", "continuá la propuesta", "resume SDD flow".
---

# /sdd-continue

Launch the `sdd-orchestrator` sub-agent to resume work on an existing change.

## Action

Call the Agent tool:

- `subagent_type`: `sdd-orchestrator`
- `description`: `SDD continue: <change-name>`
- `prompt`: |
    The user invoked `/sdd-continue` with arguments: `{ARGS}`.

    Recover current state from the active artifact store, identify the next dependency-ready phase, and run it.

    If no change name provided, search pandorica or openspec for in-progress changes and ask the user which to resume.

    Return the final result contract.

## After Return

Relay `executive_summary` and `next_recommended` to the user.
