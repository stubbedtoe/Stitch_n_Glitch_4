//// Config parameters from specs/m1-local-foundation.allium. Code must
//// reference these constants — no magic numbers — so the spec's config
//// block remains the single source of truth.

/// config.snapshot_interval_commands
pub const snapshot_interval_commands: Int = 100

/// config.offline_indicator_deadline (5.seconds, in milliseconds)
pub const offline_indicator_deadline_ms: Int = 5000
