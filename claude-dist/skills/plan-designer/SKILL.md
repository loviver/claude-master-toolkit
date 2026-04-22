---
name: plan-designer
description: Genera workflows visuales (xyflow) usando wf_create o wf_generate según complejidad. Soporta DAGs, subagentes y subflows. Intercepta peticiones ES/EN.
---

# /plan-designer

Genera un plan ejecutable como grafo de nodos (xyflow en `/workflows`), usando:

- `wf_create` → workflows complejos (multi-agente, DAG, subflows)
- `wf_generate` → fallback simple (pipeline lineal)

---

## Triggers

- **Explícito**: `/plan-designer <descripción>`
- **Natural ES**: "diseñá un plan", "diseña un plan", "crea un plan", "generá un workflow", "genera un workflow", "plan para"
- **Natural EN**: "design a plan", "create a plan", "generate a workflow", "plan for"

---

## Acción — seguir en orden

### Step 1: Extraer descripción

Extraer la intención del usuario desde los argumentos.

Si no hay suficiente información, preguntar UNA vez:

¿Qué debe hacer el plan?

---

### Step 2: Detectar complejidad

Clasificar el problema:

#### Usar `wf_generate` (simple)

- Flujo lineal
- Un solo dominio
- Sin paralelismo
- No requiere roles especializados

#### Usar `wf_create` (complejo — default recomendado)

- Múltiples pasos reales
- Diferentes dominios (backend, frontend, research, etc.)
- Requiere paralelismo
- Requiere validación/síntesis
- Puede beneficiarse de subflows

---

### Step 3A: Flujo simple

wf_generate(description="<descripción>")

---

### Step 3B: Flujo complejo

Generar un DAG con:

- Nodo `planner` (descomposición)
- Agentes especializados:
  - `researcher`
  - `coder`
  - `analyst`
  - `critic`
  - `synthesizer`
- Paralelismo cuando aplique
- Nodo final de validación

#### Formato obligatorio

```ts
wf_create({
  name: string,
  nodes: Node[],
  edges: Edge[]
})
Node schema
{
  id: string,
  type: "task" | "agent" | "subflow",
  role?: "planner" | "researcher" | "coder" | "analyst" | "critic" | "synthesizer",
  prompt?: string,
  inputs?: string[],
  outputs?: string[]
}
Edge schema
[fromNodeId, toNodeId]
Step 4: Subflows (opcional pero recomendado)

Si hay subproblemas reutilizables:

{
  id: "subtask_x",
  type: "subflow",
  plan_id: "<existing_plan>",
  inputs: [...]
}
Step 5: Output

Mostrar al usuario:

Plan creado: <name>
ID: <id>
Nodos: <count>

→ Ver en: /workflows → "<name>"
Step 6: Resumen visual

Construir tabla basada en nodos reales:

Nodo	Tipo	Rol	Descripción
planner	agent	planner	Divide el problema
backend	agent	coder	Implementa lógica
frontend	agent	coder	UI
review	agent	critic	Validación
Step 7: Siguiente paso
Ejecutar: wf_execute(plan_id="<id>")
O editar en /workflows
Reglas importantes
Preferir wf_create por defecto
Usar DAG, no pipelines lineales en casos complejos
Introducir paralelismo cuando sea posible
Incluir siempre:
planificación
síntesis o validación
Evitar nodos genéricos ("step1", "step2")
Usar nombres semánticos
Notas técnicas
wf_generate = template fijo (Start → Analyze → Implement → Review)
wf_create = control total del grafo
El cliente renderiza con planToFlow()
No requiere transformación manual
Compatible con event sourcing y logging por nodo
Objetivo del sistema

Pasar de:

→ pipelines lineales

a:

→ orquestación de agentes tipo:

DAGs ejecutables
subflows reutilizables
agentes especializados
ejecución paralela
sistemas auditables

El workflow debe ser:

observable
extensible
reutilizable
```
