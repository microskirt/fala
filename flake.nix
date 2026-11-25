{
  description = "Fala, a SoundCloud front-end";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          fala = pkgs.callPackage ./nix/pkgs/fala { };
          default = self.packages.${system}.fala;
        }
      );
      overlays.default = final: prev: { fala = final.callPackage ./nix/pkgs/fala { }; };
      nixosModules = {
        default = import ./nix/modules/nixos/fala.nix;
        fala = self.nixosModules.default;
      };
    };
}
