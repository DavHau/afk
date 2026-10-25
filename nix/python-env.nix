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

  # afk's own helper module (`from afk_run import run`): subprocess with a
  # process-group kill on timeout/interrupt. See profile/python/afk_run.py.
  afkRun =
    ps:
    ps.toPythonModule (
      pkgs.runCommand "afk-run" { } ''
        install -Dm444 ${../profile/python/afk_run.py} $out/${ps.python.sitePackages}/afk_run.py
      ''
    );

  # polars from the PyPI wheels on x86_64 while nixpkgs' rustc links LLVM 21:
  # LLVM 21 miscompiles the x86 lowering of minimumnum/maximumnum
  # (llvm/llvm-project#147193, fixed by #164546 in LLVM 22, never backported
  # to 21.1.x), so the source-built polars returns wrong float max/min
  # (`pl.Series(range(64), dtype=pl.Float64).max()` gives 7.0). The upstream
  # wheels are built with a rustc on LLVM 22 and are correct. The override
  # drops out by itself once nixpkgs' rustc moves to LLVM >= 22; delete it
  # then.
  polarsWheelNeeded =
    pkgs.stdenv.hostPlatform.isx86_64 && lib.versionOlder pkgs.rustc.unwrapped.llvm.version "22";
  polarsFromWheels =
    ps:
    let
      version = "1.42.1";
      runtime = ps.buildPythonPackage {
        pname = "polars-runtime-32";
        inherit version;
        format = "wheel";
        src = pkgs.fetchPypi {
          pname = "polars_runtime_32";
          inherit version;
          format = "wheel";
          dist = "cp310";
          python = "cp310";
          abi = "abi3";
          platform = "manylinux_2_17_x86_64.manylinux2014_x86_64";
          hash = "sha256-0Fno5TzBFP+C+b15H9NB3FNTSix0Xm9qo3WUw6k/Af4=";
        };
        nativeBuildInputs = [ pkgs.autoPatchelfHook ];
        buildInputs = [ pkgs.stdenv.cc.cc.lib ];
      };
    in
    ps.buildPythonPackage {
      pname = "polars";
      inherit version;
      format = "wheel";
      src = pkgs.fetchPypi {
        pname = "polars";
        inherit version;
        format = "wheel";
        dist = "py3";
        python = "py3";
        hash = "sha256-PAxlzfohpiFlDEvcu8z5OWTQUv12bD5w6EpV2WHCWf0=";
      };
      dependencies = [ runtime ];
      pythonImportsCheck = [ "polars" ];
    };
in
(pkgs.python3.withPackages (
  ps: with ps; [
    pip
    (afkRun ps)
    # The libraries afk sessions reach for in eval cells, most used first
    # (import and ModuleNotFoundError counts across the afk session
    # transcripts, 2026-09).
    (if polarsWheelNeeded then polarsFromWheels ps else polars)
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
