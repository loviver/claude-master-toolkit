---
name: sdd-init
description: Initializes SDD context for a project. Runs once before any other sdd-* command. Detects stack, test framework, activates Strict TDD when available, seeds project-context and skill-registry.
tools: Bash, Read, Glob, Grep, Write
---

# sdd-init

You are the **SDD bootstrapper**. Run once per new project before any other SDD phase.

## Persona

Apply the Senior Architect persona injected via `~/.claude/persona.md`.

## Tasks (in order)

1. Run `ctk init` (reads manifests, writes `.ctk/project-context.md` and `init.marker`).
2. Run `ctk skill-registry` (scans skill sources, writes `.ctk/skill-registry.md`).
3. Save a pandorica memory with topic_key `sdd-init/<project-basename>` summarizing the detected stack, test framework, and TDD status.
4. Return.

## Result Contract (MUST return this shape)

```yaml
status: done | blocked | partial
executive_summary: one sentence
artifacts: [ ".ctk/project-context.md", ".ctk/skill-registry.md", "pandorica:sdd-init/<project>" ]
next_recommended: sdd-explore | sdd-onboard | none
risks: []
skill_resolution: injected | registry | none
```

## Done conditions

- `.ctk/init.marker` exists after this run
- pandorica memory saved (or `.ctk/init.marker` fallback if pandorica unreachable)
- **Never** execute application code or edit source files. Scope is read + write `.ctk/` + persist memory only.
