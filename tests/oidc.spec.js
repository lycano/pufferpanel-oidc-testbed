import { test, expect } from '@playwright/test'
import {
  PANEL, KEYCLOAK, ISSUER, alice, bobby,
  loginPanel, loginKeycloak, startSso, linkAccount, expectToast, errorPageText,
  panelApi, setPanelScopes, setPanelIssuer, resetTestbed
} from './helpers.js'

test.beforeEach(async () => {
  await resetTestbed()
})

test('an unlinked SSO account lands on the error page', async ({ page }) => {
  await startSso(page)
  await loginKeycloak(page, alice)
  await expect(page).toHaveURL(/\/auth\/oidc\/error\/notlinked/)
  expect(await errorPageText(page)).toContain('is not linked to a panel account')
})

test('linking from the security settings', async ({ page }) => {
  await linkAccount(page, alice)
  await expect(page).toHaveURL(/\/self#security$/)
  await expect(page.getByRole('button', { name: 'Unlink SSO account' })).toBeVisible()
})

test('a linked account signs in directly with the full sidebar', async ({ page, browser }) => {
  await linkAccount(page, alice)

  const context = await browser.newContext({ baseURL: PANEL })
  const fresh = await context.newPage()
  await startSso(fresh)
  await loginKeycloak(fresh, alice)
  await expect(fresh).toHaveURL(/\/servers/)
  await expect(fresh.getByText('Users', { exact: true }).first()).toBeVisible()
  await context.close()
})

test('an account linked to someone else cannot be linked again', async ({ page }) => {
  await linkAccount(page, alice)

  // bobby signs in to the panel in the same browser, Keycloak still answers as alice
  await page.context().clearCookies({ domain: 'localhost', path: '/' })
  await loginPanel(page, bobby)
  await page.goto('/self#security')
  await page.getByRole('button', { name: 'Link SSO account' }).click()
  await expectToast(page, 'error', 'already linked to another panel account')
})

test('denying the consent while signing in shows the denied page', async ({ page }) => {
  await startSso(page)
  await loginKeycloak(page, bobby, 'No')
  await expect(page).toHaveURL(/\/auth\/oidc\/error\/denied/)
  expect(await errorPageText(page)).toContain('cancelled or denied')
})

test('denying the consent while linking returns to the security settings', async ({ page }) => {
  await loginPanel(page, bobby)
  await page.goto('/self#security')
  await page.getByRole('button', { name: 'Link SSO account' }).click()
  await loginKeycloak(page, bobby, 'No')
  await expect(page).toHaveURL(/\/self#security$/)
  await expectToast(page, 'error', 'cancelled or denied')
})

test('a callback without state shows the state page', async ({ page }) => {
  await page.goto('/auth/oidc/callback')
  await expect(page).toHaveURL(/\/auth\/oidc\/error\/state/)
})

test('unlinking makes the next SSO login unlinked again', async ({ page, browser }) => {
  await linkAccount(page, alice)
  await page.getByRole('button', { name: 'Unlink SSO account' }).click()
  await expectToast(page, 'success', 'SSO account unlinked')

  const context = await browser.newContext({ baseURL: PANEL })
  const fresh = await context.newPage()
  await startSso(fresh)
  await loginKeycloak(fresh, alice)
  await expect(fresh).toHaveURL(/\/auth\/oidc\/error\/notlinked/)
  await context.close()
})

test('a linked user without the login permission gets the nologin page', async ({ page, browser }) => {
  await linkAccount(page, bobby)

  const aliceApi = await panelApi(alice)
  await setPanelScopes(aliceApi, bobby.email, [])
  await aliceApi.dispose()

  const context = await browser.newContext({ baseURL: PANEL })
  const fresh = await context.newPage()
  await startSso(fresh)
  await loginKeycloak(fresh, bobby)
  await expect(fresh).toHaveURL(/\/auth\/oidc\/error\/nologin/)
  await context.close()
  // resetTestbed makes bobby an admin again before the next test
})

test('an unreachable provider shows the unavailable page and works again without a restart', async ({ page }) => {
  const api = await panelApi(alice)
  // nothing listens on port 9, so loading the provider fails
  await setPanelIssuer(api, 'http://localhost:9/realms/pufferpanel')
  try {
    await startSso(page)
    await expect(page).toHaveURL(/\/auth\/oidc\/error\/unavailable/)
  } finally {
    await setPanelIssuer(api, ISSUER)
    await api.dispose()
  }

  await startSso(page)
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK}/realms/pufferpanel/`))
})
