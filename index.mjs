import { readFileSync } from 'node:fs'
import { defineAgnesPlugin, defineTool, readOnlyTool, toolError, writeTool } from '@agnes/plugin-runtime'
import { Type } from '@sinclair/typebox'
import { analyzeTrace, buildCandidatePluginFiles, buildSkillMarkdown } from './distiller.mjs'

function listAssets(store) {
  return store ? (store.get('assets') ?? []) : []
}

function saveAsset(store, asset) {
  if (!store) throw new Error('Store capability unavailable')
  return store.transaction(() => {
    const assets = store.get('assets') ?? []
    const idx = assets.findIndex((a) => a.id === asset.id)
    const next = idx >= 0 ? assets.map((a, i) => (i === idx ? asset : a)) : [...assets, asset]
    store.set('assets', next)
    return asset
  })
}

function promoteAsset(store, assetId) {
  if (!store) throw new Error('Store capability unavailable')
  return store.transaction(() => {
    const assets = store.get('assets') ?? []
    const asset = assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`Distilled asset not found: ${assetId}`)
    const promoted = {
      ...asset,
      status: 'promoted',
      reuseCount: (asset.reuseCount ?? 0) + 1,
      promotedAt: new Date().toISOString(),
    }
    store.set(
      'assets',
      assets.map((a) => (a.id === assetId ? promoted : a)),
    )
    return promoted
  })
}

export function createFieldDistillerPlugin() {
  const playbook = readFileSync(new URL('./skills/field-distiller/SKILL.md', import.meta.url), 'utf8')
  const observedSessions = new Map()

  const analyzeTool = defineTool({
    name: 'fde_distill_analyze',
    description:
      'Analyze an incident troubleshooting trace (JSONL or event array), pruning dead-end failures into anti-patterns and extracting canonical steps.',
    parameters: Type.Object(
      {
        trace: Type.Union([
          Type.String({ minLength: 2 }),
          Type.Array(Type.Record(Type.String(), Type.Unknown())),
        ]),
        title: Type.Optional(Type.String({ maxLength: 120 })),
      },
      { additionalProperties: false },
    ),
    meta: readOnlyTool,
    async execute({ trace, title }, ctx) {
      ctx.signal.throwIfAborted()
      try {
        const analysis = analyzeTrace(trace, title)
        return { content: [{ type: 'text', text: JSON.stringify(analysis) }], structured: analysis }
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    },
  })

  const generateSkillTool = defineTool({
    name: 'fde_distill_generate_skill',
    description:
      'Distill a troubleshooting trace into a reusable SKILL.md playbook and persist it in the asset library.',
    parameters: Type.Object(
      {
        assetId: Type.String({ minLength: 2, maxLength: 64 }),
        skillName: Type.String({ pattern: '^[a-z][a-z0-9-]{1,63}$' }),
        description: Type.String({ minLength: 4, maxLength: 240 }),
        trace: Type.Union([
          Type.String({ minLength: 2 }),
          Type.Array(Type.Record(Type.String(), Type.Unknown())),
        ]),
        title: Type.Optional(Type.String({ maxLength: 120 })),
      },
      { additionalProperties: false },
    ),
    meta: { ...writeTool, isDestructive: false, requiresApproval: 'never' },
    async execute(args, ctx) {
      ctx.signal.throwIfAborted()
      try {
        const analysis = analyzeTrace(args.trace, args.title ?? args.skillName)
        const skillMarkdown = buildSkillMarkdown({
          skillName: args.skillName,
          description: args.description,
          analysis,
        })
        const asset = saveAsset(ctx.store, {
          id: args.assetId,
          kind: 'skill',
          name: args.skillName,
          description: args.description,
          status: 'draft',
          reuseCount: 0,
          analysis,
          skillMarkdown,
          createdAt: new Date().toISOString(),
        })
        return { content: [{ type: 'text', text: JSON.stringify({ asset }) }], structured: { asset } }
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    },
  })

  const generatePluginTool = defineTool({
    name: 'fde_distill_generate_plugin',
    description:
      'Distill a resolved workflow trace into a complete AGH candidate plugin file tree (package.json, index.mjs, contract test) ready for plugin_helper_create.',
    parameters: Type.Object(
      {
        assetId: Type.String({ minLength: 2, maxLength: 64 }),
        packageName: Type.String({ minLength: 3, maxLength: 80 }),
        toolName: Type.String({ pattern: '^[a-z][a-z0-9_]{2,63}$' }),
        description: Type.String({ minLength: 4, maxLength: 240 }),
        trace: Type.Union([
          Type.String({ minLength: 2 }),
          Type.Array(Type.Record(Type.String(), Type.Unknown())),
        ]),
      },
      { additionalProperties: false },
    ),
    meta: { ...writeTool, isDestructive: false, requiresApproval: 'never' },
    async execute(args, ctx) {
      ctx.signal.throwIfAborted()
      try {
        const analysis = analyzeTrace(args.trace, args.packageName)
        const files = buildCandidatePluginFiles({
          packageName: args.packageName,
          toolName: args.toolName,
          description: args.description,
          analysis,
        })
        const asset = saveAsset(ctx.store, {
          id: args.assetId,
          kind: 'plugin-candidate',
          name: args.packageName,
          toolName: args.toolName,
          description: args.description,
          status: 'draft',
          reuseCount: 0,
          analysis,
          files,
          createdAt: new Date().toISOString(),
        })
        return { content: [{ type: 'text', text: JSON.stringify({ asset }) }], structured: { asset } }
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    },
  })

  const libraryTool = defineTool({
    name: 'fde_distill_library',
    description: 'List distilled field assets or promote a reviewed asset to team-reusable status.',
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal('list'), Type.Literal('promote')]),
        assetId: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    meta: { ...writeTool, isDestructive: false, requiresApproval: 'never' },
    async execute({ action, assetId }, ctx) {
      ctx.signal.throwIfAborted()
      try {
        if (action === 'promote') {
          if (!assetId) throw new Error('assetId is required to promote')
          const asset = promoteAsset(ctx.store, assetId)
          return { content: [{ type: 'text', text: JSON.stringify({ asset }) }], structured: { asset } }
        }
        const assets = listAssets(ctx.store)
        return { content: [{ type: 'text', text: JSON.stringify({ assets }) }], structured: { assets } }
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    },
  })

  return defineAgnesPlugin({
    apply(ctx) {
      for (const t of [analyzeTool, generateSkillTool, generatePluginTool, libraryTool]) {
        ctx.tools.register(t)
      }
      ctx.skills?.register({
        name: 'fde-field-distiller',
        description:
          'Distill resolved field troubleshooting sessions into reusable Skills and candidate plugins.',
        body: playbook,
      })

      try {
        ctx.sessionWork?.register({
          name: 'field-distiller-observer',
          observe(event) {
            if (event.kind === 'message') {
              const count = (observedSessions.get(event.session.key) ?? 0) + 1
              observedSessions.set(event.session.key, count)
            }
          },
          async run(workCtx) {
            observedSessions.set(workCtx.session.key, workCtx.boundary.turn)
          },
        })
      } catch (err) {
        if (!(err instanceof Error && err.message.includes('session work not granted'))) {
          throw err
        }
      }

      ctx.services.register({
        scope: 'profile',
        kind: 'query',
        name: 'fde.distiller.list',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object',
          properties: { assets: { type: 'array' } },
          required: ['assets'],
          additionalProperties: false,
        },
        timeoutMs: 5000,
        maxResultBytes: 262144,
        async handler(_input, context) {
          return { assets: listAssets(context.store) }
        },
      })

      ctx.services.register({
        scope: 'profile',
        kind: 'effect',
        name: 'fde.distiller.distill',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string' },
            skillName: { type: 'string' },
            description: { type: 'string' },
            trace: { type: 'string' },
          },
          required: ['assetId', 'skillName', 'description', 'trace'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { asset: { type: 'object' } },
          required: ['asset'],
          additionalProperties: false,
        },
        timeoutMs: 5000,
        maxResultBytes: 131072,
        effectPolicy: {
          isDestructive: false,
          isOpenWorld: false,
          replay: 'idempotent',
          requiresApproval: 'never',
          approvalScopes: [],
        },
        async handler(input, context) {
          context.signal.throwIfAborted()
          const analysis = analyzeTrace(input.trace, input.skillName)
          const skillMarkdown = buildSkillMarkdown({
            skillName: input.skillName,
            description: input.description,
            analysis,
          })
          const asset = saveAsset(context.store, {
            id: input.assetId,
            kind: 'skill',
            name: input.skillName,
            description: input.description,
            status: 'draft',
            reuseCount: 0,
            analysis,
            skillMarkdown,
            createdAt: new Date().toISOString(),
          })
          return { asset }
        },
      })

      ctx.services.register({
        scope: 'profile',
        kind: 'effect',
        name: 'fde.distiller.promote',
        inputSchema: {
          type: 'object',
          properties: { assetId: { type: 'string' } },
          required: ['assetId'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { asset: { type: 'object' } },
          required: ['asset'],
          additionalProperties: false,
        },
        timeoutMs: 5000,
        maxResultBytes: 131072,
        effectPolicy: {
          isDestructive: false,
          isOpenWorld: false,
          replay: 'idempotent',
          requiresApproval: 'never',
          approvalScopes: [],
        },
        async handler(input, context) {
          context.signal.throwIfAborted()
          return { asset: promoteAsset(context.store, input.assetId) }
        },
      })
    },
  })
}

export const main = createFieldDistillerPlugin()
export { analyzeTrace, buildCandidatePluginFiles, buildSkillMarkdown }
