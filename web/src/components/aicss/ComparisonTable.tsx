/**
 * From aicss.dev "Comparison table" (ComparisonTable.tsx). MIT License, Copyright (c) 2026 AICSS; the full notice is in
 * ./LICENSE. Adapted for Tether: cells are text or yes/no, table ARIA roles, an optional caption, Studio tokens.
 */
import styles from './ComparisonTable.module.css';

export type ComparisonCell = string | boolean;
export interface ComparisonRow {
  label: string;
  cells: ComparisonCell[];
}

export function ComparisonTable({ title, columns, rows, firstColumn = 'Feature' }: { title?: string; columns: string[]; rows: ComparisonRow[]; firstColumn?: string }) {
  return (
    <div className={styles.tbl} role="table" aria-label={title ?? 'Comparison'}>
      <div className={styles.tblHead} role="row">
        <div className={styles.tblCell} role="columnheader">
          {firstColumn}
        </div>
        {columns.map((c) => (
          <div key={c} className={styles.tblCell} role="columnheader">
            {c}
          </div>
        ))}
      </div>
      <div className={styles.tblBody} role="rowgroup">
        {rows.map((r) => (
          <div key={r.label} className={styles.tblRow} role="row">
            <div className={styles.tblCell} role="rowheader">
              <span className={styles.tblCellText}>{r.label}</span>
            </div>
            {r.cells.map((v, i) => (
              <div key={i} className={styles.tblCell} role="cell">
                {v === true ? (
                  <span className={styles.yes} aria-label="yes">
                    ✓
                  </span>
                ) : v === false ? (
                  <span className={styles.no} aria-label="no">
                    —
                  </span>
                ) : (
                  <span className={styles.tblCellText}>{v}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
