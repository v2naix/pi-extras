import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const actions = ["status", "add", "remove", "apply", "capture"] as const;
type CatalogAction = (typeof actions)[number];

function expandHome(path: string): string {
	if (path === "~") return homedir();
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function getCatalogScript(): string {
	const root = process.env.PI_PACKAGE_CATALOG_DIR
		? resolve(expandHome(process.env.PI_PACKAGE_CATALOG_DIR))
		: join(homedir(), ".pi", "pi-package-catalog");
	return join(root, "scripts", "catalog.ts");
}

export default function packageCatalogExtension(pi: ExtensionAPI) {
	// Pi executes sibling tool calls in parallel. Serialize catalog operations so two
	// add/remove/apply calls cannot overwrite each other's atomic read-modify-write.
	let operationQueue = Promise.resolve();

	async function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
		const previous = operationQueue;
		let release!: () => void;
		operationQueue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}

	pi.registerTool({
		name: "pi_package_catalog",
		label: "Pi Package Catalog",
		description: `Manage the user's shared Pi package catalog at ~/.pi/pi-package-catalog. Actions: status shows machine-local enablement; add/remove update the shared catalog and Pi settings; apply merges the catalog and local choices into Pi settings; capture saves choices after the user has run 'pi config' directly. The interactive catalog config flow must be run by the user in a terminal and is intentionally not exposed here. Output is limited to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
		promptSnippet: "Manage the shared Pi package catalog and machine-local package selections",
		promptGuidelines: [
			"Use pi_package_catalog instead of directly editing catalog.json, catalog.local.json, or the packages array in Pi settings when the user asks to inspect, add, remove, apply, or capture catalog-managed Pi packages.",
			"Do not use pi_package_catalog capture unless the user has changed package resource selections with 'pi config'; capture records the current machine's choices, not the shared package list.",
		],
		parameters: Type.Object({
			action: StringEnum(actions, {
				description: "Catalog operation to perform",
			}),
			source: Type.Optional(Type.String({
				description: "Pi package source; required only for add/remove, e.g. npm:pkg or git:github.com/owner/repo@ref",
				minLength: 1,
			})),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const action = params.action as CatalogAction;
			const source = params.source?.trim();
			if ((action === "add" || action === "remove") && !source) {
				throw new Error(`pi_package_catalog ${action} requires a non-empty source`);
			}
			if (action !== "add" && action !== "remove" && source) {
				throw new Error(`pi_package_catalog ${action} does not accept a source`);
			}

			const script = getCatalogScript();
			if (!existsSync(script)) {
				throw new Error(`Pi package catalog was not found at ${script}. Set PI_PACKAGE_CATALOG_DIR if it is installed elsewhere.`);
			}

			onUpdate?.({ content: [{ type: "text", text: `Running package catalog ${action}…` }] });
			return runSerialized(async () => {
				if (signal?.aborted) throw new Error("Pi package catalog operation cancelled");
				const result = await pi.exec(process.execPath, [script, action, ...(source ? [source] : [])], {
					signal,
					timeout: 30_000,
				});
				const rawOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
				const output = rawOutput || `Package catalog ${action} completed successfully.`;
				const truncated = truncateTail(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				if (result.code !== 0) {
					throw new Error(truncated.content || `Package catalog ${action} exited with code ${result.code}`);
				}

				let text = truncated.content;
				if (truncated.truncated) {
					text = `[Earlier output omitted; showing the last ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}).]\n${text}`;
				}
				return {
					content: [{ type: "text", text }],
					details: { action, source, exitCode: result.code, truncated: truncated.truncated },
				};
			});
		},
	});
}
