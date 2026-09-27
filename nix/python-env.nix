# python-env.nix — the base interpreter of afk's pip-writable eval venv.
# Pattern reference: spaces' modules/nixos/hermes/python-venv.nix.
#
# The afk wrapper creates ~/.omp/profiles/afk/python-env (omp's managed
# venv slot for the afk profile, used
# when the project has no venv of its own) from this interpreter with
# --system-site-packages: the libraries below come from nix, and `%pip
# install` adds anything else into the writable venv.
#
# The interpreter's binary wrapper appends wheelLibraryPath to
# LD_LIBRARY_PATH so extension modules in manylinux wheels (libstdc++,
# zlib, openssl, ...) load under the nix-built interpreter. The variable is
# scoped to this interpreter's processes; bash commands and other tools
# never see it.
{ pkgs }:
let
  inherit (pkgs) lib;

  wheelLibraries = with pkgs; [
    stdenv.cc.cc
    zlib
    zstd
    openssl
    curl
    expat
    libxml2
    libxslt
    libffi
    bzip2
    ncurses
    fontconfig
    freetype
  ];
in
(pkgs.python3.withPackages (
  ps: with ps; [
    pip
    # The libraries afk sessions reach for in eval cells, most used first
    # (import and ModuleNotFoundError counts across the afk session
    # transcripts, 2026-09).
    polars
    numpy
    httpx
    scipy
    pandas
    pyarrow
    pyyaml
    pillow
    plotly
    typer
    pydantic
    jinja2
    pypdf
    requests
    pexpect
    pathspec
    pytest
    odfpy
  ]
)).override
  {
    makeWrapperArgs = [
      "--suffix"
      "LD_LIBRARY_PATH"
      ":"
      (lib.makeLibraryPath wheelLibraries)
    ];
  }
