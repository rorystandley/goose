import { it, expect, vi } from 'vitest';
const providerChat = vi.hoisted(() => vi.fn(async () => ({ message: { role: 'assistant', content: 'done' } })));
vi.mock('../../config.js', () => ({ default: { LLM_BACKEND: 'ollama', OLLAMA_HOST: 'http://localhost:11434' } }));
vi.mock('ollama', () => ({ Ollama: class { chat(args) { return providerChat(args); } } }));
import { chat } from '../../agent/llm.js';
it('honours the mission context size without changing the interactive default', async () => {
  await chat({ model: 'test', messages: [], contextTokens: 16384 });
  expect(providerChat).toHaveBeenLastCalledWith(expect.objectContaining({ options: { num_ctx: 16384 }, think: false }));
  await chat({ model: 'test', messages: [] });
  expect(providerChat.mock.calls.at(-1)[0].options).toBeUndefined();
});
