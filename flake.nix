{
  description = "Overmux local desktop development host";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
      ];
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          overmux-desktop = pkgs.writeShellApplication {
            name = "overmux-desktop";
            runtimeInputs = [ pkgs.electron ];
            text = ''
              source="''${OVERMUX_DESKTOP_SOURCE:-$PWD}"
              if [[ ! -f "$source/apps/desktop/package.json" ]]; then
                echo "overmux-desktop: run from an Overmux checkout or set OVERMUX_DESKTOP_SOURCE" >&2
                exit 1
              fi
              if [[ ! -d "$source/node_modules" ]]; then
                echo "overmux-desktop: dependencies are missing; run pnpm install in $source" >&2
                exit 1
              fi

              cd "$source"
              exec electron apps/desktop "$@"
            '';
          };
          default = self.packages.${system}.overmux-desktop;
        }
      );
      apps = forAllSystems (system: {
        overmux-desktop = {
          program = "${self.packages.${system}.overmux-desktop}/bin/overmux-desktop";
          type = "app";
        };
        default = self.apps.${system}.overmux-desktop;
      });
    };
}
