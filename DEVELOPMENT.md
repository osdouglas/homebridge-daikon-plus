# Development

Use any Node setup you prefer that satisfies the `engines.node` range in `package.json`.

This repo includes `pnpm-lock.yaml`, so CI and examples use pnpm:

```sh
pnpm install
pnpm build
pnpm test
```

Using npm is fine for local development:

```sh
npm install
npm test
```

The unit tests use Node's built-in `node:test` runner. The `test` script builds first, then runs `test/*.test.mjs` against `dist`.

CI runs lint and tests on pull requests and pushes.

## Releases

Normal releases are cut from `main`. The release tag is the immutable record of
what shipped, and the npm package version must match that tag exactly.

Use the `GitHub Release` workflow to prepare normal releases:

1. Get `main` into the exact state that should ship, including the intended
   `package.json` version.
2. In GitHub Actions, run `GitHub Release` from `main`.
3. The workflow validates the checked-in package version, runs lint and tests,
   inspects the npm package contents, then creates a draft GitHub Release for
   the exact `vX.Y.Z` tag.
4. Review and finalize the draft on GitHub's Releases page.
5. When the GitHub Release is published, the `npm Publish` workflow checks out
   the release tag, repeats lint, tests, and package inspection, then publishes
   to npm.

If `main` is not ready to release, the workflow fails before creating the draft
release. It will not bump versions, create release branches, or guess what
should ship.

Prerelease versions such as `0.2.0-rc.1` publish to the npm `beta` tag. Stable
versions such as `0.2.0` publish to the npm `latest` tag.

Maintenance branches such as `rel/0.1.x` are only needed when `main` has moved
on and an older minor line needs a patch. In that case, get the maintenance
branch into the exact state that should ship, run `GitHub Release` from that
branch, and separately reapply any still-relevant fixes to `main`.

Manual GitHub Releases are also supported. If one is published directly, the
`npm Publish` workflow still verifies that the GitHub Release tag exactly matches
`package.json`, then publishes to the correct npm dist-tag.

The npm publish workflow file is still named `npm-deploy.yml` because npm
Trusted Publishing matches on workflow filename. In GitHub Actions it appears as
`npm Publish`.

Before the first automated publish, the repository owner must do the one-time
platform setup:

1. Create or reserve the `homebridge-daikon-plus` npm package. If npm does not
   expose Trusted Publisher settings before the package exists, bootstrap with a
   throwaway prerelease version instead of the real release version:

   ```sh
   npm version 0.0.0-bootstrap.0 --no-git-tag-version
   npm publish --access public --tag bootstrap
   git checkout -- package.json
   ```

   Do not publish the checked-in stable version just to reserve the package
   name. npm package versions are immutable, so publishing `0.1.0` during
   bootstrap would make the later `v0.1.0` GitHub Release publish fail. If a
   real release version is intentionally published manually, promote that exact
   version instead of trying to republish it:

   ```sh
   npm dist-tag add homebridge-daikon-plus@0.1.0 latest
   ```
2. On npm, configure Trusted Publishing for GitHub Actions:
   - owner: `osdouglas`
   - repository: `homebridge-daikon-plus`
   - workflow filename: `npm-deploy.yml`
   - environment: `npm`
   - allowed action: `npm publish`
3. On GitHub, create an `npm` environment and add any desired deployment
   protection rules. Use this environment if you want an additional approval
   gate after the GitHub Release is published but before npm publish runs.

Do not publish from a local checkout except to bootstrap the package name or
recover from a failed release. The normal path is to make `main` releasable,
run `GitHub Release`, finalize the GitHub Release, then let GitHub Actions
publish to npm.

## Branch Install

Homebridge runs compiled JavaScript from `dist`. Published npm packages include `dist`; git branch installs use the npm `prepare` script to build after cloning.

For the standard Homebridge Raspberry Pi image, load the Homebridge runtime environment before installing. That puts the bundled `node` and `npm` on `PATH`:

```sh
sudo -u homebridge env HOME=/home/homebridge sh -lc '
  . /opt/homebridge/source.sh
  npm install --prefix /var/lib/homebridge github:osdouglas/homebridge-daikon-plus#codex/branding
'

sudo hb-service restart
```

Configure and test on the Homebridge host that will run the plugin. Start with `readonly: true`, then turn off `developerMode` before write testing.

## Test Shape

Keep unit tests focused on adapter behavior:

- mocked Open API payloads in,
- HomeKit-facing values out,
- Daikin write payloads verified before they leave the client.

Live cloud testing should stay manual and use `readonly` mode first.
