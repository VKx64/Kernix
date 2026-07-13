import { BRAND_MARK, BRAND_NAME, BROWSER_EXTENSION_NAME } from './brand'

describe('Kernix brand identity', () => {
  it('uses one product identity across the application shell and companion extension', () => {
    expect(BRAND_NAME).toBe('Kernix')
    expect(BRAND_MARK).toBe('K')
    expect(BROWSER_EXTENSION_NAME).toBe('Kernix Companion')
  })
})
