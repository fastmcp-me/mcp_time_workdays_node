#!/usr/bin/env node
"use strict";
// MCP 服务器（Node）：提供当前时间与工作日数据
// - 默认使用 Timor 年聚合接口
// - 额外支持 NateScarlet holiday-cn（GitHub Raw）作为免费备选
// 说明：正常运行时按需动态加载 MCP SDK；本地冒烟测试不需要安装 SDK。

// --------------------------- 工具函数 ---------------------------
const USER_AGENT = "mcp-workdays-node/1.1";
const DEFAULT_TIMEOUT_MS = 8000;

const pad = (n, w = 2) => String(n).padStart(w, "0");

function getNowPartsInTZ(tz) {
  // tz: 'local' 或 IANA 时区名（如 'Asia/Shanghai'）
  const useTZ = !tz || tz === "local" ? undefined : tz;
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: useTZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset", // 尽力获取偏移（如 'GMT+8'）
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  // parts: {year, month, day, hour, minute, second, timeZoneName}
  const offsetStrRaw = parts.timeZoneName || "UTC"; // 例如 'GMT+8'
  let offsetStr = "+00:00";
  const m = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(offsetStrRaw);
  if (m) {
    offsetStr = `${m[1]}${pad(m[2])}:${pad(m[3] || "00")}`;
  } else if (/GMT\+?0|UTC/.test(offsetStrRaw)) {
    offsetStr = "+00:00";
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    offset: offsetStr,
  };
}

function formatNow(parts, fmt = "%Y-%m-%d %H:%M:%S%z") {
  return fmt
    .replaceAll("%Y", String(parts.year))
    .replaceAll("%m", pad(parts.month))
    .replaceAll("%d", pad(parts.day))
    .replaceAll("%H", pad(parts.hour))
    .replaceAll("%M", pad(parts.minute))
    .replaceAll("%S", pad(parts.second))
    .replaceAll("%z", parts.offset);
}

function monthRange(year, month) {
  // 返回指定月份的天数（month: 1-12）
  const first = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month, 1));
  return Math.round((next - first) / (24 * 3600 * 1000));
}

function isoDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

// 通用 HTTP JSON 获取（fetch 优先，fallback 到 https）
async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs).unref?.();
  try {
    if (typeof fetch === "function") {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } else {
      // Fallback to https module if needed
      const https = await import("node:https");
      const { request } = https;
      const u = new URL(url);
      const opts = {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        method: "GET",
      };
      const body = await new Promise((resolve, reject) => {
        const req = request(opts, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const str = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(str);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${str.slice(0, 200)}`));
            }
          });
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy(new Error("timeout"));
        });
        req.setTimeout(timeoutMs);
        req.end();
      });
      return JSON.parse(body);
    }
  } finally {
    clearTimeout(t);
  }
}

// Timor 年聚合接口
async function timorYear(year, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `https://timor.tech/api/holiday/year/${year}`;
  return await fetchJson(url, { timeoutMs });
}

// NateScarlet holiday-cn（GitHub Raw）年数据
async function nateYear(year, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const primary = `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;
  const fallback = `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
  try {
    return await fetchJson(primary, { timeoutMs });
  } catch (_) {
    // 尝试使用 CDN 作为备选
    return await fetchJson(fallback, { timeoutMs });
  }
}

// --------------------------- MCP 服务器 ---------------------------

// 工具实现
async function handleGetCurrentTime(args) {
  const tz = args?.tz ?? "local";
  const fmt = args?.fmt ?? "%Y-%m-%d %H:%M:%S%z";
  const parts = getNowPartsInTZ(tz);
  const text = formatNow(parts, fmt);
  return { content: [{ type: "text", text }] };
}

async function handleGetWorkdaysFromApi(args) {
  const tz = args?.tz ?? "local";
  const nowParts = getNowPartsInTZ(tz);
  const year = args?.year ?? nowParts.year;
  const month = args?.month ?? nowParts.month;
  const provider = args?.provider ?? "timor";
  const timeoutMs = Math.max(1000, Math.floor((args?.timeout ?? 8.0) * 1000));
  const dim = monthRange(year, month);
  const workdays = [];
  const holidays = [];
  const makeup_workdays = [];
  let errors = 0;

  if (provider === "timor") {
    const data = await timorYear(year, { timeoutMs });
    if (!data || data.code !== 0 || !data.holiday || typeof data.holiday !== "object") {
      throw new Error("provider timor unavailable or invalid response");
    }
    const monthPrefix = `${year}-${pad(month)}-`;
    for (const key of Object.keys(data.holiday)) {
      const entry = data.holiday[key];
      if (entry && typeof entry.date === "string" && entry.date.startsWith(monthPrefix)) {
        if (entry.holiday === true) {
          holidays.push(entry.date);
        } else if (
          entry.holiday === false && typeof entry.name === "string" && entry.name.includes("补班")
        ) {
          makeup_workdays.push(entry.date);
        }
      }
    }
  } else if (provider === "nate") {
    const data = await nateYear(year, { timeoutMs });
    if (!data || !Array.isArray(data.days)) {
      throw new Error("provider nate unavailable or invalid response");
    }
    const monthPrefix = `${year}-${pad(month)}-`;
    for (const d of data.days) {
      if (!d || typeof d.date !== "string" || !d.date.startsWith(monthPrefix)) continue;
      // isOffDay = true 表示放假；为 false 表示工作日（其中周末的 false 即补班）
      if (d.isOffDay === true) {
        holidays.push(d.date);
      } else if (d.isOffDay === false) {
        const dt = new Date(d.date + "T00:00:00Z");
        const weekday = (dt.getUTCDay() + 6) % 7; // Monday=0
        if (weekday >= 5) {
          makeup_workdays.push(d.date);
        }
      }
    }
  } else {
    throw new Error(`unsupported provider: ${provider}`);
  }

  for (let d = 1; d <= dim; d++) {
    const isostr = isoDate(year, month, d);
    const weekday = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7; // Monday=0
    const isWeekend = weekday >= 5;
    if (!isWeekend && !holidays.includes(isostr)) workdays.push(isostr);
  }
  for (const d of makeup_workdays) {
    if (!workdays.includes(d)) workdays.push(d);
  }
  workdays.sort(); holidays.sort(); makeup_workdays.sort();

  const payload = {
    provider,
    year,
    month,
    workdays,
    holidays,
    makeup_workdays,
    errors,
  };
  // 始终以 text（JSON 字符串）返回，保证 MCP 客户端兼容
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

// 启动 MCP 服务器（通过 stdio）
  // 动态加载 MCP SDK 并通过 stdio 启动服务器
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  let types;
  try { types = await import("@modelcontextprotocol/sdk/types.js"); } catch { types = {}; }

  const server = new Server(
    { name: "time-and-workdays-node", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // 统一规范化工具输出为 text，避免客户端因内容类型严格校验而报错
  const ensureTextResult = (res) => {
    try {
      if (!res || !Array.isArray(res.content)) {
        return { content: [{ type: "text", text: JSON.stringify(res ?? {}) }] };
      }
      const c0 = res.content[0];
      if (!c0) return { content: [{ type: "text", text: "" }] };
      if (c0.type === "text" && typeof c0.text === "string") return res;
      if (c0.type === "json") return { content: [{ type: "text", text: JSON.stringify(c0.json) }] };
      // Fallback: stringify the whole result
      return { content: [{ type: "text", text: JSON.stringify(res) }] };
    } catch {
      return { content: [{ type: "text", text: "" }] };
    }
  };

  const wrap = (fn) => async (args) => ensureTextResult(await fn(args));

  // 工具元数据（JSON Schema）
  const toolSchemas = {
    get_current_time: {
      name: "get_current_time",
      description: "获取指定时区的当前时间（支持自定义格式）",
      inputSchema: {
        type: "object",
        properties: {
          tz: { type: "string", description: "IANA 时区名或 'local'", default: "local" },
          fmt: { type: "string", description: "时间格式（%Y-%m-%d %H:%M:%S%z）", default: "%Y-%m-%d %H:%M:%S%z" },
        },
        additionalProperties: false,
      },
    },
    get_workdays_from_api: {
      name: "get_workdays_from_api",
      description:
        "获取某月官方工作日与补班（支持 timor 与 nate 提供方）",
      inputSchema: {
        type: "object",
        properties: {
          year: { type: "integer", minimum: 1970 },
          month: { type: "integer", minimum: 1, maximum: 12 },
          tz: { type: "string", default: "local" },
          provider: { type: "string", enum: ["timor", "nate"], default: "timor" },
          timeout: { type: "number", default: 8.0 }
        },
        additionalProperties: false,
      },
    },
  };

  const toolHandlers = {
    get_current_time: wrap(handleGetCurrentTime),
    get_workdays_from_api: wrap(handleGetWorkdaysFromApi),
  };

  if (typeof server.tool === "function") {
    // 旧版 SDK：提供 server.tool 助手
    server.tool(
      toolSchemas.get_current_time.name,
      { description: toolSchemas.get_current_time.description, input_schema: toolSchemas.get_current_time.inputSchema },
      toolHandlers.get_current_time
    );
    server.tool(
      toolSchemas.get_workdays_from_api.name,
      { description: toolSchemas.get_workdays_from_api.description, input_schema: toolSchemas.get_workdays_from_api.inputSchema },
      toolHandlers.get_workdays_from_api
    );
  } else if (typeof server.setRequestHandler === "function" && types?.ListToolsRequestSchema && types?.CallToolRequestSchema) {
    // 新版 SDK：通过 setRequestHandler 显式注册 list/call 处理器
    server.setRequestHandler(types.ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: toolSchemas.get_current_time.name,
          description: toolSchemas.get_current_time.description,
          inputSchema: toolSchemas.get_current_time.inputSchema,
        },
        {
          name: toolSchemas.get_workdays_from_api.name,
          description: toolSchemas.get_workdays_from_api.description,
          inputSchema: toolSchemas.get_workdays_from_api.inputSchema,
        },
      ],
    }));

    server.setRequestHandler(types.CallToolRequestSchema, async (req) => {
      const name = req?.params?.name ?? req?.name;
      const args = req?.params?.arguments ?? req?.arguments ?? {};
      const fn = toolHandlers[name];
      if (!fn) {
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
      try {
        const res = await fn(args);
        return ensureTextResult(res);
      } catch (e) {
        return { content: [{ type: "text", text: String(e) }], isError: true };
      }
    });
  } else {
    throw new Error("MCP SDK: neither tool() nor setRequestHandler() available. Please upgrade @modelcontextprotocol/sdk.");
  }

  await server.connect(new StdioServerTransport());
