import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { codeOf, errorMessage, statusOf } from './errors'
import { strings } from '../strings'

describe('errors', () => {
  it('words an ApiError with its detail, else the generic line', () => {
    expect(errorMessage(new ApiError({ status: 500, title: 't', detail: 'Boom.' }))).toBe('Boom.')
    expect(errorMessage(new ApiError({ status: 500, title: 't' }))).toBe(strings.common.unknownError)
  })

  it('words anything that is not an ApiError as a network failure', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(strings.common.networkError)
  })

  it('reads status and code off an ApiError only', () => {
    const error = new ApiError({ status: 403, title: 't', code: 'forbidden' })
    expect(statusOf(error)).toBe(403)
    expect(codeOf(error)).toBe('forbidden')
    expect(statusOf(new Error('x'))).toBeNull()
    expect(codeOf(new Error('x'))).toBeNull()
    expect(codeOf(new ApiError({ status: 500, title: 't' }))).toBeNull()
  })
})
