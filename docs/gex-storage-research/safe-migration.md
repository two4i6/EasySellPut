# GEX guarded copy migration

`gex-archive` is explicit local administrative maintenance. It reuses the Data
migrator through Application and CLI; it is deliberately not an MCP tool, even
with allow-writes, because it accepts backup/destination filesystem paths.
The ownership exception is recorded in the desktop capability inventory. Native
UI does not silently move or switch archives. Existing cache Compact is not a
format migration and never deletes unique history.

## Commands and default behavior

```sh
easysellput gex-archive migrate --source OLD/cache/qqq-gex.db --destination NEW/cache/qqq-gex.db --json
easysellput gex-archive status --source NEW/cache/qqq-gex.db --json
easysellput gex-archive migrate --source OLD/cache/qqq-gex.db --destination NEW/cache/qqq-gex.db --resume --json
# Current contents, including new writes, downgraded into another new path:
easysellput gex-archive downgrade --source NEW/cache/qqq-gex.db --destination LEGACY/cache/qqq-gex.db --json
# Original verified snapshot restored into another new path (later writes excluded):
easysellput gex-archive restore --source NEW/cache/qqq-gex.db --destination RESTORED/cache/qqq-gex.db --json
```

Every destination must be new; no source or existing destination is overwritten.
No source, backup or historical row is deleted. The original stays the active
archive until the user explicitly starts a coordinated updated application with
its supported `--data-dir NEW`. Only GEX is copied; this does not copy preferences,
installed apps or other profile data. Keep the original and verified backup.

Legacy directories continue writing gzip. A migrated directory has an explicit
format marker; updated .NET and Node writers automatically use Brotli v2 there,
without an environment variable. `MEILI_GEX_ARCHIVE_CODEC=brotli-v2` cannot opt a
legacy directory into an unguarded new format: it now fails with migration-required.
Unknown values fail. The former prototype flag is not a production migration API.

## Snapshot, disk and recovery

The source is opened read-only and copied using SQLite online backup, including
committed WAL state. A running original application may keep writing; the output
is a consistent point-in-time snapshot, not a continuous mirror. Later receipts
remain in the original only. For a final cutover that needs all observations,
stop/drain original writers before taking the chosen final snapshot. Do not copy
just a live main `.db`, delete its WAL, or assume a snapshot includes later writes.

Maintenance creates `.migration.db` control state and an exclusive
`.migration.lock` lease, plus `.backup.db` and a private random `.working-*.db`.
The backup passes SQLite integrity, original decoded hashes, day/profile pointer
integrity and a complete logical manifest before its SHA-256 is accepted. Backup
hash is rechecked on resume, before publication and on restore. Unaccepted backup
attempts are renamed `.unverified-*` for inspection, never confused with a
verified backup or used for restore. Accepted backup corruption blocks the operation.

Preflight checks the destination mount's available space against a 256 MiB
reserve, 256 MiB body workspace and three source+WAL sizes. Before work creation
and each batch it rechecks conservative workspace/transaction budgets. Other disk
consumers can still cause SQLITE_FULL; failed transactions are rolled back, the
verified backup and original remain, and the same operation can resume. No
production low-space bypass or fake-data switch exists.

The private working copy is fenced and marked pending. At most 32 rows and the
rowid progress cursor commit together; signed 64-bit/negative rowids are covered.
Plain JSON, gzip, existing v2, raw provider identity/gzip and observed references
are verified; references stay references. Exact provider bytes, UTF-8 JSON bytes,
prices, precision, dates, hashes and all other tables/columns are preserved.
Full manifest/pointer verification occurs before a ready receipt and atomic
same-directory rename publishes the new destination. No automatic VACUUM is run.

Ctrl+C checks cancellation before phases, between records, before batch commit
and before publication. The synchronous SQLite backup call completes/returns
before cancellation is observed; it is not claimed to be preemptible mid-call.
No pending copy is published. Re-run the same source/destination/action with
`--resume`. The lease prevents concurrent migrators. A crash after rename but
before control acknowledgement is reconciled using the unique publication
receipt, version gate and current-record verification, never by overwriting an
existing path. A foreign preexisting destination is refused even if its data look
identical. Partial working databases cannot be opened by updated normal readers.

`status` reports persisted progress, not a substitute for backup/full verification.
A normal resume verifies the accepted backup and current published records.
`restore` validates the retained backup SHA and makes a fresh legacy-readable copy.
To resume an interrupted restore, use the displayed verified backup as `downgrade
--source BACKUP --destination RESTORED --resume`. Downgrade converts current
contents on another new path and removes the v2 write gate only after validation.
Never switch an old binary directly onto a v2 database or expect unsetting a flag
to downgrade already stored bytes. Never retire the only original/backup copy as
part of these commands.

## Old-client isolation and limits

A ready v2 database contains version 2/status ready and SQLite BEFORE INSERT,
UPDATE and DELETE triggers on existing GEX tables, including the marker/receipt.
Those triggers call `gex_v2_writer()`. Updated Node/.NET connection factories
validate the marker and register version 2. Old clients do not register the
function, so their normal startup INSERT OR IGNORE and subsequent DML fail inside
SQLite rather than silently modifying history. Updated normal readers reject
pending/unknown markers. Old gzip decoders also explicitly reject QGEX bytes.
The source remains an entirely separate legacy archive; no gate is injected into it.

This is compatibility isolation for the application's actual SQLite access
paths, not a security boundary against malicious same-user SQL, dropping triggers,
raw filesystem replacement or arbitrary code registering the function. Old
clients may still perform harmless schema probes or physical VACUUM; they cannot
perform the guarded DML. A new destination is never automatically selected, and
published ready archives do not depend on a running migration process. Keep
backups and use a separate profile. Future schema writers must preserve the gate.

The local acceptance uses synthetic fixtures only. It covers live source WAL
writes, actual CLI/Node/.NET, old-client SQL denial, new v2 writes, full replay,
backup corruption, disk preflight and actual SQLITE_FULL, cancellation, killed
uncommitted processes, lease contention, idempotent resume, restore, downgrade
and occupied destinations. Runtime bounds/headers have cross-runtime tests.
Real six-CBOE original bytes remain unavailable. No claim is made about real user
compression savings or native Mac/Windows acceptance until the corresponding CI
and platform runs are inspected. No Mac connection is required for this work.

The app payload version advances to 1.0.1 so independently distributed updated
engines have a new package identity. Its module `dataFormat=1` still denotes the
preserved GEX table/operation contracts; the independently versioned QGEX archive
marker/connection gate enforces codec compatibility. Installing an older payload
is not a way to bypass the database trigger gate. Use the updated host and payload
when explicitly selecting a migrated profile. No app or host release is published
by merging this work branch.
