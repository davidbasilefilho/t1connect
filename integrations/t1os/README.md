# Optional T1OS companion profile

This unit is a packaging candidate, not a deployment or part of T1OS's default overlay.
T1 Connect remains runnable on its own. The profile uses its own root-owned app and Node
24 installation under /opt/t1-connect, a dedicated non-admin t1-connect account, private
SQLite state and a separate runtime socket directory. The guest packager would stage
those files and disposable guest certificates explicitly. The unit has no Install section
or activation dependencies and has an explicit guest enable marker. Its bind remains
127.0.0.1:3791. T3's port 3773, systemd unit, Pi workflow, credential files, policy and
two-target SSH allowlist stay unchanged. The companion cannot access the operator's home
or /opt/t1os. It does not consume T3 turns.

The local administrator must intentionally act as the isolated daemon UID when granting,
starting or revoking. Do not make the T3 operator, provider process, or remote client that
UID or add a writable shared socket. A later cross-UID broker should mediate narrow owner
operations without lending the provider the daemon identity. Keep firewall or tailnet
changes out of this profile.

## Acceptance before any guest promotion

- Verify the pinned T1OS overlay and its bundled T3 v0.1.10 in a fresh, disposable VM.
  Verify the marker is absent by default and the operator's T3, Pi and private routing
  remain unchanged. Check AppArmor/LSM and systemd's effective credential access for
  the non-root daemon UID, resource controls and loopback filtering in that VM.
- Use guest-only fixture PKI to exercise a console-approved task and viewer through
  loopback. Confirm the socket is inaccessible to the normal operator and the daemon
  cannot read T3/provider state. Stop the candidate unit and ensure no remaining
  listeners, sessions or route changes. Do not enable/reconfigure Tailscale, SSH, LAN,
  or the overlay's hosted Connect policy in this step.
- The desired later T3 adapter should emit only a task-scoped, redacted projection
  via documented interfaces stable on the pinned release. Compare that approach with
  direct scoped upstream pairing before adding compatibility code. No adapter or
  second-device networking has been tested yet.

Offline validation ran on systemd 257 with a disposable runtime directory and the
user-mode unit parser, because the workspace cannot write to /run/systemd. This checks
parsing and paths visible to the verifier, not service execution, account provisioning,
credential mounts or T1OS behavior. The integration suite separately checks the daemon
with disjoint state and owner runtime directories. In the disposable guest, validate
the system-scope profile before any service start.
