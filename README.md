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

Playwright tests in `tests/` run against the running testbed (Chromium): not linked, linking, SSO login, an account
linked to someone else, consent denied while signing in and while linking, missing state, unlink, login not permitted
and an unreachable provider. Each test resets the state first: nobody linked, bobby an admin, the real issuer, and
Keycloak asks for consent again.

Needs Node.js 20 or newer with npm.

1. Start the testbed (see "Start and stop") and wait until http://localhost:8088 answers.
2. Install once, in `pufferpanel-oidc-testbed/tests/`:

   ```sh
   cd tests
   npm install
   npx playwright install chromium   # downloads the browser
   ```

   On distributions Playwright does not support officially (e.g. Fedora) it prints "your OS is not officially
   supported" and downloads its Ubuntu build, which works.
3. Run, still in `tests/`:

   ```sh
   npm run test:ui                    # Playwright's UI: pick single tests, watch each step, time-travel through the run
   npm test                           # all tests headless
   npm run test:headed                # visible browser, 500 ms between actions (SLOWMO=1000 npm run test:headed for slower)
   npm run test:debug                 # inspector: step through every action by hand
   npm run test:headed -- -g "linking" # only the tests whose name contains "linking" (works with every mode)
   npx playwright show-report         # details, screenshots and traces of failed tests after a headless run
   ```

## Notes

- Panel usernames need at least 5 characters; `pufferpanel user add` refuses shorter ones.
- Both containers use the host network so the browser and the panel reach Keycloak under the same issuer URL
  (`http://localhost:8180/realms/pufferpanel`). Ports 8088 and 8180 must be free.
- The OIDC keys are pinned by environment variables: changing them in the panel's settings works until the next restart.
- Keycloak runs in dev mode with a file database inside its container: `stop`/`start` keeps it, `down` resets it to the
  imported realm.
