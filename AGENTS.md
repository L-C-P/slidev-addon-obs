# AGENTS.md – slidev-addon-obs

## Project overview

A [Slidev](https://sli.dev) addon that switches OBS Studio scenes on slide navigation via obs-websocket (protocol v4 and v5). The connection is configured in the headmatter (`obs:`), the scene per slide via `obsScene:`.

- **npm package:** `slidev-addon-obs`
- **GitHub:** `https://github.com/L-C-P/slidev-addon-obs`
- **License:** MIT
- **Author:** Denis Sowa

---

## Project structure

| Path | Description |
|---|---|
| `global-top.vue` | Global layer: reads the config, resolves the scene of the current slide, drives the connection |
| `obs.ts` | Dependency-free obs-websocket client (v4 + v5 handshake, auth, requests, reconnect) and SHA-256 |
| `slides.md` | Demo/preview slides for this addon |
| `.github/workflows/publish.yml` | CI/CD workflow – publishes to npm on tag push |

---

## Key concepts

- Slidev renders `global-top.vue` once per `SlidesShow`, i.e. in the play view and in the presenter view. Print/export, embedded and notes views are excluded explicitly.
- Custom headmatter keys are available via `configs` from `@slidev/client`.
- The auth string is identical in v4 and v5: `base64(sha256(base64(sha256(password + salt)) + challenge))`.
- SHA-256 is implemented in plain JS because `crypto.subtle` is only available in secure contexts, and the deck may be opened via `http://<lan-ip>`.
- `obs.ts` must stay free of non-erasable TypeScript syntax (no parameter properties, enums) so it can be run directly with Node for tests.
- v5 closes the socket with code 4009 on a wrong password; v4 answers `Authenticate` with `status: error`. Both stop the reconnect loop.

---

## Publish workflow (CI/CD)

Publishing to npm is fully automated via GitHub Actions using **Trusted Publishing (OIDC)** – no npm token or secret required.

### Trigger
A push of a version tag (`v*`) triggers the workflow in `.github/workflows/publish.yml`.

### Steps to release a new version

1. Ensure the working directory is clean (`git status`)
2. Bump the version and create a tag:
   ```bash
   npm version patch   # or minor / major
   ```
3. Push the commit and tag:
   ```bash
   git push --follow-tags
   ```
4. GitHub Actions picks up the tag and runs `npm publish --provenance --access public` automatically.

### Trusted Publishing setup (must be configured on npmjs.com)
- Configure on npmjs.com under the package settings → *Trusted Publishers*
- Owner: `L-C-P`, Repository: `slidev-addon-obs`, Workflow: `publish.yml`
- The workflow requires `permissions.id-token: write` for OIDC authentication.

---

## Development

```bash
npm install       # install dependencies
npx slidev        # start Slidev dev server with the demo slides
```

### Important notes
- Always run `npm version patch/minor/major` from a **clean** working directory.
  If the directory is dirty, use `npm version patch --no-git-tag-version` to bump only `package.json`/`package-lock.json`, then commit manually and tag separately.
- Do not commit `node_modules`.
- All variables, comments, and commit messages must be in **English**.
- German text (e.g. in slides) must use UTF-8 encoded Umlauts.
