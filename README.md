# MCP Time & Workdays (Node)

提供一个基于 Model Context Protocol (MCP) 的 Node 服务器：
- 获取指定时区的当前时间（可自定义格式）
- 获取某年某月的官方工作日、假期与补班（多数据源）

默认在线数据源为 Timor 年聚合接口，额外支持 NateScarlet holiday-cn（GitHub Raw）作为免费备选，无需 API Key。

---

## 特性
- 在线数据源（免费）：
  - Timor 年聚合接口（默认）
  - NateScarlet holiday-cn（GitHub Raw，内置 CDN 兜底）
- 统一输出：工作日(`workdays`)、假期(`holidays`)、补班(`makeup_workdays`)
- 工具输出统一封装为 MCP `text` 内容，兼容严格客户端
- Node 18+ 原生运行，无需额外依赖（除 MCP SDK）




## 环境与安装
- 要求：Node.js >= 18.17

### 方式一：NPX（推荐）
```bash
# 全局安装
npm install -g mcp-time-workdays-node

# 或直接使用 npx
npx mcp-time-workdays-node
```

### 方式二：本地开发
```bash
# 克隆项目
git clone https://github.com/tanranv5/mcp_time_workdays_node.git
cd mcp-time-workdays-node

# 安装依赖
npm install

# 运行服务器
node mcp_time_workdays_node.mjs
# 或
npm start
```

> 提示：本项目 `package.json` 已设定 `type: module` 与最小依赖 `@modelcontextprotocol/sdk`。

## MCP 工具
服务器启动后会通过 stdio 暴露以下工具：

1) `get_current_time`
- 输入：
  - `tz`：IANA 时区名或 `local`（默认 `local`）
  - `fmt`：时间格式，默认`%Y-%m-%d %H:%M:%S%z`
- 输出：`text`（字符串）
- 示例输出：`2025-09-10 10:30:45+08:00`

2) `get_workdays_from_api`
- 输入：
  - `year`：整数（默认当前年）
  - `month`：1-12（默认当前月）
  - `tz`：`local` 或 IANA 时区名（默认 `local`，仅用于获取“当前年月”）
  - `provider`：`timor`（默认）或 `nate`
  - `timeout`：超时秒数（默认 `8.0`）
- 输出：`text`（JSON 字符串）：
  - `provider, year, month, workdays[], holidays[], makeup_workdays[]`
- 逻辑：
  - 工作日 = “当月所有周一至周五 - 官方假期 + 官方补班周末”

### 例：手动调用（模拟 MCP 客户端逻辑）
以下展示从命令行模拟调用的方式（仅示例）：
```bash
# 获取 2025-10 月（Timor）
node -e "(async()=>{const s=await import('./mcp_time_workdays_node.mjs');})();" \
| echo '{"method":"tools/call","params":{"name":"get_workdays_from_api","arguments":{"year":2025,"month":10,"provider":"timor"}}}'
```

> 实际使用中，请让 MCP 兼容的客户端（如 Claude Desktop）通过 stdio 连接。

## 客户端配置示例（Claude Desktop）

### NPX 方式（推荐）
在 `claude_desktop_config.json`（或等效位置）中添加：
```json
{
  "mcpServers": {
    "time-and-workdays-node": {
      "command": "npx",
      "args": ["mcp-time-workdays-node"],
      "env": {}
    }
  }
}
```

### 本地开发方式
```json
{
  "mcpServers": {
    "time-and-workdays-node": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_time_workdays_node.mjs"],
      "env": {}
    }
  }
}
```

## 数据源说明
- `timor`（默认）：
  - 年聚合接口：`https://timor.tech/api/holiday/year/{year}`
  - 响应字段包含 `holiday` 映射：`{ 'MM-DD': { date, holiday, name, ... } }`
  - 使用方式：从映射中过滤当月项；`holiday=true` 视为放假；`holiday=false` 且 `name` 包含“补班”视为补班

- `nate`：
  - 年文件（GitHub Raw）：`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json`
  - 内置 CDN 兜底：`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json`
  - `days[]` 内 `isOffDay=true` 为放假；`isOffDay=false` 若对应周末则视为补班

> 备注：不推荐用于“补班”判断的数据源（例如 Nager.Date）未内置。


## 常见问题
- 输出是 `text`：为提升 MCP 客户端兼容性，本服务统一返回 `text` 类型内容（JSON 字符串或纯文本）。
- 时区参数 `tz`：仅影响“默认年月”的判定，不影响工作日计算（工作日按本地/官方规则计算）。
- 超时 `timeout`：单位秒。网络波动时可适当增大。

## 致谢
- Timor 年聚合接口：https://timor.tech/
- NateScarlet holiday-cn：https://github.com/NateScarlet/holiday-cn
- Model Context Protocol：https://github.com/modelcontextprotocol

---

如需把 CLI 也加入 `npm bin` 或增加更多数据源（例如带 Key 的商业 API），欢迎提 Issue/PR。

