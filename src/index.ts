#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const VERSION = "2.1.2";
const REPO = "contentsnare/mcp";
const PLUGIN_NAME = "content-snare-mcp";
const API_ORIGIN = (process.env.CONTENTSNARE_API_URL || "https://api.contentsnare.com").replace(/\/+$/, "");
const BASE_URL = `${API_ORIGIN}/partner_api/v1`;
const TOKENS_PAGE = "https://app.contentsnare.com/settings/security/access-tokens";
const CONFIG_DIR = path.join(os.homedir(), ".contentsnare");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const TOKEN_PREFIX = "cs_pat_";

// ---------------------------------------------------------------------------
// Permissions: API scope -> label on the Personal Access Tokens page
// ---------------------------------------------------------------------------

type Scope =
  | "read_clients"
  | "write_clients"
  | "read_team_members"
  | "write_team_members"
  | "read_requests"
  | "write_requests"
  | "review_requests"
  | "read_templates"
  | "administration";

const PERMISSION_LABELS: Record<Scope, string> = {
  read_clients: "Read clients",
  write_clients: "Manage clients",
  read_team_members: "Read team members",
  write_team_members: "Manage team members",
  read_requests: "Read requests",
  write_requests: "Manage requests and supported templates",
  review_requests: "Review request answers",
  read_templates: "Read templates",
  administration: "Manage webhooks",
};

function labelsFor(scopes: string[]): string {
  return scopes
    .map((s) => (s in PERMISSION_LABELS ? `"${PERMISSION_LABELS[s as Scope]}"` : s))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Token resolution: CONTENTSNARE_API_TOKEN env var, then ~/.contentsnare/config.json
// ---------------------------------------------------------------------------

type TokenSource = "plugin" | "desktop" | "env" | "file";

function runningAsClaudeCodePlugin(): boolean {
  return Boolean(process.env.CLAUDE_PLUGIN_ROOT);
}

// Set by mcpb/manifest.json
function runningAsClaudeDesktopExtension(): boolean {
  return process.env.CONTENTSNARE_MCP_HOST === "claude-desktop";
}

// Claude Desktop on Windows has passed sensitive values through still encrypted
function envTokenIsEncrypted(): boolean {
  return Boolean(process.env.CONTENTSNARE_API_TOKEN?.trim().startsWith("__encrypted__"));
}

const ENCRYPTED_TOKEN_MESSAGE =
  "Claude Desktop passed the Content Snare access token to the server still encrypted, which is a known " +
  "Claude Desktop bug. Ask the user to update Claude Desktop to the latest version, then turn the Content Snare " +
  "extension off and on again under Settings > Extensions.";

function readEnvToken(): string | undefined {
  const value = process.env.CONTENTSNARE_API_TOKEN?.trim();
  // An unset ${user_config.api_token} or ${VAR} can arrive as literal text
  if (!value || value.includes("${") || envTokenIsEncrypted()) return undefined;
  return value;
}

function readFileToken(): string | undefined {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as { api_token?: unknown };
    return typeof config.api_token === "string" && config.api_token.trim()
      ? config.api_token.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

// Read on every call, so a token saved by `setup` works without restarting the server
function resolveToken(): { token: string; source: TokenSource } | null {
  const envToken = readEnvToken();
  if (envToken) {
    const source = runningAsClaudeCodePlugin() ? "plugin" : runningAsClaudeDesktopExtension() ? "desktop" : "env";
    return { token: envToken, source };
  }
  const fileToken = readFileToken();
  if (fileToken) return { token: fileToken, source: "file" };
  return null;
}

function describeSource(source: TokenSource): string {
  switch (source) {
    case "plugin":
      return "Claude Code plugin settings (system credential store)";
    case "desktop":
      return "Claude Desktop extension settings (system keychain)";
    case "env":
      return "CONTENTSNARE_API_TOKEN environment variable";
    case "file":
      return CONFIG_FILE;
  }
}

function saveTokenFile(token: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ api_token: token }, null, 2) + "\n", { mode: 0o600 });
  // writeFileSync only applies the mode when it creates the file
  fs.chmodSync(CONFIG_FILE, 0o600);
}

// ---------------------------------------------------------------------------
// Setup walkthrough (returned to the AI client so it can guide the user)
// ---------------------------------------------------------------------------

function setupCommand(): string {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (!script || /[\\/]_npx[\\/]/.test(script)) return `npx -y github:${REPO} setup`;
  return `node "${script.replace(/\\/g, "/")}" setup`;
}

function saveTokenStep(): string {
  if (runningAsClaudeCodePlugin()) {
    return (
      `In Claude Code, run /plugin configure ${PLUGIN_NAME}@${PLUGIN_NAME} (or run /plugin, open the ` +
      `Installed tab, select ${PLUGIN_NAME} and choose "Configure options"). Paste the token into the ` +
      `masked field there, not into the chat. Claude Code keeps it in the system credential store. ` +
      `Then run /reload-plugins.\n\n` +
      `   If those commands aren't available (for example in the Claude desktop app), open a terminal ` +
      `window instead and run:\n\n    ${setupCommand()}\n\n` +
      `   Paste the token when it asks. Nothing shows on screen as it's pasted. It saves the token to ` +
      `${CONFIG_FILE}, which the plugin also reads, so no restart is needed.`
    );
  }
  if (runningAsClaudeDesktopExtension()) {
    return (
      `In Claude Desktop, open Settings, then Extensions, find Content Snare and open its settings (Configure). ` +
      `Paste the token into the "Content Snare personal access token" field there, not into this chat, and save. ` +
      `Claude Desktop keeps it in the system keychain. If the tools still say it isn't connected, turn the ` +
      `extension off and on again.`
    );
  }
  return (
    `Open a separate terminal window (not this chat) and run:\n\n    ${setupCommand()}\n\n` +
    `   Paste the token when it asks. Nothing shows on screen as it's pasted. The command checks the ` +
    `token with Content Snare and saves it to ${CONFIG_FILE}. No restart is needed.`
  );
}

function getTokenSteps(): string {
  return [
    `1. Open ${TOKENS_PAGE} (in Content Snare: Settings, then Security, then Personal Access Tokens).`,
    `2. Click "Generate access token".`,
    `3. Name it something recognisable, such as "Claude MCP".`,
    `4. Choose when it expires. Admins can pick 30 days to 2 years. Editors always get 90 days.`,
    `5. Tick the permissions for what they want to do. "Manage" permissions don't include read access, so tick the matching "Read" ones too. For full use of this server: ` +
      `"Read clients", "Manage clients", "Read requests", "Manage requests and supported templates", ` +
      `"Review request answers" and "Read templates". "Read team members", "Manage team members" and ` +
      `"Manage webhooks" are only needed for team and webhook tools, and the last two are admin-only.`,
    `6. Confirm with their Content Snare password (and authenticator code if 2FA is on), then click "Generate access token".`,
    `7. Copy the token. It starts with ${TOKEN_PREFIX} and is only shown once.`,
    `8. ${saveTokenStep()}`,
    `9. Then call check_connection to confirm it worked.`,
  ].join("\n");
}

const DO_NOT_PASTE =
  "Never ask the user to paste the token into this chat, and don't offer to save it for them. " +
  "If they paste it into the chat anyway, tell them to revoke it on the Personal Access Tokens page " +
  "and generate a new one, because the chat keeps a copy.";

const ACCESS_NOTES =
  "If there's no Personal Access Tokens item in Settings, or Generate access token is unavailable: " +
  "only admins can create tokens unless an admin allows editors to, and reviewers and viewers can't. " +
  "API access also depends on the Content Snare plan. For help, contact support@contentsnare.com.";

function notConnectedMessage(): string {
  return [
    "Content Snare isn't connected yet. Walk the user through these steps.",
    DO_NOT_PASTE,
    "",
    getTokenSteps(),
    "",
    ACCESS_NOTES,
  ].join("\n");
}

function reconnectMessage(reason: string): string {
  return [
    reason,
    "",
    `Ask the user to open ${TOKENS_PAGE}. If the token is listed as expired, they can use "Rotate token" ` +
      `to get a replacement. Otherwise they can generate a new one. Then save it:`,
    saveTokenStep(),
    "",
    DO_NOT_PASTE,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

class ToolError extends Error {}

type Query = Record<string, string | string[] | number | boolean | undefined>;

function errorText(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 2000);
  if (data && typeof data === "object") {
    const d = data as { errors?: unknown; error?: unknown; message?: unknown };
    if (Array.isArray(d.errors)) return d.errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("; ");
    if (typeof d.error === "string") return d.error;
    if (typeof d.message === "string") return d.message;
  }
  return JSON.stringify(data);
}

function describeApiError(status: number, data: unknown, scopes: Scope[], retryAfter: string | null): string {
  const detail = errorText(data);
  if (status === 401) {
    return reconnectMessage(
      `Content Snare rejected the access token (HTTP 401: ${detail}). It has probably expired, been revoked, or was copied incompletely.`
    );
  }
  if (status === 403 && /partner api is disabled/i.test(detail)) {
    return (
      "API access isn't available on this Content Snare account (HTTP 403: Partner API is disabled). " +
      "It depends on the plan. The user can contact support@contentsnare.com to ask about it."
    );
  }
  if (status === 403) {
    const needs = scopes.length
      ? ` This tool needs the ${labelsFor(scopes)} permission on the token. The user can add it on ${TOKENS_PAGE} ` +
        `by editing the token's permissions (Content Snare asks for their password again).`
      : "";
    return (
      `Content Snare refused this action (HTTP 403: ${detail}).${needs} ` +
      `Their role in Content Snare can also limit what a token can do.`
    );
  }
  if (status === 429) {
    return `Content Snare's rate limit was hit (HTTP 429). Retry after ${retryAfter ?? "a few"} seconds.`;
  }
  return `Content Snare API error (HTTP ${status}): ${detail}`;
}

async function api(
  method: string,
  apiPath: string,
  options: { body?: unknown; query?: Query; scopes?: Scope[]; token?: string } = {}
): Promise<unknown> {
  const token = options.token ?? resolveToken()?.token;
  if (!token) throw new ToolError(envTokenIsEncrypted() ? ENCRYPTED_TOKEN_MESSAGE : notConnectedMessage());

  const url = new URL(`${BASE_URL}${apiPath}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
    else url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": `contentsnare-mcp/${VERSION}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new ToolError(`Couldn't reach Content Snare at ${API_ORIGIN}: ${(err as Error).message}`);
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new ToolError(describeApiError(res.status, data, options.scopes ?? [], res.headers.get("retry-after")));
  }
  return data;
}

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

const PaginationParams = {
  limit: z.number().int().optional().describe("Maximum number of items to return (default 200)"),
  offset: z.number().int().optional().describe("Number of items to skip from the beginning"),
};

const SortParams = {
  sort_by: z.string().optional().describe("Field to sort by"),
  sort_direction: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

const SearchParams = {
  q: z.string().optional().describe("Search query string"),
  q_by: z.array(z.string()).optional().describe("Fields to search in (e.g. ['email', 'full_name'])"),
};

function listQuery(params: {
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_direction?: string;
  q?: string;
  q_by?: string[];
}): Query {
  return {
    limit: params.limit,
    offset: params.offset,
    sort_by: params.sort_by,
    sort_direction: params.sort_direction,
    q: params.q,
    "q_by[]": params.q_by,
  };
}

// Inline-field schemas for create_request_with_fields (pages_data)
const ConditionOperator = z.enum([
  "contains",
  "equals",
  "does not equal",
  "less than",
  "greater than",
  "is empty",
  "has a value",
]);

const Condition = z.object({
  question_number: z
    .number()
    .int()
    .describe("question_number of the question to check. Must be on the same page as this question"),
  condition: ConditionOperator.describe("Comparison operator"),
  value: z
    .string()
    .default("")
    .describe(
      "Value to compare against. For choice questions with equals or does not equal, it must exactly match " +
        "one of that question's options (case-sensitive). Use an empty string for 'is empty' and 'has a value'"
    ),
});

const ConditionGroup = z.object({
  conditions: z.array(Condition).min(1).describe("One or more conditions"),
  logical_operator: z
    .enum(["and", "or"])
    .default("and")
    .describe("'and' = all conditions must match, 'or' = any. Content Snare requires it even for one condition, so it defaults to 'and'"),
});

const QuestionDataType = z.enum([
  "single-line",
  "text",
  "multi-line text",
  "formatted text",
  "email",
  "url",
  "address",
  "country select",
  "single image upload",
  "multiple image upload",
  "single file upload",
  "multiple file upload",
  "signature",
  "phone",
  "number",
  "currency",
  "date/time",
  "numeric rating",
  "star rating",
  "single select option",
  "multi select options",
  "dropdown",
  "task list",
  "table",
  "date range",
  "button",
  "icon",
  "color picker",
]);

const OPTION_TYPES = new Set(["single select option", "multi select options", "dropdown", "task list"]);

const Question = z.object({
  question: z.string().describe("The question text"),
  data_type: QuestionDataType.describe("Field type"),
  question_number: z.number().int().describe("Unique across the whole request. Start at 1 and count up"),
  options: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Option strings. Required for: single select option, multi select options, dropdown, task list"),
  columns: z.array(z.string()).nullable().optional().describe("Column headers. Required for: table"),
  instructions: z.string().nullable().optional().describe("Guidance on how to answer the question"),
  show_when: ConditionGroup.optional().describe(
    "Hide this question until the conditions match. Conditions can only refer to questions on the same page"
  ),
  hide_when: ConditionGroup.optional().describe(
    "Hide this question when the conditions match. Use show_when or hide_when, not both"
  ),
});

const SectionData = z.object({
  name: z.string().describe("Section name"),
  questions_data: z.array(Question).describe("Questions in this section"),
});

const PageData = z.object({
  name: z.string().describe("Page name"),
  sections_data: z.array(SectionData).describe("Sections in this page"),
});

type PageDataInput = z.infer<typeof PageData>;

// Content Snare silently drops conditions it can't resolve, so catch them before sending
function checkPagesData(pages: PageDataInput[]): string[] {
  const problems: string[] = [];
  const questions = new Map<number, { page: number; data_type: string; options: string[] }>();

  pages.forEach((page, pageIndex) =>
    page.sections_data.forEach((section) =>
      section.questions_data.forEach((q) => {
        if (questions.has(q.question_number)) {
          problems.push(`question_number ${q.question_number} is used more than once. Each must be unique across the whole request.`);
        } else {
          questions.set(q.question_number, { page: pageIndex, data_type: q.data_type, options: q.options ?? [] });
        }
        if (OPTION_TYPES.has(q.data_type) && !q.options?.length) {
          problems.push(`Question ${q.question_number} is a ${q.data_type} and needs an options array.`);
        }
        if (q.data_type === "table" && !q.columns?.length) {
          problems.push(`Question ${q.question_number} is a table and needs a columns array.`);
        }
      })
    )
  );

  pages.forEach((page, pageIndex) =>
    page.sections_data.forEach((section) =>
      section.questions_data.forEach((q) => {
        if (q.show_when && q.hide_when) {
          problems.push(`Question ${q.question_number} has both show_when and hide_when. Use one.`);
        }
        for (const c of (q.show_when ?? q.hide_when)?.conditions ?? []) {
          const target = questions.get(c.question_number);
          if (c.question_number === q.question_number) {
            problems.push(`Question ${q.question_number} has a condition on itself.`);
          } else if (!target) {
            problems.push(`Question ${q.question_number} has a condition on question ${c.question_number}, which doesn't exist.`);
          } else if (target.page !== pageIndex) {
            problems.push(
              `Question ${q.question_number} (page "${page.name}") has a condition on question ${c.question_number} ` +
                `(page "${pages[target.page].name}"). Conditions only work between questions on the same page, ` +
                `so move one of them.`
            );
          } else if (
            OPTION_TYPES.has(target.data_type) &&
            (c.condition === "equals" || c.condition === "does not equal") &&
            !target.options.includes(c.value)
          ) {
            problems.push(
              `Question ${q.question_number} checks question ${c.question_number} ${c.condition} "${c.value}", ` +
                `but that isn't one of its options (${target.options.map((o) => `"${o}"`).join(", ")}). ` +
                `Matching is exact and case-sensitive.`
            );
          }
        }
      })
    )
  );

  return problems;
}

// ---------------------------------------------------------------------------
// Tool registration helper
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function textResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return textResult(await fn());
  } catch (err) {
    if (err instanceof ToolError) return errorResult(err.message);
    return errorResult(`Unexpected error: ${(err as Error).message}`);
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

// ---------------------------------------------------------------------------
// CLI: `setup` saves a token, anything else starts the MCP server
// ---------------------------------------------------------------------------

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Piped input, e.g. from a password manager CLI
    return new Promise((resolve, reject) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data));
      stdin.on("error", reject);
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let input = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(input);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") input = input.slice(0, -1);
        else input += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function runSetup(): Promise<void> {
  console.log("\nContent Snare MCP setup\n");
  console.log("You need a personal access token from Content Snare. To create one:");
  console.log(`  1. Open ${TOKENS_PAGE}`);
  console.log('  2. Click "Generate access token", name it, tick the permissions you need, and confirm');
  console.log(`  3. Copy the token (it starts with ${TOKEN_PREFIX} and is only shown once)\n`);

  const raw = await readHidden("Paste the token here and press Enter (nothing will show as you paste): ");
  const token = raw
    .replace(/\x1b\[[0-9;]*[~A-Za-z]/g, "")
    .replace(/[\x00-\x1f\x7f\s]/g, "");

  if (!token) throw new Error("No token entered. Nothing was saved.");
  if (!token.startsWith(TOKEN_PREFIX)) {
    console.log(`\nThat doesn't start with ${TOKEN_PREFIX}, so it may not be a personal access token. Checking it anyway.`);
  }

  console.log("\nChecking the token with Content Snare...");
  let me: { full_name?: string; scopes?: string[]; expires_at?: string | null };
  try {
    me = (await api("GET", "/me", { token })) as typeof me;
  } catch (err) {
    const message = err instanceof ToolError && /HTTP 401/.test(err.message)
      ? "Content Snare rejected that token. Check you copied all of it, or generate a new one."
      : (err as Error).message.split("\n")[0];
    throw new Error(`${message}\nNothing was saved.`);
  }

  saveTokenFile(token);

  console.log(`\nConnected as ${me.full_name ?? "unknown user"}.`);
  if (me.scopes?.length) console.log(`Permissions: ${labelsFor(me.scopes)}`);
  if (me.expires_at) console.log(`Expires: ${new Date(me.expires_at).toLocaleDateString()}`);
  console.log(`Saved to ${CONFIG_FILE}`);
  if (readEnvToken()) {
    console.log("\nNote: CONTENTSNARE_API_TOKEN is set in this environment and takes priority over the saved file.");
  }
  console.log("\nYou can go back to your AI client now. No restart needed.\n");
}

const args = process.argv.slice(2);

if (args[0] === "setup") {
  runSetup()
    .then(() => process.exit(0))
    .catch((err: Error) => {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    });
} else if (args[0] === "--version" || args[0] === "-v") {
  console.log(VERSION);
} else if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(
    [
      `contentsnare-mcp ${VERSION}`,
      "",
      "Usage:",
      "  contentsnare-mcp          Start the MCP server (stdio). Your MCP client runs this.",
      "  contentsnare-mcp setup    Save a Content Snare personal access token for the server to use.",
      "",
      `Token lookup order: CONTENTSNARE_API_TOKEN environment variable, then ${CONFIG_FILE}`,
      `Docs: https://github.com/${REPO}`,
    ].join("\n")
  );
} else {
  startServer();
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

function startServer() {
  const server = new McpServer(
    { name: "contentsnare", version: VERSION },
    {
      instructions:
        "Tools for the Content Snare API: clients, requests, pages, templates, team members and webhooks. " +
        "If a tool says Content Snare isn't connected, or the user asks how to set it up, call check_connection " +
        "and walk the user through the steps it returns. Never ask the user to paste their access token into the chat. " +
        "In create_request_with_fields, conditions only work between questions on the same page.",
    }
  );

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  server.registerTool(
    "check_connection",
    {
      description:
        "Check whether Content Snare is connected, and if so who the token belongs to, its permissions and when it expires. " +
        "If it isn't connected, returns step-by-step setup instructions to walk the user through.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const resolved = resolveToken();
      if (!resolved) return textResult(envTokenIsEncrypted() ? ENCRYPTED_TOKEN_MESSAGE : notConnectedMessage());
      return runTool(async () => {
        const me = (await api("GET", "/me", { token: resolved.token })) as {
          full_name?: string;
          credential_type?: string;
          scopes?: string[];
          expires_at?: string | null;
        };
        return {
          connected: true,
          user: me.full_name,
          credential_type: me.credential_type,
          permissions: (me.scopes ?? []).map((s) => PERMISSION_LABELS[s as Scope] ?? s),
          scopes: me.scopes,
          expires_at: me.expires_at,
          token_source: describeSource(resolved.source),
        };
      });
    }
  );

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_clients",
    {
      description: "List active clients. Permission: Read clients",
      inputSchema: {
        ...PaginationParams,
        ...SortParams,
        ...SearchParams,
        include_external: z.boolean().optional().describe("Include clients from external sources/integrations"),
      },
      annotations: READ_ONLY,
    },
    (params) =>
      runTool(() =>
        api("GET", "/clients", {
          query: { ...listQuery(params), include_external: params.include_external },
          scopes: ["read_clients"],
        })
      )
  );

  server.registerTool(
    "get_client",
    {
      description: "Get a client by ID. Permission: Read clients",
      inputSchema: { id: z.string().describe("Client ID") },
      annotations: READ_ONLY,
    },
    ({ id }) => runTool(() => api("GET", `/clients/${id}`, { scopes: ["read_clients"] }))
  );

  const ClientFields = {
    phone: z.string().optional().describe("Phone number"),
    language_code: z.enum(["en", "en-gb", "es", "fr", "de", "nl", "pt-br"]).optional().describe("Language code"),
    client_companies: z
      .array(z.object({ name: z.string().describe("Company name") }))
      .optional()
      .describe("Companies to associate with the client"),
  };

  server.registerTool(
    "create_client",
    {
      description: "Create a new client. Permission: Manage clients",
      inputSchema: {
        email: z.string().describe("Client email address"),
        full_name: z.string().describe("Client full name"),
        ...ClientFields,
      },
      annotations: WRITE,
    },
    (params) => runTool(() => api("POST", "/clients", { body: params, scopes: ["write_clients"] }))
  );

  server.registerTool(
    "update_client",
    {
      description: "Update an existing client. Permission: Manage clients",
      inputSchema: {
        id: z.string().describe("Client ID"),
        email: z.string().optional().describe("Client email address"),
        full_name: z.string().optional().describe("Client full name"),
        ...ClientFields,
      },
      annotations: WRITE,
    },
    ({ id, ...body }) => runTool(() => api("PUT", `/clients/${id}`, { body, scopes: ["write_clients"] }))
  );

  server.registerTool(
    "delete_client",
    {
      description: "Delete a client. Permission: Manage clients",
      inputSchema: { id: z.string().describe("Client ID") },
      annotations: DESTRUCTIVE,
    },
    ({ id }) =>
      runTool(async () => {
        await api("DELETE", `/clients/${id}`, { scopes: ["write_clients"] });
        return "Client deleted.";
      })
  );

  server.registerTool(
    "list_client_companies",
    {
      description: "List client companies. Permission: Read clients",
      inputSchema: { ...PaginationParams, ...SortParams, ...SearchParams },
      annotations: READ_ONLY,
    },
    (params) => runTool(() => api("GET", "/client_companies", { query: listQuery(params), scopes: ["read_clients"] }))
  );

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_requests",
    {
      description: "List requests. Permission: Read requests",
      inputSchema: {
        ...PaginationParams,
        ...SortParams,
        ...SearchParams,
        filter_statuses: z
          .array(z.enum(["published", "waiting", "scheduled", "draft", "completed", "archived"]))
          .optional()
          .describe("Filter by request statuses"),
        expand: z
          .array(z.enum(["request_template_name", "owner_email", "owner_name", "clients"]))
          .optional()
          .describe("Include additional data in response"),
      },
      annotations: READ_ONLY,
    },
    (params) =>
      runTool(() =>
        api("GET", "/requests", {
          query: {
            ...listQuery(params),
            "filter_by[statuses][]": params.filter_statuses,
            "expand[]": params.expand,
          },
          scopes: ["read_requests"],
        })
      )
  );

  server.registerTool(
    "get_request",
    {
      description: "Get a request by ID, including its pages. Permission: Read requests",
      inputSchema: { id: z.string().describe("Request ID") },
      annotations: READ_ONLY,
    },
    ({ id }) => runTool(() => api("GET", `/requests/${id}`, { scopes: ["read_requests"] }))
  );

  const RequestSettings = {
    due: z.string().optional().describe("Due date in yyyy-mm-dd format (default: 14 days)"),
    status: z.enum(["published", "draft"]).optional().describe("Request status (default: draft)"),
    folder_id: z.string().optional().describe("Folder ID to group the request in"),
    folder_name: z.string().optional().describe("Folder name to group the request in"),
    owner_id: z.string().optional().describe("Request owner (team member) ID"),
    owner_email: z.string().optional().describe("Request owner (team member) email"),
    communication_template_id: z.string().optional().describe("Communications schedule ID"),
    communication_template_name: z.string().optional().describe("Communications schedule name"),
    comments_enabled: z.boolean().optional().describe("Enable client comments"),
    passcode_enabled: z.boolean().optional().describe("Require client to set a pin code"),
    share_via_link_enabled: z.boolean().optional().describe("Allow sharing via link without login"),
    expires_after_due: z.boolean().optional().describe("Close the request to the client after the due date"),
  };

  const RequestClient = {
    client_id: z.string().optional().describe("ID of an existing client. Use this or client_email"),
    client_email: z
      .string()
      .optional()
      .describe("Client email. Finds the existing client or creates a new one. Use this or client_id"),
    client_full_name: z
      .string()
      .optional()
      .describe("Required for new clients. Providing a value overwrites the existing name"),
    client_phone: z.string().optional().describe("Client phone. Providing a value overwrites the existing phone"),
    company_name: z
      .string()
      .optional()
      .describe("Company name. Created if it isn't already associated with the client"),
  };

  server.registerTool(
    "create_request",
    {
      description:
        "Create a new request from a request template. " +
        "Permission: Manage requests and supported templates, plus Manage clients if the client is new",
      inputSchema: {
        name: z.string().describe("Request name"),
        ...RequestClient,
        request_template_id: z.string().optional().describe("Request template ID (this or request_template_name)"),
        request_template_name: z.string().optional().describe("Request template name (this or request_template_id)"),
        ...RequestSettings,
      },
      annotations: WRITE,
    },
    (params) =>
      runTool(async () => {
        if (!params.client_id && !params.client_email) throw new ToolError("Provide client_id or client_email.");
        return api("POST", "/requests", { body: params, scopes: ["write_requests", "write_clients"] });
      })
  );

  server.registerTool(
    "create_request_with_fields",
    {
      description:
        "Create a request with its pages, sections and questions defined inline (no template needed). " +
        "Conditional logic (show_when / hide_when) only works between questions on the same page. " +
        "For choice questions, condition values must exactly match an option. " +
        "Permission: Manage requests and supported templates, plus Manage clients if the client is new",
      inputSchema: {
        name: z.string().describe("Request name"),
        ...RequestClient,
        ...RequestSettings,
        pages_data: z
          .array(PageData)
          .min(1)
          .describe(
            "Pages, each containing sections of questions. For option types (single select option, multi select options, " +
              "dropdown, task list) provide 'options'. For table provide 'columns'."
          ),
      },
      annotations: WRITE,
    },
    (params) =>
      runTool(async () => {
        if (!params.client_id && !params.client_email) throw new ToolError("Provide client_id or client_email.");
        const problems = checkPagesData(params.pages_data);
        if (problems.length) {
          throw new ToolError(
            "Nothing was created. Content Snare would reject or silently ignore parts of this request:\n- " +
              problems.join("\n- ")
          );
        }
        return api("POST", "/requests", { body: params, scopes: ["write_requests", "write_clients"] });
      })
  );

  server.registerTool(
    "update_request",
    {
      description: "Update an existing request. Permission: Manage requests and supported templates",
      inputSchema: {
        id: z.string().describe("Request ID"),
        name: z.string().optional().describe("Request name"),
        due: z.string().optional().describe("Due date in yyyy-mm-dd format"),
        status: z.enum(["draft", "published", "completed", "archived"]).optional().describe("Request status"),
        folder_id: z.string().optional().describe("Folder ID"),
        folder_name: z.string().optional().describe("Folder name"),
        owner_id: z.string().optional().describe("Owner team member ID"),
        owner_email: z.string().optional().describe("Owner team member email"),
        instruction_text: z.string().optional().describe("Request instructions (HTML supported)"),
        show_instruction: z.boolean().optional().describe("Show instructions to client"),
        communication_template_id: z
          .string()
          .nullable()
          .optional()
          .describe("Communications schedule ID (null to remove)"),
        communication_template_name: z
          .string()
          .nullable()
          .optional()
          .describe("Communications schedule name (null or 'None' to remove)"),
        comments_enabled: z.boolean().optional().describe("Enable client comments"),
        passcode_enabled: z.boolean().optional().describe("Require pin code"),
        share_via_link_enabled: z.boolean().optional().describe("Allow sharing via link"),
        expires_after_due: z.boolean().optional().describe("Close the request to the client after the due date"),
        client_assignments_ids: z
          .array(
            z.object({
              account_id: z.string().describe("Client ID"),
              client_company_id: z.string().optional().describe("Client company ID"),
              primary: z.boolean().optional().describe("Mark as primary client (only one per request)"),
            })
          )
          .optional()
          .describe("Client assignments"),
      },
      annotations: WRITE,
    },
    ({ id, ...body }) => runTool(() => api("PUT", `/requests/${id}`, { body, scopes: ["write_requests"] }))
  );

  server.registerTool(
    "delete_request",
    {
      description: "Delete a request. Permission: Manage requests and supported templates",
      inputSchema: { id: z.string().describe("Request ID") },
      annotations: DESTRUCTIVE,
    },
    ({ id }) =>
      runTool(async () => {
        await api("DELETE", `/requests/${id}`, { scopes: ["write_requests"] });
        return "Request deleted.";
      })
  );

  // -------------------------------------------------------------------------
  // Review and bulk actions
  // -------------------------------------------------------------------------

  const ScopePaths = { request: "requests", page: "pages", section: "sections" } as const;

  server.registerTool(
    "approve_all_submitted_fields",
    {
      description: "Approve all submitted fields in a request, page, or section. Permission: Review request answers",
      inputSchema: {
        scope: z.enum(["request", "page", "section"]).describe("Approve at request, page, or section level"),
        id: z.string().describe("ID of the request, page, or section"),
      },
      annotations: WRITE,
    },
    ({ scope, id }) =>
      runTool(async () => {
        await api("PUT", `/${ScopePaths[scope]}/${id}/approve_all_submitted_fields`, { scopes: ["review_requests"] });
        return `All submitted fields in ${scope} ${id} have been approved.`;
      })
  );

  server.registerTool(
    "submit_all_fields",
    {
      description: "Submit all fields for review in a request, page, or section. Permission: Review request answers",
      inputSchema: {
        scope: z.enum(["request", "page", "section"]).describe("Submit at request, page, or section level"),
        id: z.string().describe("ID of the request, page, or section"),
      },
      annotations: WRITE,
    },
    ({ scope, id }) =>
      runTool(async () => {
        await api("PUT", `/${ScopePaths[scope]}/${id}/submit_all_fields`, { scopes: ["review_requests"] });
        return `All fields in ${scope} ${id} have been submitted for review.`;
      })
  );

  server.registerTool(
    "run_integration_actions",
    {
      description: "Run the integration actions in a request. Permission: Review request answers",
      inputSchema: { id: z.string().describe("Request ID") },
      annotations: WRITE,
    },
    ({ id }) =>
      runTool(async () => {
        await api("PUT", `/requests/${id}/run_integration_actions`, { scopes: ["review_requests"] });
        return `Integration actions run for request ${id}.`;
      })
  );

  // -------------------------------------------------------------------------
  // Pages and sections
  // -------------------------------------------------------------------------

  server.registerTool(
    "get_page",
    {
      description: "Get a page by ID, including its sections and fields. Permission: Read requests",
      inputSchema: {
        id: z.string().describe("Page ID"),
        include_internal_fields: z.boolean().optional().describe("Include fields marked as internal (hidden from clients)"),
      },
      annotations: READ_ONLY,
    },
    ({ id, include_internal_fields }) =>
      runTool(() =>
        api("GET", `/pages/${id}`, { query: { include_internal_fields }, scopes: ["read_requests"] })
      )
  );

  server.registerTool(
    "create_page",
    {
      description: "Add a page to a request from a page template. Permission: Manage requests and supported templates",
      inputSchema: {
        request_id: z.string().describe("Request ID to add the page to"),
        name: z.string().optional().describe("Page name (defaults to template name)"),
        source_template_id: z.string().optional().describe("Page template ID (this or source_template_name)"),
        source_template_name: z.string().optional().describe("Page template name (this or source_template_id)"),
      },
      annotations: WRITE,
    },
    (params) => runTool(() => api("POST", "/pages", { body: params, scopes: ["write_requests"] }))
  );

  server.registerTool(
    "create_section",
    {
      description: "Add a section to a page from a section template. Permission: Manage requests and supported templates",
      inputSchema: {
        page_id: z.string().describe("Page ID to add the section to"),
        name: z.string().optional().describe("Section name (defaults to template name)"),
        source_template_id: z.string().optional().describe("Section template ID (this or source_template_name)"),
        source_template_name: z.string().optional().describe("Section template name (this or source_template_id)"),
      },
      annotations: WRITE,
    },
    (params) => runTool(() => api("POST", "/sections", { body: params, scopes: ["write_requests"] }))
  );

  // -------------------------------------------------------------------------
  // Fields
  // -------------------------------------------------------------------------

  server.registerTool(
    "review_field",
    {
      description: "Review a field: approve, reject, submit for review, or revise. Permission: Review request answers",
      inputSchema: {
        id: z.string().describe("Field ID"),
        status: z
          .enum(["approved", "done", "redo", "todo"])
          .describe(
            "'approved' to approve, 'done' to submit for review, 'redo' to reject, " +
              "'todo' to revise or remove a rejection or approval"
          ),
        rejection_comment: z.string().optional().describe("Message to the client explaining why the field was rejected"),
      },
      annotations: WRITE,
    },
    ({ id, ...body }) => runTool(() => api("PUT", `/fields/${id}/review`, { body, scopes: ["review_requests"] }))
  );

  // -------------------------------------------------------------------------
  // Templates, schedules and folders
  // -------------------------------------------------------------------------

  const listTool = (name: string, description: string, apiPath: string, scope: Scope) =>
    server.registerTool(
      name,
      { description: `${description}. Permission: ${PERMISSION_LABELS[scope]}`, inputSchema: PaginationParams, annotations: READ_ONLY },
      (params) => runTool(() => api("GET", apiPath, { query: params, scopes: [scope] }))
    );

  listTool("list_request_templates", "List request templates", "/request_templates", "read_templates");
  listTool("list_page_templates", "List page templates", "/page_templates", "read_templates");
  listTool("list_section_templates", "List section templates", "/section_templates", "read_templates");
  listTool("list_communication_templates", "List communications schedules", "/communication_templates", "read_requests");
  listTool("list_folders", "List folders", "/folders", "read_requests");

  // -------------------------------------------------------------------------
  // Team members
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_team_members",
    {
      description: "List team members. Permission: Read team members",
      inputSchema: { ...PaginationParams, ...SortParams, ...SearchParams },
      annotations: READ_ONLY,
    },
    (params) => runTool(() => api("GET", "/team_members", { query: listQuery(params), scopes: ["read_team_members"] }))
  );

  server.registerTool(
    "get_team_member",
    {
      description: "Get a team member by ID. Permission: Read team members",
      inputSchema: { id: z.string().describe("Team member ID") },
      annotations: READ_ONLY,
    },
    ({ id }) => runTool(() => api("GET", `/team_members/${id}`, { scopes: ["read_team_members"] }))
  );

  server.registerTool(
    "create_team_member",
    {
      description: "Invite a new team member. Permission: Manage team members (admins only)",
      inputSchema: {
        email: z.string().describe("Email address"),
        full_name: z.string().describe("Full name"),
        role: z.enum(["admin", "editor", "reviewer", "viewer"]).describe("Team member role"),
        phone: z.string().optional().describe("Phone number"),
        personal_message: z.string().optional().describe("Message included in the invitation email"),
      },
      annotations: WRITE,
    },
    (params) => runTool(() => api("POST", "/team_members", { body: params, scopes: ["write_team_members"] }))
  );

  server.registerTool(
    "update_team_member",
    {
      description: "Update a team member's role or active status. Permission: Manage team members (admins only)",
      inputSchema: {
        id: z.string().describe("Team member ID"),
        role: z.enum(["admin", "editor", "reviewer", "viewer"]).optional().describe("Team member role"),
        active: z.boolean().optional().describe("Active (true) or inactive (false)"),
      },
      annotations: WRITE,
    },
    ({ id, ...body }) => runTool(() => api("PUT", `/team_members/${id}`, { body, scopes: ["write_team_members"] }))
  );

  server.registerTool(
    "delete_team_member",
    {
      description: "Delete a team member. Permission: Manage team members (admins only)",
      inputSchema: { id: z.string().describe("Team member ID") },
      annotations: DESTRUCTIVE,
    },
    ({ id }) =>
      runTool(async () => {
        await api("DELETE", `/team_members/${id}`, { scopes: ["write_team_members"] });
        return "Team member deleted.";
      })
  );

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  const WebhookEvent = z.enum([
    "all_fields_completed",
    "client_create_failed",
    "client_created",
    "client_destroy_failed",
    "client_destroyed",
    "client_portal_group_created",
    "client_portal_group_destroyed",
    "client_portal_group_updated",
    "client_portal_viewed",
    "client_update_failed",
    "client_updated",
    "comment_create_failed",
    "comment_created",
    "email_bounced",
    "email_delivered",
    "email_spam_complained",
    "field_approved",
    "field_completed",
    "field_rejected",
    "id_verification_client_mark_reset",
    "id_verification_client_marked_not_proceeding",
    "id_verification_client_marked_proceeding",
    "id_verification_completed",
    "id_verification_monitoring_updated",
    "integration_action_failed",
    "integration_action_succeeded",
    "internal_comment_created",
    "page_completed",
    "product_item_auto_purchase",
    "product_item_exhausted",
    "product_item_manual_purchase",
    "product_item_purchase_failed",
    "product_item_returned",
    "product_item_used",
    "recurring_request_completed",
    "recurring_request_created",
    "recurring_request_destroyed",
    "recurring_request_executed",
    "recurring_request_failed",
    "request_archived",
    "request_archived_failed",
    "request_board_column_change_failed",
    "request_board_column_changed",
    "request_completed",
    "request_completed_failed",
    "request_create_failed",
    "request_created",
    "request_destroy_failed",
    "request_destroyed",
    "request_draft",
    "request_expired",
    "request_exported",
    "request_owner_reassigned",
    "request_published",
    "request_published_failed",
    "request_scheduled",
    "request_update_failed",
    "request_updated",
    "request_viewed",
    "request_waiting_for_approval",
    "scheduled_request_failed_to_publish",
    "scheduled_request_published_but_limits_exceeded",
    "section_completed",
    "signature_completed",
    "sms_delivered",
    "sms_failed",
    "team_member_create_failed",
    "team_member_created",
    "team_member_destroy_failed",
    "team_member_destroyed",
    "team_member_update_failed",
    "team_member_updated",
    "webhook_delivery_failed",
  ]);

  listTool("list_webhooks", "List webhooks", "/webhooks", "administration");

  server.registerTool(
    "get_webhook",
    {
      description: "Get a webhook by ID. Permission: Manage webhooks (admins only)",
      inputSchema: { id: z.string().describe("Webhook ID") },
      annotations: READ_ONLY,
    },
    ({ id }) => runTool(() => api("GET", `/webhooks/${id}`, { scopes: ["administration"] }))
  );

  server.registerTool(
    "create_webhook",
    {
      description: "Create a webhook. Permission: Manage webhooks (admins only)",
      inputSchema: {
        url: z.string().describe("Webhook callback URL"),
        enabled: z.boolean().optional().describe("Whether the webhook is enabled (default: true)"),
        subscriptions: z.array(WebhookEvent).optional().describe("Events to subscribe to"),
      },
      annotations: WRITE,
    },
    (params) => runTool(() => api("POST", "/webhooks", { body: params, scopes: ["administration"] }))
  );

  server.registerTool(
    "update_webhook",
    {
      description: "Update a webhook. Permission: Manage webhooks (admins only)",
      inputSchema: {
        id: z.string().describe("Webhook ID"),
        url: z.string().optional().describe("Webhook callback URL"),
        enabled: z.boolean().optional().describe("Whether the webhook is enabled"),
        subscriptions: z.array(WebhookEvent).optional().describe("Events to subscribe to"),
      },
      annotations: WRITE,
    },
    ({ id, ...body }) => runTool(() => api("PUT", `/webhooks/${id}`, { body, scopes: ["administration"] }))
  );

  server.registerTool(
    "delete_webhook",
    {
      description: "Delete a webhook. Permission: Manage webhooks (admins only)",
      inputSchema: { id: z.string().describe("Webhook ID") },
      annotations: DESTRUCTIVE,
    },
    ({ id }) =>
      runTool(async () => {
        await api("DELETE", `/webhooks/${id}`, { scopes: ["administration"] });
        return "Webhook deleted.";
      })
  );

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  server.connect(new StdioServerTransport()).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
