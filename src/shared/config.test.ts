import { describe, expect, it } from 'vitest'
import { resolveContentBaseUrl, CONTENT_BASE_URL_DEFAULT } from './config'

describe('resolveContentBaseUrl', () => {
  it('returns the default when env var is unset', () => {
    expect(resolveContentBaseUrl({})).toBe(CONTENT_BASE_URL_DEFAULT)
  })

  it('returns the env override when set', () => {
    expect(resolveContentBaseUrl({ DEEPCUTS_CONTENT_BASE_URL: 'http://localhost:8080/content' }))
      .toBe('http://localhost:8080/content')
  })

  it('strips trailing slashes', () => {
    expect(resolveContentBaseUrl({ DEEPCUTS_CONTENT_BASE_URL: 'http://x/y///' }))
      .toBe('http://x/y')
  })

  it('ignores empty env override', () => {
    expect(resolveContentBaseUrl({ DEEPCUTS_CONTENT_BASE_URL: '  ' }))
      .toBe(CONTENT_BASE_URL_DEFAULT)
  })
})
