# LocalTell OSM Python Environment Setup

This guide documents the Python environment used for the **LocalTell geographic-pack / OpenStreetMap (OSM) tooling** under WSL.

It is intended to be reusable when setting up a new machine, reinstalling WSL, recreating the project environment, or returning to the project after a long break.

## 1. What this environment is for

The `localtell-data` repository uses Python tooling to:

- read OSM `.osm.pbf` files,
- build LocalTell schema-v3 geographic packs such as `TN.db`,
- validate geographic packs,
- run coordinate-to-locality lookup tests,
- prepare offline data for the Android LocalTell app.

The current tooling uses Python 3.11, the Python package `osmium` (pyosmium), Python's built-in `sqlite3`, and the repository's own scripts/tests.

The Android app itself does **not** require this Python environment. This environment is only for building and validating offline LocalTell data packs.

---

## 2. Environment options

Choose **one** approach.

### Option A — Use an existing Conda environment (recommended for the current setup)

This is the setup currently used.

The WSL2 terminal uses the Conda environment named:

```text
wsl2
```

Example environment path:

```text
/home/actionanand/miniconda3/envs/wsl2
```

The name `wsl2` is only a convenient environment name. A Conda environment does **not** determine whether Linux itself is running under WSL1 or WSL2.

For example:

```text
WSL2 Ubuntu
└── Conda environment: wsl2

WSL1 / another Linux distribution
└── another Conda environment
```

Use this option when the existing environment is intended to contain your normal development dependencies.

### Option B — Create a dedicated Conda environment for LocalTell OSM work

Use this if you want LocalTell's OSM dependencies isolated from other Python projects.

```bash
conda create -n localtell-osm python=3.11 pip -y
conda activate localtell-osm
```

To leave the environment:

```bash
conda deactivate
```

To return later:

```bash
conda activate localtell-osm
```

### Option C — Install Miniconda first, then create an environment

Use this only when Conda/Miniconda is not yet installed in that Linux/WSL distribution.

After installing Miniconda for Linux, initialize Bash if necessary:

```bash
~/miniconda3/bin/conda init bash
source ~/.bashrc
```

Then create either:

```bash
conda create -n wsl2 python=3.11 pip -y
conda activate wsl2
```

or:

```bash
conda create -n localtell-osm python=3.11 pip -y
conda activate localtell-osm
```

Do not install another Miniconda copy when an existing installation already works.

### Option D — Python `venv` without Conda

Optional fallback:

```bash
python3 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install osmium
```

To leave:

```bash
deactivate
```

For the current LocalTell WSL2 setup, **Option A is preferred**.

---

## 3. Open the project

```bash
cd /mnt/c/AR_Files/code/localtell-data
```

Verify the repository:

```bash
git status
```

Expected when clean:

```text
On branch master
Your branch is up to date with 'origin/master'.

nothing to commit, working tree clean
```

---

## 4. Activate the existing WSL2 Conda environment

```bash
conda activate wsl2
```

The prompt should show:

```text
(wsl2) actionanand@ARPC:...
```

List environments:

```bash
conda info --envs
```

Example:

```text
# conda environments:
#
base                     /home/actionanand/miniconda3
wsl2                  *  /home/actionanand/miniconda3/envs/wsl2
```

The `*` marks the active environment.

Confirm its path:

```bash
echo $CONDA_PREFIX
```

Expected for the current setup:

```text
/home/actionanand/miniconda3/envs/wsl2
```

---

## 5. Check whether the Conda environment owns Python

Run:

```bash
which python
which python3
conda list python
```

An environment can be active even when it does not contain Python.

Before Python was installed in the current `wsl2` environment, the observed result was:

```text
which python
# no output

which python3
/usr/bin/python3
```

This means:

- Conda environment `wsl2` is active,
- it has no environment-owned Python,
- `python3` is falling through to Ubuntu's system Python.

Avoid doing the LocalTell build in this mixed state.

---

## 6. Install Python into the existing Conda environment

Install Python 3.11 and pip:

```bash
conda install python=3.11 pip -y
```

In the verified setup this installed Python `3.11.16`.

Refresh shell command lookup:

```bash
hash -r
```

Verify:

```bash
which python
which python3
python --version
python3 --version
```

Expected pattern:

```text
/home/actionanand/miniconda3/envs/wsl2/bin/python
/home/actionanand/miniconda3/envs/wsl2/bin/python3
Python 3.11.x
Python 3.11.x
```

The verified result was:

```text
/home/actionanand/miniconda3/envs/wsl2/bin/python
/home/actionanand/miniconda3/envs/wsl2/bin/python3
Python 3.11.16
Python 3.11.16
```

At this point both `python` and `python3` come from Conda rather than `/usr/bin`.

---

## 7. Upgrade pip

Use:

```bash
python -m pip install --upgrade pip
```

Prefer `python -m pip` over a bare `pip`, because it makes it explicit which Python receives the package.

Verify:

```bash
python -m pip --version
```

Its path should be under:

```text
/home/actionanand/miniconda3/envs/wsl2/
```

---

## 8. Install pyosmium

The LocalTell geographic pack builder imports the module `osmium`.

Install it:

```bash
python -m pip install osmium
```

The verified setup installed:

```text
osmium 4.3.1
```

Verify:

```bash
python -c "import osmium; print('pyosmium OK')"
```

Expected:

```text
pyosmium OK
```

The PyPI package is named `osmium`; its Python bindings are commonly referred to as **pyosmium**.

The current LocalTell builder uses the Python package directly. A separate `osmium-tool` CLI installation is not required unless future scripts explicitly use it.

---

## 9. Run the LocalTell test suite

From the repository root:

```bash
python -m unittest discover -s tests -v
```

The verified setup passed these five tests:

```text
test_admin_levels_are_persisted_and_tn_extent_validates ... ok
test_concave_representative_and_simplification ... ok
test_indian_hierarchy_and_state_filter ... ok
test_polygon_priority_and_nearest_excludes_admin ... ok
test_state_boundary_must_exist ... ok
```

Expected summary:

```text
Ran 5 tests ...
OK
```

If tests fail, fix the code/environment before processing a real OSM PBF.

---

## 10. Compile-check all Python scripts

```bash
python -m py_compile scripts/*.py
```

Success produces no output.

---

## 11. Inspect the environment

```bash
conda list
```

Important packages in the verified setup:

```text
python    3.11.16
pip       26.2.1
sqlite    3.53.4
osmium    4.3.1
requests  2.34.2
```

Exact versions can change. The important checks are:

- Python comes from the intended Conda environment,
- `osmium` imports successfully,
- repository tests pass,
- repository scripts compile.

---

## 12. Quick setup checklist for future sessions

Normally you do **not** reinstall anything.

```bash
cd /mnt/c/AR_Files/code/localtell-data

conda activate wsl2

which python
python --version

python -c "import osmium; print('pyosmium OK')"

git status

python -m unittest discover -s tests -v
python -m py_compile scripts/*.py
```

If these pass, the environment is ready.

---

## 13. Full verification command block

```bash
cd /mnt/c/AR_Files/code/localtell-data

conda activate wsl2

echo "Conda prefix: $CONDA_PREFIX"

echo
echo "Python:"
which python
python --version

echo
echo "Pip:"
python -m pip --version

echo
echo "Pyosmium:"
python -c "import osmium; print('pyosmium OK')"

echo
echo "Git:"
git status --short

echo
echo "Tests:"
python -m unittest discover -s tests -v

echo
echo "Syntax:"
python -m py_compile scripts/*.py
echo "Python script syntax OK"
```

---

## 14. Recreate the existing `wsl2` environment from scratch

If it is deleted or a new WSL2 installation is created:

```bash
conda create -n wsl2 python=3.11 pip -y
conda activate wsl2

python -m pip install --upgrade pip
python -m pip install osmium
```

Then:

```bash
cd /mnt/c/AR_Files/code/localtell-data

python -c "import osmium; print('pyosmium OK')"
python -m unittest discover -s tests -v
python -m py_compile scripts/*.py
```

---

## 15. Optional: export environment information

Full Conda export:

```bash
conda env export -n wsl2 > environment.yml
```

More portable history-only export:

```bash
conda env export -n wsl2 --from-history > environment-from-history.yml
```

Because `osmium` was installed using pip, verify that the exported environment includes the pip dependency if the file is intended to reproduce the complete environment.

Optional pip snapshot:

```bash
python -m pip freeze > requirements-pip.txt
```

Do not commit these automatically unless you intentionally want them as project dependency files.

---

## 16. Conda reference

List environments:

```bash
conda info --envs
```

Activate:

```bash
conda activate wsl2
```

Deactivate:

```bash
conda deactivate
```

Show active environment directory:

```bash
echo $CONDA_PREFIX
```

List packages:

```bash
conda list
```

Check Python:

```bash
conda list python
```

Remove only a disposable environment when intended:

```bash
conda env remove -n localtell-osm
```

Do not remove `wsl2` unless you intentionally want to recreate it.

---

## 17. WSL1 vs WSL2 clarification

A Conda environment and a WSL distribution are separate concepts.

```text
Windows
├── Ubuntu running as WSL2
│   └── Miniconda
│       └── environment: wsl2
│
└── Another distro running as WSL1
    └── its own Linux filesystem / tools / Conda installation
```

`conda activate wsl2` activates a Python environment; it does not select or change the Windows WSL version.

From Windows PowerShell, WSL versions can be checked with:

```powershell
wsl --list --verbose
```

---

## 18. Troubleshooting

### `python: command not found` even though `(wsl2)` is visible

```bash
conda list python
which python
which python3
```

If Python is absent:

```bash
conda install python=3.11 pip -y
hash -r
```

### `python3` points to `/usr/bin/python3`

The active Conda environment does not currently provide Python, or the shell lookup needs refreshing.

```bash
conda install python=3.11 pip -y
hash -r
which python
which python3
```

Both should resolve under `$CONDA_PREFIX/bin`.

### `ModuleNotFoundError: No module named 'osmium'`

Verify:

```bash
which python
echo $CONDA_PREFIX
```

Then:

```bash
python -m pip install osmium
python -c "import osmium; print('pyosmium OK')"
```

### `conda activate` does not work

Initialize Conda:

```bash
~/miniconda3/bin/conda init bash
source ~/.bashrc
conda activate wsl2
```

### Tests suddenly fail after dependency changes

Check:

```bash
which python
python --version
python -m pip --version
python -c "import osmium; print(osmium.__file__)"
conda list
```

Make sure commands are using the intended Conda environment rather than Ubuntu system Python.

---

## 19. Current known-good LocalTell setup

Verified during LocalTell development:

```text
Conda:
24.4.0

Environment:
wsl2

Environment path:
/home/actionanand/miniconda3/envs/wsl2

Python:
3.11.16

pip:
26.2.1

osmium / pyosmium:
4.3.1

SQLite supplied by Conda:
3.53.4
```

These checks passed:

```bash
python -c "import osmium; print('pyosmium OK')"
python -m unittest discover -s tests -v
python -m py_compile scripts/*.py
```

This is the baseline environment for LocalTell schema-v3 OSM geographic-pack work.

---

## 20. What comes after environment setup

Once the environment is healthy, the LocalTell data workflow is:

```text
OSM .osm.pbf source
        ↓
schema-v3 geographic pack builder
        ↓
Tamil Nadu filtering using IN-TN
        ↓
TN.db
        ↓
pack validation
        ↓
coordinate/locality tests
        ↓
compression and release only after validation
```

Complete and verify the environment **before** downloading or processing a large real OSM PBF.
