import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	getAgentDir,
	getSettingsListTheme,
	type BuildSystemPromptOptions,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

const CONFIG_PATH = join(getAgentDir(), "skill-visibility.json");
const CONFIG_VERSION = 1;
const VISIBLE = "进入系统提示词";
const HIDDEN = "仅手动调用";
const DECLARED_HIDDEN = "Skill 自带隐藏";

interface StoredConfig {
	version: number;
	hiddenSkillPaths: string[];
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function readHiddenPaths(value: unknown): Set<string> {
	if (!value || typeof value !== "object") return new Set();
	const config = value as Partial<StoredConfig>;
	if (config.version !== CONFIG_VERSION || !Array.isArray(config.hiddenSkillPaths)) return new Set();
	return new Set(config.hiddenSkillPaths.filter((path): path is string => typeof path === "string" && path.length > 0));
}

async function loadConfig(): Promise<Set<string>> {
	try {
		return readHiddenPaths(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
		throw error;
	}
}

async function saveConfig(hiddenSkillPaths: Set<string>): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	const temporaryPath = `${CONFIG_PATH}.${process.pid}.tmp`;
	const config: StoredConfig = {
		version: CONFIG_VERSION,
		hiddenSkillPaths: [...hiddenSkillPaths].sort(),
	};
	await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await rename(temporaryPath, CONFIG_PATH);
}

function hideSelectedSkills(systemPrompt: string, options: BuildSystemPromptOptions, hiddenPaths: Set<string>): string {
	const selected = (options.skills ?? []).filter((skill) => hiddenPaths.has(skill.filePath));
	if (selected.length === 0) return systemPrompt;

	for (const skill of selected) skill.disableModelInvocation = true;
	const locations = new Set(selected.map((skill) => escapeXml(skill.filePath)));

	return systemPrompt
		.replace(/  <skill>\n[\s\S]*?  <\/skill>\n?/g, (block) =>
			[...locations].some((location) => block.includes(`<location>${location}</location>`)) ? "" : block,
		)
		.replace(/\n?<available_skills>\n\s*<\/available_skills>/, "");
}

export default async function skillVisibilityExtension(pi: ExtensionAPI) {
	const hiddenPaths = await loadConfig();
	const knownPaths = new Set<string>();
	const intrinsicallyHiddenPaths = new Set<string>();
	let pendingSave = Promise.resolve();

	function rememberIntrinsicVisibility(skills: NonNullable<BuildSystemPromptOptions["skills"]>): void {
		for (const skill of skills) {
			if (knownPaths.has(skill.filePath)) continue;
			knownPaths.add(skill.filePath);
			if (skill.disableModelInvocation) intrinsicallyHiddenPaths.add(skill.filePath);
		}
	}

	function applyVisibilityFlags(skills: NonNullable<BuildSystemPromptOptions["skills"]>): void {
		rememberIntrinsicVisibility(skills);
		for (const skill of skills) {
			skill.disableModelInvocation = intrinsicallyHiddenPaths.has(skill.filePath) || hiddenPaths.has(skill.filePath);
		}
	}

	pi.registerCommand("skill-visibility", {
		description: "选择哪些 Skill 不进入系统提示词",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/skill-visibility 仅支持 TUI 模式", "error");
				return;
			}

			const skills = [...(ctx.getSystemPromptOptions().skills ?? [])].sort((left, right) =>
				left.name.localeCompare(right.name) || left.filePath.localeCompare(right.filePath),
			);
			applyVisibilityFlags(skills);
			if (skills.length === 0) {
				ctx.ui.notify("当前环境没有加载任何 Skill", "info");
				return;
			}

			await ctx.ui.custom((tui, theme, _keybindings, done) => {
				const skillsByPath = new Map(skills.map((skill) => [skill.filePath, skill]));
				const items: SettingItem[] = skills.map((skill) => {
					const declaredHidden = intrinsicallyHiddenPaths.has(skill.filePath);
					return {
						id: skill.filePath,
						label: skill.name,
						description: declaredHidden
							? `${skill.sourceInfo.source} · 该 Skill 自身已声明 disable-model-invocation: true`
							: `${skill.sourceInfo.scope} · ${skill.sourceInfo.origin} · ${skill.sourceInfo.source}`,
						currentValue: declaredHidden ? DECLARED_HIDDEN : hiddenPaths.has(skill.filePath) ? HIDDEN : VISIBLE,
						values: declaredHidden ? undefined : [VISIBLE, HIDDEN],
					};
				});

				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("Skill 系统提示词可见性")), 1, 1));
				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 18),
					getSettingsListTheme(),
					(id, value) => {
						if (value === HIDDEN) hiddenPaths.add(id);
						else hiddenPaths.delete(id);
						const skill = skillsByPath.get(id);
						if (skill) skill.disableModelInvocation = intrinsicallyHiddenPaths.has(id) || hiddenPaths.has(id);
						pendingSave = pendingSave
							.then(() => saveConfig(hiddenPaths))
							.catch((error) => ctx.ui.notify(`保存 Skill 可见性失败：${String(error)}`, "error"));
					},
					() => done(undefined),
					{ enableSearch: true },
				);
				container.addChild(settingsList);

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			});

			await pendingSave;
		},
	});

	pi.on("before_agent_start", (event) => {
		applyVisibilityFlags(event.systemPromptOptions.skills ?? []);
		return {
			systemPrompt: hideSelectedSkills(event.systemPrompt, event.systemPromptOptions, hiddenPaths),
		};
	});
}
