import { AcpSdkBackend } from '@/agent/backends/acp';
import { buildOpencodeEnv } from './config';
import { resolveCliWorkingDirectory } from '@/utils/workingDirectory';

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

export function createOpencodeBackend(opts: {
    cwd?: string;
}): AcpSdkBackend {
    const env = buildOpencodeEnv();
    const args = ['acp', '--cwd', opts.cwd ?? resolveCliWorkingDirectory()];

    return new AcpSdkBackend({
        command: 'opencode',
        args,
        env: filterEnv(env)
    });
}
