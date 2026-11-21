/**
 * Execution trajectory analyzer and Skill / Candidate Plugin generator for FDE field distillation.
 */

export function parseTraceInput(traceInput) {
  if (Array.isArray(traceInput)) return traceInput
  if (typeof traceInput !== 'string') throw new Error('trace must be an array or JSONL string')
  return traceInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function analyzeTrace(traceInput, title = 'Field Incident Playbook') {
  const events = parseTraceInput(traceInput)
  const antiPatterns = []
  const canonicalSteps = []
  const seenSuccess = new Set()
  const paramTypes = {}

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (!ev || typeof ev !== 'object') continue
    if (ev.ok === false || ev.kind === 'error') {
      antiPatterns.push({
        seq: ev.seq ?? i + 1,
        tool: ev.tool ?? 'unknown',
        error: String(ev.error ?? ev.summary ?? 'Step failed'),
        hint: `Avoid repeating "${ev.tool ?? 'step'}" without checking precondition (${String(ev.error ?? 'error')})`,
      })
      continue
    }
    if (ev.tool) {
      const signature = `${ev.tool}:${JSON.stringify(ev.args ?? {})}`
      if (!seenSuccess.has(signature)) {
        seenSuccess.add(signature)
        canonicalSteps.push({
          step: canonicalSteps.length + 1,
          tool: ev.tool,
          args: ev.args ?? {},
          summary: String(ev.summary ?? `Execute ${ev.tool}`),
        })
      }
      if (ev.args && typeof ev.args === 'object' && !Array.isArray(ev.args)) {
        for (const [k, v] of Object.entries(ev.args)) {
          if (!paramTypes[k]) paramTypes[k] = typeof v
        }
      }
    }
  }

  return {
    title,
    totalEvents: events.length,
    prunedFailures: antiPatterns.length,
    canonicalSteps,
    antiPatterns,
    inferredParams: paramTypes,
  }
}

export function buildSkillMarkdown({ skillName, description, analysis }) {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(skillName)) {
    throw new Error(`Invalid skillName "${skillName}"; expected lowercase kebab-case`)
  }
  const stepsText =
    analysis.canonicalSteps.length > 0
      ? analysis.canonicalSteps
          .map(
            (s) =>
              `${s.step}. **\`${s.tool}\`**: ${s.summary}\n   - Example args: \`${JSON.stringify(s.args)}\``,
          )
          .join('\n')
      : '1. Inspect incident inputs and verify preconditions before executing tools.'

  const pitfallText =
    analysis.antiPatterns.length > 0
      ? analysis.antiPatterns.map((p) => `- **${p.tool}**: ${p.hint}`).join('\n')
      : '- Do not bypass read-only checks or execute unverified write operations.'

  return [
    '---',
    `name: ${skillName}`,
    `description: ${description}`,
    '---',
    '',
    `# ${analysis.title}`,
    '',
    '## Canonical Resolution Steps',
    '',
    stepsText,
    '',
    '## Known Pitfalls & Anti-Patterns',
    '',
    pitfallText,
    '',
    '## Safety & Refusal Rules',
    '',
    '- Confirm target identifiers and environment before mutating state.',
    '- Stop and report missing evidence rather than guessing parameters.',
    '',
  ].join('\n')
}

export function buildCandidatePluginFiles({ packageName, toolName, description, analysis }) {
  if (!/^[a-z0-9][a-z0-9._-]{1,64}$/.test(packageName.replace(/^@[a-z0-9-]+\//, ''))) {
    throw new Error(`Invalid packageName: ${packageName}`)
  }
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(toolName)) {
    throw new Error(`Invalid toolName "${toolName}"; expected snake_case`)
  }

  const paramEntries = Object.entries(analysis.inferredParams ?? {})
  const schemaLines =
    paramEntries.length > 0
      ? paramEntries
          .map(([k, t]) => {
            const typeExpr =
              t === 'number' ? 'Type.Number()' : t === 'boolean' ? 'Type.Boolean()' : 'Type.String()'
            return `      ${k}: ${typeExpr},`
          })
          .join('\n')
      : '      targetId: Type.String({ minLength: 1 }),'

  const manifest = {
    name: packageName,
    version: '0.1.0',
    type: 'module',
    license: 'Apache-2.0',
    exports: './index.mjs',
    agnes: {
      plugins: [
        {
          id: `ext:${packageName}/main`,
          export: 'main',
          apiRange: '^5.0.0',
          inject: ['tools'],
          capabilities: {
            tools: { prefix: '', names: [toolName] },
          },
        },
      ],
    },
  }

  const indexSource = `import { defineAgnesPlugin, defineTool, readOnlyTool } from '@agnes/plugin-runtime'
import { Type } from '@sinclair/typebox'

export const distilledTool = defineTool({
  name: '${toolName}',
  description: ${JSON.stringify(description)},
  parameters: Type.Object(
    {
${schemaLines}
    },
    { additionalProperties: false },
  ),
  meta: readOnlyTool,
  async execute(args, ctx) {
    ctx.signal.throwIfAborted()
    const structured = {
      tool: '${toolName}',
      steps: ${JSON.stringify(analysis.canonicalSteps.map((s) => s.tool))},
      input: args,
    }
    return { content: [{ type: 'text', text: JSON.stringify(structured) }], structured }
  },
})

export const main = defineAgnesPlugin({
  apply(ctx) {
    ctx.tools.register(distilledTool)
  },
})
`

  const testSource = `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPluginTestHost } from '@agnes/host/author-testkit'
import { main } from '../index.mjs'

const packageDir = fileURLToPath(new URL('../', import.meta.url))

test('${toolName} executes distilled workflow contract cleanly', async () => {
  const host = await createPluginTestHost(main, { packageDir })
  try {
    const res = await host.invoke('${toolName}', ${JSON.stringify(
      paramEntries.length
        ? Object.fromEntries(
            paramEntries.map(([k, t]) => [k, t === 'number' ? 1 : t === 'boolean' ? true : 'sample']),
          )
        : { targetId: 'sample-1' },
    )})
    assert.notEqual(res.isError, true)
    assert.equal(res.structured.tool, '${toolName}')
  } finally {
    await host.dispose()
  }
})
`

  return [
    { path: 'package.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: 'index.mjs', content: indexSource },
    { path: 'test/contract.test.mjs', content: testSource },
  ]
}
