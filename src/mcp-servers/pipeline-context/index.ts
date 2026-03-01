import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { logger } from '../../utils/logger.js';

export interface ReportEntry {
  id: string;
  type: 'markdown' | 'json';
  path: string;
  content: string;
  timestamp: string;
}

const REPORTS_DIR = resolve('/home/brans/ai-agent-pipeline/reports');

/**
 * List all available reports in the reports directory.
 */
export async function listReports(): Promise<string[]> {
  try {
    const files = await readdir(REPORTS_DIR);
    return files.filter(f => f.endsWith('.md') || f.endsWith('.json'));
  } catch (err) {
    logger.error('Failed to list reports', { error: String(err) });
    return [];
  }
}

/**
 * Search reports for a keyword or pattern.
 */
export async function searchReports(query: string): Promise<ReportEntry[]> {
  const files = await listReports();
  const results: ReportEntry[] = [];
  const lowercaseQuery = query.toLowerCase();

  for (const file of files) {
    try {
      const filePath = join(REPORTS_DIR, file);
      const content = await readFile(filePath, 'utf-8');
      
      if (content.toLowerCase().includes(lowercaseQuery)) {
        results.push({
          id: file,
          type: file.endsWith('.json') ? 'json' : 'markdown',
          path: filePath,
          content: content.slice(0, 5000), // Limit content size for MCP transport
          timestamp: new Date().toISOString() // In a real impl, we'd pull from file stats
        });
      }
    } catch (err) {
      logger.warn('Failed to read report during search', { file, error: String(err) });
    }
  }

  return results.sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Get the full content of a specific report.
 */
export async function getReport(id: string): Promise<ReportEntry | null> {
  try {
    const filePath = join(REPORTS_DIR, id);
    const content = await readFile(filePath, 'utf-8');
    
    return {
      id,
      type: id.endsWith('.json') ? 'json' : 'markdown',
      path: filePath,
      content,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    logger.error('Failed to get report', { id, error: String(err) });
    return null;
  }
}
