import { describe, expect, it } from 'vitest'
import { fillTemplate, paramsIn } from '../../../shared/types'
import { builtinErrands, findErrand } from '../errands'

describe('built-in errands', () => {
  it('lists the six clout NPCs and the five labor NPCs', () => {
    const names = builtinErrands().map((errand) => errand.name)
    expect(names.filter((name) => name.startsWith('Clout —'))).toHaveLength(6)
    expect(names.filter((name) => name.startsWith('Labor —'))).toHaveLength(5)
  })

  it('names an NPC and a destination for every errand', () => {
    for (const errand of builtinErrands()) {
      expect(errand.npcName).not.toBe('')
      expect(errand.destination).not.toBe('')
    }
  })

  it('gives the three Rucesion clout errands the recorded conversation', () => {
    for (const npc of ['Maria', 'Angelo', 'Eduardo']) {
      const errand = builtinErrands().find((e) => e.npcName === npc)!
      expect(errand.params).toEqual([{ name: 'citizen', label: 'Citizen to support' }])
      expect(errand.steps.map((s) => s.choose ?? s.answer)).toEqual([
        'Rucesion Civics',
        'Support a Citizen',
        'I am sure',
        '{citizen}'
      ])
      expect(errand.branches?.map((b) => b.then)).toEqual(['done', 'restart'])
    }
  })

  it('gives the five labor errands the recorded conversation', () => {
    for (const errand of builtinErrands().filter((e) => e.name.startsWith('Labor —'))) {
      expect(errand.params).toEqual([{ name: 'aisling', label: 'Aisling to work for' }])
      expect(errand.steps.map((s) => s.choose ?? s.answer)).toEqual([
        'Labor',
        'I want to work',
        '{aisling}'
      ])
    }
  })

  it('names every placeholder a step uses among the errand params', () => {
    for (const errand of builtinErrands()) {
      const declared = new Set((errand.params ?? []).map((p) => p.name))
      for (const step of [...errand.steps, ...(errand.branches ?? [])]) {
        for (const text of [step.answer, step.when]) {
          if (text === undefined) continue
          for (const name of paramsIn(text)) expect(declared.has(name)).toBe(true)
        }
      }
    }
  })

  it('gives every step one answer, and every branch a `when`', () => {
    for (const errand of builtinErrands()) {
      for (const step of errand.steps) {
        expect((step.choose === undefined) !== (step.answer === undefined)).toBe(true)
      }
      for (const branch of errand.branches ?? []) expect(branch.when).toBeDefined()
    }
  })

  it('holds no citizen name: the placeholder is what a step carries', () => {
    const text = JSON.stringify(builtinErrands())
    expect(fillTemplate(text, {})).toBe(text)
    expect(text).not.toContain('Pandsala')
  })

  it('finds an errand by name', () => {
    const first = builtinErrands()[0]!
    expect(findErrand(first.name)).toBe(first)
  })

  it('returns undefined for an unknown name', () => {
    expect(findErrand('no such errand')).toBeUndefined()
  })
})
