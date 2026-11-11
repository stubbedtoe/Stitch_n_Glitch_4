//// Config parameters from specs/m1-local-foundation.allium. Code must
//// reference these constants — no magic numbers — so the spec's config
//// block remains the single source of truth.

/// config.snapshot_interval_commands
pub const snapshot_interval_commands: Int = 100

/// config.offline_indicator_deadline (5.seconds, in milliseconds)
pub const offline_indicator_deadline_ms: Int = 5000

/// config.max_pipeline_ops (specs/m2-chart-core.allium — F-045 pt 2 op stack)
pub const max_pipeline_ops: Int = 16

/// config.stub_tone_amount_bound (specs/m2-chart-core.allium — stub op)
pub const stub_tone_amount_bound: Int = 100

/// config.colorblind_safe_sets_required (specs/m2-chart-core.allium —
/// invariant MinColorblindSafeSets, NFR-U2)
pub const colorblind_safe_sets_required: Int = 2

/// config.min_zoom_pct (specs/m2-chart-core.allium — rule ChartZoomed clamp,
/// AC-F009-02)
pub const min_zoom_pct: Int = 10

/// config.max_zoom_pct (specs/m2-chart-core.allium — rule ChartZoomed clamp,
/// AC-F009-02)
pub const max_zoom_pct: Int = 4000

/// config.grid_auto_hide_below_zoom_pct (specs/m2-chart-core.allium —
/// ChartView.grid_visible, AC-F009-02)
pub const grid_auto_hide_below_zoom_pct: Int = 25

/// config.min_cell_px_at_100pct (specs/m2-chart-core.allium — S5 16px-cell
/// minimum at 100% zoom, PRD v1.15; ChartView.rendered_cell_size)
pub const min_cell_px_at_100pct: Int = 16

/// config.min_pan_zoom_fps (specs/m2-chart-core.allium — NFR-P2,
/// ChartViewControls guarantee PanZoomPerformance)
pub const min_pan_zoom_fps: Int = 55

/// config.p2_benchmark_chart_width (specs/m2-chart-core.allium — NFR-P2
/// benchmark chart width)
pub const p2_benchmark_chart_width: Int = 1000

/// config.p2_benchmark_chart_height (specs/m2-chart-core.allium — NFR-P2
/// benchmark chart height)
pub const p2_benchmark_chart_height: Int = 1000
