# Working on the Content Snare MCP server

## Build

```bash
npm install
npm run build      # type-check, then bundle src/index.ts into dist/index.js
npm run typecheck  # type-check only
```

`dist/index.js` is committed and must be rebuilt before every commit that changes `src/`. It's a single esbuild bundle with every dependency inlined, so the Claude Code plugin, `npx github:...` and a plain `git clone` all run it with no `npm install`. That's also why everything is in `devDependencies`.

## Layout

```
.claude-plugin/
  plugin.json        Claude Code plugin: MCP server definition and the masked api_token prompt
  marketplace.json   Makes this repo installable with /plugin marketplace add
src/index.ts         The whole server: token handling, setup command, API client, tools
dist/index.js        Bundled output (committed)
docs/                Partner API reference for create_request_with_fields
```

## How authentication works

The server uses a Content Snare personal access token (prefix `cs_pat_`), sent as `Authorization: Bearer <token>` to `https://api.contentsnare.com/partner_api/v1`.

It looks for the token on every tool call, in this order:

1. `CONTENTSNARE_API_TOKEN`. The Claude Code plugin fills this from its sensitive `api_token` option. An unfilled `${user_config.api_token}` or `${VAR}` placeholder counts as unset.
2. `~/.contentsnare/config.json`, written by `contentsnare-mcp setup`.

Reading it on every call means a token saved with `setup` works without restarting the server.

With no token the server still starts, and every tool returns setup steps for the AI client to walk the user through. The steps adapt to how the server was launched: plugin users are sent to `/plugin` > Configure options, everyone else gets the exact `setup` command for their install. The text never asks the user to paste the token into the chat.

API errors are turned into instructions: 401 sends the user to rotate the token, 403 names the missing permission using the labels from the Personal Access Tokens page, and "Partner API is disabled" points to support.

## Testing against another environment

Set `CONTENTSNARE_API_URL` (for example `https://staging-api.example.com`) to send requests somewhere other than production. You need a token from that environment.

## Content Snare API notes

- Rate limits: 50 reads and 20 writes per 10 seconds. A 429 includes `Retry-After`.
- IDs are prefixed strings (`req_`, `acc_`, `pag_`, `sec_`, `fld_`).
- Pages are called tabs inside the API code, and pages in the API paths and the product.
- `pages_data` on `POST /requests` isn't in the OpenAPI spec. The schema lives in the API's `RequestPagesDataSchema`, and conditions are built per page by `Requests::FieldLogicCreator`. That's where the same-page and exact-option rules come from. `checkPagesData` in `src/index.ts` checks them before sending.
- Webhook event names come from the production OpenAPI spec (`swagger/v1/swagger.json` in the API repo).
