/**
 * The Owner filter's keys and options (specs/20261108-estimate-list-oversight US-4).
 */
import { describe, expect, it } from 'vitest'
import type { EstimateListItem } from './estimatesApi'
import { OWNER_ME, byOwner, ownerKeyOf, ownerOptions } from './ownerFilter'
import { strings } from '../strings'

const row = (id: string, over: Partial<EstimateListItem>): EstimateListItem => ({
  id,
  name: id,
  author: '',
  updatedAt: '2026-11-20T10:00:00.000Z',
  access: 'owner',
  owner: null,
  closedAt: null,
  crmDealId: null,
  ...over,
})

const mine = row('a', {})
const anna = row('b', { access: 'oversight', owner: { status: 'active', name: 'Anna Rossi' } })
const annaShared = row('c', { access: 'viewer', owner: { status: 'active', name: 'Anna Rossi' } })
const bruno = row('d', { access: 'editor', owner: { status: 'active', name: 'Bruno Bianchi' } })
const former = row('e', { access: 'oversight', owner: { status: 'deleted', name: null } })
const broken = row('f', { access: 'viewer', owner: null })

describe('ownerFilter', () => {
  it('keys a row by what it shows as its owner', () => {
    expect(ownerKeyOf(mine)).toBe(OWNER_ME)
    expect(ownerKeyOf(anna)).toBe('Anna Rossi')
    expect(ownerKeyOf(former)).toBe(strings.sharing.identity.deleted)
    expect(ownerKeyOf(broken)).toBe(strings.sharing.identity.unknown)
  })

  it('lists the caller first, then the others by name, once each', () => {
    expect(ownerOptions([bruno, anna, mine, annaShared], null)).toEqual([
      { value: OWNER_ME, isMe: true },
      { value: 'Anna Rossi', isMe: false },
      { value: 'Bruno Bianchi', isMe: false },
    ])
  })

  it('keeps a chosen owner no loaded row has', () => {
    expect(ownerOptions([mine], 'Carla Verdi')).toEqual([
      { value: OWNER_ME, isMe: true },
      { value: 'Carla Verdi', isMe: false },
    ])
  })

  it('filters on the key, everyone when none is chosen', () => {
    const all = [mine, anna, annaShared, bruno]
    expect(byOwner(all, null)).toEqual(all)
    expect(byOwner(all, 'Anna Rossi')).toEqual([anna, annaShared])
    expect(byOwner(all, OWNER_ME)).toEqual([mine])
  })
})
