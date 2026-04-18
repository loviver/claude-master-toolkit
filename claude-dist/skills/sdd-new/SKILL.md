---
name: sdd-new
description: Inicia un nuevo SDD change. Delega exploration + proposal al sub-agente sdd-orchestrator para mantener el contexto principal liviano. Usar cuando el usuario tipea /sdd-new <change-name> o pide "arrancá un SDD nuevo", "iniciá spec-driven development", "nueva propuesta SDD", "start a new SDD flow".
---

# /sdd-new

Launch the `sdd-orchestrator` sub-agent with the user's change name. The sub-agent carries all SDD workflow logic in its own context — do NOT inline orchestrator rules here.

## Action

Call the Agent tool:

- `subagent_type`: `sdd-orchestrator`
- `description`: `SDD new change: <change-name>`
- `prompt`: |
    The user invoked `/sdd-new` with arguments: `{ARGS}`.

    Run the SDD workflow starting from exploration → proposal.

    First-time setup (if not already cached this session):
    1. Ask execution mode (auto | interactive, default interactive)
    2. Ask artifact store (pandorica | openspec | hybrid | none, default pandorica)
    3. Run SDD init guard

    Then delegate phases according to the dependency graph.
    Return the final result contract for relay to the user.

## After Return

Relay the sub-agent's `executive_summary` and `next_recommended` to the user. Keep main thread clean.
