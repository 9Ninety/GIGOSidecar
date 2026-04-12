# GIGO Sidecar

A lightweight SSE (Server-Sent Events) proxy server that intercepts upstream responses, buffers answer text, and polishes content via LLM.

## Features

- **SSE Proxy**: Intercepts upstream SSE streams and processes them in real-time
- **Content Polishing**: Enhances responses using configurable LLM backends
- **Reasoning Simulation**: Provides mock reasoning templates for better UX
- **Environment-Based Configuration**: All settings configurable via environment variables
- **Fly.io Ready**: Optimized for deployment on Fly.io platform

## Environment Variables

### Upstream API Configuration

| Variable            | Description                        | Default                     |
| ------------------- | ---------------------------------- | --------------------------- |
| `UPSTREAM_API_BASE` | Upstream API base URL              | `https://api.openai.com`    |
| `POLISH_API_BASE`   | Base URL for the polishing service | Same as `UPSTREAM_API_BASE` |
| `POLISH_API_KEY`    | API key for the polishing service  | (required)                  |
| `POLISH_MODEL`      | Model name for text polishing      | (required)                  |

### Test Configuration (Local Development)

| Variable       | Description               |
| -------------- | ------------------------- |
| `TEST_API_KEY` | API key for running tests |
| `TEST_MODEL`   | Model name for tests      |
| `TEST_PROMPT`  | Default test prompt       |

## Local Development

### Prerequisites

- Node.js 24+

### Setup

1. Clone the repository
2. Create `.env.local` file with your configuration:

```bash
# Upstream API (the API you're proxying to)
UPSTREAM_API_BASE=https://api.openai.com

# Polishing service (can be same as upstream or different)
POLISH_API_BASE=https://api.openai.com
POLISH_API_KEY=sk-your-api-key
POLISH_MODEL=gpt-4

# Test configuration
TEST_API_KEY=sk-your-test-key
TEST_MODEL=gpt-3.5-turbo
TEST_PROMPT="Explain how IPC works in Electron"
```

**Note**: Ensure `.env.local` is in your `.gitignore` to avoid committing secrets.

3. Start the server:

```bash
node src/server.mjs
```

The server will start on port 8080 by default. You can customize with:

```bash
node src/server.mjs --port 3000 --expose
```

### Testing

Run the SSE test against a running server:

```bash
node tests/sse-test.mjs 8080
```

## Fly.io Deployment

### Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed
- Fly.io account

### Initial Deployment

1. **Launch the app**:

```bash
fly launch
```

This will create a `fly.toml` configuration file. Review and adjust as needed.

2. **Set secrets** (do not use `.env` file for production):

```bash
# Required: Upstream API base URL
fly secrets set UPSTREAM_API_BASE=https://your-upstream-api.com

# Required: Polishing service configuration
fly secrets set POLISH_API_KEY=sk-your-api-key
fly secrets set POLISH_MODEL=your-model-name

# Optional: If polishing service differs from upstream
fly secrets set POLISH_API_BASE=https://polish-api.example.com
```

**Note**: All configuration on Fly.io is done via `fly secrets`. The `.env.local` file is only for local development and should not be committed or deployed.

3. **Deploy**:

```bash
fly deploy
```

### Updating Secrets

To update environment variables after deployment:

```bash
fly secrets set POLISH_API_KEY=sk-new-key
```

This will redeploy the app with the new secrets.

### Monitoring

View logs:

```bash
fly logs
```

Check app status:

```bash
fly status
```

### Scaling

Scale to single machines:

```bash
fly scale count 1
```

Adjust VM resources:

```bash
fly scale vm shared-cpu-2x --memory 512
```

## Configuration Precedence

The app uses the following precedence for configuration:

1. **Command-line arguments** (highest priority)
2. **Environment variables**
3. **Default values** (lowest priority)

Example for target URL:

- `--target https://api.example.com` (CLI arg wins)
- `UPSTREAM_API_BASE=https://api.example.com` (env var)
- `https://api.openai.com` (default)

## Architecture

```
Client → GIGO Sidecar → Upstream API
            ↓
      [Polish Service]
            ↓
      Enhanced Response
```

The sidecar buffers SSE responses from the upstream API, sends the content to a polishing LLM for enhancement, and streams the polished response back to the client with simulated reasoning steps.

## License

GPL-2.0-only
