# Authoritative package identity

- Application audit anchor: `18be03ecfb760e91e41c8daa5f2dd6336a41b883` (`Correct retirement tax treatment and 2025 deductions`).
- AppImage: `src-tauri/target/release/bundle/appimage/LifeLook_0.1.0_amd64.AppImage`.
- AppImage SHA-256: `80d932bc237aff1a33bcdbe5ab0886f9a4edca677763f53aa88b9d6094d539dd`.
- Built and audited: 2026-08-10 America/Los_Angeles.
- Host: Ubuntu 24.04.3 LTS; Linux 6.17.0-29-generic x86_64.
- Toolchain: Node 22.22.2; npm 11.15.0; rustc 1.97.1; cargo-audit 0.22.2.
- Profiles: each scenario and matrix run used a newly created `XDG_DATA_HOME`. The full-suite wrapper removed its temporary profiles. Matrix and independent-reproduction profiles were created under `mktemp` paths and contain synthetic data only.
- Visible-window evidence: `visible-window.png`, SHA-256 `35b28eb6f2053dd4eae17202151836a61fc28301243431014e4417ecaa16157c`.
- State-specific package evidence: `final-full-suite/`.
- Appearance/layout package evidence: `control-matrix/results.json` and its 32 named screenshots.

The first smoke invocation lacked a `DISPLAY` and failed during GTK initialization. The required Xvfb invocation then passed and produced the retained screenshot. This is recorded as a harness invocation error, not an AppImage pass.
