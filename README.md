# Fala

Fala is a SoundCloud front-end: a React/Vite web app served by a small Node proxy server. This repository is a maintained fork that also contains its own flake. The flake builds the checkout itself and provides the `fala` package (`packages.<system>.fala` and `default`), `overlays.default`, and a NixOS module.

## Structure

```text
flake.nix                      # Package, overlay and NixOS module outputs
nix/
  pkgs/fala/default.nix        # Installs the dependencies from bun.lock, runs the Vite build and wraps server/index.js
  modules/nixos/fala.nix       # services.fala systemd service
server/                        # Node proxy and static file server
web/                           # React front-end source
package.json, bun.lock         # Front-end dependencies
start.sh                       # Launcher for running outside Nix
```

## Configuration

Import `nixosModules.default` (or `nixosModules.fala`) into a NixOS configuration. You don't need the overlay. The service runs as a `DynamicUser` and keeps its cached SoundCloud `client_id` in `/var/lib/fala`.

```nix
services.fala = {
  enable = true;
  package = pkgs.fala; # Optional; defaults to pkgs.fala, or the flake's own package when pkgs.fala doesn't exist
  bind = "127.0.0.1"; # Protected tracks only play on a secure origin (localhost or HTTPS through a reverse proxy)
  port = 8090; # Ports below 1024 grant CAP_NET_BIND_SERVICE
};
```
