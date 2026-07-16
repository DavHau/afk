{
  description = "afk — oh-my-pi harness with the jj patch set applied";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.xz";

    # omp (the harness). git+https form: github: API resolution is
    # rate-limited on the build host.
    llm-agents.url = "git+https://github.com/numtide/llm-agents.nix?shallow=1";
    llm-agents.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      llm-agents,
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
          omp-patched = pkgs.callPackage ./nix/omp-patched.nix {
            omp = llm-agents.packages.${system}.omp;
          };
        in
        {
          inherit omp-patched;
          default = omp-patched;
        }
      );

      devShells = forAllSystems (
        system: pkgs: {
          default = pkgs.mkShell {
            packages = [
              self.packages.${system}.omp-patched
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
