import { getDb } from '../utils/db.js';
import { getSummaryMetrics } from '../monitoring/metrics.js';

export async function benchmarksCommand(opts: { json?: boolean }) {
  const db = getDb();
  const summary = getSummaryMetrics();

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('=== AI Agent Pipeline Performance Benchmarks ===\n');

  // Overall Stats
  console.log('Cluster Throughput:');
  console.log(`  Total Hops:      ${summary.total_hops}`);
  console.log(`  Success Rate:    ${summary.total_hops ? Math.round((summary.success_count / summary.total_hops) * 100) : 0}%`);
  console.log(`  Avg Latency:     ${Math.round(summary.avg_duration || 0)}ms`);
  console.log(`  Total Cost:      $${(summary.total_cost || 0).toFixed(4)}`);
  console.log('');

  // Mode Distribution
  const modeStats = db.prepare(`
    SELECT mode, count(*) as count, avg(duration_ms) as avg_lat
    FROM performance_metrics
    GROUP BY mode
  `).all() as any[];

  console.log('Mode Performance:');
  if (modeStats.length === 0) {
    console.log('  No data available.');
  } else {
    for (const stat of modeStats) {
      console.log(`  [${stat.mode}] Count: ${stat.count} | Avg Latency: ${Math.round(stat.avg_lat)}ms`);
    }
  }
  console.log('');

  // Node Distribution
  const nodeStats = db.prepare(`
    SELECT node_id, count(*) as count, sum(cost_usd) as total_cost
    FROM performance_metrics
    GROUP BY node_id
  `).all() as any[];

  console.log('Resource Utilization (by Node):');
  if (nodeStats.length === 0) {
    console.log('  No data available.');
  } else {
    for (const stat of nodeStats) {
      console.log(`  [${stat.node_id}] Tasks: ${stat.count} | Cost Contrib: $${(stat.total_cost || 0).toFixed(4)}`);
    }
  }
}
