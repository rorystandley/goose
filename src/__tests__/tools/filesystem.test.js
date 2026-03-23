import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fs/promises (default import in filesystem.js)
// ---------------------------------------------------------------------------
const mockReadFile  = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockReaddir   = vi.hoisted(() => vi.fn());
const mockStat      = vi.hoisted(() => vi.fn());
const mockMkdir     = vi.hoisted(() => vi.fn());

vi.mock('fs/promises', () => ({
  default: {
    readFile:  mockReadFile,
    writeFile: mockWriteFile,
    readdir:   mockReaddir,
    stat:      mockStat,
    mkdir:     mockMkdir,
  },
}));

// ---------------------------------------------------------------------------
// Mock os (default import) — gives a stable homedir for tilde expansion tests
// ---------------------------------------------------------------------------
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/Users/testuser'),
  },
}));

import { read_file, write_file, list_directory } from '../../tools/filesystem.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------
describe('read_file', () => {
  it('returns file contents for a valid file', async () => {
    mockReadFile.mockResolvedValueOnce('hello world');
    const result = await read_file.execute({ path: '/Users/test/file.txt' });
    expect(result).toBe('hello world');
  });

  it('truncates content that exceeds 10,000 characters', async () => {
    // Use 20,000 chars so the truncated result (10,000 + suffix) is clearly
    // shorter than the original content.
    const longContent = 'x'.repeat(20000);
    mockReadFile.mockResolvedValueOnce(longContent);
    const result = await read_file.execute({ path: '/Users/test/big.txt' });
    expect(result).toContain('[File truncated at 10,000 characters]');
    expect(result.length).toBeLessThan(longContent.length);
  });

  it('returns error message when fs.readFile rejects', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));
    const result = await read_file.execute({ path: '/Users/test/missing.txt' });
    expect(result).toContain('Failed to read file');
    expect(result).toContain('ENOENT');
  });

  it('expands ~/path to homedir before reading', async () => {
    mockReadFile.mockResolvedValueOnce('contents');
    await read_file.execute({ path: '~/docs/file.txt' });
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/Users/testuser/docs/file.txt'),
      'utf8'
    );
  });

  it('expands bare ~ to homedir', async () => {
    mockReadFile.mockResolvedValueOnce('');
    await read_file.execute({ path: '~' });
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/Users/testuser'),
      'utf8'
    );
  });

  it('does not alter absolute paths', async () => {
    mockReadFile.mockResolvedValueOnce('data');
    await read_file.execute({ path: '/absolute/path/file.txt' });
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/absolute/path/file.txt'),
      'utf8'
    );
  });

  it('has riskLevel "safe"', () => {
    expect(read_file.riskLevel).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------
describe('write_file', () => {
  it('writes a file inside an allowed path and returns success message', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined);
    const result = await write_file.execute({
      path: '/Users/test/out.txt',
      content: 'some content',
    });
    expect(result).toContain('File written successfully');
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('denies writes outside ALLOWED_PATHS', async () => {
    const result = await write_file.execute({
      path: '/etc/passwd',
      content: 'hacked',
    });
    expect(result).toContain('Access denied');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('returns error message when fs.writeFile rejects', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const result = await write_file.execute({
      path: '/Users/test/protected.txt',
      content: 'data',
    });
    expect(result).toContain('Failed to write file');
    expect(result).toContain('EACCES');
  });

  it('expands ~/path and writes to homedir when inside ALLOWED_PATHS', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined);
    // /Users/testuser falls inside the /Users allowed path set in vitest.config.js
    const result = await write_file.execute({
      path: '~/output.txt',
      content: 'hello',
    });
    expect(result).toContain('File written successfully');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('/Users/testuser/output.txt'),
      'hello',
      'utf8'
    );
  });

  it('has riskLevel "dangerous"', () => {
    expect(write_file.riskLevel).toBe('dangerous');
  });
});

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------
describe('list_directory', () => {
  it('returns formatted directory listing', async () => {
    mockReaddir.mockResolvedValueOnce([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
      { name: 'subdir',   isDirectory: () => true,  isFile: () => false },
    ]);
    mockStat.mockResolvedValueOnce({ size: 1234 });

    const result = await list_directory.execute({ path: '/Users/test' });
    expect(result).toContain('file.txt');
    expect(result).toContain('1234 bytes');
    expect(result).toContain('subdir/');
    expect(result).toContain('[dir]');
    expect(result).toContain('[file]');
  });

  it('returns empty message for an empty directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);
    const result = await list_directory.execute({ path: '/Users/test/empty' });
    expect(result).toContain('Directory is empty');
  });

  it('returns error message when fs.readdir rejects', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT: no such directory'));
    const result = await list_directory.execute({ path: '/Users/test/missing' });
    expect(result).toContain('Failed to list directory');
  });

  it('expands ~/path when listing a directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);
    await list_directory.execute({ path: '~/Documents' });
    expect(mockReaddir).toHaveBeenCalledWith(
      expect.stringContaining('/Users/testuser/Documents'),
      expect.any(Object)
    );
  });

  it('has riskLevel "safe"', () => {
    expect(list_directory.riskLevel).toBe('safe');
  });
});
