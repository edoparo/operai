import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { errorMessage, fieldErrorOf, isNulRefusal, nulRefusedFieldOf, pdfCheckUnavailableOf } from './errors'
import { en, it as italian, strings } from '../strings'

/** crm-api's answer for a NUL in free text (crm-api/src/lib/nulText.test.ts): a 422 naming the field, never the value. */
const nulRefusal = (field: string, message = 'Not text: contains a NUL character') =>
  new ApiError({
    status: 422,
    title: 'Unprocessable Entity',
    detail: `${field}: ${message}`,
    extras: { field, errors: [{ field, message }] },
  })

const NOT_THE_RAW_TEXT = /NUL|legalName|addressLines|source:/

describe('a server 422 for a character that cannot be saved', () => {
  it('is recognised by its cause, for both server spellings, and by nothing else', () => {
    expect(isNulRefusal(nulRefusal('legalName'))).toBe(true)
    expect(isNulRefusal(nulRefusal('source', 'Must not contain a NUL character'))).toBe(true)
    expect(isNulRefusal(nulRefusal('name', 'Required'))).toBe(false)
    expect(
      isNulRefusal(new ApiError({ status: 500, title: 'x', detail: 'name: Not text: contains a NUL character' })),
    ).toBe(false)
    expect(isNulRefusal(new Error('NUL character'))).toBe(false)
  })

  it('reads as the localized sentence at the field, never the server detail or the field key', () => {
    const found = fieldErrorOf(nulRefusal('legalName'))
    expect(found).toEqual({ field: 'legalName', message: strings.common.validation.noNul })
    expect(found?.message).not.toMatch(NOT_THE_RAW_TEXT)
  })

  it('reads as the same sentence where no field can be shown (a banner)', () => {
    expect(errorMessage(nulRefusal('addressLines.1'))).toBe(strings.common.validation.noNul)
  })

  it('names the field the server named (the nested index goes with it)', () => {
    expect(nulRefusedFieldOf(nulRefusal('addressLines.1'))).toBe('addressLines.1')
    expect(nulRefusedFieldOf(nulRefusal('name', 'Required'))).toBeNull()
  })

  it('leaves every other refusal as it was', () => {
    const other = nulRefusal('name', 'Required')
    expect(fieldErrorOf(other)?.message).toBe('name: Required')
    expect(errorMessage(other)).toBe('name: Required')
  })
})

// 503 `pdf_check_busy` / `pdf_check_unavailable`: the check of an uploaded PDF could not run (crm-api isolatedPdfCheck.ts)
const pdfCheck = (code: string, status = 503) =>
  new ApiError({ status, title: 'Service Unavailable', code, detail: 'Too many files are being checked right now.' })

describe('a 503 from the isolated PDF check', () => {
  it('is recognised by status and code together, and by nothing else', () => {
    expect(pdfCheckUnavailableOf(pdfCheck('pdf_check_busy'))).toBe('pdf_check_busy')
    expect(pdfCheckUnavailableOf(pdfCheck('pdf_check_unavailable'))).toBe('pdf_check_unavailable')
    expect(pdfCheckUnavailableOf(pdfCheck('pdf_check_busy', 500))).toBeNull()
    expect(pdfCheckUnavailableOf(pdfCheck('storage_unconfigured'))).toBeNull()
    expect(pdfCheckUnavailableOf(new ApiError({ status: 503, title: 'x' }))).toBeNull()
    expect(pdfCheckUnavailableOf(new Error('pdf_check_busy'))).toBeNull()
  })

  it('reads as our own sentence, never the server English detail', () => {
    expect(errorMessage(pdfCheck('pdf_check_busy'))).toBe('The check of uploaded PDFs is busy. Try again in a moment.')
    expect(errorMessage(pdfCheck('pdf_check_unavailable'))).toBe('The PDF could not be checked right now. Try again.')
  })

  it('has Italian copy that is a translation of each', () => {
    for (const code of ['pdf_check_busy', 'pdf_check_unavailable'] as const) {
      expect(italian.common.pdfCheck[code]).not.toBe(en.common.pdfCheck[code])
      expect(italian.common.pdfCheck[code]).toMatch(/Riprova/)
    }
  })

  it('leaves a bare 503 (the authorization outage) with its own wording', () => {
    expect(errorMessage(new ApiError({ status: 503, title: 'x', detail: 'Authorization service unavailable' }))).toBe(
      'Authorization service unavailable',
    )
  })
})
