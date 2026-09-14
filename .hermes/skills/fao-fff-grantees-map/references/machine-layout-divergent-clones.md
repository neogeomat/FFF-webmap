# Machine layout — one Webmap clone on this host (verify before git ops)

The repo lives at `/home/ubentu/ssd/baato/FAO/FFF`; `Webmap/` inside it is the deployed git
repo. The pre-SSD path `/home/ubentu/baato/FAO/FFF` (still hardcoded in some scripts and
older docs) does NOT resolve on this host. An earlier session found a tree at the old path
with HEAD at the `825d4f3`-era commits and recorded it as a second, diverged clone — but
those commits are ordinary ancestors of this tree's `a5de154` ("for 3rd presentation") HEAD,
so the SSD tree is the single live lineage
(`5316fde → 80983d9 → 825d4f3 → … → a5de154`), pushed to `origin` =
`neogeomat/FFF-webmap` (GitHub Pages live site).

Symptom to watch for: a `git`/file command that worked moments earlier starts returning
"No such file or directory" — the active tree switched (sandbox/backend vs. real disk),
not the repo.

**Before any edit, commit, or push in this project:**
1. `pwd` and confirm the tree you are in resolves on disk.
2. `git log --oneline -3` inside `Webmap/` — HEAD should be `a5de154`-era "3rd presentation" work.
3. `git remote -v` — confirm `origin` points at `neogeomat/FFF-webmap`; push to `origin`,
   never the `amritkarma.kll` second remote.
4. Ask/confirm which tree the user is actively working in if there is any doubt.

## graphify knowledge graph at the FFF root
`/graphify` was run against the FFF project root (`/home/ubentu/ssd/baato/FAO/FFF`,
corpus = code + docs + images incl. the Webmap). Its `graphify-out/` (graph.json,
GRAPH_REPORT.md) lives at the project root, NOT inside Webmap/. Architecture/codebase
questions about the map can be answered from that graph (`/graphify query "..."` from the
FFF root) instead of grepping.
