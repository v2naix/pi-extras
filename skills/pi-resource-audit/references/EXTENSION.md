# Extension audit checklist

Apply every item to the extension's full import and runtime graph.

## Supply chain and loading

- Entry points and package manifests expose only intended resources; globs and conventional directories do not load forgotten files.
- Runtime dependencies are necessary, reputable, pinned or bounded appropriately, represented by a coherent lockfile, and placed in `dependencies`; Pi core packages are unbundled `peerDependencies` where applicable.
- Install/prepare/postinstall scripts, native modules, downloaded binaries, dynamic imports, and self-update paths are absent or fully justified and verified.
- Source maps, generated output, vendored code, minified/obfuscated text, Unicode confusables, symlinks, and package contents do not conceal a second execution path.

## Privilege and trust boundaries

- Filesystem access is scoped to the declared purpose; user-controlled paths are resolved and constrained against traversal, absolute-path escape, symlink escape, and unsafe overwrite.
- Process execution uses argument arrays where possible; shell strings, environment inheritance, executable lookup, working directories, and user-controlled arguments cannot produce command injection or binary hijacking.
- Network access uses expected destinations and secure transport, has timeouts/cancellation, bounds response sizes, and neither silently uploads data nor follows attacker-controlled destinations with credentials.
- Secrets are sourced narrowly and stay out of prompts, tool results, session entries, logs, notifications, command lines, errors, analytics, and model/provider payloads.
- Project-local configuration and files that influence privileged behavior are honored only inside Pi's trust boundary; use `ctx.isProjectTrusted()` where the extension reads project configuration outside Pi's protected resource loading.
- Destructive, costly, externally visible, or privilege-expanding effects have specific preview/consent gates. Consent describes the actual target and is fail-closed when UI is unavailable.
- Parsing and dispatch avoid `eval`, `Function`, unsafe deserialization, prototype pollution, attacker-selected modules, and unbounded regular expressions or allocations.

## Pi lifecycle and concurrency

- The factory performs bounded initialization only. Long-lived processes, sockets, watchers, and timers start at `session_start` or on demand and stop in an idempotent `session_shutdown` handler.
- Session replacement and reload code does not reuse stale `pi`, context, session-manager, or resource objects; reload is terminal for the old command frame.
- Event ordering and parallel tool execution are accounted for. Shared state, files, and external resources cannot race; file read-modify-write operations use `withFileMutationQueue()` over the complete mutation window.
- State that must survive resume, fork, tree navigation, or reload is persisted in the appropriate session/tool-result representation and reconstructed from the active branch rather than accidental process memory.
- Abort signals, timeouts, cleanup paths, and partial failures leave no orphan process, lock, terminal mode, temporary secret, or corrupt state.
- Mode checks use `ctx.mode === "tui"` for terminal-only components and `ctx.hasUI` for supported dialogs/notifications; headless behavior is defined and safe.

## Tools, hooks, and providers

- Tool names, descriptions, prompt snippets, and guidelines describe the real capability without inducing overuse. Guidelines name the tool explicitly.
- Parameter schemas are strict and bounded; string enums use Pi's Google-compatible mechanism; compatibility transforms run before validation without weakening the public schema.
- Tool results have the documented shape, errors are signaled correctly, sensitive internals stay out of model-visible content, and output is truncated with disclosure and retrievable full-output handling where appropriate.
- Built-in tool overrides preserve exact semantics/result details and required prompt metadata, or clearly declare the divergence.
- `tool_call` mutations are treated as unvalidated after mutation; handlers preserve invariants and blocking gates fail closed on handler errors.
- Prompt/context/message/provider hooks preserve roles and required structure, avoid leaking system prompts or context files, and do not create recursive turns or uncontrolled message injection.
- Provider registration protects API keys and OAuth tokens, validates endpoints, avoids command-backed key resolution unless explicitly intended, and does not downgrade transport or silently reroute requests.

## Correctness and quality

- Implementation matches the documented Pi API version and the extension's claims; event choice matches intended timing and return semantics.
- Inputs, cancellation, empty states, malformed persisted data, network/process failure, and unsupported modes have observable, recoverable behavior.
- Privileged logic is separated from rendering and presentation; names expose effects; comments explain security invariants rather than restating code.
- Tests cover each trust boundary and dangerous sink, including negative cases, traversal/injection payloads, denied consent, cancellation, concurrency, reload/session replacement, and headless modes relevant to the extension.
- Documentation states capabilities, data handling, destinations, persistence, dependencies, platform requirements, setup/removal, and security-sensitive defaults.
