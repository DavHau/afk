# afk-skills: the FULL Superpowers skills library from the pinned input,
# built as `src + patches`. The patch list (patches/superpowers/*.patch)
# starts EMPTY — the escalation path for when a prompt-level override
# proves insufficient. Forked/copied skill sources are PROHIBITED; every
# divergence is a patch against the pinned upstream.
#
# The install copies the upstream `skills/` tree to the derivation root, so
# `$out` IS the skills root: `$out/using-superpowers/SKILL.md` exists and
# OMP_SUPERPOWERS_DIR=${afk-skills} resolves the bootstrap injector's
# `join(skillsDir, "using-superpowers", "SKILL.md")` directly.
{
  stdenvNoCC,
  lib,
  superpowers,
}:
let
  patches = builtins.filter (p: lib.hasSuffix ".patch" (toString p)) (
    lib.filesystem.listFilesRecursive ../patches/superpowers
  );
in
stdenvNoCC.mkDerivation {
  pname = "afk-skills";
  version = "0-unstable";
  src = superpowers;
  inherit patches;
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    cp -r skills "$out"
    runHook postInstall
  '';
}
