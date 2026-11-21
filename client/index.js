import React from 'react'

const strings = {
  en: {
    title: 'Field-to-Asset Distiller Library',
    distillTitle: 'Distill Troubleshooting Trace into Skill',
    assetId: 'Asset ID',
    skillName: 'Skill Name (kebab-case)',
    description: 'Description',
    trace: 'Trace (JSONL)',
    submit: 'Distill Skill',
    promote: 'Promote Asset',
    empty: 'No distilled field assets yet.',
    loading: 'Loading distilled assets…',
    saving: 'Distilling asset…',
    refresh: 'Refresh',
  },
  'zh-CN': {
    title: '“从救火到资产”经验蒸馏器',
    distillTitle: '将排障轨迹蒸馏为标准 Skill',
    assetId: '资产 ID',
    skillName: 'Skill 名称 (kebab-case)',
    description: '一句话说明',
    trace: '会话轨迹 (JSONL)',
    submit: '生成 Skill 资产',
    promote: '晋升为团队复用资产',
    empty: '暂无沉淀资产。',
    loading: '加载资产库…',
    saving: '蒸馏生成中…',
    refresh: '刷新',
  },
}

const h = React.createElement

export function apply(ctx, config) {
  const services = ctx.profile.services
  const pendingKey = JSON.stringify(['fde.distiller', config.binding, config.revision])

  function readPending() {
    return JSON.parse(window.sessionStorage.getItem(pendingKey) ?? 'null')
  }

  function DistillerLibraryPage() {
    const locale = React.useSyncExternalStore(ctx.locale.subscribe, () => ctx.locale.locale)
    const t = strings[locale] ?? strings.en
    const [assets, setAssets] = React.useState([])
    const [assetId, setAssetId] = React.useState('')
    const [skillName, setSkillName] = React.useState('')
    const [description, setDescription] = React.useState('')
    const [trace, setTrace] = React.useState('')
    const [busy, setBusy] = React.useState(true)
    const [error, setError] = React.useState('')
    const [operation, setOperation] = React.useState(readPending)
    const live = React.useRef(false)
    const locked = React.useRef(false)

    const load = React.useCallback(async () => {
      const res = await services.query('fde.distiller.list', {})
      if (live.current) setAssets(res.assets ?? [])
    }, [])

    const runWork = React.useCallback(async (work) => {
      if (locked.current) return
      locked.current = true
      setBusy(true)
      setError('')
      try {
        await work()
      } catch (err) {
        if (live.current) setError(err instanceof Error ? err.message : 'Request failed')
      } finally {
        locked.current = false
        if (live.current) setBusy(false)
      }
    }, [])

    const settle = React.useCallback(
      async (result) => {
        const final = ['completed', 'refused', 'cancelled'].includes(result.state)
        if (final) window.sessionStorage.removeItem(pendingKey)
        if (!live.current) return
        if (final) setOperation(null)
        if (result.state === 'completed') {
          setAssetId('')
          setSkillName('')
          setDescription('')
          setTrace('')
          await load()
        } else {
          setError(`Status: ${result.state}`)
        }
      },
      [load],
    )

    React.useEffect(() => {
      live.current = true
      void runWork(async () => {
        const saved = readPending()
        if (saved) {
          const receipt = await services.readOperation(saved.service, saved.operationId)
          await settle(receipt)
        }
        await load()
      })
      return () => {
        live.current = false
      }
    }, [load, runWork, settle])

    function dispatch(service, input) {
      if (busy || operation) return
      const next = { service, operationId: crypto.randomUUID(), input }
      void runWork(async () => {
        window.sessionStorage.setItem(pendingKey, JSON.stringify(next))
        setOperation(next)
        const result = await services.effect(service, input, { operationId: next.operationId })
        await settle(result)
      })
    }

    const blocked = busy || operation !== null
    return h(
      'section',
      { 'aria-label': t.title },
      h('h1', null, config.publicConfig?.label ?? t.title),
      busy && h('p', { role: 'status' }, assets.length ? t.saving : t.loading),
      error && h('p', { role: 'alert' }, error),
      h('button', { type: 'button', disabled: busy, onClick: () => void runWork(load) }, t.refresh),
      h('h2', null, t.distillTitle),
      h(
        'form',
        {
          onSubmit(e) {
            e.preventDefault()
            if (!blocked && assetId.trim() && skillName.trim() && description.trim() && trace.trim()) {
              dispatch('fde.distiller.distill', {
                assetId: assetId.trim(),
                skillName: skillName.trim(),
                description: description.trim(),
                trace: trace.trim(),
              })
            }
          },
        },
        h(
          'label',
          null,
          t.assetId,
          h('input', {
            name: 'assetId',
            value: assetId,
            disabled: blocked,
            onInput: (e) => setAssetId(e.currentTarget.value),
          }),
        ),
        h(
          'label',
          null,
          t.skillName,
          h('input', {
            name: 'skillName',
            value: skillName,
            disabled: blocked,
            onInput: (e) => setSkillName(e.currentTarget.value),
          }),
        ),
        h(
          'label',
          null,
          t.description,
          h('input', {
            name: 'description',
            value: description,
            disabled: blocked,
            onInput: (e) => setDescription(e.currentTarget.value),
          }),
        ),
        h(
          'label',
          null,
          t.trace,
          h('textarea', {
            name: 'trace',
            value: trace,
            disabled: blocked,
            onInput: (e) => setTrace(e.currentTarget.value),
          }),
        ),
        h('button', { type: 'submit', disabled: blocked }, t.submit),
      ),
      assets.length === 0
        ? h('p', null, t.empty)
        : h(
            'ul',
            null,
            assets.map((asset) =>
              h(
                'li',
                { key: asset.id },
                h(
                  'strong',
                  null,
                  `${asset.id} (${asset.kind}: ${asset.name}) [${asset.status}] reuse=${asset.reuseCount ?? 0}`,
                ),
                asset.skillMarkdown && h('pre', null, asset.skillMarkdown),
                asset.status !== 'promoted' &&
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: blocked,
                      onClick: () => dispatch('fde.distiller.promote', { assetId: asset.id }),
                    },
                    t.promote,
                  ),
              ),
            ),
          ),
    )
  }

  ctx.homeEntries.register({
    id: 'distiller-library',
    icon: 'plugin',
    titleKey: 'Asset Distiller',
    order: 45,
    placement: 'secondary',
    component: DistillerLibraryPage,
  })
}
