import { test, expect } from '@playwright/test'

test('catalog loads and Library card unfolds player on click', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('img[alt*="Test Artist"]')
  const card = page.locator('button[aria-label*="Test Artist"]').first()
  await card.click()
  await expect(page.getByTestId('inline-player')).toBeVisible()
})

test('Coming soon section renders upcoming episodes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Coming soon', { exact: false })).toBeVisible()
  await expect(page.getByAltText(/Upcoming Artist/)).toBeVisible()
})

test('prefers-reduced-motion disables transforms on the hero', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('/')
  const headline = page.locator('h1').first()
  await expect(headline).toBeVisible()
  const transform = await headline.evaluate((el) => getComputedStyle(el).transform)
  expect(transform === 'none' || transform.startsWith('matrix(1, 0, 0, 1,')).toBe(true)
  await context.close()
})

test('clicking the active card toggles pause/resume', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('button[aria-label*="Test Artist"]').first()
  await card.click()
  await expect(page.getByTestId('inline-player')).toBeVisible()
  await card.click()
  await expect(card).toHaveAttribute('aria-label', /Play preview/)
})
