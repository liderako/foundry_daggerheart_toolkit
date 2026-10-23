import { MODULE_ID, nameKey } from "./shared.js";

export const CONSUMES_PATH = `flags.${MODULE_ID}.consumesAmmo`;
const AMMO_PATH = `flags.${MODULE_ID}.ammoItems`;
// [link, name] pairs, so a link to an item that no longer exists can still be matched by name.
const AMMO_NAMES_PATH = `flags.${MODULE_ID}.ammoNames`;
const SOURCE_PATH = "_stats.compendiumSource";

/**
 * Weapon ammunition. A weapon marked "Consumes ammunition" links the consumables it shoots, dropped from a compendium
 * or an inventory. Its attack dialog then asks which of them to spend, and the roll takes one unit of it, as
 * Daggerheart does for its own item costs: a spent stack stays in the inventory at 0. A roll made without the dialog
 * spends the first ammunition left. Called during init.
 */
export function registerAmmunition() {
	// Lets a compendium index entry tell where it was copied from, for isLinkedItem.
	const indexFields = CONFIG.Item.compendiumIndexFields ??= [];
	if (!indexFields.includes(SOURCE_PATH)) {
		indexFields.push(SOURCE_PATH);
	}
	Hooks.on("renderItemSheetV2", (sheet, element) => {
		if (sheet.document.type === "weapon") {
			injectWeaponFields(sheet, element, sheet.document);
		}
	});
	Hooks.on("renderD20RollDialog", injectAmmoChoice);
	// Called once per roll, after its dialog is confirmed or skipped. Hooks.call stops at a false result.
	Hooks.on("daggerheart.postRollConfiguration", (roll, config) => {
		spendAmmo(roll, config);
	});
}

export function consumesAmmo(weapon) {
	return weapon?.type === "weapon" && !!foundry.utils.getProperty(weapon, CONSUMES_PATH);
}

function getAmmoLinks(weapon) {
	return foundry.utils.getProperty(weapon, AMMO_PATH) ?? [];
}

function getAmmoLinkNames(weapon) {
	const pairs = foundry.utils.getProperty(weapon, AMMO_NAMES_PATH);
	return new Map(Array.isArray(pairs) ? pairs : []);
}

/** The document id of a compendium UUID. An "(HB)" copy keeps the id of the system item it copies. */
function compendiumId(uuid) {
	return uuid?.startsWith("Compendium.") ? uuid.split(".").at(-1) : null;
}

/**
 * UUIDs a document stands for: itself, what it was copied from, and what that compendium entry was copied from in
 * turn. An item taken from a compendium remembers only the entry it came from, while that entry may be a copy of an
 * entry in another compendium.
 */
function getLineage(uuid, document) {
	const lineage = new Set([uuid]);
	const addSources = doc => {
		for (const source of [foundry.utils.getProperty(doc ?? {}, SOURCE_PATH), doc?._stats?.duplicateSource, doc?.flags?.core?.sourceId]) {
			if (source) {
				lineage.add(source);
			}
		}
	};
	addSources(document);
	for (const source of [...lineage]) {
		if (source !== uuid && source.startsWith("Compendium.")) {
			addSources(fromUuidSync(source, { strict: false }));
		}
	}
	return lineage;
}

/**
 * Whether an inventory item is the linked item or another copy of the same compendium entry. When the ids do not
 * meet, a stack with the linked item's name counts; savedName stands in when the linked item no longer exists.
 */
function isLinkedItem(item, link, savedName) {
	const itemLineage = getLineage(item.uuid, item);
	const linked = fromUuidSync(link, { strict: false });
	const linkIds = new Set();
	for (const source of getLineage(link, linked)) {
		if (itemLineage.has(source)) {
			return true;
		}
		linkIds.add(compendiumId(source));
	}
	linkIds.delete(null);
	if ([...itemLineage].some(source => linkIds.has(compendiumId(source)))) {
		return true;
	}
	// A stack whose copy chain was lost (made by hand, or brought in without a compendium source) still counts when it
	// carries the linked item's name; the "(HB)" suffix and letter case are ignored.
	const name = linked?.name ?? savedName;
	return !!name && nameKey("consumable", name) === nameKey("consumable", item.name);
}

/** Consumable stacks in the weapon owner's inventory that it shoots and that have units left, in the weapon's order. */
function getAmmoStacks(weapon) {
	const links = getAmmoLinks(weapon);
	const names = getAmmoLinkNames(weapon);
	const rank = item => links.findIndex(link => isLinkedItem(item, link, names.get(link)));
	return (weapon.actor?.items ?? [])
		.filter(item => item.type === "consumable" && item.system.quantity > 0 && rank(item) >= 0)
		.sort((a, b) => rank(a) - rank(b));
}

function injectWeaponFields(sheet, element, weapon) {
	const fieldset = element.querySelector("section.tab[data-tab='settings'] fieldset");
	if (!fieldset || element.querySelector(".mist-ammo-fields")) {
		return;
	}
	const escape = foundry.utils.escapeHTML;
	const disabled = sheet.isEditable ? "" : "disabled";
	const checked = consumesAmmo(weapon) ? "checked" : "";
	const hint = escape(game.i18n.localize("MIST_AGE.Ammo.AmmunitionHint"));
	fieldset.insertAdjacentHTML("afterend", `
		<fieldset class="two-columns mist-ammo-fields">
			<legend>${game.i18n.localize("MIST_AGE.Ammo.Legend")}</legend>
			<span>${game.i18n.localize("MIST_AGE.Ammo.ConsumesAmmo")}</span>
			<input type="checkbox" name="${CONSUMES_PATH}" ${checked} ${disabled} />
			<span data-tooltip="${hint}">${game.i18n.localize("MIST_AGE.Ammo.Ammunition")}</span>
			<document-tags type="Item" name="${AMMO_PATH}" value="${escape(getAmmoLinks(weapon).join(","))}" ${disabled}></document-tags>
		</fieldset>
	`);
	const tags = element.querySelector(".mist-ammo-fields document-tags");
	// Runs before the field's own drop handler, which would accept any item as it is.
	tags?.addEventListener("drop", event => onDropAmmo(event, tags, weapon), { capture: true });
}

/** Links a dropped consumable. An inventory item is linked through its compendium entry, so later stacks count too. */
function onDropAmmo(event, tags, weapon) {
	event.preventDefault();
	event.stopImmediatePropagation();
	if (!tags.editable) {
		return;
	}
	const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
	const item = data.type === "Item" && data.uuid ? fromUuidSync(data.uuid, { strict: false }) : null;
	if (item?.type !== "consumable") {
		ui.notifications.warn(game.i18n.localize("MIST_AGE.Ammo.OnlyConsumables"));
		return;
	}
	// A compendium entry is linked as it is, even when it was itself copied from another compendium.
	const inCompendium = data.uuid.startsWith("Compendium.");
	const link = inCompendium ? data.uuid : (foundry.utils.getProperty(item, SOURCE_PATH) ?? item.flags?.core?.sourceId ?? data.uuid);
	if (!tags.value.includes(link)) {
		tags.value = [...tags.value, link];
	}
	const names = getAmmoLinkNames(weapon);
	if (names.get(link) !== item.name) {
		names.set(link, item.name);
		weapon.update({ [AMMO_NAMES_PATH]: [...names] });
	}
}

/** Adds the "Spend ammunition" choice above the roll button of an attack with such a weapon. */
function injectAmmoChoice(app, element) {
	const weapon = app.item;
	const controls = element.querySelector(".roll-dialog-controls");
	// The dialog also confirms costs of actions without a roll, such as clearing a jam; those spend no ammunition.
	if (!consumesAmmo(weapon) || !app.config || !app.roll || !controls || element.querySelector(".mist-ammo")) {
		return;
	}
	const escape = foundry.utils.escapeHTML;
	const stacks = getAmmoStacks(weapon);
	// Kept on the roll config, which the dialog hands on to the roll and so to spendAmmo.
	const state = app.config[MODULE_ID] ??= {};
	if (!stacks.some(stack => stack.id === state.ammoId)) {
		state.ammoId = stacks[0]?.id ?? null;
	}
	const body = stacks.length
		? `<select class="mist-ammo-select">${stacks.map(stack => `
			<option value="${stack.id}" ${stack.id === state.ammoId ? "selected" : ""}>${escape(stack.name)} (${stack.system.quantity})</option>`).join("")}
		</select>`
		: `<span class="mist-ammo-empty">${game.i18n.localize("MIST_AGE.Ammo.NoAmmo")}</span>`;
	controls.insertAdjacentHTML("beforebegin", `
		<fieldset class="mist-ammo">
			<legend>${game.i18n.localize("MIST_AGE.Ammo.Spend")}</legend>
			${body}
		</fieldset>
	`);
	element.querySelector(".mist-ammo-select")?.addEventListener("change", event => {
		state.ammoId = event.currentTarget.value;
	});
}

/** Takes one unit of the chosen ammunition when an attack roll with such a weapon goes ahead. */
function spendAmmo(roll, config) {
	if (!(roll instanceof CONFIG.Dice.daggerheart.D20Roll) || !config.source?.actor) {
		return;
	}
	const weapon = fromUuidSync(config.source.actor, { strict: false })?.items?.get(config.source.item);
	if (!consumesAmmo(weapon)) {
		return;
	}
	const stacks = getAmmoStacks(weapon);
	const state = config[MODULE_ID];
	const stack = state ? stacks.find(s => s.id === state.ammoId) : stacks[0];
	if (!stack) {
		ui.notifications.warn(game.i18n.format("MIST_AGE.Ammo.NoneLeft", { weapon: weapon.name }));
		return;
	}
	stack.update({ "system.quantity": stack.system.quantity - 1 });
}
