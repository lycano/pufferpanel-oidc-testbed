# PufferPanel OIDC testbed

Keycloak with a ready realm plus PufferPanel built from the local checkout `../PufferPanel` (whatever branch is
checked out there, e.g. `pr/oidc`). Everything runs on localhost only.

## Setup

The testbed folder has to sit next to the PufferPanel checkout, since `compose.yaml` builds from `../PufferPanel`:

```
any-folder/
├── PufferPanel/                  # git clone, branch with the OIDC changes checked out
└── pufferpanel-oidc-testbed/     # this folder
    ├── compose.yaml
    ├── README.md
    └── keycloak/
        └── realm-pufferpanel.json
```

```sh
cd any-folder
git clone https://github.com/lycano/PufferPanel.git
git -C PufferPanel switch pr/oidc
```

Needed on the machine:
- podman with a compose provider (`podman compose` calls `podman-compose` or `docker-compose`), e.g.
  `pipx install podman-compose` or `brew install podman-compose`; docker with its compose plugin works as well
- free ports 8088 (panel) and 8180 (Keycloak)

## URLs and accounts

| What | URL | Login |
|---|---|---|
| PufferPanel | http://localhost:8088 | panel users below |
| Keycloak admin | http://localhost:8180/admin | `admin` / `admin` |

| Keycloak user | Password | Panel user (email / password) |
|---|---|---|
| `alice` | `alice` | `alice@example.com` / `testbed-alice` (admin) |
| `bobby` | `bobby` | `bobby@example.com` / `testbed-bobby` (admin) |

The realm (client `pufferpanel`, secret `testbed-secret`, both users) is imported from `keycloak/` on the first start.
The panel's OIDC settings come from environment variables in `compose.yaml`, so no setup in the UI is needed.

## Start and stop

In `pufferpanel-oidc-testbed/`:

```sh
podman compose up --build          # first start builds the panel image from ../PufferPanel (takes a few minutes)
podman compose down                # stop, keeps the panel database
podman compose down -v             # stop and delete the panel database (links, users)
podman compose logs -f pufferpanel # follow the panel log
```

## Rebuild

```sh
# panel only, after changes in ../PufferPanel (keeps users and links)
podman compose up -d --build --force-recreate pufferpanel

# panel without build cache, if old content keeps showing up
podman compose build --no-cache pufferpanel
podman compose up -d --force-recreate pufferpanel

# Keycloak, e.g. after changing keycloak/realm-pufferpanel.json (re-imports the realm)
podman compose up -d --force-recreate keycloak

# everything from scratch (deletes the panel database; both users are created again)
podman compose down -v
podman compose up -d --build

# remove everything incl. both images (podman-compose has no --rmi, so the images go by name)
podman compose down -v
podman rmi localhost/pufferpanel:pr1504-testbed quay.io/keycloak/keycloak:26.0
# optional: the unnamed build layers of the Node and Go stages can only go with a prune, which removes all
# dangling (untagged, unused) images on the machine, not just the testbed's
podman image prune -f
```

## Tests

1. **Not linked:** on http://localhost:8088 click "Login with Keycloak", sign in as `alice`/`alice`, accept the consent.
   Expected: `/auth/oidc/error/notlinked`.
2. **Link:** "Back to login", sign in with `alice@example.com` / `testbed-alice`, Profile (avatar, top right) → "Two factor authentication" → "Link SSO account".
   Expected: back on that page with "SSO account linked".
3. **SSO login:** log out, "Login with Keycloak". Expected: signed in directly, full sidebar.
4. **Already linked to someone else:** log out of the panel and sign in as `bobby@example.com` / `testbed-bobby` (password), then
   Profile (avatar, top right) → "Two factor authentication" → "Link SSO account". Keycloak still has alice's session from step 1, so it answers as `alice`.
   Expected: "This SSO account is already linked to another panel account."
5. **Denied by the provider:** log out of Keycloak (http://localhost:8180/realms/pufferpanel/account → Sign out), click the
   SSO button, sign in as `bobby`, click **No** on the consent screen. Expected: `/auth/oidc/error/denied`.
   Clicking **No** while *linking* (signed in to the panel) instead returns to Profile → "Two factor authentication" with a
   red toast "The SSO login was cancelled or denied."
6. **Login not permitted:** link `bobby` (as in 2), then as `alice` remove bobby's permissions (Users → bobby), log out and use SSO
   as `bobby`. Expected: `/auth/oidc/error/nologin`.
7. **Provider unreachable:** `podman compose stop keycloak`, click the SSO button. Expected: `/auth/oidc/error/unavailable`.
   `podman compose start keycloak`, try again: works without restarting the panel.
8. **Unlink:** Profile → "Two factor authentication" → "Unlink SSO account", log out, SSO again. Expected: `notlinked` again.
9. **State:** open http://localhost:8088/auth/oidc/callback directly. Expected: `/auth/oidc/error/state`.

## Notes

- Panel usernames need at least 5 characters; `pufferpanel user add` refuses shorter ones.
- Both containers use the host network so the browser and the panel reach Keycloak under the same issuer URL
  (`http://localhost:8180/realms/pufferpanel`). Ports 8088 and 8180 must be free.
- The OIDC keys are pinned by environment variables: changing them in the panel's settings works until the next restart.
- Keycloak runs in dev mode with a file database inside its container: `stop`/`start` keeps it, `down` resets it to the
  imported realm.
