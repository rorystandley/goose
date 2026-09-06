import { describe, expect, it } from 'vitest';
import { getHtml } from '../../interfaces/web/public.js';
import { updateTimeline } from '../../interfaces/web/client/data.js';

describe('dashboard bootstrap', () => {
  it('escapes HTML and script delimiters in runtime configuration', () => {
    const html = getHtml('</script><script>alert(1)</script>', '<model>');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).toContain('type="module" src="/app.js"');
  });
});

describe('live tool events', () => {
  it('attaches successive tool results to the last unfinished matching call', () => {
    let items = updateTimeline([], 'toolCall', { toolName: 'read_file' });
    items = updateTimeline(items, 'toolResult', { toolName: 'read_file', result: 'first' });
    items = updateTimeline(items, 'toolCall', { toolName: 'read_file' });
    items = updateTimeline(items, 'toolResult', { toolName: 'read_file', result: 'second' });
    expect(items.map(i => i.result)).toEqual(['first', 'second']);
  });
  it('resolves only the matching approval and preserves denied state', () => {
    const items = [{ type: 'toolCall', approvalId: 'one' }, { type: 'toolCall', approvalId: 'two' }];
    const updated = updateTimeline(items, 'approvalResolved', { approvalId: 'one', approved: false });
    expect(updated[0]).toMatchObject({ resolved: true, approved: false });
    expect(updated[1].resolved).toBeUndefined();
    expect(items[0].resolved).toBeUndefined();
  });
});
