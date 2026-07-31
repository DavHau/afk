---
alwaysApply: true
---

# Running programs that are not installed

Do NOT install missing programs with `nix-env` or similar. Run them ad hoc:

- `nix shell nixpkgs#<package> -c <command>`
- `nix-shell -p <package> --run '<command>'`
