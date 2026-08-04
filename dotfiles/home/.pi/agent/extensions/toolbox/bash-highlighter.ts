/**
 * Bash command syntax highlighting.
 *
 * The bash grammar used by the generic highlighter does not reliably color
 * command names, flags, paths, or shell operators. This small tokenizer keeps
 * the display useful for shell commands while remaining deliberately forgiving:
 * malformed or incomplete commands are returned as-is rather than breaking the
 * tool row.
 */

export type BashSyntaxToken =
	| "syntaxKeyword"
	| "syntaxFunction"
	| "syntaxString"
	| "syntaxVariable"
	| "syntaxOperator"
	| "syntaxPunctuation"
	| "syntaxNumber"
	| "syntaxType"
	| "syntaxComment"
	| "toolTitle"
	| "toolOutput"
	| "muted";

export interface BashThemeLike {
	fg(color: BashSyntaxToken, text: string): string;
	bold(text: string): string;
}

export interface BashCallArgs {
	command?: string;
	timeout?: number;
}

// Flow-control words use syntaxKeyword. Builtins and external commands use
// syntaxFunction when they appear in command position.
const SHELL_KEYWORDS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"for",
	"while",
	"until",
	"do",
	"done",
	"case",
	"esac",
	"in",
	"function",
	"select",
	"time",
	"coproc",
]);

const SHELL_OPERATORS = [
	";;&",
	"&>>",
	"<<<",
	"<<-",
	"&&",
	"||",
	"|&",
	">>",
	"<<",
	">&",
	"<&",
	"&>",
	"<>",
	">|",
	";;",
	";&",
	"|",
	";",
	"&",
	"(",
	")",
	"{",
	"}",
	"!",
	">",
	"<",
] as const;

const SHELL_PUNCTUATION = new Set(["[", "]", "[[", "]]", ":", ","]);
const SHELL_COMPARISON_OPERATORS = new Set(["=", "==", "!=", "=~", "+", "-", "*", "/", "%"]);

interface HeredocSpec {
	delimiter: string;
	stripTabs: boolean;
}

interface BashScanState {
	expectCommand: boolean;
	expectForVariable: boolean;
	expectFunctionName: boolean;
	pendingHeredocs: HeredocSpec[];
	activeHeredoc?: HeredocSpec;
}

function isWhitespace(char: string): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function color(
	theme: BashThemeLike,
	token: BashSyntaxToken | null,
	text: string,
): string {
	return token && text ? theme.fg(token, text) : text;
}

function isVariableStart(text: string, index: number): boolean {
	if (text[index] !== "$") return false;
	const next = text[index + 1];
	return Boolean(next && (next === "{" || next === "(" || /[A-Za-z_0-9@#?$!*_-]/.test(next)));
}

function consumeVariable(text: string, start: number): number {
	if (text[start] !== "$") return start + 1;
	if (text[start + 1] === "{" || text[start + 1] === "(") {
		const closing = text[start + 1] === "{" ? "}" : ")";
		const end = text.indexOf(closing, start + 2);
		return end === -1 ? text.length : end + 1;
	}

	let end = start + 2;
	if (/[A-Za-z_]/.test(text[start + 1] ?? "")) {
		while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end++;
	}
	return end;
}

function consumeWord(text: string, start: number): number {
	let index = start;
	let quote: "'" | '"' | "`" | undefined;

	while (index < text.length) {
		const char = text[index];

		if (quote) {
			if (char === "\\" && quote !== "'") {
				index += Math.min(2, text.length - index);
				continue;
			}
			if (char === quote) quote = undefined;
			index++;
			continue;
		}

		if (char === "\\") {
			index += Math.min(2, text.length - index);
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			index++;
			continue;
		}
		if (isWhitespace(char) || SHELL_OPERATORS.some((operator) => text.startsWith(operator, index))) {
			break;
		}
		if (char === "$" && text[index + 1] === "(") break;
		if (char === "$" && text[index + 1] === "{") {
			index = consumeVariable(text, index);
			continue;
		}
		index++;
	}

	return index;
}

function matchOperator(text: string, index: number): string | undefined {
	if (text.startsWith("$(", index)) return "$(";
	return SHELL_OPERATORS.find((operator) => text.startsWith(operator, index));
}

function readHeredocDelimiter(text: string, start: number, stripTabs: boolean): HeredocSpec | undefined {
	let index = start;
	while (text[index] === " " || text[index] === "\t") index++;
	if (index >= text.length || text[index] === "\n") return undefined;

	const quote = text[index];
	if (quote === "'" || quote === '"' || quote === "`") {
		const end = text.indexOf(quote, index + 1);
		if (end === -1) return undefined;
		const delimiter = text.slice(index + 1, end);
		return delimiter ? { delimiter, stripTabs } : undefined;
	}

	let end = index;
	while (end < text.length && !isWhitespace(text[end])) end++;
	const delimiter = text.slice(index, end);
	return delimiter ? { delimiter, stripTabs } : undefined;
}

function isEscapedNewline(text: string, newlineIndex: number): boolean {
	let backslashes = 0;
	for (let index = newlineIndex - 1; index >= 0 && text[index] === "\\"; index--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

function isCommentStart(text: string, index: number): boolean {
	if (text[index] !== "#") return false;
	if (index === 0) return true;
	const previous = text[index - 1];
	return isWhitespace(previous) || ";&|(){}".includes(previous);
}

function renderVariableOrString(
	word: string,
	theme: BashThemeLike,
	baseToken: BashSyntaxToken | null,
): string {
	const out: string[] = [];
	let index = 0;
	let plainStart = 0;

	const flushPlain = (end: number) => {
		if (end > plainStart) {
			out.push(color(theme, baseToken, word.slice(plainStart, end)));
		}
	};

	while (index < word.length) {
		const char = word[index];

		if (char === "'" || char === '"' || char === "`") {
			flushPlain(index);
			const quote = char;
			let end = index + 1;
			let literalStart = index;
			let quotedOut = "";

			const flushQuotedLiteral = (literalEnd: number) => {
				if (literalEnd > literalStart) {
					quotedOut += color(theme, "syntaxString", word.slice(literalStart, literalEnd));
				}
			};

			while (end < word.length) {
				if (word[end] === "\\" && quote !== "'") {
					flushQuotedLiteral(end);
					quotedOut += color(theme, "syntaxString", word.slice(end, Math.min(end + 2, word.length)));
					end += Math.min(2, word.length - end);
					literalStart = end;
					continue;
				}
				if (word[end] === quote) {
					flushQuotedLiteral(end);
					quotedOut += color(theme, "syntaxString", quote);
					end++;
					literalStart = end;
					break;
				}
				if (quote === '"' && isVariableStart(word, end)) {
					flushQuotedLiteral(end);
					const variableEnd = consumeVariable(word, end);
					quotedOut += color(theme, "syntaxVariable", word.slice(end, variableEnd));
					end = variableEnd;
					literalStart = end;
					continue;
				}
				end++;
			}
			if (literalStart < end) flushQuotedLiteral(end);

			out.push(quotedOut);
			index = end;
			plainStart = end;
			continue;
		}

		if (char === "\\") {
			flushPlain(index);
			out.push(color(theme, "syntaxString", word.slice(index, Math.min(index + 2, word.length))));
			index += Math.min(2, word.length - index);
			plainStart = index;
			continue;
		}

		if (isVariableStart(word, index) && word[index + 1] !== "(") {
			flushPlain(index);
			const variableEnd = consumeVariable(word, index);
			out.push(color(theme, "syntaxVariable", word.slice(index, variableEnd)));
			index = variableEnd;
			plainStart = index;
			continue;
		}

		index++;
	}

	flushPlain(word.length);
	return out.join("");
}

function renderWord(
	word: string,
	theme: BashThemeLike,
	state: BashScanState,
): string {
	const assignment = /^(?:[A-Za-z_][A-Za-z0-9_]*)=/.exec(word);
	if (state.expectCommand && assignment) {
		const equals = word.indexOf("=");
		return (
			color(theme, "syntaxVariable", word.slice(0, equals)) +
			color(theme, "syntaxOperator", "=") +
			renderVariableOrString(word.slice(equals + 1), theme, null)
		);
	}

	if (SHELL_KEYWORDS.has(word)) {
		if (word === "for") state.expectForVariable = true;
		else if (word === "function") state.expectFunctionName = true;
		state.expectCommand = ["if", "then", "else", "elif", "while", "until", "do", "select", "time", "coproc"].includes(word);
		return color(theme, "syntaxKeyword", word);
	}

	if (state.expectForVariable) {
		state.expectForVariable = false;
		return renderVariableOrString(word, theme, "syntaxVariable");
	}

	if (state.expectFunctionName) {
		state.expectFunctionName = false;
		return renderVariableOrString(word, theme, "syntaxFunction");
	}

	if (SHELL_PUNCTUATION.has(word)) {
		return color(theme, "syntaxPunctuation", word);
	}

	if (SHELL_COMPARISON_OPERATORS.has(word)) {
		return color(theme, "syntaxOperator", word);
	}

	if (/^--?[A-Za-z0-9][\w.-]*(=.*)?$/.test(word) && word !== "-") {
		const equals = word.indexOf("=");
		if (equals !== -1) {
			return (
				color(theme, "syntaxType", word.slice(0, equals)) +
				color(theme, "syntaxOperator", "=") +
				renderVariableOrString(word.slice(equals + 1), theme, null)
			);
		}
		return color(theme, "syntaxType", word);
	}

	if (/^\d+(\.\d+)?$/.test(word)) {
		return color(theme, "syntaxNumber", word);
	}

	if (state.expectCommand) {
		state.expectCommand = false;
		return renderVariableOrString(word, theme, "syntaxFunction");
	}

	return renderVariableOrString(word, theme, null);
}

function updateOperatorState(operator: string, state: BashScanState): void {
	if (operator === "$(" || operator === "(" || operator === "{" || operator === "!" || ["&&", "||", "|", "|&", ";", ";;", ";;&", ";&", "&"].includes(operator)) {
		state.expectCommand = true;
	} else if (operator === ")" || operator === "}") {
		state.expectCommand = false;
	}
}

/**
 * Tokenize and color a shell command. Unknown text is preserved uncolored.
 */
export function highlightBashCommand(
	command: string,
	colorize: (token: BashSyntaxToken, text: string) => string,
): string {
	const theme: BashThemeLike = {
		fg: (token, text) => colorize(token, text),
		bold: (text) => text,
	};
	const out: string[] = [];
	const state: BashScanState = {
		expectCommand: true,
		expectForVariable: false,
		expectFunctionName: false,
		pendingHeredocs: [],
	};

	let index = 0;
	while (index < command.length) {
		if (state.activeHeredoc) {
			const newline = command.indexOf("\n", index);
			const end = newline === -1 ? command.length : newline;
			const line = command.slice(index, end);
			const comparison = state.activeHeredoc.stripTabs ? line.replace(/^\t+/, "") : line;

			// Heredoc bodies belong to the embedded language, not Bash. Keep them
			// untouched until the delimiter line closes the active heredoc.
			out.push(line);
			if (newline === -1) {
				state.activeHeredoc = undefined;
				index = end;
				continue;
			}

			out.push("\n");
			index = end + 1;
			if (comparison === state.activeHeredoc.delimiter) {
				state.activeHeredoc = state.pendingHeredocs.shift();
				if (!state.activeHeredoc) state.expectCommand = true;
			}
			continue;
		}

		const char = command[index];

		if (char === " " || char === "\t" || char === "\r") {
			out.push(char);
			index++;
			continue;
		}
		if (char === "\n") {
			out.push(char);
			state.expectCommand = true;
			state.expectForVariable = false;
			state.expectFunctionName = false;
			if (!isEscapedNewline(command, index) && state.pendingHeredocs.length > 0) {
				state.activeHeredoc = state.pendingHeredocs.shift();
			}
			index++;
			continue;
		}

		if (isCommentStart(command, index)) {
			const newline = command.indexOf("\n", index);
			const end = newline === -1 ? command.length : newline;
			out.push(colorize("syntaxComment", command.slice(index, end)));
			index = end;
			continue;
		}

		const operator = matchOperator(command, index);
		if (operator) {
			const token = operator === "(" || operator === ")" || operator === "{" || operator === "}"
				? "syntaxPunctuation"
				: "syntaxOperator";
			out.push(colorize(token, operator));
			if (operator === "<<" || operator === "<<-") {
				const heredoc = readHeredocDelimiter(command, index + operator.length, operator === "<<-");
				if (heredoc) state.pendingHeredocs.push(heredoc);
			}
			updateOperatorState(operator, state);
			index += operator.length;
			continue;
		}

		const end = consumeWord(command, index);
		if (end === index) {
			out.push(command[index]);
			index++;
			continue;
		}

		out.push(renderWord(command.slice(index, end), theme, state));
		index = end;
	}

	return out.join("");
}

/**
 * Format the Bash tool call row while retaining Pi's timeout display.
 */
export function formatBashCallHighlighted(args: BashCallArgs, theme: BashThemeLike): string {
	const command = typeof args?.command === "string" ? args.command : "";
	const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	const prompt = theme.fg("toolTitle", theme.bold("$ "));

	if (!command) {
		return prompt + theme.fg("toolOutput", "...") + timeoutSuffix;
	}

	try {
		return prompt + highlightBashCommand(command, (token, text) => theme.fg(token, text)) + timeoutSuffix;
	} catch {
		return prompt + command + timeoutSuffix;
	}
}
