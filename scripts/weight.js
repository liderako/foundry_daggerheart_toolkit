import { INVENTORY_TYPES, MODULE_ID, WEIGHT_FLAGS, nameKey, rerenderActorSheets } from "./shared.js";

const SLOTS_PATH = `${WEIGHT_FLAGS}.slots`;
const WORN_PATH = `${WEIGHT_FLAGS}.worn`;
// Active effects can raise capacity by adding to this flag (e.g. a backpack: ADD 4).
const BONUS_PATH = `${WEIGHT_FLAGS}.bonusSlots`;
const WEARABLE_TYPES = new Set(["loot"]);

// Carrying capacity in slots by Strength. Values outside the table continue the nearest step.
const CAPACITY_BY_STRENGTH = { "-1": 18, 0: 20, 1: 24, 2: 28, 3: 32 };
// Per-item defaults (potions, tiny consumables, light armor, small weapons), keyed by nameKey().
const PRESET_WEIGHTS_URL = `modules/${MODULE_ID}/data/weights.json`;
let presetWeights = new Map();

async function loadPresetWeights() {
	const response = await fetch(PRESET_WEIGHTS_URL, { cache: "no-store" });
	if (!response.ok) {
		console.warn(`${MODULE_ID} | Could not load ${PRESET_WEIGHTS_URL}`);
		return;
	}
	const { weights } = await response.json();
	presetWeights = new Map(weights.map(entry => [nameKey(entry.type, entry.name), entry.slots]));
	rerenderActorSheets();
}

/** Weight used while an item has no weight of its own. */
function getDefaultWeight(item) {
	const preset = presetWeights.get(nameKey(item.type, item.name));
	if (preset !== undefined) {
		return preset;
	}
	switch (item.type) {
		case "weapon": {
			return item.system.burden === "twoHanded" ? 3 : 2;
		}
		case "armor": {
			return 4;
		}
		default: {
			return 1;
		}
	}
}

const round = value => Math.round(value * 100) / 100;
const signed = value => (value > 0 ? `+${value}` : `${value}`);

export function getCapacity(strength) {
	const levels = Object.keys(CAPACITY_BY_STRENGTH).map(Number).sort((a, b) => a - b);
	const min = levels[0];
	const max = levels.at(-1);
	if (strength < min) {
		const step = CAPACITY_BY_STRENGTH[min + 1] - CAPACITY_BY_STRENGTH[min];
		return Math.max(0, CAPACITY_BY_STRENGTH[min] - (min - strength) * step);
	}
	if (strength > max) {
		const step = CAPACITY_BY_STRENGTH[max] - CAPACITY_BY_STRENGTH[max - 1];
		return CAPACITY_BY_STRENGTH[max] + (strength - max) * step;
	}
	return CAPACITY_BY_STRENGTH[strength];
}

function hasOwnWeight(item) {
	const raw = foundry.utils.getProperty(item, SLOTS_PATH);
	return raw !== null && raw !== undefined && raw !== "";
}

export function getItemWeight(item) {
	if (!hasOwnWeight(item)) {
		return getDefaultWeight(item);
	}
	return Math.max(0, Number(foundry.utils.getProperty(item, SLOTS_PATH)) || 0);
}

/** Worn armor and worn clothing do not take up slots. */
function isWorn(item) {
	if (item.type === "armor") {
		return !!item.system.equipped;
	}
	return WEARABLE_TYPES.has(item.type) && foundry.utils.getProperty(item, WORN_PATH) === true;
}

function getQuantity(item) {
	return Math.max(0, item.system.quantity ?? 1);
}

export function getItemLoad(item) {
	if (!INVENTORY_TYPES.has(item.type) || isWorn(item)) {
		return 0;
	}
	return getItemWeight(item) * getQuantity(item);
}

export function getEncumbrance(actor) {
	const strength = Number(actor.system.traits?.strength?.value) || 0;
	const bonus = Number(foundry.utils.getProperty(actor, BONUS_PATH)) || 0;
	const baseCapacity = getCapacity(strength);
	const capacity = baseCapacity + bonus;
	const load = round(actor.items.reduce((sum, item) => sum + getItemLoad(item), 0));
	const free = game.settings.get(MODULE_ID, "freeOverload");
	const overload = round(Math.max(0, load - capacity));
	let state = "ok";
	if (overload > free) {
		state = "heavy";
	} else if (overload > 0) {
		state = "overloaded";
	}
	return { strength, bonus, baseCapacity, capacity, load, overload, free, state };
}

function weightIcon() {
	return `<i class="fa-solid fa-weight-hanging" inert></i>`;
}

function injectHeaderWeight(element, item) {
	const container = element.querySelector(".item-sheet-header .item-description");
	if (!container) {
		return;
	}
	container.querySelector(".mist-weight")?.remove();
	const suffix = hasOwnWeight(item) ? "" : ` (${game.i18n.localize("MIST_AGE_WEIGHT.Default")})`;
	const text = `${round(getItemWeight(item))} ${game.i18n.localize("MIST_AGE_WEIGHT.Slots")}${suffix}`;
	container.insertAdjacentHTML("beforeend", `<h3 class="mist-weight">${weightIcon()} ${text}</h3>`);
}

function injectSettingsFields(sheet, element, item) {
	const fieldset = element.querySelector("section.tab[data-tab='settings'] fieldset");
	if (!fieldset || fieldset.querySelector(".mist-weight-field")) {
		return;
	}
	const disabled = sheet.isEditable ? "" : "disabled";
	let html = "";
	if (game.user.isGM) {
		const defaultWeight = getDefaultWeight(item);
		const value = hasOwnWeight(item) ? foundry.utils.getProperty(item, SLOTS_PATH) : "";
		const hint = foundry.utils.escapeHTML(game.i18n.format("MIST_AGE_WEIGHT.WeightHint", { default: defaultWeight }));
		html += `
			<span class="mist-weight-field" data-tooltip="${hint}">${game.i18n.localize("MIST_AGE_WEIGHT.Weight")}</span>
			<input type="number" name="${SLOTS_PATH}" value="${value}" placeholder="${defaultWeight}" min="0" step="any" data-dtype="Number" ${disabled} />`;
	}
	if (WEARABLE_TYPES.has(item.type)) {
		const checked = foundry.utils.getProperty(item, WORN_PATH) ? "checked" : "";
		html += `
			<span class="mist-weight-field">${game.i18n.localize("MIST_AGE_WEIGHT.Worn")}</span>
			<input type="checkbox" name="${WORN_PATH}" ${checked} ${disabled} />`;
	}
	fieldset.insertAdjacentHTML("beforeend", html);
}

function injectInventoryWeights(actor, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		row.querySelector(".mist-weight-tag")?.remove();
		const item = actor.items?.get(row.dataset.itemId);
		if (!item || !INVENTORY_TYPES.has(item.type)) {
			continue;
		}
		let text;
		let tooltip;
		if (isWorn(item)) {
			text = game.i18n.localize("MIST_AGE_WEIGHT.WornTag");
			tooltip = `${round(getItemWeight(item))} ${game.i18n.localize("MIST_AGE_WEIGHT.Slots")}`;
		} else {
			const load = getItemLoad(item);
			if (!load) {
				continue;
			}
			text = `${round(load)}`;
			tooltip = getQuantity(item) > 1 ? `${round(getItemWeight(item))} × ${getQuantity(item)}` : `${text} ${game.i18n.localize("MIST_AGE_WEIGHT.Slots")}`;
		}
		const tag = `<div class="tag mist-weight-tag" data-tooltip="${foundry.utils.escapeHTML(tooltip)}">${weightIcon()} ${text}</div>`;
		const tags = row.querySelector(".item-tags");
		if (tags) {
			tags.insertAdjacentHTML("beforeend", tag);
		} else {
			row.querySelector(".item-name")?.insertAdjacentHTML("afterend", tag);
		}
	}
}

function injectLoadBar(actor, element) {
	const tab = element.querySelector(".tab.inventory");
	if (!tab) {
		return;
	}
	tab.querySelector(".mist-load")?.remove();
	const encumbrance = getEncumbrance(actor);
	const percent = encumbrance.capacity > 0 ? Math.min(100, (encumbrance.load / encumbrance.capacity) * 100) : 100;
	const bonus = encumbrance.bonus ? game.i18n.format("MIST_AGE_WEIGHT.Bonus", { bonus: signed(encumbrance.bonus) }) : "";
	const tooltip = foundry.utils.escapeHTML(game.i18n.format("MIST_AGE_WEIGHT.LoadTooltip", {
		strength: signed(encumbrance.strength),
		capacity: encumbrance.baseCapacity,
		bonus,
		free: encumbrance.free
	}));
	let status = "";
	if (encumbrance.state === "overloaded") {
		status = `${game.i18n.localize("MIST_AGE_WEIGHT.Overloaded")} (+${encumbrance.overload})`;
	} else if (encumbrance.state === "heavy") {
		status = `${game.i18n.localize("MIST_AGE_WEIGHT.HeavilyOverloaded")} (+${encumbrance.overload})`;
	}
	const html = `
		<div class="mist-load mist-load-${encumbrance.state}" data-tooltip="${tooltip}">
			<span class="mist-load-label">${weightIcon()} ${game.i18n.localize("MIST_AGE_WEIGHT.Load")}</span>
			<div class="mist-load-bar"><div class="mist-load-fill" style="width: ${percent}%"></div></div>
			<span class="mist-load-value">${encumbrance.load} / ${encumbrance.capacity}</span>
			${status ? `<span class="mist-load-status">${status}</span>` : ""}
		</div>`;
	const anchor = tab.querySelector(".gold-section") ?? tab.querySelector(".search-section");
	if (anchor) {
		anchor.insertAdjacentHTML("afterend", html);
	} else {
		tab.insertAdjacentHTML("afterbegin", html);
	}
}

/** Called during init: settings, the weight API, preset weights and sheet rendering. */
export function registerWeight() {
	game.settings.register(MODULE_ID, "freeOverload", {
		name: "MIST_AGE_WEIGHT.FreeOverload.Name",
		hint: "MIST_AGE_WEIGHT.FreeOverload.Hint",
		scope: "world",
		config: true,
		type: Number,
		default: 8,
		onChange: rerenderActorSheets
	});
	const module = game.modules.get(MODULE_ID);
	module.api = { ...module.api, getCapacity, getItemWeight, getItemLoad, getEncumbrance };
	loadPresetWeights();

	Hooks.on("renderItemSheetV2", (sheet, element) => {
		if (!INVENTORY_TYPES.has(sheet.document.type)) {
			return;
		}
		injectHeaderWeight(element, sheet.document);
		injectSettingsFields(sheet, element, sheet.document);
	});

	Hooks.on("renderActorSheetV2", (sheet, element) => {
		const actor = sheet.document;
		injectInventoryWeights(actor, element);
		if (actor.type === "character" && !game.itempiles?.API.isValidItemPile(actor)) {
			injectLoadBar(actor, element);
		}
	});
}
