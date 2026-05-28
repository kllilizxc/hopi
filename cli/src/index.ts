#!/usr/bin/env bun

async function main(): Promise<void> {
    const { runCli } = await import('./commands/runCli')

    await runCli()
}

void main()

export {}
