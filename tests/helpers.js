import { request, expect } from '@playwright/test'

export const PANEL = 'http://localhost:8088'
export const KEYCLOAK = 'http://localhost:8180'
export const ISSUER = `${KEYCLOAK}/realms/pufferpanel`

export const alice = { name: 'alice', keycloakPassword: 'alice', email: 'alice@example.com', password: 'testbed-alice' }
export const bobby = { name: 'bobby', keycloakPassword: 'bobby', email: 'bobby@example.com', password: 'testbed-bobby' }

// password login on the panel's login page
export async function loginPanel(page, user) {
  await page.goto('/auth/login')
  await page.locator('input[name="email"]').fill(user.email)
  await page.keyboard.press('Enter')
  await page.locator('input[name="password"]:visible').fill(user.password)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/servers/)
}

// signs in on Keycloak's login page; consent 'Yes' only clicks when Keycloak asks, 'No' expects the consent screen
export async function loginKeycloak(page, user, consent = 'Yes') {
  await page.locator('#username').fill(user.name)
  await page.locator('#password').fill(user.keycloakPassword)
  await page.getByRole('button', { name: 'Sign In' }).click()
  const button = page.getByRole('button', { name: consent, exact: true })
  if (consent === 'No') {
    await button.click()
  } else if (await consentAsked(button)) {
    await button.click()
  }
}

async function consentAsked(button) {
  return button.waitFor({ timeout: 3000 }).then(() => true, () => false)
}

export async function startSso(page) {
  await page.goto('/auth/login')
  await page.locator('a.oidc-login').click()
}

// signs in with the password and links the user's Keycloak account under Profile -> Two factor authentication
export async function linkAccount(page, user) {
  await loginPanel(page, user)
  await page.goto('/self#security')
  await page.getByRole('button', { name: 'Link SSO account' }).click()
  await loginKeycloak(page, user)
  await expectToast(page, 'success', 'SSO account linked')
}

// toasts stay a few seconds, so an earlier one can still be shown: look for the one with the expected text
export async function expectToast(page, kind, text) {
  await expect(page.locator(`.toast.${kind}`, { hasText: text })).toBeVisible()
}

export async function errorPageText(page) {
  return page.locator('.oidc-error p').textContent()
}

// a panel API session for the user, without a browser
export async function panelApi(user) {
  const api = await request.newContext({ baseURL: PANEL })
  const res = await api.post('/auth/login', { data: { email: user.email, password: user.password } })
  expect(res.ok(), `password login of ${user.email}`).toBeTruthy()
  return api
}

export async function panelUserId(api, email) {
  const res = await api.get('/api/users', { params: { email } })
  return (await res.json()).users[0].id
}

export async function setPanelScopes(api, email, scopes) {
  const id = await panelUserId(api, email)
  const res = await api.put(`/api/users/${id}/perms`, { data: { scopes } })
  expect(res.ok(), `permissions of ${email}`).toBeTruthy()
}

// the panel reloads the OIDC provider when the settings are saved
export async function setPanelIssuer(api, issuer) {
  const res = await api.post('/api/settings', { data: { 'panel.oidc.issuer': issuer } })
  expect(res.ok(), `issuer ${issuer}`).toBeTruthy()
}

// nobody linked, bobby an admin again, the real issuer, and Keycloak asks for consent again on the next login
export async function resetTestbed() {
  const aliceApi = await panelApi(alice)
  await setPanelIssuer(aliceApi, ISSUER)
  await setPanelScopes(aliceApi, bobby.email, ['admin'])
  await aliceApi.delete('/api/self/oidc')
  await aliceApi.dispose()

  const bobbyApi = await panelApi(bobby)
  await bobbyApi.delete('/api/self/oidc')
  await bobbyApi.dispose()

  await revokeKeycloakConsents([alice, bobby])
}

async function keycloakAdmin() {
  const api = await request.newContext({ baseURL: KEYCLOAK })
  const res = await api.post('/realms/master/protocol/openid-connect/token', {
    form: { client_id: 'admin-cli', username: 'admin', password: 'admin', grant_type: 'password' }
  })
  const token = (await res.json()).access_token
  return { api, headers: { Authorization: `Bearer ${token}` } }
}

async function revokeKeycloakConsents(users) {
  const { api, headers } = await keycloakAdmin()
  for (const user of users) {
    const found = await (await api.get('/admin/realms/pufferpanel/users', { headers, params: { username: user.name, exact: 'true' } })).json()
    // 404 when the user never consented, which is fine
    await api.delete(`/admin/realms/pufferpanel/users/${found[0].id}/consents/pufferpanel`, { headers })
  }
  await api.dispose()
}
