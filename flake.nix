{
  description = "afk — oh-my-pi harness with jj patches and the Superpowers skill library";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.xz";

    # omp (the harness). git+https form: github: API resolution is
    # rate-limited on the build host.
    llm-agents.url = "git+https://github.com/numtide/llm-agents.nix?shallow=1";
    llm-agents.inputs.nixpkgs.follows = "nixpkgs";

    # The Superpowers skill library (non-flake; bumped via
    # `nix flake update superpowers`).
    superpowers.url = "git+https://github.com/obra/superpowers.git?ref=main&shallow=1";
    superpowers.flake = false;

    # wrapPackage: the wrapper lib that produces the `afk` binary.
    wrappers.url = "git+https://github.com/lassulus/wrappers?shallow=1";
    wrappers.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      llm-agents,
      superpowers,
      wrappers,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (
        system: pkgs:
        let
          afk-skills = pkgs.callPackage ./nix/afk-skills.nix { inherit superpowers; };
          omp-natives = pkgs.callPackage ./nix/omp-natives.nix {
            omp = llm-agents.packages.${system}.omp;
          };
          omp-patched = pkgs.callPackage ./nix/omp-patched.nix {
            omp = llm-agents.packages.${system}.omp;
            inherit omp-natives;
          };
          afkPkgs = import ./nix/afk.nix {
            inherit pkgs afk-skills omp-patched;
            wrapPackage = wrappers.lib.wrapPackage;
          };
        in
        {
          inherit afk-skills omp-natives omp-patched;
          inherit (afkPkgs) afk;
          default = afkPkgs.afk;
        }
      );

      devShells = forAllSystems (
        system: pkgs: {
          default = pkgs.mkShell {
            packages = [
              self.packages.${system}.afk
              pkgs.jujutsu
              pkgs.git
              pkgs.bun
              pkgs.nixfmt
            ];
          };
        }
      );

      formatter = forAllSystems (system: pkgs: pkgs.nixfmt);
    };
}
