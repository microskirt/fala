{
  lib,
  stdenv,
  bun,
  nodejs,
  makeWrapper,
}:

let
  packageJson = lib.importJSON ../../../package.json;

  # The dependencies are locked by bun.lock only. Installing with `--os="*"`
  # and `--cpu="*"` pulls in the optional binaries for every platform, so the
  # output is identical on all systems and one hash covers every architecture.
  node-modules = stdenv.mkDerivation {
    pname = "fala-node-modules";
    version = packageJson.version;

    src = lib.fileset.toSource {
      root = ../../..;
      fileset = lib.fileset.unions [
        ../../../package.json
        ../../../bun.lock
      ];
    };

    nativeBuildInputs = [ bun ];

    buildPhase = ''
      runHook preBuild

      export HOME=$TMPDIR
      export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache

      bun install \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress \
        --os="*" \
        --cpu="*" \
        --backend=copyfile

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      cp -r node_modules $out/node_modules

      runHook postInstall
    '';

    dontFixup = true;

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-5u318089wTE7Rpa4R0Kz/3Q2I7NbhcRXs48tyUzPeMc=";

    impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [
      "GIT_PROXY_COMMAND"
      "SOCKS_SERVER"
    ];
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "fala";
  version = packageJson.version;

  src = lib.fileset.toSource {
    root = ../../..;
    fileset = lib.fileset.unions [
      ../../../package.json
      ../../../bun.lock
      ../../../vite.config.js
      ../../../server
      ../../../web
    ];
  };

  nativeBuildInputs = [
    nodejs
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild

    cp -r ${node-modules}/node_modules .
    chmod -R u+w node_modules
    patchShebangs node_modules

    node node_modules/vite/bin/vite.js build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/fala
    cp package.json $out/lib/fala/
    cp -r server $out/lib/fala/server
    cp -r dist $out/lib/fala/dist

    mkdir -p $out/bin
    makeWrapper ${lib.getExe nodejs} $out/bin/fala \
      --add-flags $out/lib/fala/server/index.js

    runHook postInstall
  '';

  passthru = {
    inherit node-modules;
  };

  meta = {
    description = "SoundCloud front-end built with React, Vite and Node";
    homepage = "https://github.com/microskirt/fala";
    platforms = lib.platforms.linux;
    mainProgram = "fala";
  };
})
