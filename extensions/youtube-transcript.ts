import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

interface SubtitleTrack {
	language: string;
	label: string;
	automatic: boolean;
}

const TRUSTED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

function validateYouTubeUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Invalid YouTube URL");
	}
	if (url.protocol !== "https:" || !TRUSTED_HOSTS.has(url.hostname.toLowerCase())) {
		throw new Error("Only HTTPS youtube.com and youtu.be URLs are allowed");
	}
	return url.toString();
}

function parseSubtitleListing(output: string): { title: string; tracks: SubtitleTrack[] } {
	let title = "YouTube video";
	let explicitAutomatic: boolean | null = null;
	let currentTable: Array<{ language: string; label: string }> | null = null;
	const tables: Array<Array<{ language: string; label: string }>> = [];

	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.startsWith("TITLE:")) {
			title = line.slice("TITLE:".length).trim() || title;
			continue;
		}
		if (line.includes("Available automatic captions")) {
			explicitAutomatic = true;
			continue;
		}
		if (line.includes("Available subtitles")) {
			explicitAutomatic = false;
			continue;
		}
		if (line.startsWith("Language")) {
			currentTable = [];
			tables.push(currentTable);
			continue;
		}
		if (!line || !currentTable) continue;
		const match = line.match(/^(\S+)\s+(.+?)\s+(?:vtt|srt|ttml|srv\d|json3)(?:,|$)/);
		if (!match) continue;
		currentTable.push({ language: match[1], label: match[2].trim() });
	}

	const tracks: SubtitleTrack[] = [];
	for (let index = 0; index < tables.length; index++) {
		const table = tables[index];
		// yt-dlp prints automatic captions first and creator subtitles second.
		// With one unlabeled table, translated tracks or a large language list indicate automatic captions.
		const automatic = tables.length > 1
			? index < tables.length - 1
			: explicitAutomatic ?? (table.length > 20 || table.some((track) => /\bfrom\b/i.test(track.label)));
		for (const track of table) tracks.push({ ...track, automatic });
	}

	return { title, tracks };
}

function chooseTrack(tracks: SubtitleTrack[], requested?: string): SubtitleTrack | null {
	const manual = tracks.filter((track) => !track.automatic);
	const automatic = tracks.filter((track) => track.automatic);
	const pools = [manual, automatic];
	const matchesLanguage = (track: SubtitleTrack, language: string) => {
		const candidate = track.language.toLowerCase();
		const preferred = language.toLowerCase();
		return candidate === preferred || candidate.startsWith(`${preferred}-`);
	};

	if (requested) {
		for (const pool of pools) {
			const match = pool.find((track) => matchesLanguage(track, requested));
			if (match) return match;
		}
	}

	// Prefer English across both manual and automatic tracks, then Chinese.
	// Within each language group, creator-provided subtitles still beat automatic captions.
	for (const language of ["en", "zh-Hans", "zh-Hant", "zh-CN", "zh-TW", "zh"]) {
		for (const pool of pools) {
			const match = pool.find((track) => matchesLanguage(track, language));
			if (match) return match;
		}
	}

	for (const pool of pools) {
		const original = pool.find((track) => !/\bfrom\b/i.test(track.label));
		if (original) return original;
		if (pool[0]) return pool[0];
	}

	return null;
}

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)));
}

function cleanVtt(vtt: string): string {
	const cues: string[] = [];
	let cueLines: string[] = [];

	const flush = () => {
		const cue = decodeEntities(cueLines.join(" "))
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (cue && cue !== cues[cues.length - 1]) cues.push(cue);
		cueLines = [];
	};

	for (const rawLine of vtt.replace(/^\uFEFF/, "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) {
			flush();
			continue;
		}
		if (line === "WEBVTT" || line.startsWith("Kind:") || line.startsWith("Language:")) continue;
		if (line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) continue;
		if (/^\d+$/.test(line) || line.includes("-->")) continue;
		cueLines.push(line);
	}
	flush();

	let merged = "";
	for (const cue of cues) {
		if (!merged) {
			merged = cue;
			continue;
		}
		if (merged.endsWith(cue)) continue;
		let overlap = 0;
		const max = Math.min(merged.length, cue.length, 300);
		for (let size = max; size >= 3; size--) {
			if (merged.slice(-size) === cue.slice(0, size)) {
				overlap = size;
				break;
			}
		}
		merged += overlap > 0 ? cue.slice(overlap) : `\n${cue}`;
	}

	return merged.replace(/[ \t]+\n/g, "\n").trim();
}

function safeFileName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "video";
}

export default function youtubeTranscriptExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "youtube_transcript",
		label: "YouTube Transcript",
		description: "Extract a YouTube video's existing subtitles locally with yt-dlp, without browser cookies or API keys. Returns cleaned transcript text for summarization. Does not analyze visuals. Output is limited to 50KB; full long transcripts are saved to a local cache file.",
		promptSnippet: "Extract YouTube subtitles locally without browser cookies or API keys",
		promptGuidelines: [
			"Use youtube_transcript first when the user asks to summarize a YouTube video; summarize the returned transcript and clearly note that visual-only content was not analyzed.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "HTTPS YouTube video URL" }),
			language: Type.Optional(Type.String({ description: "Preferred subtitle language code, such as zh-TW, zh-Hans, or en" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const url = validateYouTubeUrl(params.url);
			onUpdate?.({ content: [{ type: "text", text: "Checking available subtitles…" }] });

			const listing = await pi.exec("yt-dlp", [
				"--skip-download",
				"--no-playlist",
				"--no-warnings",
				"--print", "TITLE:%(title)s",
				"--list-subs",
				url,
			], { signal, timeout: 60_000 });

			if (listing.code !== 0) {
				const message = listing.stderr.trim() || listing.stdout.trim() || "yt-dlp failed to inspect the video";
				if (/ENOENT|not found|command not found/i.test(message)) {
					throw new Error("yt-dlp is not installed. Install it with: brew install yt-dlp");
				}
				throw new Error(message.slice(0, 1000));
			}

			const info = parseSubtitleListing(`${listing.stdout}\n${listing.stderr}`);
			const track = chooseTrack(info.tracks, params.language);
			if (!track) {
				throw new Error("This video has no downloadable subtitles. Audio transcription (for example with Whisper) is required.");
			}

			onUpdate?.({ content: [{ type: "text", text: `Downloading ${track.language} ${track.automatic ? "automatic" : "manual"} subtitles…` }] });
			const tempDir = await mkdtemp(join(tmpdir(), "pi-youtube-transcript-"));
			try {
				const args = [
					"--skip-download",
					"--no-playlist",
					"--no-warnings",
					track.automatic ? "--write-auto-subs" : "--write-subs",
					"--sub-langs", track.language,
					"--sub-format", "vtt",
					"--output", join(tempDir, "%(id)s.%(ext)s"),
					url,
				];
				const download = await pi.exec("yt-dlp", args, { signal, timeout: 90_000 });
				if (download.code !== 0) {
					throw new Error((download.stderr.trim() || download.stdout.trim() || "Subtitle download failed").slice(0, 1000));
				}

				const files = await readdir(tempDir);
				const subtitleFile = files.find((file) => file.endsWith(".vtt"));
				if (!subtitleFile) throw new Error("yt-dlp completed but did not produce a VTT subtitle file");

				const transcript = cleanVtt(await readFile(join(tempDir, subtitleFile), "utf8"));
				if (!transcript) throw new Error("The downloaded subtitle file was empty after cleaning");

				const header = `# ${info.title}\n\nSubtitle: ${track.language} (${track.automatic ? "YouTube automatic captions" : "creator-provided"})\n\n`;
				const fullOutput = header + transcript;
				const truncated = truncateHead(fullOutput, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
				let output = truncated.content;
				let cachePath: string | undefined;

				if (truncated.truncated) {
					const cacheDir = join(homedir(), ".pi", "agent", "cache", "youtube-transcripts");
					await mkdir(cacheDir, { recursive: true, mode: 0o700 });
					cachePath = join(cacheDir, `${safeFileName(subtitleFile.replace(/\..*$/, ""))}.txt`);
					await writeFile(cachePath, fullOutput, { encoding: "utf8", mode: 0o600 });
					output += `\n\n[Transcript truncated to ${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}. Full transcript saved at: ${cachePath}]`;
				}

				return {
					content: [{ type: "text", text: output }],
					details: {
						title: info.title,
						language: track.language,
						automatic: track.automatic,
						cachePath,
						visualsAnalyzed: false,
					},
				};
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	});
}
