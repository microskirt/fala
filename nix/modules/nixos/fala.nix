{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.fala;
in
{
  options.services.fala = {
    enable = lib.mkEnableOption "Fala, a SoundCloud front-end";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.fala or (pkgs.callPackage ../../pkgs/fala { });
      defaultText = lib.literalExpression ''
        pkgs.fala or (pkgs.callPackage ../../pkgs/fala { })
      '';
      example = lib.literalExpression "pkgs.fala";
      description = ''
        The Fala package to use. Defaults to `pkgs.fala` when the flake's
        overlay is applied, and otherwise to the package built from the
        flake's own source tree.
      '';
    };

    bind = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      example = "0.0.0.0";
      description = ''
        Address the HTTP server binds to. The default only accepts
        connections from the local machine.

        Note that browsers only allow playback of protected (DRM) SoundCloud
        tracks on a secure origin. Either keep the default and reach Fala
        through localhost, or put it behind a reverse proxy serving HTTPS.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8090;
      example = 80;
      description = ''
        Port the HTTP server listens on. Ports below 1024 additionally grant
        the service the `CAP_NET_BIND_SERVICE` capability.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.fala = {
      description = "Fala, a SoundCloud front-end";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        HOST = cfg.bind;
        PORT = toString cfg.port;
        DATA_DIR = "/var/lib/fala";
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        DynamicUser = true;
        StateDirectory = "fala";
        WorkingDirectory = "/var/lib/fala";
        Restart = "on-failure";

        # Hardening. MemoryDenyWriteExecute is deliberately not set: V8 needs
        # writable and executable memory for its JIT.
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        NoNewPrivileges = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        LockPersonality = true;
        RestrictNamespaces = true;
        RestrictRealtime = true;
        SystemCallArchitectures = "native";
        CapabilityBoundingSet = if cfg.port < 1024 then "CAP_NET_BIND_SERVICE" else "";
        AmbientCapabilities = lib.optionalString (cfg.port < 1024) "CAP_NET_BIND_SERVICE";
      };
    };
  };
}
