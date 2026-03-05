# Task Tools Sync Implementation Summary

## 问题描述

Claude Code 调用 `TaskCreate`、`TaskUpdate`、`TaskList` 等工具时，这些工具调用没有同步到 HOPI task 的 subtasks 字段。

## 根本原因

1. HOPI 原有实现只捕获 `TodoWrite` 工具
2. Claude Code 的 `TaskCreate`/`TaskUpdate` 工具是内置工具，通过不同的消息格式传递
3. 缺乏统一的提取层来处理不同 agent 的工具调用

## 解决方案

### 1. 统一提取层架构

创建了可扩展的提取器架构：

```
hub/src/sync/taskTools/
├── types.ts              # 接口定义
├── registry.ts           # 提取器注册表
├── extractors/
│   ├── claude.ts         # Claude Code 提取器
│   ├── codex.ts          # Codex 提取器
│   └── acp.ts            # ACP 提取器
├── index.ts              # 导出
├── README.md             # 文档
└── examples.ts           # 使用示例
```

### 2. 核心组件

#### AgentToolExtractor 接口
```typescript
interface AgentToolExtractor {
    extractTaskTools(content: Record<string, unknown>): TaskToolResult | null
}
```

#### ExtractorRegistry
- 管理所有 agent 的提取器
- 提供统一的提取入口
- 支持动态注册自定义提取器

#### ClaudeToolExtractor
支持以下工具：
- `TodoWrite` - 完整任务列表（替换模式）
- `TaskCreate` - 创建新任务（合并模式）
- `TaskUpdate` - 更新任务（合并模式）

### 3. 同步模式

#### Replace 模式
- 用于 `TodoWrite`
- 完全替换现有 subtasks
- 适用于提供完整任务列表的场景

#### Merge 模式
- 用于 `TaskCreate`/`TaskUpdate`
- 按 ID 合并，保留未修改的任务
- 适用于增量更新的场景

### 4. 集成点

修改了以下文件：

1. **hub/src/socket/handlers/cli/sessionHandlers.ts**
   - 使用新的 `extractTaskToolsFromMessage()` 替代 `extractTodoWriteTodosFromMessageContent()`
   - 根据工具类型选择合并模式

2. **hub/src/sync/taskSubtasks.ts**
   - 添加 `mode` 参数支持 replace/merge
   - 实现 `mergeTodos()` 函数处理增量更新

## 测试覆盖

### 单元测试
- `registry.test.ts` - 测试提取器注册和调用
- `claude.test.ts` - 测试 Claude 工具提取
- `taskSubtasks.test.ts` - 测试同步逻辑和合并模式

### 测试结果
```
✓ 15 tests passed (taskTools)
✓ 5 tests passed (taskSubtasks)
```

## 扩展性

### 添加新 agent
1. 实现 `AgentToolExtractor` 接口
2. 在 `DefaultExtractorRegistry` 中注册
3. 添加测试

### 添加新工具
1. 在对应的提取器中添加识别逻辑
2. 返回标准的 `TaskToolResult`
3. 添加测试

## 向后兼容

- 保留了原有的 `hub/src/sync/todos.ts`（标记为已废弃）
- 新代码完全兼容现有的 `TodoWrite` 工具
- 不影响现有功能

## 使用示例

```typescript
// 在 sessionHandlers.ts 中
const taskToolResult = extractTaskToolsFromMessage(content)
if (taskToolResult) {
    const { todos, source } = taskToolResult
    const mode = source === 'TodoWrite' ? 'replace' : 'merge'

    syncTaskSubTasksFromSessionTodos({
        store,
        session,
        todos,
        todosUpdatedAt: msg.createdAt,
        mode
    })
}
```

## 文件清单

### 新增文件
- `hub/src/sync/taskTools/types.ts`
- `hub/src/sync/taskTools/registry.ts`
- `hub/src/sync/taskTools/extractors/claude.ts`
- `hub/src/sync/taskTools/extractors/codex.ts`
- `hub/src/sync/taskTools/extractors/acp.ts`
- `hub/src/sync/taskTools/index.ts`
- `hub/src/sync/taskTools/README.md`
- `hub/src/sync/taskTools/examples.ts`
- `hub/src/sync/taskTools/registry.test.ts`
- `hub/src/sync/taskTools/extractors/claude.test.ts`

### 修改文件
- `hub/src/socket/handlers/cli/sessionHandlers.ts`
- `hub/src/sync/taskSubtasks.ts`
- `hub/src/sync/taskSubtasks.test.ts`

## 下一步

1. 监控生产环境中 Claude Code 的 TaskCreate/TaskUpdate 调用
2. 根据实际使用情况优化合并逻辑
3. 考虑添加更多工具支持（如 TaskList、TaskGet）
4. 完善错误处理和日志记录
