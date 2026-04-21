import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename, resolve } from 'path';
import { parseJsonlFile } from '../../shared/jsonl-parser/token-extraction.js';
import { output, outputError, isJsonMode } from '../../shared/output.js';
import type { SessionEvent } from '../../shared/types/session-event.js';

interface FieldShape {
  type: string;
  nullable?: boolean;
  values?: Set<unknown>;
  fields?: Record<string, FieldShape>;
  items?: FieldShape;
  unionTypes?: string[];
}

interface SchemaOutput {
  totalEvents: number;
  eventTypeCounts: Record<string, number>;
  schemas: Record<string, FieldShape>;
  contentBlockTypes?: string[];
}

export async function schemaInspectCommand(
  jsonlPath: string,
  opts: {
    type?: string;
    json?: boolean;
    sample?: boolean;
    depth?: string;
    output?: string;
    exportSchemas?: boolean;
  } = {},
): Promise<void> {
  if (!existsSync(jsonlPath)) {
    outputError(`schema-inspect: file not found: ${jsonlPath}`);
    return;
  }

  try {
    const events = await parseJsonlFile(jsonlPath);
    const depth = Math.max(1, parseInt(opts.depth ?? '3', 10));
    const filterType = opts.type;

    // Count by type
    const typeCounts = new Map<string, number>();
    for (const evt of events) {
      const t = evt.type;
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }

    // Infer schemas by type
    const schemas = new Map<string, FieldShape>();
    const examples = new Map<string, SessionEvent>();
    const contentBlockTypes = new Set<string>();

    for (const evt of events) {
      const t = evt.type;
      if (filterType && t !== filterType) continue;

      const shape = inferShape(evt, depth);
      const existing = schemas.get(t);
      schemas.set(t, existing ? mergeShapes(existing, shape) : shape);

      if (!examples.has(t)) examples.set(t, evt);

      // Collect content block types from assistant messages
      if (t === 'assistant' && 'message' in evt && evt.message?.content) {
        const content = evt.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === 'object' && 'type' in block) {
              contentBlockTypes.add(String(block.type));
            }
          }
        }
      }
    }

    const result: SchemaOutput = {
      totalEvents: events.length,
      eventTypeCounts: Object.fromEntries(typeCounts),
      schemas: Object.fromEntries(schemas),
      contentBlockTypes: contentBlockTypes.size > 0 ? Array.from(contentBlockTypes).sort() : undefined,
    };

    // Always write debug output to .ctk/debug/schema-inspect/<basename>-<timestamp>/
    const outDir = opts.output ?? defaultOutputDir(jsonlPath);
    writeDebugArtifacts(outDir, result, examples, jsonlPath);

    // Optionally export deterministic per-event-type schemas (BigQuery-style)
    if (opts.exportSchemas) {
      const schemaDir = join(outDir, 'declarative');
      writeDeclarativeSchemas(schemaDir, result.schemas);
      console.log(`📄 Declarative schemas → ${schemaDir}`);
    }

    if (opts.json || isJsonMode()) {
      output(result);
    } else {
      printSchema(result, examples, opts.sample ?? false);
      console.log(`📁 Debug artifacts → ${outDir}\n`);
    }
  } catch (err: any) {
    outputError(`schema-inspect: ${err.message}`);
  }
}

function defaultOutputDir(jsonlPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = basename(jsonlPath).replace(/\.jsonl$/, '');
  return resolve('.ctk/debug/schema-inspect', `${slug}-${stamp}`);
}

function writeDebugArtifacts(
  outDir: string,
  result: SchemaOutput,
  examples: Map<string, SessionEvent>,
  sourcePath: string,
): void {
  mkdirSync(outDir, { recursive: true });

  // Full schema as JSON
  writeFileSync(
    join(outDir, 'schema.json'),
    JSON.stringify(result, replacer, 2),
  );

  // One example per event type
  const examplesObj: Record<string, SessionEvent> = {};
  for (const [type, evt] of examples) examplesObj[type] = evt;
  writeFileSync(
    join(outDir, 'examples.json'),
    JSON.stringify(examplesObj, null, 2),
  );

  // Human-readable summary
  const summary: string[] = [];
  summary.push(`# Schema Inspection`);
  summary.push(``);
  summary.push(`Source: ${sourcePath}`);
  summary.push(`Total events: ${result.totalEvents}`);
  summary.push(``);
  summary.push(`## Event types`);
  for (const [t, n] of Object.entries(result.eventTypeCounts)) {
    summary.push(`- ${t}: ${n}`);
  }
  if (result.contentBlockTypes) {
    summary.push(``);
    summary.push(`## Content block types`);
    summary.push(result.contentBlockTypes.map((t) => `- ${t}`).join('\n'));
  }
  writeFileSync(join(outDir, 'README.md'), summary.join('\n') + '\n');
}

function writeDeclarativeSchemas(
  outDir: string,
  schemas: Record<string, FieldShape>,
): void {
  mkdirSync(outDir, { recursive: true });

  for (const [eventType, shape] of Object.entries(schemas)) {
    const fields = toBigQuerySchema(shape);
    const filename = `${capitalize(eventType.replace(/-/g, '_'))}Event.json`;
    writeFileSync(join(outDir, filename), JSON.stringify(fields, null, 2));
  }
}

function toBigQuerySchema(shape: FieldShape): Array<Record<string, unknown>> {
  if (shape.type !== 'object' || !shape.fields) return [];
  const result: Array<Record<string, unknown>> = [];
  for (const [name, field] of Object.entries(shape.fields)) {
    result.push(fieldToBQ(name, field));
  }
  return result;
}

function fieldToBQ(name: string, field: FieldShape): Record<string, unknown> {
  const entry: Record<string, unknown> = { name };

  if (field.type === 'object' && field.fields) {
    entry.type = 'RECORD';
    entry.fields = toBigQuerySchema(field);
  } else if (field.type === 'array') {
    entry.mode = 'REPEATED';
    if (field.unionTypes) {
      entry.type = 'JSON';
      entry.description = `union: ${field.unionTypes.join(' | ')}`;
    } else if (field.items?.type === 'object' && field.items.fields) {
      entry.type = 'RECORD';
      entry.fields = toBigQuerySchema(field.items);
    } else {
      entry.type = bqType(field.items?.type ?? 'unknown');
    }
  } else if (field.unionTypes) {
    entry.type = 'JSON';
    entry.description = `union: ${field.unionTypes.join(' | ')}`;
  } else {
    entry.type = bqType(field.type);
  }

  if (field.nullable) entry.mode = 'NULLABLE';
  return entry;
}

function bqType(t: string): string {
  switch (t) {
    case 'string': return 'STRING';
    case 'number': return 'FLOAT';
    case 'boolean': return 'BOOLEAN';
    case 'object': return 'RECORD';
    case 'array': return 'JSON';
    case 'null': return 'STRING';
    default: return 'JSON';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return Array.from(value);
  return value;
}

function inferShape(value: unknown, maxDepth: number, depth = 0): FieldShape {
  if (depth >= maxDepth) {
    return { type: typeof value };
  }

  if (value === null) {
    return { type: 'null', nullable: true };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: 'array', items: { type: 'unknown' } };
    }

    const itemShapes = new Map<string, FieldShape>();
    const blockTypes = new Set<string>();

    for (const item of value) {
      if (item && typeof item === 'object' && 'type' in item) {
        blockTypes.add(String(item.type));
      }
      const itemShape = inferShape(item, maxDepth, depth + 1);
      const key = itemShape.type;
      itemShapes.set(key, itemShapes.has(key) ? mergeShapes(itemShapes.get(key)!, itemShape) : itemShape);
    }

    if (blockTypes.size > 0) {
      return { type: 'array', unionTypes: Array.from(blockTypes) };
    }

    if (itemShapes.size === 1) {
      return { type: 'array', items: Array.from(itemShapes.values())[0] };
    }

    return {
      type: 'array',
      unionTypes: Array.from(itemShapes.keys()),
      items: { type: 'object' },
    };
  }

  if (typeof value === 'object') {
    const fields: Record<string, FieldShape> = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = inferShape(v, maxDepth, depth + 1);
    }
    return { type: 'object', fields };
  }

  if (typeof value === 'string') {
    return { type: 'string' };
  }

  if (typeof value === 'number') {
    return { type: 'number' };
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }

  return { type: typeof value };
}

function mergeShapes(a: FieldShape, b: FieldShape): FieldShape {
  if (a.type !== b.type) {
    // Union type
    const types = new Set<string>();
    if (a.unionTypes) types.forEach((t) => types.add(t));
    else types.add(a.type);
    if (b.unionTypes) b.unionTypes.forEach((t) => types.add(t));
    else types.add(b.type);
    return {
      type: Array.from(types).join(' | '),
      unionTypes: Array.from(types),
    };
  }

  if (a.type === 'object' && a.fields && b.fields) {
    const merged: Record<string, FieldShape> = { ...a.fields };
    for (const [k, v] of Object.entries(b.fields)) {
      merged[k] = merged[k] ? mergeShapes(merged[k], v) : v;
    }
    return { type: 'object', fields: merged };
  }

  if (a.type === 'array') {
    if (a.unionTypes && b.unionTypes) {
      const all = new Set([...a.unionTypes, ...b.unionTypes]);
      return { type: 'array', unionTypes: Array.from(all) };
    }
    if (a.items && b.items) {
      return { type: 'array', items: mergeShapes(a.items, b.items) };
    }
  }

  return a;
}

function printSchema(result: SchemaOutput, examples: Map<string, SessionEvent>, showSample: boolean): void {
  console.log(`\n📊 Schema Analysis: ${result.totalEvents} events\n`);

  console.log('Event types:');
  for (const [type, count] of Object.entries(result.eventTypeCounts).sort()) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }

  if (result.contentBlockTypes) {
    console.log(`\nContent block types: ${result.contentBlockTypes.join(', ')}`);
  }

  console.log('\n' + '─'.repeat(60));

  for (const [type, shape] of Object.entries(result.schemas)) {
    console.log(`\n▸ ${type}`);
    printFieldShape(shape, 2);

    if (showSample && examples.has(type)) {
      const evt = examples.get(type)!;
      console.log(`\n  Example:`);
      console.log(
        '  ' +
          JSON.stringify(evt, null, 2)
            .split('\n')
            .slice(0, 10)
            .join('\n  ') +
          (JSON.stringify(evt, null, 2).split('\n').length > 10 ? '\n  ...' : ''),
      );
    }
  }

  console.log('\n');
}

function printFieldShape(shape: FieldShape, indent: number): void {
  const pad = ' '.repeat(indent);

  if (shape.type === 'object' && shape.fields) {
    for (const [k, v] of Object.entries(shape.fields)) {
      const nullable = v.nullable ? '?' : '';
      if (v.type === 'object' && v.fields) {
        console.log(`${pad}${k}${nullable}: {`);
        printFieldShape(v, indent + 2);
        console.log(`${pad}}`);
      } else if (v.type === 'array') {
        if (v.unionTypes) {
          console.log(
            `${pad}${k}${nullable}: Array<${v.unionTypes.length <= 3 ? v.unionTypes.join(' | ') : '...'}>`,
          );
        } else if (v.items) {
          console.log(`${pad}${k}${nullable}: Array<${v.items.type}>`);
        } else {
          console.log(`${pad}${k}${nullable}: Array`);
        }
      } else {
        console.log(`${pad}${k}${nullable}: ${v.type}`);
      }
    }
  }
}
