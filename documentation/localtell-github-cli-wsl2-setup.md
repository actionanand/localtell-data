# LocalTell — GitHub CLI (`gh`) Setup for WSL2

This guide explains how to install, authenticate, verify, update, and use GitHub CLI (`gh`) in WSL2 for the `localtell-data` repository.

## 1. Why LocalTell uses GitHub CLI

LocalTell geographic data tooling uses GitHub Releases to publish runtime assets such as:

```text
manifest.json
TN.db.gz
KL.db.gz
KA.db.gz
...
```

GitHub CLI allows the Python automation scripts to publish and verify these release assets without manually uploading them in the browser.

The LocalTell data tooling should use:

```text
Python scripts
    ↓
gh CLI
    ↓
GitHub Releases
```

The `gh` command is installed per development machine. It is not stored in the repository.

---

## 2. Environment

This guide is intended for:

```text
Windows
  └── WSL2
      └── Ubuntu / Debian-based Linux
```

Check the Linux distribution:

```bash
cat /etc/os-release
```

---

## 3. Install GitHub CLI using the official APT repository

GitHub recommends using its official Debian/Ubuntu package repository.

Run:

```bash
(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) \
  && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update \
  && sudo apt install gh -y
```

Verify:

```bash
gh --version
```

Example:

```text
gh version 2.x.x
```

---

## 4. Authenticate with GitHub

Run:

```bash
gh auth login
```

For normal LocalTell development, choose:

```text
GitHub.com
HTTPS
Login with a web browser
```

GitHub CLI will display or copy a one-time device code and open the browser-based authentication flow.

After login, verify:

```bash
gh auth status
```

You should see that the current WSL2 environment is authenticated to `github.com`.

> Do not store GitHub access tokens, device codes, or credentials in the LocalTell repository.

---

## 5. Verify repository access

Open the repository:

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

Then run:

```bash
gh repo view
```

It should resolve the current repository.

For LocalTell, verify the data releases:

```bash
gh release list
```

Expected release tags may include:

```text
cell-data-v3
cell-data-v2
cell-data-v1
```

The active geographic release is currently:

```text
cell-data-v3
```

---

## 6. Useful LocalTell release commands

### View the geographic data release

```bash
gh release view cell-data-v3 \
  --repo actionanand/localtell-data
```

### Download release assets

```bash
mkdir -p ~/localtell-osm-work/release-test

gh release download cell-data-v3 \
  --repo actionanand/localtell-data \
  --dir ~/localtell-osm-work/release-test \
  --pattern '*.db.gz' \
  --pattern 'manifest.json'
```

### Upload or replace an asset

LocalTell automation normally performs this through Python. For manual recovery:

```bash
gh release upload cell-data-v3 \
  ~/localtell-osm-work/output/KL.db.gz \
  --repo actionanand/localtell-data \
  --clobber
```

`--clobber` replaces an existing asset with the same name.

### Keep the release marked as Latest

```bash
gh release edit cell-data-v3 \
  --repo actionanand/localtell-data \
  --latest
```

---

## 7. LocalTell automated publishing

The LocalTell repository provides Python-based data automation.

The canonical implementation is Python:

```bash
python scripts/build_state.py KL
python scripts/validate_state.py KL
python scripts/package_state.py KL
python scripts/generate_manifest.py
python scripts/publish_release.py
```

`package.json` provides shorter WSL2 command aliases:

```bash
npm run data:build -- KL
npm run data:validate -- KL
npm run data:package -- KL
npm run data:manifest
npm run data:publish
```

The npm commands do not implement the data logic. They only invoke the Python scripts.

Before publishing, always verify:

```bash
gh auth status
```

The publish script should also perform this check automatically.

---

## 8. Updating GitHub CLI

Because the official GitHub APT repository was configured during installation, normal package updates can update `gh`:

```bash
sudo apt update
sudo apt install gh
```

Verify afterward:

```bash
gh --version
```

---

## 9. Moving to a new computer or WSL2 installation

GitHub CLI authentication is local to the machine/WSL2 environment.

On a new computer:

```text
1. Install WSL2 / Ubuntu.
2. Clone the localtell-data repository.
3. Install the Python environment and pyosmium.
4. Install Node/npm if npm command wrappers are desired.
5. Install GitHub CLI using this guide.
6. Run `gh auth login`.
7. Recreate or download the LocalTell OSM workspace.
```

GitHub authentication is not copied by cloning the repository.

Run on the new machine:

```bash
gh auth login
gh auth status
```

The LocalTell data workspace defaults to:

```text
~/localtell-osm-work
```

Because `~` means the current Linux user's home directory, the same configuration works even when the Linux username or computer changes.

The large OSM source files and generated databases are intentionally not stored in Git. They can either be rebuilt/downloaded on the new machine or copied separately if required.

---

## 10. Troubleshooting

### `gh: command not found`

Check:

```bash
which gh
```

If nothing is returned, reinstall GitHub CLI using the official APT instructions above.

### Authentication expired or unavailable

Run:

```bash
gh auth status
```

If required:

```bash
gh auth login
```

### Logout

```bash
gh auth logout
```

Then authenticate again:

```bash
gh auth login
```

### Release command cannot find the repository

Make the repository explicit:

```bash
gh release list \
  --repo actionanand/localtell-data
```

### APT signature/key errors

GitHub occasionally rotates repository signing keys. If APT reports a GitHub CLI repository signature error, refresh the official keyring by repeating the installation setup from Section 3 rather than disabling signature verification.

---

## 11. Security rules

Never commit:

```text
GitHub tokens
authentication files
device login codes
private keys
OSM PBF files
generated .db files
generated .db.gz files
```

The repository should contain only the scripts, configuration, tests, and documentation needed to reproduce the data.

Runtime geographic packs belong in GitHub Releases.

---

## 12. Quick verification checklist

```bash
gh --version
gh auth status

cd /mnt/c/AR_Files/code/localtell-data

gh repo view
gh release list
gh release view cell-data-v3
```

If all commands succeed, GitHub CLI is ready for LocalTell data automation.

---

## Official references

- GitHub CLI manual: https://cli.github.com/manual/
- GitHub CLI authentication: https://cli.github.com/manual/gh_auth_login
- Official Linux installation instructions: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
