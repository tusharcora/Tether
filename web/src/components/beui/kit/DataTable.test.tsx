import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from './DataTable';

interface Row { id: string; name: string; n: number }
const rows: Row[] = [
  { id: 'a', name: 'bravo', n: 2 },
  { id: 'b', name: 'alpha', n: 3 },
  { id: 'c', name: 'charlie', n: 1 },
];
const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', sort: (x, y) => x.name.localeCompare(y.name), cell: (r) => r.name },
  { id: 'n', header: 'Count', align: 'right', sort: (x, y) => x.n - y.n, cell: (r) => r.n },
  { id: 'note', header: 'Note', cell: () => '-' },
];
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);
const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('DataTable', () => {
  it('is a real table: named, with column headers and one row per item in the given order', () => {
    render(<DataTable aria-label="Things" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('table', { name: 'Things' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Count', 'Note']);
    expect(names()).toEqual(['bravo', 'alpha', 'charlie']);
  });

  it('sorts a sortable header ascending, then flips it, and says so in aria-sort', () => {
    render(<DataTable aria-label="Things" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(header('Name').getAttribute('aria-sort')).toBe('none');
    expect(header('Note').getAttribute('aria-sort')).toBeNull(); // not sortable
    fireEvent.click(within(header('Name')).getByRole('button'));
    expect(names()).toEqual(['alpha', 'bravo', 'charlie']);
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(header('Name')).getByRole('button'));
    expect(names()).toEqual(['charlie', 'bravo', 'alpha']);
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(within(header('Name')).getByRole('button'));
    expect(names()).toEqual(['alpha', 'bravo', 'charlie']);
    fireEvent.click(within(header('Count')).getByRole('button'));
    expect(names()).toEqual(['charlie', 'bravo', 'alpha']);
    expect(header('Name').getAttribute('aria-sort')).toBe('none');
  });

  it('starts from a default sort', () => {
    render(<DataTable aria-label="Things" columns={columns} rows={rows} rowKey={(r) => r.id} defaultSort={{ id: 'n', dir: 'desc' }} />);
    expect(names()).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('opens a row on click, Enter and Space, walks rows with the arrows, and marks the current one', () => {
    const open = vi.fn();
    render(<DataTable aria-label="Things" columns={columns} rows={rows} rowKey={(r) => r.id} rowLabel={(r) => r.name} onRowClick={open} currentKey="b" />);
    const list = screen.getAllByRole('row').slice(1);
    expect(list[1]!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(list[0]!);
    expect(open).toHaveBeenLastCalledWith(rows[0]);
    list[0]!.focus();
    fireEvent.keyDown(list[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(list[1]);
    fireEvent.keyDown(list[1]!, { key: 'End' });
    expect(document.activeElement).toBe(list[2]);
    fireEvent.keyDown(list[2]!, { key: 'Enter' });
    expect(open).toHaveBeenLastCalledWith(rows[2]);
    fireEvent.keyDown(list[2]!, { key: ' ' });
    expect(open).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(list[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(list[0]);
  });

  it('says so when there is nothing to show', () => {
    render(<DataTable aria-label="Things" columns={columns} rows={[]} rowKey={(r) => r.id} empty="No things." />);
    expect(screen.getByText('No things.')).toBeTruthy();
  });
});
