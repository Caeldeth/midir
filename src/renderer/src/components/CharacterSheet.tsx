import {
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography
} from '@mui/material'
import {
  characterClassName,
  elementName,
  equipmentSlotName,
  formatAgo,
  formatDurability,
  formatNumber,
  formatSigned,
  legendIconName,
  nationName
} from '@renderer/lib/format'
import { EQUIPMENT_SLOT_ORDER, INVENTORY_SLOT_COUNT } from '@shared/labels'
import type { CharacterRecord, ItemRef } from '@shared/types'
import React from 'react'

/**
 * The character sheet: statistics, equipment, appearance, legend, and gold.
 *
 * Every number comes from the record, and the record only holds what the
 * server actually sent. Nothing here is estimated.
 */

const cardSx = { p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold', mb: 1.5 } as const

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
      <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
        {item.name}
        {item.canStack && item.count > 1 ? (
          <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
            {' '}
            [{formatNumber(item.count)}]
          </Typography>
        ) : null}
      </Typography>
    </Tooltip>
  )
}

function CharacterSheet({ record }: { record: CharacterRecord }): React.JSX.Element {
  const { stats, appearance } = record
  const inventorySlots = Object.keys(record.inventory)
    .map(Number)
    .sort((a, b) => a - b)

  return (
    <Box
      data-testid="character-sheet"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 2.5,
        alignItems: 'stretch'
      }}
    >
      <Paper sx={cardSx}>
        <Typography variant="h5">{record.name}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          Level {formatNumber(stats.level)}
          {stats.abilityLevel > 0 ? ` · Ability ${formatNumber(stats.abilityLevel)}` : ''} ·{' '}
          {record.displayClass || characterClassName(appearance.characterClass)}
        </Typography>

        <Bar label="Health" current={stats.currentHealth} maximum={stats.maxHealth} color="error" />
        <Bar label="Mana" current={stats.currentMana} maximum={stats.maxMana} color="info" />

        <Divider sx={{ my: 1.5 }} />
        <StatRow label="Gold" value={formatNumber(stats.gold)} />
        <StatRow
          label="Weight"
          value={`${formatNumber(stats.weight)} / ${formatNumber(stats.maxWeight)}`}
        />
        {stats.statPoints > 0 ? (
          <StatRow label="Unspent points" value={formatNumber(stats.statPoints)} />
        ) : null}

        <Box sx={{ flexGrow: 1 }} />
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
          {record.title ? <Chip size="small" label={record.title} /> : null}
          {record.guild ? (
            <Chip
              size="small"
              variant="outlined"
              label={record.guildRank ? `${record.guild} · ${record.guildRank}` : record.guild}
            />
          ) : null}
          {appearance.nation > 0 ? (
            <Chip size="small" variant="outlined" label={nationName(appearance.nation)} />
          ) : null}
          {record.hasMail ? <Chip size="small" color="warning" label="Mail waiting" /> : null}
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1.5 }}>
          Last seen {formatAgo(record.lastSeenMs)}
        </Typography>
      </Paper>

      <Paper sx={cardSx}>
        <Typography variant="h6" sx={headingSx}>
          Statistics
        </Typography>
        <StatRow label="Strength" value={formatNumber(stats.strength)} />
        <StatRow label="Intelligence" value={formatNumber(stats.intelligence)} />
        <StatRow label="Wisdom" value={formatNumber(stats.wisdom)} />
        <StatRow label="Constitution" value={formatNumber(stats.constitution)} />
        <StatRow label="Dexterity" value={formatNumber(stats.dexterity)} />
        <Divider sx={{ my: 1 }} />
        <StatRow label="Armour class" value={formatSigned(stats.armorClass)} />
        <StatRow label="Magic resistance" value={formatNumber(stats.magicResistance)} />
        <StatRow label="Damage" value={formatSigned(stats.damageModifier)} />
        <StatRow label="Hit" value={formatSigned(stats.hitModifier)} />
        <StatRow label="Attack element" value={elementName(stats.attackElement)} />
        <StatRow label="Defence element" value={elementName(stats.defenseElement)} />
        <Divider sx={{ my: 1 }} />
        <StatRow label="Experience" value={formatNumber(stats.totalExperience)} />
        <StatRow label="To next level" value={formatNumber(stats.toNextLevel)} />
        <StatRow label="Ability" value={formatNumber(stats.totalAbility)} />
        <StatRow label="To next ability" value={formatNumber(stats.toNextAbility)} />
        <StatRow label="Game points" value={formatNumber(stats.gamePoints)} />
      </Paper>

      <Paper sx={cardSx}>
        <Typography variant="h6" sx={headingSx}>
          Equipment
        </Typography>
        {EQUIPMENT_SLOT_ORDER.some((slot) => record.equipment[slot] !== undefined) ? (
          EQUIPMENT_SLOT_ORDER.map((slot) => {
            const item = record.equipment[slot]
            if (item === undefined) return null
            return (
              <Box
                key={slot}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}
              >
                <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>
                  {equipmentSlotName(slot)}
                </Typography>
                <ItemLine item={item} />
              </Box>
            )
          })
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Nothing equipped yet.
          </Typography>
        )}
      </Paper>

      <Paper sx={cardSx}>
        <Typography variant="h6" sx={headingSx}>
          Inventory
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
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
      </Paper>

      <Paper sx={cardSx}>
        <Typography variant="h6" sx={headingSx}>
          Appearance
        </Typography>
        <StatRow label="Class" value={characterClassName(appearance.characterClass)} />
        <StatRow label="Nation" value={nationName(appearance.nation)} />
        <StatRow label="Hair style" value={formatNumber(appearance.hairStyle)} />
        <StatRow label="Hair colour" value={formatNumber(appearance.hairColor)} />
        <StatRow label="Body" value={formatNumber(appearance.bodyShape)} />
        <StatRow label="Face" value={formatNumber(appearance.faceShape)} />
        <StatRow label="Skin colour" value={formatNumber(appearance.skinColor)} />
        <Divider sx={{ my: 1 }} />
        <StatRow label="Armour sprite" value={formatNumber(appearance.armorSprite)} />
        <StatRow label="Weapon sprite" value={formatNumber(appearance.weaponSprite)} />
        <StatRow label="Shield sprite" value={formatNumber(appearance.shieldSprite)} />
        <StatRow label="Boots sprite" value={formatNumber(appearance.bootsSprite)} />
        <StatRow label="Overcoat sprite" value={formatNumber(appearance.overcoatSprite)} />
      </Paper>

      <Paper sx={cardSx}>
        <Typography variant="h6" sx={headingSx}>
          Legend
        </Typography>
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
      </Paper>
    </Box>
  )
}

export default CharacterSheet
