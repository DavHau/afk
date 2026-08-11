# omp-natives: the pi-natives Rust addon built from upstream omp source plus
# ONLY the Rust-affecting patches (currently omp-reflink-degraded-copy).
# All other afk patches touch TypeScript only, so this artifact is byte-
# identical across TS patch iterations; splitting it out means the expensive
# cargo build runs once per omp version bump (or Rust patch change) and is
# served from cache thereafter. omp-patched consumes
# $out through a preBuild seam instead of running cargo — including the
# regenerated index.d.ts, so a Rust patch that changes a napi signature
# reaches the TS typecheck through this derivation, never through
# omp-patched's own patch list.
#
# MUST NOT reference omp-patched or TS-only patches — the hash may depend
# on Rust-affecting patches alone, or every prompt tweak would trigger a
# full cargo rebuild.
#
# $out layout:
#   native/ — the complete post-build packages/natives/native/ directory:
#             pi_natives.<nodeTag>.node, index.d.ts (const-enum-fixed) and
#             index.js (loader with the gen-enums marker block filled in).
#             gen-enums writes ONLY inside this directory (verified against
#             packages/natives/scripts/gen-enums.ts: dtsPath and jsPath both
#             resolve under ../native).
#   lib/    — the raw cargo artifact <nativeLib>, seeded by omp-patched into
#             target/<rustTarget>/release/ so upstream's unmodified `cp`
#             line still succeeds.
{
  lib,
  stdenv,
  omp,
}:
let
  rustTarget = stdenv.hostPlatform.rust.rustcTarget;
  # Mirror of upstream's platformsBySystem, restricted to the flake's systems.
  nativeLibBySystem = {
    x86_64-linux = "libpi_natives.so";
    aarch64-linux = "libpi_natives.so";
  };
  nativeLib =
    nativeLibBySystem.${stdenv.hostPlatform.system}
      or (throw "Unsupported platform for omp-natives: ${stdenv.hostPlatform.system}");
in
omp.overrideAttrs (old: {
  pname = "omp-natives";

  # Rust-affecting patches ONLY (see header). TS-only patches live in
  # nix/omp-patched.nix.
  patches = [ ../patches/omp/omp-reflink-degraded-copy.patch ];

  # Fast-compile override for the pi-natives Rust build. Upstream's release
  # profile (opt-level=3, lto="fat", codegen-units=1) serializes the whole
  # backend through one LTO unit. This distribution trades peak native-code
  # performance for compile time, even on this once-per-omp-bump build.
  # Cargo reads CARGO_PROFILE_RELEASE_* over Cargo.toml, so no patch needed.
  env = (old.env or { }) // {
    CARGO_PROFILE_RELEASE_LTO = "off";
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "256";
    CARGO_PROFILE_RELEASE_OPT_LEVEL = "1";
  };

  # Truncate upstream's buildPhase right before its first bun codegen step
  # (the `echo "Generating docs index..."` line): everything above it is
  # exactly the Rust pipeline we want — the LD_LIBRARY_PATH/LIBCLANG_PATH
  # exports, the cargo build, the cp into packages/natives/native, the napi
  # dts generation and gen-enums. Textual truncation (instead of copying the
  # commands) keeps them bit-identical with upstream across rebases; the
  # assert fails evaluation loudly if upstream renames the marker line.
  buildPhase =
    let
      marker = ''echo "Generating docs index..."'';
      parts = lib.splitString marker (old.buildPhase or "");
    in
    assert lib.assertMsg (builtins.length parts == 2)
      "omp-natives: marker not found exactly once in upstream omp buildPhase; upstream changed — update nix/omp-natives.nix";
    builtins.head parts
    + ''
      runHook postBuild
    '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/native $out/lib
    cp -r packages/natives/native/. $out/native/
    cp target/${rustTarget}/release/${nativeLib} $out/lib/${nativeLib}

    runHook postInstall
  '';

  # Upstream's install check smoke-tests the full compiled binary, which this
  # derivation no longer produces. (dontStrip stays inherited: harmless for a
  # plain .so, and it keeps the attr set close to upstream's.)
  doInstallCheck = false;
})
