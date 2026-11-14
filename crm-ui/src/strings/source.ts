/** Where a company or a lead came from (specs/20261101-crm US-7): the field, its values and its detail. */
import type { LeadSource } from '../lib/types'

const en = {
  label: 'Source',
  hint: 'How it reached us.',
  none: 'Not specified',
  value: {
    inbound: 'Direct inbound',
    outbound: 'Direct outbound',
    event: 'Event',
    referral: 'Referral',
    other: 'Other',
  } as Record<LeadSource, string>,
  /** The detail field's label, by source: which event, who referred it, or what else. */
  detail: { event: 'Which event', referral: 'Referred by', other: 'Details' } as Record<'event' | 'referral' | 'other', string>,
  detailHint: {
    event: 'e.g. Swiss Digital Day 2026',
    referral: 'A person or a company',
    other: 'Where it came from',
  } as Record<'event' | 'referral' | 'other', string>,
  /** Announced when the detail field offers what was already written. */
  suggestions: (count: number) => (count === 1 ? '1 suggestion already in use.' : `${count} suggestions already in use.`),
  /** "Event · Swiss Digital Day 2026" */
  summary: (source: string, detail: string | null) => (detail ? `${source} · ${detail}` : source),
}

const it: typeof en = {
  label: 'Origine',
  hint: 'Come ci ha raggiunto.',
  none: 'Non specificata',
  value: {
    inbound: 'Inbound diretto',
    outbound: 'Outbound diretto',
    event: 'Evento',
    referral: 'Referral',
    other: 'Altro',
  },
  detail: { event: 'Quale evento', referral: 'Segnalata da', other: 'Dettaglio' },
  detailHint: {
    event: 'ad es. Swiss Digital Day 2026',
    referral: 'Una persona o un’azienda',
    other: 'Da dove arriva',
  },
  suggestions: (count: number) => (count === 1 ? '1 suggerimento già in uso.' : `${count} suggerimenti già in uso.`),
  summary: (source: string, detail: string | null) => (detail ? `${source} · ${detail}` : source),
}

export const source = { en, it }
