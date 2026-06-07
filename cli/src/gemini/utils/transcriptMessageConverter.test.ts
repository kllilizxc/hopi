import { describe, expect, it } from 'vitest';
import { convertGeminiTranscriptMessage } from './transcriptMessageConverter';

describe('convertGeminiTranscriptMessage', () => {
    it('keeps plain user transcript messages as user messages', () => {
        expect(convertGeminiTranscriptMessage({
            type: 'user',
            content: 'please continue'
        })).toEqual({
            kind: 'user',
            text: 'please continue'
        });
    });

    it('keeps plain gemini transcript messages as codex text messages', () => {
        expect(convertGeminiTranscriptMessage({
            type: 'gemini',
            content: 'working on it'
        })).toEqual({
            kind: 'codex',
            message: {
                type: 'message',
                message: 'working on it'
            }
        });
    });

    it('converts top-level structured tool calls into codex tool-call messages', () => {
        expect(convertGeminiTranscriptMessage({
            type: 'tool_call',
            id: 'call-1',
            name: 'write_file',
            input: { path: 'src/app.ts', text: 'hello' },
            status: 'completed'
        })).toEqual({
            kind: 'codex',
            message: {
                type: 'tool-call',
                callId: 'call-1',
                name: 'write_file',
                input: { path: 'src/app.ts', text: 'hello' },
                status: 'completed'
            }
        });
    });

    it('converts nested structured tool results from gemini transcript messages', () => {
        expect(convertGeminiTranscriptMessage({
            type: 'gemini',
            content: {
                type: 'tool_result',
                id: 'call-2',
                output: { ok: true },
                status: 'completed'
            }
        })).toEqual({
            kind: 'codex',
            message: {
                type: 'tool-call-result',
                callId: 'call-2',
                output: { ok: true },
                is_error: false
            }
        });
    });
});
