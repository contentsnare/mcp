# Content Snare MCP server

Lets Claude, or any other MCP client, work with your Content Snare account. Create requests from a template or build them on the fly, look up clients, review answers, and manage team members and webhooks, all by asking in plain English.

It runs on your own computer and talks to the [Content Snare API](https://api.contentsnare.com/partner_api/v1/documentation) using a personal access token. It works in apps that can run MCP servers on your computer: Claude Desktop, Claude Code, Codex, Cursor, VS Code and similar. Web-only apps, such as Microsoft 365 Copilot, ChatGPT in a browser and Claude in a browser, can't use it.

## Before you start

- **API access on your Content Snare account.** It depends on your plan. If you're not sure, ask [support@contentsnare.com](mailto:support@contentsnare.com).
- **The right role.** Admins can create access tokens. Editors can too if an admin has allowed it. Reviewers and viewers can't.
- **Node.js 18 or later**, except for the [Claude Desktop extension](#claude-desktop), which brings its own. Check with `node --version`. If you don't have it, install the LTS version from [nodejs.org](https://nodejs.org).
- **git, if you add the plugin in the Claude desktop app or use the `npx` commands below.** Check with `git --version`. Without git, the [download option](#prefer-a-local-copy) replaces the `npx` commands.

## Step 1: Create a personal access token

1. In Content Snare, go to **Settings**, then **Security**, then **Personal Access Tokens**. Or open [app.contentsnare.com/settings/security/access-tokens](https://app.contentsnare.com/settings/security/access-tokens).
2. Click **Generate access token**.
3. Give it a name you'll recognise, such as `Claude MCP`.
4. Choose when it expires. Admins can pick from 30 days to 2 years. Editors always get 90 days.
5. Tick the permissions for what you want your AI to do. **Manage** permissions don't include read access, so tick the matching **Read** permission too.

   | Permission | What it unlocks |
   |---|---|
   | Read clients | Look up clients and client companies |
   | Manage clients | Create, update and delete clients, and create new clients as part of a request |
   | Read requests | Look up requests, pages, folders and communications schedules |
   | Manage requests and supported templates | Create, update and delete requests, and add pages and sections |
   | Review request answers | Approve, reject or submit answers, and run integration actions |
   | Read templates | List request, page and section templates |
   | Read team members | Look up team members |
   | Manage team members (admins only) | Invite, update and remove team members |
   | Manage webhooks (admins only) | Create, update and delete webhooks |

6. Enter your Content Snare password, plus your authenticator code if you use two-factor authentication, and click **Generate access token**.
7. Copy the token. It starts with `cs_pat_` and Content Snare only shows it once.

**Keep the token out of your AI chat.** Anything typed into a chat is saved with the conversation. If you paste it in by mistake, revoke it on the same page and generate a new one.

## Step 2: Connect it

Pick the section for the app you use.

### Claude Code in the Claude desktop app (the Code tab)

You install it as a plugin from this repository. The desktop app needs **git** to add a plugin source, so check `git --version` in a terminal first. If it's missing, install it from [git-scm.com](https://git-scm.com) and restart the app.

1. Start a session in the **Code** tab, click **+** next to the prompt box and choose **Add plugins** (or **Plugins**, then **Browse plugins**).
2. Choose **Add marketplace** and enter `contentsnare/mcp`.
3. Select **Content Snare** and click **Add to this computer**.
4. In the session, ask Claude to "connect Content Snare". A page opens in your browser (or Claude gives you a link to it). Paste your token there and click **Connect**. The page runs on your own computer, checks the token with Content Snare and saves it, so the token never goes into the chat.

Typing `/plugin` commands in the desktop app doesn't work. They only run in a terminal session.

### Claude Code in a terminal

In a Claude Code session, run:

```text
/plugin install content-snare-mcp --marketplace contentsnare/mcp
```

Or in two steps, on Claude Code older than 2.1.275:

```text
/plugin marketplace add contentsnare/mcp
/plugin install content-snare-mcp@content-snare-mcp
```

Choose an install scope. Claude Code then asks for your **Content Snare personal access token** in a masked field. Paste it there. Claude Code keeps it in your system's secure credential store, not in a settings file, and passes it to the server when it starts.

To add the token later or replace it, run `/plugin configure content-snare-mcp@content-snare-mcp` (or `/plugin`, then the **Installed** tab, **content-snare-mcp**, **Configure options**), then run `/reload-plugins`. Or ask Claude to "connect Content Snare" and use the browser page. If you install from your shell with `claude plugin install`, don't use its `--config` flag for the token, because that leaves the token in your shell history.

### Claude Desktop

Nothing else to install, and no terminal.

1. Download [content-snare.mcpb](https://github.com/contentsnare/mcp/releases/latest/download/content-snare.mcpb).
2. Double-click it. Claude Desktop opens it. Click **Install**.
3. When it asks for your **Content Snare personal access token**, paste the token into that field. Claude Desktop keeps it in your computer's keychain.

To add the token later or replace it, open Claude Desktop's **Settings**, then **Extensions**, and open the Content Snare extension's settings. To update to a new version, download the file again and install it over the old one.

### Codex

This covers the Codex CLI, the Codex IDE extension and the ChatGPT desktop app, which share one config.

**1. Add the server.** In a terminal:

```bash
codex mcp add contentsnare -- npx -y github:contentsnare/mcp
```

**2. Give it time to start.** Codex waits 10 seconds for a server by default, and the first `npx` start can take longer. Open `~/.codex/config.toml` (on Windows, `C:\Users\<you>\.codex\config.toml`) and add a line under `[mcp_servers.contentsnare]`:

```toml
[mcp_servers.contentsnare]
command = "npx"
args = ["-y", "github:contentsnare/mcp"]
startup_timeout_sec = 30
```

**3. Connect your token.** Ask Codex to "connect Content Snare". A page opens in your browser where you paste the token, as [described above](#claude-code-in-the-claude-desktop-app-the-code-tab).

To skip the `npx` download each time, use a [local copy](#prefer-a-local-copy) and `codex mcp add contentsnare -- node /full/path/to/content-snare-mcp/dist/index.js` instead.

### Cursor, VS Code, GitHub Copilot and other MCP clients

**1. Add the server to your app.** The config needs no token. Most apps take this JSON in their MCP settings:

```json
{
  "mcpServers": {
    "contentsnare": {
      "command": "npx",
      "args": ["-y", "github:contentsnare/mcp"]
    }
  }
}
```

From the command line:

```bash
# Claude Code without the plugin
claude mcp add contentsnare --scope user -- npx -y github:contentsnare/mcp

# GitHub Copilot CLI
copilot mcp add contentsnare -- npx -y github:contentsnare/mcp
```

On Windows, if the server doesn't start, wrap `npx` in `cmd /c`: use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "github:contentsnare/mcp"]`, or `-- cmd /c npx -y github:contentsnare/mcp` for `claude mcp add`.

**2. Connect your token.** Ask your AI to "connect Content Snare" and paste the token into the page that opens in your browser.

If you'd rather use a terminal, `npx -y github:contentsnare/mcp setup` does the same job: paste the token when it asks (nothing shows as you paste). Both save it to `.contentsnare/config.json` in your home folder (on Windows, `C:\Users\<you>\.contentsnare\config.json`).

#### Prefer a local copy

`npx` fetches the server from GitHub each time your app starts it, and needs git to do it. To run a copy on disk instead, either clone it:

```bash
git clone https://github.com/contentsnare/mcp.git content-snare-mcp
node content-snare-mcp/dist/index.js setup
```

Or, without git, download it: on the GitHub page click **Code**, then **Download ZIP**, unzip it, and run `node path/to/the/unzipped/folder/dist/index.js setup`.

Then point your app at it with `"command": "node"` and `"args": ["/full/path/to/content-snare-mcp/dist/index.js"]`. There's no `npm install` step, because `dist/index.js` is a single bundled file.

### Using an environment variable instead

If `CONTENTSNARE_API_TOKEN` is set, the server uses it ahead of the saved file. This suits CI, or loading the token from a password manager into your shell. In a project `.mcp.json`, reference the variable rather than the value, so the token never sits in a file you might commit:

```json
{
  "mcpServers": {
    "contentsnare": {
      "command": "npx",
      "args": ["-y", "github:contentsnare/mcp"],
      "env": { "CONTENTSNARE_API_TOKEN": "${CONTENTSNARE_API_TOKEN}" }
    }
  }
}
```

Avoid a `.env` file in a project folder for this. AI coding agents read project files freely, so a token kept there can end up in the chat.

## Check it works

Ask your AI to "check my Content Snare connection". It runs `check_connection` and shows who the token belongs to, its permissions and when it expires.

If you haven't saved a token yet, the server still starts. Ask your AI to do anything with Content Snare and it will give you the connect page, without asking you to paste the token into the chat.

## When the token expires

Content Snare emails you within the last day before a token expires. On the Personal Access Tokens page, use **Rotate token** on the expired token or generate a new one, then ask your AI to "connect Content Snare" again and paste the new one into the page.

## Troubleshooting

| You see | What it means | What to do |
|---|---|---|
| Content Snare isn't connected yet | No token found | Ask your AI to "connect Content Snare" |
| The connect page says the link has expired | Links last 30 minutes and work once | Ask your AI to "connect Content Snare" again for a new link |
| `npm error enoent An unknown git error occurred` | `npx` needs git and can't find it | Install git, or use the [download option](#prefer-a-local-copy) |
| `node` or `npx` is not recognised | Node.js isn't installed, or your app can't see it | Install Node.js LTS from [nodejs.org](https://nodejs.org), then restart your app |
| HTTP 401 | The token has expired, been revoked, or was copied incompletely | Rotate or generate a token and save it again |
| Partner API is disabled | API access isn't on for your account | Contact [support@contentsnare.com](mailto:support@contentsnare.com) |
| HTTP 403 naming a permission | The token doesn't have that permission | Edit the token on the Personal Access Tokens page and tick it |
| HTTP 429 | Rate limit: 50 reads and 20 writes per 10 seconds | Wait for the number of seconds shown, then retry |

## Tools

| Area | Tools | Permission |
|---|---|---|
| Connection | `check_connection` | None |
| Clients | `list_clients`, `get_client`, `list_client_companies` | Read clients |
| | `create_client`, `update_client`, `delete_client` | Manage clients |
| Requests | `list_requests`, `get_request`, `get_page` | Read requests |
| | `create_request`, `create_request_with_fields`, `update_request`, `delete_request`, `create_page`, `create_section` | Manage requests and supported templates, plus Manage clients when the request creates a new client |
| Review | `review_field`, `approve_all_submitted_fields`, `submit_all_fields`, `run_integration_actions` | Review request answers |
| Templates | `list_request_templates`, `list_page_templates`, `list_section_templates` | Read templates |
| Schedules and folders | `list_communication_templates`, `list_folders` | Read requests |
| Team | `list_team_members`, `get_team_member` | Read team members |
| | `create_team_member`, `update_team_member`, `delete_team_member` | Manage team members |
| Webhooks | `list_webhooks`, `get_webhook`, `create_webhook`, `update_webhook`, `delete_webhook` | Manage webhooks |

## Building requests with inline fields

`create_request_with_fields` builds a whole request (pages, sections and questions) in one call, without a template. Questions can be shown or hidden based on other answers with `show_when` or `hide_when`. A few rules matter, because Content Snare quietly drops conditions that break them:

- A condition can only refer to a question **on the same page**.
- For choice questions (single select, multi select, dropdown, task list), an `equals` or `does not equal` value must **exactly match** one of the options, including capitals.
- Content Snare requires `logical_operator` on every condition group, even with one condition. The server fills in `"and"` if it's missing.
- `is empty` and `has a value` still need a `value`. The server sends an empty string if it's missing.

The server checks all of this before sending, and tells your AI what to fix instead of creating a request with broken logic. The full field reference is in [docs/create-request-api.md](docs/create-request-api.md).

## Upgrading from version 1

Version 1 used an OAuth app with a client ID, client secret and redirect URL. Version 2 uses a personal access token instead:

- Remove `CONTENTSNARE_CLIENT_ID`, `CONTENTSNARE_CLIENT_SECRET` and `CONTENTSNARE_REDIRECT_URI` from your MCP config.
- Delete `~/.contentsnare/tokens.json`. It's no longer read.
- Follow Steps 1 and 2 above.
- `get_current_user` is now `check_connection`.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
