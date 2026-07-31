---
alwaysApply: true
---

# Searching the Nix store and the filesystem

**NEVER** run `find` on the top-level `/nix/store`. It holds millions of
entries and will hang or time out. To look inside one package, use its full
store path (e.g. `find /nix/store/<hash>-<name>/`).

**NEVER** run `find` on `/` or another large filesystem root. To locate source
or definitions, prefer in order:

1. `nix eval` (e.g. `nix eval --raw nixpkgs#<pkg>.src`, or
   `nix eval .#nixosConfigurations.<host>.config.<path>`) to resolve store
   paths and config values.
2. `git` / `jj` inside the relevant repo (`git grep`, `git ls-files`).
3. `$HOME/projects/<project>` checkouts — clone if missing, then search the
   source tree directly.
