---
name: repo-layer-master
description: >
  Automates the creation of repository layers using a simplified singleton pattern.
  No dependency injection, no constructors. Direct access to DB (e.g., Prisma) and
  exported instance for immediate usage. Triggered when user says "repo-layer",
  "repository", "create repo", "export instance".
  ALSO validates existing repositories to ensure they follow the singleton pattern.
  Triggered when user says "repo-layer", "validate repo", "check repository", "audit repo".
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.1"
---

## When to Use

- User explicitly asks for repository layer scaffolding
- Creating new services or modules that need database access
- Updating repository logic or methods consistently across the codebase
- Ensuring singleton repository instances are exported for shared use

## Critical Patterns

### Pattern 0: Skill Resolution (BEFORE instantiating)

1. Check skill registry (`pandorica_search(query: "skill-registry", project: "{project}")`)
2. Match by language/framework:
   - TypeScript / Node.js → class-based repositories with singleton export
   - Go → struct + interface + constructor pattern
   - Python → class + module-level instance
3. Inject project-specific DB connection, entity models, and context if available
4. Warn if no registry → fallback to default repository conventions

---

### Pattern 1: Repository Class Instantiation

- Instantiate repository as a **single class per model/entity**
- Ensure constructor receives dependencies:
  - DB connection
  - Logger (optional)
  - Config / context (optional)
- Example (TypeScript):

```ts
import { Database } from "../db";
import { UserEntity } from "../entities/User";

export class UserRepository {
  constructor(private db: Database) {}

  async findById(id: string) {
    return this.db.query("SELECT * FROM users WHERE id = ?", [id]);
  }
}

export const userRepository = new UserRepository(Database.instance);

### Pattern 6: Repository Audit (VALIDATION MODE)

When user provides existing repository code:

1. Analyze the repository structure
2. Validate compliance with required patterns
3. Report violations (NO fixing unless explicitly requested)

### Validation Rules (STRICT)

The repository MUST:

- ✅ Export a singleton instance:
  export const xRepository = new XRepository();

- ✅ NOT use constructor

- ✅ NOT use @Injectable()

- ✅ Use direct prisma/global DB access

- ✅ Keep methods focused on data access only

- ✅ Use consistent naming (findById, findMany, etc.)

### Violations

Classify findings:

CRITICAL:
- Missing singleton export
- Using @Injectable()
- Using constructor injection

WARNING:
- Inconsistent naming
- Mixed business logic inside repo
- Poor query structure

SUGGESTION:
- Optimization opportunities

## Repository Audit — {file}

### Compliance

| Rule | Status |
|------|--------|
| Singleton export | ✅ |
| No constructor | ❌ |
| No Injectable | ✅ |
| Direct DB usage | ✅ |

### Issues

| Severity | Description |
|----------|------------|
| CRITICAL | Repository uses constructor injection |
| WARNING | Method naming inconsistent |
| SUGGESTION | Could optimize query with select |

### Verdict

- COMPLIANT ✅
- NON-COMPLIANT ❌
