import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComparisonTable } from '../components/aicss/ComparisonTable';
import { ApprovalCard } from '../components/beui/agents/approval-card';
import { CodeBlock } from '../components/beui/agents/code-block';
import { Citations } from '../components/beui/agents/citations';
import { FileDiff } from '../components/beui/agents/file-diff';
import { StreamingResponse } from '../components/beui/agents/streaming-response';
import { ToolApproval } from '../components/beui/agents/tool-approval';
import { ToolResult } from '../components/beui/agents/tool-result';
import { TodoList } from '../components/beui/agents/todo-list';
import { UploadDropzone } from '../components/bencho/UploadDropzone';
import { renderApp } from '../test/render';
import { Thread, citationItems, routeOf, visibleText } from './Thread';

describe('chat components', () => {
  it('streaming response shows no actions while streaming, then copy and feedback', () => {
    const { rerender } = render(<StreamingResponse status="streaming">Hello</StreamingResponse>);
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull();
    rerender(
      <StreamingResponse status="complete" copyText="Hello">
        Hello
      </StreamingResponse>,
    );
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Helpful' })).toBeTruthy();
  });

  it('out of free requests: the reply says until when and links Switch model to the Tether bot’s Runs on', () => {
    const onGo = vi.fn();
    const chat = { messages: [{ id: 'm1', role: 'tether', text: '', at: 1, error: 'Out of free requests until 02:00 · Switch model' }], models: [], loading: false, feedback: vi.fn() } as never;
    renderApp(<Thread chat={chat} onGo={onGo} empty="" />);
    expect(screen.getByText(/Out of free requests until 02:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch model' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'crew', id: 'orchestrator' });
  });

  it('citation rows open inside the app through onOpen', () => {
    const onGo = vi.fn();
    const items = citationItems([{ n: 1, label: 'limit.ts', kind: 'file', path: 'src/limit.ts', line: 12 }, { n: 2, label: 'run', kind: 'run', id: 'r9' }], onGo);
    render(<Citations citations={items} defaultOpen />);
    fireEvent.click(screen.getByRole('button', { name: /limit\.ts/ }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'code', id: 'src/limit.ts', line: 12 });
    expect(routeOf({ n: 3, label: 'n', kind: 'note', path: 'a.md' })).toEqual({ tab: 'graph', id: 'a.md' });
  });

  it('hides the tether data block, even half written', () => {
    expect(visibleText('Answer.\n\n```tether\n{"sources":[')).toBe('Answer.');
    expect(visibleText('plain')).toBe('plain');
  });

  it('approval card in review mode approves or rejects', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ApprovalCard title="Start a run?" approveLabel="Start run" onApprove={onApprove} onReject={onReject}>
        task
      </ApprovalCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(onApprove).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('approval card in question mode: a single choice moves on, the last submits', async () => {
    const onSubmit = vi.fn();
    render(
      <ApprovalCard
        questions={[
          { id: 'a', title: 'Which?', autoAdvance: true, options: [{ value: 'x', label: 'Xs' }] },
          { id: 'b', title: 'Which more?', multiple: true, options: [{ value: 'y', label: 'Ys' }] },
        ]}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByText('Xs'));
    fireEvent.click(await screen.findByText('Ys', {}, { timeout: 3000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(onSubmit).toHaveBeenCalledWith({ a: expect.objectContaining({ selected: ['x'] }), b: expect.objectContaining({ selected: ['y'] }) });
  });

  it('tool approval offers once, always and deny', () => {
    const f = { once: vi.fn(), always: vi.fn(), deny: vi.fn() };
    render(<ToolApproval tool="run_code" description="Comment on #4" defaultOpen onApprove={f.once} onAlwaysAllow={f.always} onDeny={f.deny} />);
    fireEvent.click(screen.getByRole('button', { name: /Allow once/ }));
    fireEvent.click(screen.getByRole('button', { name: /Always allow/ }));
    fireEvent.click(screen.getByRole('button', { name: /Deny/ }));
    expect(f.once).toHaveBeenCalled();
    expect(f.always).toHaveBeenCalled();
    expect(f.deny).toHaveBeenCalled();
  });

  it('tool result shows its output and copies it', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ToolResult tool="run_code" title="repo.search" status="success" copyText="3 hits" defaultOpen>
        3 hits
      </ToolResult>,
    );
    expect(screen.getAllByText('3 hits').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('3 hits'));
  });

  it('file diff counts added and removed lines', () => {
    render(
      <FileDiff
        file="a.ts"
        status="complete"
        defaultOpen
        lines={[
          { id: '1', type: 'removed', oldLine: 1, content: 'old' },
          { id: '2', type: 'added', newLine: 1, content: 'new' },
          { id: '3', type: 'added', newLine: 2, content: 'newer' },
        ]}
      />,
    );
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('−1')).toBeTruthy();
  });

  it('code block copies its code', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CodeBlock code="const a = 1;" language="typescript" filename="a.ts" status="complete" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;'));
  });

  it('todo list shows every item with its state', () => {
    render(<TodoList items={[{ id: 'a', title: 'Plan', status: 'completed' }, { id: 'b', title: 'Build', status: 'in-progress' }]} defaultOpen />);
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('comparison table renders rows and yes/no cells', () => {
    render(<ComparisonTable title="Runs" columns={['A', 'B']} rows={[{ label: 'Cost', cells: ['$1', '$2'] }, { label: 'Tests', cells: [true, false] }]} />);
    expect(screen.getByRole('table', { name: 'Runs' })).toBeTruthy();
    expect(screen.getByText('$2')).toBeTruthy();
    expect(screen.getByLabelText('yes')).toBeTruthy();
    expect(screen.getByLabelText('no')).toBeTruthy();
  });

  it('dropzone accepts a real file and refuses an oversized one', () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles} maxBytes={10} />);
    const input = screen.getByTestId('dropzone-input');
    fireEvent.change(input, { target: { files: [new File(['hi'], 'a.txt', { type: 'text/plain' })] } });
    expect(onFiles).toHaveBeenCalledOnce();
    expect(screen.getByText('Added a.txt')).toBeTruthy();
    fireEvent.change(input, { target: { files: [new File(['x'.repeat(50)], 'big.txt')] } });
    expect(onFiles).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toContain('Too big');
  });
});
