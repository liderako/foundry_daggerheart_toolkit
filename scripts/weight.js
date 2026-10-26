import { INVENTORY_TYPES, MODULE_ID, WEIGHT_FLAGS, nameKey, rerenderActorSheets } from "./shared.js";

const SLOTS_PATH = `${WEIGHT_FLAGS}.slots`;
const WORN_PATH = `${WEIGHT_FLAGS}.worn`;
// Active effects can raise capacity by adding to this flag (e.g. a backpack: ADD 10).
const BONUS_PATH = `${WEIGHT_FLAGS}.bonusSlots`;
// Capacity typed in by whoever can edit the sheet; replaces the Strength formula. Adversaries and companions always
// allow it, characters only while the GM turns on the characterManualCapacity setting.
const CAPACITY_PATH = `${WEIGHT_FLAGS}.capacity`;
const MANUAL_CAPACITY_TYPES = new Set(["adversary", "companion"]);
const WEARABLE_TYPES = new Set(["loot"]);
const LOAD_BAR_TYPES = new Set(["character", "adversary", "companion"]);

// Capacity formula, editable in the module settings. The Mist Age defaults give Strength -1 = 8, 0 = 10, 1 = 14,
// 2 = 18, 3 = 22 slots: 10 base, +4 per point of Strength, -2 per point below 0. A backpack adds 10 by effect.
const CAPACITY_DEFAULTS = { capacityBase: 10, capacityPerStrength: 4, capacityPerNegativeStrength: 2 };
// Per-item defaults (potions, tiny consumables, light armor, small weapons), keyed by nameKey().
const PRESET_WEIGHTS_URL = `modules/${MODULE_ID}/data/weights.json`;
let presetWeights = new Map();
// Called when weights or load settings change, so loads computed elsewhere (the overload icon) are refreshed.
export const LOAD_RULES_HOOK = "mistAgeToolkit.loadRulesChanged";

function onLoadRulesChanged() {
	rerenderActorSheets();
	Hooks.callAll(LOAD_RULES_HOOK);
}

async function loadPresetWeights() {
	const response = await fetch(PRESET_WEIGHTS_URL, { cache: "no-store" });
	if (!response.ok) {
		console.warn(`${MODULE_ID} | Could not load ${PRESET_WEIGHTS_URL}`);
		return;
	}
	const { weights } = await response.json();
	presetWeights = new Map(weights.map(entry => [nameKey(entry.type, entry.name), entry.slots]));
	onLoadRulesChanged();
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

/** Base capacity plus a step per point of Strength, with a separate step for each point below 0. */
export function getCapacity(strength) {
	const value = key => {
		const number = Number(game.settings.get(MODULE_ID, key));
		return Number.isFinite(number) ? number : CAPACITY_DEFAULTS[key];
	};
	const perPoint = strength >= 0 ? value("capacityPerStrength") : value("capacityPerNegativeStrength");
	return Math.max(0, value("capacityBase") + strength * perPoint);
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

/** Characters only have a carrying limit while the characterCapacity setting is on; other actors always do. */
function hasCapacityLimit(actor) {
	return actor.type !== "character" || game.settings.get(MODULE_ID, "characterCapacity");
}

function allowsManualCapacity(actor) {
	return MANUAL_CAPACITY_TYPES.has(actor.type) || (actor.type === "character" && game.settings.get(MODULE_ID, "characterManualCapacity"));
}

/**
 * Adversaries and companions have no Strength trait: they use a capacity set by hand, or the Strength 0 capacity.
 * Without a carrying limit the load is still counted, but there is never an overload.
 */
export function getEncumbrance(actor) {
	const limited = hasCapacityLimit(actor);
	const hasStrength = actor.system.traits?.strength !== undefined;
	const strength = Number(actor.system.traits?.strength?.value) || 0;
	const bonus = Number(foundry.utils.getProperty(actor, BONUS_PATH)) || 0;
	const formulaCapacity = getCapacity(strength);
	const ownCapacity = foundry.utils.getProperty(actor, CAPACITY_PATH);
	const manualCapacity = allowsManualCapacity(actor) && ownCapacity !== null && ownCapacity !== undefined && ownCapacity !== "";
	const baseCapacity = manualCapacity ? Math.max(0, Number(ownCapacity) || 0) : formulaCapacity;
	const capacity = baseCapacity + bonus;
	const load = round(actor.items.reduce((sum, item) => sum + getItemLoad(item), 0));
	const free = game.settings.get(MODULE_ID, "freeOverload");
	const overload = limited ? round(Math.max(0, load - capacity)) : 0;
	let state = "ok";
	if (overload > free) {
		state = "heavy";
	} else if (overload > 0) {
		state = "overloaded";
	}
	return { limited, hasStrength, strength, bonus, manualCapacity, formulaCapacity, baseCapacity, capacity, load, overload, free, state };
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

/** Whoever can edit the sheet, except that the characterCapacityGMOnly setting keeps character capacity to the GM. */
function canEditCapacity(sheet) {
	if (!allowsManualCapacity(sheet.document) || !sheet.isEditable) {
		return false;
	}
	return sheet.document.type !== "character" || game.user.isGM || !game.settings.get(MODULE_ID, "characterCapacityGMOnly");
}

/** The capacity as text, or, where it can be set by hand, an input (empty = formula). */
function capacityHTML(sheet, encumbrance) {
	if (!canEditCapacity(sheet)) {
		return `${encumbrance.capacity}`;
	}
	const value = encumbrance.manualCapacity ? encumbrance.baseCapacity : "";
	const hint = foundry.utils.escapeHTML(game.i18n.format("MIST_AGE_WEIGHT.CapacityHint", { default: encumbrance.formulaCapacity }));
	const bonus = encumbrance.bonus ? ` ${signed(encumbrance.bonus)}` : "";
	return `<input class="mist-load-capacity" type="number" name="${CAPACITY_PATH}" value="${value}" placeholder="${encumbrance.formulaCapacity}" min="0" step="any" data-dtype="Number" data-tooltip="${hint}" />${bonus}`;
}

function injectLoadBar(sheet, element) {
	const tab = element.querySelector(".tab.inventory");
	if (!tab) {
		return;
	}
	tab.querySelector(".mist-load")?.remove();
	const encumbrance = getEncumbrance(sheet.document);
	const anchor = tab.querySelector(".gold-section") ?? tab.querySelector(".search-section");
	const insert = html => (anchor ? anchor.insertAdjacentHTML("afterend", html) : tab.insertAdjacentHTML("afterbegin", html));
	if (!encumbrance.limited) {
		const tooltip = foundry.utils.escapeHTML(game.i18n.localize("MIST_AGE_WEIGHT.LoadUnlimitedTooltip"));
		insert(`
			<div class="mist-load mist-load-ok mist-load-unlimited" data-tooltip="${tooltip}">
				<span class="mist-load-label">${weightIcon()} ${game.i18n.localize("MIST_AGE_WEIGHT.Load")}</span>
				<span class="mist-load-value">${encumbrance.load} ${game.i18n.localize("MIST_AGE_WEIGHT.Slots")}</span>
			</div>`);
		return;
	}
	const percent = encumbrance.capacity > 0 ? Math.min(100, (encumbrance.load / encumbrance.capacity) * 100) : 100;
	const bonus = encumbrance.bonus ? game.i18n.format("MIST_AGE_WEIGHT.Bonus", { bonus: signed(encumbrance.bonus) }) : "";
	let tooltipKey = encumbrance.hasStrength ? "MIST_AGE_WEIGHT.LoadTooltip" : "MIST_AGE_WEIGHT.LoadTooltipNoStrength";
	if (encumbrance.manualCapacity) {
		tooltipKey = "MIST_AGE_WEIGHT.LoadTooltipManual";
	}
	const tooltip = foundry.utils.escapeHTML(game.i18n.format(tooltipKey, {
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
	insert(`
		<div class="mist-load mist-load-${encumbrance.state}" data-tooltip="${tooltip}">
			<span class="mist-load-label">${weightIcon()} ${game.i18n.localize("MIST_AGE_WEIGHT.Load")}</span>
			<div class="mist-load-bar"><div class="mist-load-fill" style="width: ${percent}%"></div></div>
			<span class="mist-load-value">${encumbrance.load} / ${capacityHTML(sheet, encumbrance)}</span>
			${status ? `<span class="mist-load-status">${status}</span>` : ""}
		</div>`);
}

/** Called during init: settings, the weight API, preset weights and sheet rendering. */
export function registerWeight() {
	// Edited in the toolkit settings window (settings-menu.js); labels are MIST_AGE_WEIGHT.<Key>.Name / .Hint.
	const settings = {
		...Object.fromEntries(Object.entries(CAPACITY_DEFAULTS).map(([key, value]) => [key, { type: Number, default: value }])),
		characterCapacity: { type: Boolean, default: true },
		characterManualCapacity: { type: Boolean, default: false },
		characterCapacityGMOnly: { type: Boolean, default: false },
		freeOverload: { type: Number, default: 8 }
	};
	for (const [key, { type, default: initial }] of Object.entries(settings)) {
		const label = `MIST_AGE_WEIGHT.${key[0].toUpperCase()}${key.slice(1)}`;
		game.settings.register(MODULE_ID, key, {
			name: `${label}.Name`,
			hint: `${label}.Hint`,
			scope: "world",
			config: false,
			type,
			default: initial,
			onChange: onLoadRulesChanged
		});
	}
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
		if (LOAD_BAR_TYPES.has(actor.type) && !game.itempiles?.API.isValidItemPile(actor)) {
			injectLoadBar(sheet, element);
		}
	});
}
