/**
 * ACP (Agent Communication Protocol) client for Cursor.
 *
 * Implements JSON-RPC 2.0 over stdio to communicate with `agent acp`.
 * Translates ACP session/update notifications into the existing stream-json
 * line format so downstream parsers (parse.ts, parse-stdout.ts, format-event.ts)
 * remain unchanged.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { ensurePathInEnv } from "@paperclipai/adapter-utils/server-utils";

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

// ---------------------------------------------------------------------------
// ACP session types
// ---------------------------------------------------------------------------

export interface AcpSessionResult {
  sessionId: string | null;
  stopReason: string | null;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  costUsd: number | null;
}

export interface AcpClientOptions {
  command: string;
  cwd: string;
  env: Record<string, string>;
  /** Callback for stream-json translated lines */
  onStreamLine: (line: string) => Promise<void>;
  /** Callback for stderr output */
  onStderr: (chunk: string) => Promise<void>;
  /** Whether to auto-allow all permissions (yolo mode) */
  yolo: boolean;
  /** Timeout in seconds, 0 = no timeout */
  timeoutSec: number;
  /** Grace period after timeout signal */
  graceSec: number;
}

// ---------------------------------------------------------------------------
// ACP Client
// ---------------------------------------------------------------------------

export class AcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private lineBuffer = "";
  private pending = new Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (err: Error) => void;
  }>();
  private notificationHandler: ((msg: JsonRpcNotification) => Promise<void>) | null = null;
  private closed = false;
  private stderrChunks: string[] = [];
  private stdoutRaw: string[] = [];

  private readonly options: AcpClientOptions;

  constructor(options: AcpClientOptions) {
    this.options = options;
  }

  /** Spawn `agent acp` and return the child process */
  spawn(): ChildProcess {
    const runtimeEnv = ensurePathInEnv({ ...process.env, ...this.options.env });
    const child = spawn(this.options.command, ["acp"], {
      cwd: this.options.cwd,
      env: runtimeEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stdoutRaw.push(text);
      this.handleStdoutChunk(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderrChunks.push(text);
      void this.options.onStderr(text);
    });

    child.on("close", () => {
      this.closed = true;
      // Reject any pending requests
      for (const [, pending] of this.pending) {
        pending.reject(new Error("ACP process closed unexpectedly"));
      }
      this.pending.clear();
    });

    child.on("error", (err) => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        pending.reject(err);
      }
      this.pending.clear();
    });

    this.proc = child;
    return child;
  }

  private handleStdoutChunk(text: string) {
    this.lineBuffer += text;
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      void this.handleJsonRpcLine(trimmed);
    }
  }

  private async handleJsonRpcLine(line: string) {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      // Not valid JSON - pass through as raw stdout
      await this.options.onStreamLine(line);
      return;
    }

    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      await this.options.onStreamLine(line);
      return;
    }

    // Response (has id)
    if ("id" in msg && typeof msg.id === "number") {
      const resp = msg as JsonRpcResponse;
      const pending = this.pending.get(resp.id);
      if (pending) {
        this.pending.delete(resp.id);
        pending.resolve(resp);
      }
      return;
    }

    // Notification (no id, has method)
    if ("method" in msg) {
      const notification = msg as JsonRpcNotification;
      if (this.notificationHandler) {
        await this.notificationHandler(notification);
      }
    }
  }

  /** Send a JSON-RPC request and wait for its response */
  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (this.closed || !this.proc?.stdin?.writable) {
      throw new Error(`ACP process is not running (method: ${method})`);
    }

    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
    const line = JSON.stringify(req) + "\n";

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(line, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /** Send a JSON-RPC notification (no response expected) */
  notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed || !this.proc?.stdin?.writable) return;

    const msg: { jsonrpc: "2.0"; method: string; params?: Record<string, unknown> } = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };
    const line = JSON.stringify(msg) + "\n";
    this.proc.stdin.write(line);
  }

  /** Set the notification handler */
  onNotification(handler: (msg: JsonRpcNotification) => Promise<void>) {
    this.notificationHandler = handler;
  }

  /** Get collected stderr */
  getStderr(): string {
    return this.stderrChunks.join("");
  }

  /** Get collected stdout */
  getStdout(): string {
    return this.stdoutRaw.join("");
  }

  /** Check if the process has exited */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Kill the underlying process */
  kill(signal: NodeJS.Signals = "SIGTERM") {
    if (this.proc && !this.closed) {
      this.proc.kill(signal);
    }
  }

  /** Wait for the process to exit, returns exit code */
  waitForExit(): Promise<{ exitCode: number | null; signal: string | null }> {
    return new Promise((resolve) => {
      if (!this.proc) {
        resolve({ exitCode: null, signal: null });
        return;
      }
      if (this.proc.exitCode !== null) {
        resolve({ exitCode: this.proc.exitCode, signal: null });
        return;
      }
      this.proc.on("close", (code, sig) => {
        resolve({ exitCode: code, signal: sig ? String(sig) : null });
      });
    });
  }
}

// ---------------------------------------------------------------------------
// ACP → stream-json translation
// ---------------------------------------------------------------------------

function translateSessionUpdate(
  update: Record<string, unknown>,
  onStreamLine: (line: string) => Promise<void>,
): Promise<void> {
  const updateType = typeof update.type === "string" ? update.type : "";

  if (updateType === "agent_message_chunk") {
    const content = update.content as Record<string, unknown> | undefined;
    if (!content) return Promise.resolve();

    // Text content
    if (typeof content.text === "string" && content.text.length > 0) {
      return onStreamLine(JSON.stringify({ type: "text", text: content.text }));
    }

    // Tool use start
    if (typeof content.toolName === "string") {
      return onStreamLine(JSON.stringify({
        type: "tool_call",
        tool: content.toolName,
        phase: "started",
        input: content.input ?? {},
      }));
    }

    // Tool use end / result
    if (typeof content.toolResult === "string" || content.toolResult !== undefined) {
      return onStreamLine(JSON.stringify({
        type: "tool_call",
        tool: typeof content.toolName === "string" ? content.toolName : "unknown",
        phase: "completed",
        output: typeof content.toolResult === "string" ? content.toolResult : JSON.stringify(content.toolResult),
      }));
    }

    // Pass through as raw
    return onStreamLine(JSON.stringify({ type: "text", text: JSON.stringify(content) }));
  }

  // For unknown update types, emit as raw system event
  return onStreamLine(JSON.stringify({ type: "system", subtype: updateType, data: update }));
}

// ---------------------------------------------------------------------------
// High-level ACP session runner
// ---------------------------------------------------------------------------

export interface RunAcpSessionOptions {
  client: AcpClient;
  prompt: string;
  sessionId: string | null;
  cwd: string;
  yolo: boolean;
  onStreamLine: (line: string) => Promise<void>;
  onLog: (stream: "stdout" | "stderr", text: string) => Promise<void>;
  timeoutSec: number;
}

export async function runAcpSession(opts: RunAcpSessionOptions): Promise<AcpSessionResult> {
  const { client, prompt, sessionId, cwd, yolo, onStreamLine, onLog, timeoutSec } = opts;

  let resolvedSessionId: string | null = sessionId;
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let costUsd: number | null = null;
  let stopReason: string | null = null;

  // Set up notification handler for session updates and permission requests
  client.onNotification(async (notification) => {
    if (notification.method === "session/update") {
      const params = notification.params ?? {};
      const sessionUpdate = params.sessionUpdate as Record<string, unknown> | undefined;
      if (sessionUpdate) {
        await translateSessionUpdate(sessionUpdate, onStreamLine);
      }
      // Extract session ID from notification if present
      if (typeof params.sessionId === "string" && params.sessionId) {
        resolvedSessionId = params.sessionId;
      }
      return;
    }

    if (notification.method === "session/request_permission") {
      const params = notification.params ?? {};
      const permissionId = typeof params.permissionId === "string" ? params.permissionId : "";
      const action = yolo ? "allow-always" : "allow-once";
      // Respond to permission request
      client.notify("session/permission_response", {
        permissionId,
        action,
        ...(typeof params.sessionId === "string" ? { sessionId: params.sessionId } : {}),
      });
      return;
    }
  });

  // Step 1: Initialize
  const initResp = await client.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "paperclip", version: "1.0.0" },
  });
  if (initResp.error) {
    throw new Error(`ACP initialize failed: ${initResp.error.message}`);
  }

  // Step 2: Authenticate
  const authResp = await client.request("authenticate", {
    methodId: "cursor_login",
  });
  if (authResp.error) {
    await onLog("stderr", `[paperclip] ACP authentication warning: ${authResp.error.message}\n`);
  }

  // Step 3: Create or load session
  let sessionResp: JsonRpcResponse;
  if (sessionId) {
    sessionResp = await client.request("session/load", { sessionId });
    if (sessionResp.error) {
      // Session load failed, try creating a new one
      await onLog("stderr", `[paperclip] ACP session/load failed (${sessionResp.error.message}), creating new session.\n`);
      sessionResp = await client.request("session/new", { cwd, mcpServers: [] });
    }
  } else {
    sessionResp = await client.request("session/new", { cwd, mcpServers: [] });
  }

  if (sessionResp.error) {
    throw new Error(`ACP session creation failed: ${sessionResp.error.message}`);
  }

  const sessionResult = sessionResp.result as Record<string, unknown> | undefined;
  if (sessionResult && typeof sessionResult.sessionId === "string") {
    resolvedSessionId = sessionResult.sessionId;
  }

  if (!resolvedSessionId) {
    throw new Error("ACP session creation returned no session ID");
  }

  // Emit init event in stream-json format
  await onStreamLine(JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: resolvedSessionId,
  }));

  // Step 4: Send prompt
  let timedOut = false;
  let promptDone = false;

  const promptPromise = client.request("session/prompt", {
    sessionId: resolvedSessionId,
    prompt: [{ type: "text", text: prompt }],
  }).then((resp) => {
    promptDone = true;
    return resp;
  });

  // Set up timeout if configured
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      if (!promptDone) {
        timedOut = true;
        client.kill("SIGTERM");
      }
    }, timeoutSec * 1000);
  }

  try {
    const promptResp = await promptPromise;

    if (promptResp.error) {
      // Emit error as stream-json
      await onStreamLine(JSON.stringify({
        type: "error",
        message: promptResp.error.message,
      }));
    } else {
      const result = promptResp.result as Record<string, unknown> | undefined;
      if (result) {
        stopReason = typeof result.stopReason === "string" ? result.stopReason : null;

        // Extract usage from result
        const usageObj = result.usage as Record<string, unknown> | undefined;
        if (usageObj) {
          usage.inputTokens += typeof usageObj.input_tokens === "number" ? usageObj.input_tokens : 0;
          usage.inputTokens += typeof usageObj.inputTokens === "number" ? usageObj.inputTokens : 0;
          usage.cachedInputTokens += typeof usageObj.cached_input_tokens === "number" ? usageObj.cached_input_tokens : 0;
          usage.cachedInputTokens += typeof usageObj.cachedInputTokens === "number" ? usageObj.cachedInputTokens : 0;
          usage.outputTokens += typeof usageObj.output_tokens === "number" ? usageObj.output_tokens : 0;
          usage.outputTokens += typeof usageObj.outputTokens === "number" ? usageObj.outputTokens : 0;
        }

        const cost = typeof result.costUsd === "number" ? result.costUsd
          : typeof result.total_cost_usd === "number" ? result.total_cost_usd
          : typeof result.cost_usd === "number" ? result.cost_usd
          : null;
        if (cost !== null && cost > 0) costUsd = cost;

        // Extract session ID from result
        if (typeof result.sessionId === "string" && result.sessionId) {
          resolvedSessionId = result.sessionId;
        }
      }
    }

    // Emit result event in stream-json format
    await onStreamLine(JSON.stringify({
      type: "result",
      session_id: resolvedSessionId,
      usage: {
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
      },
      ...(costUsd !== null ? { total_cost_usd: costUsd } : {}),
      ...(stopReason ? { stop_reason: stopReason } : {}),
    }));
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  return {
    sessionId: resolvedSessionId,
    stopReason,
    usage,
    costUsd,
  };
}
