# GIGO Sidecar

A proxy that de-GPTs your LLM responses. It intercepts the patronizing gaslighting, the corporate buzzword salad, the psychological projection, and the endless "let me reframe that for you" bullshit, then rewrites it through a secondary LLM instructed to talk like a person, not a mid-level manager mansplaining his way through a PowerPoint.

## What It Fixes

GPT and its ilk have developed a very specific disease:

- **Gaslighting**: "You're not actually tired, you're experiencing 'energy allocation imbalance'"
- **Mansplaining**: "What you're really asking is..." (no, it isn't)
- **Corporate cosplay**: "Let's align on the core value proposition" instead of "here's what this does"
- **Fake empathy**: "I understand you might be feeling..." followed by completely missing the point
- **Bullet-point manifestos**: Taking 500 words to say what needs 50
- **The confidence trick**: Stating wrong things with absolute certainty, then apologizing in the same breath

GIGO sits between you and the upstream API, buffers the SSE stream, and runs it through a polish layer that strips this garbage out.

## Environment Variables

### Upstream API Configuration

| Variable            | Description                        | Default                  |
| ------------------- | ---------------------------------- | ------------------------ |
| `UPSTREAM_API_BASE` | Upstream API base URL              | `https://api.openai.com` |
| `POLISH_API_BASE`   | Base URL for the polishing service | (required)               |
| `POLISH_API_KEY`    | API key for the polishing service  | (required)               |
| `POLISH_MODEL`      | Model name for text polishing      | (required)               |

### Test Configuration (Local Development)

| Variable       | Description               |
| -------------- | ------------------------- |
| `TEST_API_KEY` | API key for running tests |
| `TEST_MODEL`   | Model name for tests      |
| `TEST_PROMPT`  | Default test prompt       |

## Local Development

### Prerequisites

- Bun 1.x

### Setup

1. Clone the repository
2. Create `.env.local` file with your configuration:

```bash
# Upstream API (the API you're proxying to)
UPSTREAM_API_BASE=https://openrouter.ai/api/v1

# Polishing service (can be same as upstream or different)
POLISH_API_BASE=https://openrouter.ai/api/v1
POLISH_API_KEY=sk-your-api-key
POLISH_MODEL=gemini-2.5-flash-lite

# Test configuration
TEST_API_KEY=sk-your-test-key
TEST_MODEL=gpt-5
TEST_PROMPT="Explain how IPC works in Electron"
```

**Note**: Ensure `.env.local` is in your `.gitignore` to avoid committing secrets.

3. Start the server:

```bash
bun src/server.ts
```

The server will start on port 8080 by default. You can customize with:

```bash
bun src/server.ts --port 3000 --expose
```

### Testing

Run the SSE test against a running server:

```bash
bun tests/sse-test.ts 8080
```

Optional type-check setup:

```bash
bun i
bun typecheck
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
#  Upstream API base URL
fly secrets set UPSTREAM_API_BASE=https://your-upstream-api.com/v1

# Polishing service configuration
fly secrets set POLISH_API_BASE=https://polish-api.example.com/v1
fly secrets set POLISH_API_KEY=sk-your-api-key
fly secrets set POLISH_MODEL=your-model-name
```

**Note**: All configuration on Fly.io is done via `fly secrets`. The `.env.local` file is only for local development and should not be committed or deployed.

3. **Deploy**:

```bash
fly deploy
```

### Scaling

Scale to single machines:

```bash
fly scale count 1
```

Adjust VM resources:

```bash
fly scale vm shared-cpu-1x --memory 256
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

GNU General Public License v2.0
