import { MODULE_ID } from "./shared.js";

const CONSUMES_PATH = `flags.${MODULE_ID}.consumesAmmo`;
const AMMO_PATH = `flags.${MODULE_ID}.ammoItems`;

/**
 * Weapon ammunition. A weapon marked "Consumes ammunition" links the consumables it shoots, dropped from a compendium
 * or an inventory. Its attack dialog then asks which of them to spend, and the roll takes one unit of it, as
 * Daggerheart does for its own item costs: a spent stack stays in the inventory at 0. A roll made without the dialog
 * spends the first ammunition left. Called during init.
 */
export function registerAmmunition() {
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

function consumesAmmo(weapon) {
	return weapon?.type === "weapon" && !!foundry.utils.getProperty(weapon, CONSUMES_PATH);
}

function getAmmoLinks(weapon) {
	return foundry.utils.getProperty(weapon, AMMO_PATH) ?? [];
}

/** The document id of a compendium UUID. An "(HB)" copy keeps the id of the system item it copies. */
function compendiumId(uuid) {
	return uuid?.startsWith("Compendium.") ? uuid.split(".").at(-1) : null;
}

/** Whether an inventory item is the linked item: the item itself, or a copy taken from that compendium entry. */
function isLinkedItem(item, link) {
	const linkId = compendiumId(link);
	const sources = [item.uuid, item._stats?.compendiumSource, item.flags?.core?.sourceId];
	return sources.some(source => source && (source === link || (linkId && compendiumId(source) === linkId)));
}

/** Consumable stacks in the weapon owner's inventory that it shoots and that have units left, in the weapon's order. */
function getAmmoStacks(weapon) {
	const links = getAmmoLinks(weapon);
	const rank = item => links.findIndex(link => isLinkedItem(item, link));
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
	tags?.addEventListener("drop", event => onDropAmmo(event, tags), { capture: true });
}

/** Links a dropped consumable. An inventory item is linked through its compendium entry, so later stacks count too. */
function onDropAmmo(event, tags) {
	event.preventDefault();
	event.stopImmediatePropagation();
	if (!tags.editable) {
		return;
	}
	const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
	const item = data.type === "Item" && data.uuid ? fromUuidSync(data.uuid) : null;
	if (item?.type !== "consumable") {
		ui.notifications.warn(game.i18n.localize("MIST_AGE.Ammo.OnlyConsumables"));
		return;
	}
	const link = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? data.uuid;
	if (!tags.value.includes(link)) {
		tags.value = [...tags.value, link];
	}
}

/** Adds the "Spend ammunition" choice above the roll button of an attack with such a weapon. */
function injectAmmoChoice(app, element) {
	const weapon = app.item;
	const controls = element.querySelector(".roll-dialog-controls");
	if (!consumesAmmo(weapon) || !app.config || !controls || element.querySelector(".mist-ammo")) {
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
	const weapon = fromUuidSync(config.source.actor)?.items?.get(config.source.item);
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
