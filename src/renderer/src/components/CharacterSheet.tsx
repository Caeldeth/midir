import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Tooltip,
  Typography
} from '@mui/material'
import {
  characterClassName,
  elementName,
  formatAgo,
  formatDurability,
  formatNumber,
  formatSigned,
  legendIconName,
  nationName,
  plural
} from '@renderer/lib/format'
import { INVENTORY_SLOT_COUNT } from '@shared/labels'
import type { CharacterRecord, ItemRef } from '@shared/types'
import EquipScreen from '@renderer/components/EquipScreen'
import ItemIcon from '@renderer/components/ItemIcon'
import React from 'react'

/**
 * The character sheet: identity, the equipment screen, vitals, and the
 * statistics, inventory, bank, and legend.
 *
 * Every number comes from the record, and the record only holds what the
 * server actually sent. Nothing here is estimated.
 *
 * The top row shows identity and vitals beside the equipment screen. Below it,
 * each detail section is a collapsible accordion, so a long sheet stays short
 * until the player opens what they want.
 */

const cardSx = { p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold', mb: 1.5 } as const
const sectionHeadingSx = { color: 'text.button', fontWeight: 'bold' } as const

function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  )
}

function Bar({
  label,
  current,
  maximum,
  color
}: {
  label: string
  current: number
  maximum: number
  color: 'error' | 'info'
}): React.JSX.Element {
  const percent = maximum > 0 ? Math.min(100, (current / maximum) * 100) : 0
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(current)} / {formatNumber(maximum)}
        </Typography>
      </Box>
      <LinearProgress variant="determinate" value={percent} color={color} sx={{ height: 6 }} />
    </Box>
  )
}

function ItemLine({ item }: { item: ItemRef }): React.JSX.Element {
  const durability = formatDurability(item.durability, item.maxDurability)
  return (
    <Tooltip title={durability === '' ? item.name : `${item.name} — durability ${durability}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <ItemIcon sprite={item.sprite} color={item.color} />
        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
          {item.name}
          {item.canStack && item.count > 1 ? (
            <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
              {' '}
              [{formatNumber(item.count)}]
            </Typography>
          ) : null}
        </Typography>
      </Box>
    </Tooltip>
  )
}

/** A collapsible detail section. */
function Section({
  title,
  defaultExpanded = false,
  children
}: {
  title: string
  defaultExpanded?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
        <Typography variant="h6" sx={sectionHeadingSx}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  )
}

function CharacterSheet({ record }: { record: CharacterRecord }): React.JSX.Element {
  const { stats, appearance } = record
  const inventorySlots = Object.keys(record.inventory)
    .map(Number)
    .sort((a, b) => a - b)
  const className = record.displayClass || characterClassName(appearance.characterClass)
  const itemsBanked =
    record.bank === undefined ? 'Not read' : formatNumber(record.bank.items.length)

  return (
    <Box data-testid="character-sheet" sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2.5,
          alignItems: 'stretch'
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Paper sx={cardSx}>
            <Typography variant="h4">{record.name}</Typography>
            <Typography variant="subtitle1" sx={{ color: 'text.secondary', mb: 1 }}>
              Level {formatNumber(stats.level)}
              {stats.abilityLevel > 0
                ? ` · Ability ${formatNumber(stats.abilityLevel)}`
                : ''} · {className}
            </Typography>
            {appearance.nation > 0 ? (
              <Typography variant="body2">{nationName(appearance.nation)}</Typography>
            ) : null}
            {record.guild ? (
              <Typography variant="body2">
                {record.guildRank ? `${record.guild} · ${record.guildRank}` : record.guild}
              </Typography>
            ) : null}
            {record.title ? <Typography variant="body2">{record.title}</Typography> : null}
            {record.hasMail ? (
              <Chip
                size="small"
                color="warning"
                label="Mail waiting"
                sx={{ alignSelf: 'flex-start', mt: 1 }}
              />
            ) : null}
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1.5 }}>
              Last seen {formatAgo(record.lastSeenMs)}
            </Typography>
          </Paper>

          <Paper sx={cardSx}>
            <Typography variant="h6" sx={headingSx}>
              Vitals
            </Typography>
            <Bar
              label="Health"
              current={stats.currentHealth}
              maximum={stats.maxHealth}
              color="error"
            />
            <Bar label="Mana" current={stats.currentMana} maximum={stats.maxMana} color="info" />
            <Divider sx={{ my: 1.5 }} />
            <StatRow label="Gold" value={formatNumber(stats.gold)} />
            <StatRow
              label="Weight"
              value={`${formatNumber(stats.weight)} / ${formatNumber(stats.maxWeight)}`}
            />
            <StatRow
              label="Items carried"
              value={`${formatNumber(inventorySlots.length)} of ${INVENTORY_SLOT_COUNT}`}
            />
            <StatRow label="Items banked" value={itemsBanked} />
            {stats.statPoints > 0 ? (
              <StatRow label="Unspent points" value={formatNumber(stats.statPoints)} />
            ) : null}
          </Paper>
        </Box>

        <Paper sx={cardSx}>
          <Typography variant="h6" sx={headingSx}>
            Equipment
          </Typography>
          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
            <EquipScreen record={record} />
          </Box>
        </Paper>
      </Box>

      <Section title="Statistics" defaultExpanded>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 2.5
          }}
        >
          <Box>
            <StatRow label="Strength" value={formatNumber(stats.strength)} />
            <StatRow label="Intelligence" value={formatNumber(stats.intelligence)} />
            <StatRow label="Wisdom" value={formatNumber(stats.wisdom)} />
            <StatRow label="Constitution" value={formatNumber(stats.constitution)} />
            <StatRow label="Dexterity" value={formatNumber(stats.dexterity)} />
          </Box>
          <Box>
            <StatRow label="Armour class" value={formatSigned(stats.armorClass)} />
            <StatRow label="Magic resistance" value={formatNumber(stats.magicResistance)} />
            <StatRow label="Damage" value={formatSigned(stats.damageModifier)} />
            <StatRow label="Hit" value={formatSigned(stats.hitModifier)} />
            <StatRow label="Attack element" value={elementName(stats.attackElement)} />
            <StatRow label="Defence element" value={elementName(stats.defenseElement)} />
          </Box>
          <Box>
            <StatRow label="Experience" value={formatNumber(stats.totalExperience)} />
            <StatRow label="To next level" value={formatNumber(stats.toNextLevel)} />
            <StatRow label="Ability" value={formatNumber(stats.totalAbility)} />
            <StatRow label="To next ability" value={formatNumber(stats.toNextAbility)} />
            <StatRow label="Game points" value={formatNumber(stats.gamePoints)} />
          </Box>
        </Box>
      </Section>

      <Section title="Inventory">
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {inventorySlots.length} of {INVENTORY_SLOT_COUNT} slots used
        </Typography>
        {inventorySlots.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No items seen yet.
          </Typography>
        ) : (
          inventorySlots.map((slot) => (
            <Box key={slot} sx={{ display: 'flex', gap: 1.5, py: 0.25 }}>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  minWidth: 24,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {slot}
              </Typography>
              <ItemLine item={record.inventory[slot]!} />
            </Box>
          ))
        )}
      </Section>

      <Section title="Bank">
        {record.bank === undefined ? (
          // An unread bank is never called empty. An empty bank sends no reply
          // at all, so only the player's own request tells the two apart, and a
          // record with no bank at all has no such request behind it. See
          // decode/dialog.ts.
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Not read yet. Midir fills this when you visit a banker and choose &ldquo;Withdraw
            Item&rdquo;.
          </Typography>
        ) : record.bank.items.length === 0 ? (
          // Midir saw the request and no list came back, so the bank was empty
          // when the player looked.
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Empty when you last looked{record.bank.npcName ? `, at ${record.bank.npcName}` : ''} ·{' '}
            {formatAgo(record.bank.readAtMs)}
          </Typography>
        ) : (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {plural(record.bank.items.length, 'item')}
              {record.bank.npcName ? ` at ${record.bank.npcName}` : ''} · read{' '}
              {formatAgo(record.bank.readAtMs)}
            </Typography>
            {record.bank.items.map((item) => (
              <Box
                key={`${item.name}-${item.sprite}`}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                    minWidth: 32,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {item.count > 1 ? `×${formatNumber(item.count)}` : ''}
                </Typography>
                <ItemIcon sprite={item.sprite} color={item.color} />
                <Typography variant="body2">{item.name}</Typography>
              </Box>
            ))}
          </>
        )}
      </Section>

      <Section title="Legend">
        {record.legend.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No legend marks seen yet.
          </Typography>
        ) : (
          record.legend.map((mark, index) => (
            <Box key={`${mark.key}-${index}`} sx={{ py: 0.5 }}>
              <Typography variant="body2">{mark.text}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {legendIconName(mark.icon)}
              </Typography>
            </Box>
          ))
        )}
      </Section>
    </Box>
  )
}

export default CharacterSheet
