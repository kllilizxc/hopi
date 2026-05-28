declare module 'bun:bundle' {
    interface Registry {
        features:
            | 'HOPI_TARGET_DARWIN_ARM64'
            | 'HOPI_TARGET_DARWIN_X64'
            | 'HOPI_TARGET_LINUX_ARM64'
            | 'HOPI_TARGET_LINUX_X64'
            | 'HOPI_TARGET_WIN32_X64';
    }

    export function feature(name: Registry['features']): boolean;
}
