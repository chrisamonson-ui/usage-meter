import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const PANE = 'usage-meter'
const TITLE = 'Usage'
// Change the tag when Limit's fields change.
const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [], {
  shape: 'limits-1',
})

const LABELS: Record<string, string> = {
  five_hour: 'Current session (5-hour)',
  seven_day: 'Weekly (7-day)',
  spend_limit: 'Spend limit',
}

function bar(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function resetText(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const mins = Math.max(0, Math.round((at - now) / 60000))
  if (mins < 60) return `resets in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `resets in ${hours}h ${mins % 60}m`
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const register: Register = on => {
  async function refresh($: EngineInterface) {
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits.map(l => ({ ...l })))
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage',
      description: 'Show your 5-hour and weekly usage in a pane',
    })
    const ran = await next(e)
    await refresh($)
    void $.ui.open({ id: PANE, title: TITLE })

    return ran
  })

  on('command.run', { command: 'usage' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Usage pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits.map(l => ({ ...l })))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, limits)
    const now = $.clock.now()
    const width = Math.max(10, Math.min(30, (e.viewport?.columns ?? 40) - 10))
    const order = ['five_hour', 'seven_day', 'spend_limit']
    const sorted = [...list].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
    )

    return (
      <Box flexDirection="column" gap={1}>
        {sorted.length === 0 && (
          <Text dimColor>
            No usage reading yet. It appears after Claude's next reply.
          </Text>
        )}
        {sorted.map(limit => (
          <Box flexDirection="column">
            <Text bold>{LABELS[limit.kind] ?? limit.kind}</Text>
            <Text color={limit.percentUsed >= 90 ? 'error' : limit.percentUsed >= 70 ? 'warning' : undefined}>
              {bar(limit.percentUsed, width)} {limit.percentUsed}%
            </Text>
            <Text dimColor>{resetText(limit.resetsAt, now)}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
