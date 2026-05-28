# Task Tools Extraction Layer

统一的任务工具提取层，用于从不同 agent 的消息中提取任务相关的工具调用。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    ExtractorRegistry                         │
│  (统一入口，管理所有 agent 的提取器)                          │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Claude     │    │    Codex     │    │     ACP      │
│  Extractor   │    │  Extractor   │    │  Extractor   │
└──────────────┘    └──────────────┘    └──────────────┘
```

## 支持的工具

### Claude Code
- `TodoWrite` - 待办事项列表（替换模式）
- `TaskCreate` - 创建新任务（合并模式）
- `TaskUpdate` - 更新任务状态（合并模式）

### Codex
- `TodoWrite` - 待办事项列表

### ACP (Anthropic Computer Protocol)
- `plan` - 计划条目

## 使用方式

### 基本用法

```typescript
import { extractTaskToolsFromMessage } from '@/sync/taskTools'

const result = extractTaskToolsFromMessage(messageContent)
if (result) {
    const { todos, source } = result
    // todos: TodoItem[]
    // source: 'TodoWrite' | 'TaskCreate' | 'TaskUpdate' | 'unknown'
}
```

### 注册自定义提取器

```typescript
import { getExtractorRegistry } from '@/sync/taskTools'
import type { AgentToolExtractor } from '@/sync/taskTools'

const customExtractor: AgentToolExtractor = {
    extractTaskTools(content) {
        // 自定义提取逻辑
        return {
            todos: [...],
            source: 'unknown'
        }
    }
}

getExtractorRegistry().register('my-agent', customExtractor)
```

## 同步模式

### Replace 模式（替换）
用于 `TodoWrite` 工具，完全替换现有的 subtasks。

```typescript
syncTaskSubTasksFromSessionTodos({
    store,
    session,
    todos,
    todosUpdatedAt,
    mode: 'replace'  // 默认值
})
```

### Merge 模式（合并）
用于 `TaskCreate`/`TaskUpdate` 工具，按 ID 合并 subtasks。

```typescript
syncTaskSubTasksFromSessionTodos({
    store,
    session,
    todos,
    todosUpdatedAt,
    mode: 'merge'
})
```

合并规则：
- 相同 ID 的任务会被更新
- 新 ID 的任务会被追加
- 不在新列表中的任务会被保留

## 工作流程

1. **消息到达** - CLI 通过 Socket.IO 发送 `append-message` 事件
2. **提取工具** - `extractTaskToolsFromMessage()` 识别工具类型
3. **更新 session** - 更新 session 的 todos 字段
4. **同步到 task** - 根据工具类型选择合并模式，更新关联 task 的 subtasks
5. **广播事件** - 通知 web 端更新 UI

## 扩展指南

### 添加新的 agent 支持

1. 创建提取器类：

```typescript
// hub/src/sync/taskTools/extractors/myagent.ts
import type { AgentToolExtractor, TaskToolResult } from '../types'

export class MyAgentToolExtractor implements AgentToolExtractor {
    extractTaskTools(content: Record<string, unknown>): TaskToolResult | null {
        if (content.type !== 'myagent') return null

        // 提取逻辑
        return {
            todos: [...],
            source: 'TodoWrite'
        }
    }
}
```

2. 注册到默认 registry：

```typescript
// hub/src/sync/taskTools/registry.ts
import { MyAgentToolExtractor } from './extractors/myagent'

constructor() {
    this.register('claude', new ClaudeToolExtractor())
    this.register('codex', new CodexToolExtractor())
    this.register('acp', new AcpToolExtractor())
    this.register('myagent', new MyAgentToolExtractor())  // 新增
}
```

3. 导出提取器：

```typescript
// hub/src/sync/taskTools/index.ts
export { MyAgentToolExtractor } from './extractors/myagent'
```

### 添加新的工具支持

在对应的提取器中添加工具识别逻辑：

```typescript
// 在 ClaudeToolExtractor 中
for (const block of modelContent) {
    if (!isObject(block) || block.type !== 'tool_use') continue

    const name = typeof block.name === 'string' ? block.name : null
    if (!name) continue

    // 添加新工具
    if (name === 'MyNewTool') {
        const result = this.extractFromMyNewTool(input)
        if (result) return result
    }
}
```

## 测试

```bash
# 运行所有 taskTools 测试
bun test src/sync/taskTools/

# 运行 taskSubtasks 测试
bun test src/sync/taskSubtasks.test.ts
```

## 相关文件

- `hub/src/sync/taskTools/` - 提取层实现
- `hub/src/sync/taskSubtasks.ts` - 同步逻辑
- `hub/src/socket/handlers/cli/sessionHandlers.ts` - 消息处理入口
- `hub/src/sync/todos.ts` - 旧的提取逻辑（已废弃，保留用于兼容）
