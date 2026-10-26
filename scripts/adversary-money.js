import { getCurrencyKey, getCurrencyLabel } from "./prices.js";
import { MODULE_ID, checkedValues, rerenderActorSheets } from "./shared.js";

const DEFAULT_TABLE = "Money from Enemies (HB)";
// Inline rolls as Foundry finds them in text: [[/r 2d6 # Silver]]{label}, or [[2d6]] followed by the currency name.
const INLINE_ROLL = /\[\[(\/[a-zA-Z]+\s)?(.*?)(]{2,3})(?:{([^}]+)})?/gi;
// The level chosen last in this session, so a group of adversaries of one kind is rolled without choosing again.
let lastLevelId = null;

/**
 * A GM-only button in the adversary inventory that rolls the money the adversary carries and adds it to its gold. The
 * money comes from a roll table (the adversaryMoneyTable setting), whose Daggerheart roll formulas are wealth levels: the
 * GM picks one, the table is rolled with it, and the inline rolls in the drawn result's text are rolled as the amount,
 * each in the currency its flavor names. The adversaryMoneyButton setting hides the button. Called during init.
 */
export function registerAdversaryMoney() {
	game.settings.register(MODULE_ID, "adversaryMoneyButton", {
		name: "MIST_AGE.AdversaryMoney.Setting.Name",
		hint: "MIST_AGE.AdversaryMoney.Setting.Hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: rerenderActorSheets
	});
	game.settings.register(MODULE_ID, "adversaryMoneyTable", {
		name: "MIST_AGE.AdversaryMoney.Table.Name",
		hint: "MIST_AGE.AdversaryMoney.Table.Hint",
		scope: "world",
		config: false,
		type: String,
		default: DEFAULT_TABLE
	});
	Hooks.on("renderActorSheetV2", injectButton);
}

function localize(key, data) {
	return data ? game.i18n.format(`MIST_AGE.AdversaryMoney.${key}`, data) : game.i18n.localize(`MIST_AGE.AdversaryMoney.${key}`);
}

/** Puts the button under the gold of an adversary's inventory tab, for the GM only. */
function injectButton(sheet, element) {
	const actor = sheet.document;
	const tab = element.querySelector(".tab.inventory");
	if (actor?.type !== "adversary" || !game.user.isGM || !game.settings.get(MODULE_ID, "adversaryMoneyButton") || !actor.system.gold
		|| !tab || tab.querySelector(".mist-money-roll")) {
		return;
	}
	const tooltip = foundry.utils.escapeHTML(localize("Tooltip", { table: getTableName() }));
	const html = `
		<div class="mist-money-roll">
			<button type="button" data-tooltip="${tooltip}"><i class="fa-solid fa-sack-dollar" inert></i> ${localize("Button")}</button>
		</div>`;
	const gold = tab.querySelector(".gold-section");
	if (gold) {
		gold.insertAdjacentHTML("afterend", html);
	} else {
		tab.insertAdjacentHTML("afterbegin", html);
	}
	const button = tab.querySelector(".mist-money-roll button");
	button.addEventListener("click", async () => {
		button.disabled = true;
		try {
			await rollMoney(actor);
		} finally {
			button.disabled = false;
		}
	});
}

function getTableName() {
	return game.settings.get(MODULE_ID, "adversaryMoneyTable")?.trim() || DEFAULT_TABLE;
}

function findTable() {
	const wanted = getTableName().toLowerCase();
	return game.tables.find(table => table.name.trim().toLowerCase() === wanted) ?? null;
}

async function rollMoney(actor) {
	const table = findTable();
	if (!table) {
		ui.notifications.warn(localize("NoTable", { table: getTableName() }));
		return;
	}
	const level = await chooseLevel(actor, table);
	if (!level) {
		return;
	}
	const { results } = await table.roll({ selectedFormula: level.formula || undefined });
	const result = results[0];
	const parts = result ? parseMoney(`${result.description ?? result.text ?? ""} ${result.name ?? ""}`) : [];
	if (!parts.length) {
		ui.notifications.warn(localize("NoMoney", { table: table.name, result: result?.name ?? "" }));
		return;
	}

	const rolls = [];
	const totals = {};
	for (const part of parts) {
		const key = getCurrencyKey(part.currency);
		if (!key) {
			ui.notifications.warn(localize("UnknownCurrency", { currency: part.currency || part.formula }));
			continue;
		}
		let roll;
		try {
			roll = await new Roll(part.formula, {}, { flavor: getCurrencyLabel(key) }).evaluate();
		} catch (error) {
			ui.notifications.error(localize("BadFormula", { formula: part.formula }));
			console.error(`${MODULE_ID} | Could not roll ${part.formula}`, error);
			continue;
		}
		rolls.push(roll);
		totals[key] = (totals[key] ?? 0) + Math.max(0, Math.floor(roll.total));
	}

	const gained = Object.entries(totals).filter(([, amount]) => amount > 0);
	if (gained.length) {
		await actor.update(Object.fromEntries(gained.map(([key, amount]) => [`system.gold.${key}`, (Number(actor.system.gold[key]) || 0) + amount])));
	}
	const money = gained.map(([key, amount]) => `${amount} ${getCurrencyLabel(key)}`).join(", ");
	const name = foundry.utils.escapeHTML(actor.name);
	const levelName = foundry.utils.escapeHTML(result.name || level.name);
	await ChatMessage.implementation.create({
		speaker: ChatMessage.implementation.getSpeaker({ actor }),
		whisper: game.users.filter(user => user.isGM).map(user => user.id),
		flavor: `<strong>${localize("Message.Title", { name })}</strong> (${levelName})<br>${money ? localize("Message.Added", { money }) : localize("Message.Nothing")}`,
		rolls
	});
}

/** The wealth levels of a table: its Daggerheart base formula and alternative formulas, by the row they draw. */
function getLevels(table) {
	const flag = table.flags?.daggerheart ?? {};
	const levels = [
		{ id: "", name: flag.formulaName || table.name, formula: table.formula },
		...Object.entries(flag.altFormula ?? {}).map(([id, alt]) => ({ id, name: alt.name, formula: alt.formula }))
	];
	const order = level => constantValue(level.formula) ?? Infinity;
	return levels.sort((a, b) => order(a) - order(b));
}

/** The number a formula always rolls, such as "3", or null for a formula with dice. */
function constantValue(formula) {
	const value = Number(formula);
	return formula?.trim() && Number.isFinite(value) ? value : null;
}

/** Asks the GM how wealthy the adversary is; a table without alternative formulas is rolled as it is. Null if cancelled. */
async function chooseLevel(actor, table) {
	const levels = getLevels(table);
	if (levels.length === 1) {
		return levels[0];
	}
	const active = table.flags?.daggerheart?.activeAltFormula ?? "";
	const selected = levels.find(level => level.id === lastLevelId)?.id ?? levels.find(level => level.id === active)?.id ?? "";
	const rows = levels.map(level => {
		const hint = describeLevel(table, level);
		return `
			<label class="mist-jam-option">
				<input type="radio" name="level" value="${level.id}" ${level.id === selected ? "checked" : ""}>
				<span class="mist-money-level"><strong>${foundry.utils.escapeHTML(level.name)}</strong>${hint ? `<small>${hint}</small>` : ""}</span>
			</label>`;
	}).join("");
	const id = await foundry.applications.api.DialogV2.prompt({
		window: { title: localize("Dialog.Title", { name: actor.name }), icon: "fa-solid fa-sack-dollar" },
		position: { width: 520 },
		content: `<p>${localize("Dialog.Hint")}</p><div class="mist-jam-options">${rows}</div>`,
		ok: {
			label: localize("Dialog.Button"),
			icon: "fa-solid fa-dice",
			callback: (event, button) => checkedValues(button.form, "level")[0] ?? ""
		}
	});
	const level = levels.find(entry => entry.id === id);
	if (level) {
		lastLevelId = level.id;
	}
	return level ?? null;
}

/** The text of the row a level always draws, with its rolls shown as their labels: "2d6 Silver — Smiths, guards". */
function describeLevel(table, level) {
	const value = constantValue(level.formula);
	const result = value === null ? null : table.getResultsForRoll(value)[0];
	const html = result?.description ?? result?.text ?? "";
	return html
		.replace(INLINE_ROLL, (whole, command, content, close, label) => label ?? content.split("#")[0].trim())
		.replace(/<\/p>\s*<p[^>]*>/gi, " — ")
		.replace(/<[^>]*>/g, "")
		.trim();
}

/** The money rolls in a result's text: each inline roll, in the currency named by its flavor or by the word after it. */
function parseMoney(text) {
	return [...text.matchAll(INLINE_ROLL)].map(match => {
		const [whole, , content] = match;
		const [formula, flavor] = content.split("#").map(part => part.trim());
		const following = text.slice(match.index + whole.length).match(/^\s*(\p{L}+)/u)?.[1];
		return { formula, currency: flavor || following || "" };
	}).filter(part => part.formula);
}
