import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import config from '../config.js';

/**
 * Expand a leading `~` to the current user's home directory.
 * Node's path.resolve() does not handle tilde natively — without this,
 * a path like `~/Downloads` resolves relative to CWD instead of $HOME.
 */
function expandTilde(filePath) {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function isPathAllowed(filePath) {
  const resolved = path.resolve(expandTilde(filePath));
  return config.ALLOWED_PATHS.some(allowed =>
    resolved.startsWith(path.resolve(expandTilde(allowed)))
  );
}

export const read_file = {
  name: 'read_file',
  description: 'Read the contents of a file and return it as text. Useful for inspecting configuration files, logs, code, or any text file on the system.',
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read',
      },
    },
    required: ['path'],
  },
  execute: async ({ path: filePath }) => {
    try {
      const resolved = path.resolve(expandTilde(filePath));
      const content = await fs.readFile(resolved, 'utf8');
      if (content.length > 10000) {
        return content.slice(0, 10000) + '\n[File truncated at 10,000 characters]';
      }
      return content;
    } catch (err) {
      return `Failed to read file: ${err.message}`;
    }
  },
};

export const write_file = {
  name: 'write_file',
  description: 'Write content to a file on the filesystem. This will create the file if it does not exist, or overwrite it if it does. Only paths within allowed directories are permitted.',
  riskLevel: 'dangerous',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to write to',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  execute: async ({ path: filePath, content }) => {
    try {
      if (!isPathAllowed(filePath)) {
        return `Access denied: path is outside allowed directories (${config.ALLOWED_PATHS.join(', ')})`;
      }
      const resolved = path.resolve(expandTilde(filePath));
      await fs.writeFile(resolved, content, 'utf8');
      return `File written successfully: ${resolved}`;
    } catch (err) {
      return `Failed to write file: ${err.message}`;
    }
  },
};

export const list_directory = {
  name: 'list_directory',
  description: 'List the contents of a directory, showing file names, types (file or directory), and sizes.',
  riskLevel: 'safe',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list',
      },
    },
    required: ['path'],
  },
  execute: async ({ path: dirPath }) => {
    try {
      const resolved = path.resolve(expandTilde(dirPath));
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (!entries.length) return `Directory is empty: ${resolved}`;

      const lines = [`Contents of ${resolved}:`];
      for (const entry of entries) {
        const type = entry.isDirectory() ? 'dir' : 'file';
        if (entry.isFile()) {
          const stat = await fs.stat(path.join(resolved, entry.name)).catch(() => null);
          const size = stat ? `${stat.size} bytes` : 'unknown size';
          lines.push(`  [${type}] ${entry.name} (${size})`);
        } else {
          lines.push(`  [${type}] ${entry.name}/`);
        }
      }
      return lines.join('\n');
    } catch (err) {
      return `Failed to list directory: ${err.message}`;
    }
  },
};
