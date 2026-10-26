export const MODULE_ID = "mist-age-toolkit";
// The module socket, through which the GM asks a player's client to open a roll (module.json sets socket: true).
export const SOCKET = `module.${MODULE_ID}`;

// The toolkit merges the earlier mist-age-prices and mist-age-weight modules. Their flag scopes are kept, so prices
// and weights already stored on items, compendiums and actors keep working without a migration.
export const PRICE_PATH = "flags.mist-age-prices.price";
export const WEIGHT_FLAGS = "flags.mist-age-weight";

export const INVENTORY_TYPES = new Set(["weapon", "armor", "consumable", "loot"]);

/** Key shared by an original item and its "(HB)" copy: case, spacing and the HB suffix are ignored. */
export function nameKey(type, name) {
	const base = name.normalize("NFC").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s*\(hb\)\s*$/, "").replace(/\s+/g, " ").trim();
	return `${type}:${base}`;
}

export function rerenderActorSheets() {
	for (const app of foundry.applications.instances.values()) {
		if (app instanceof foundry.applications.sheets.ActorSheetV2 && app.rendered) {
			app.render();
		}
	}
}

export function rerenderItemAndActorSheets() {
	const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;
	for (const app of foundry.applications.instances.values()) {
		if ((app instanceof ActorSheetV2 || app instanceof ItemSheetV2) && app.rendered) {
			app.render();
		}
	}
}

/** The character a player rolls for: the assigned one, or else the first character the player owns. */
export function getPlayerCharacter(user) {
	const owned = actor => actor.type === "character" && !game.itempiles?.API.isValidItemPile(actor) && actor.testUserPermission(user, "OWNER");
	return user.character ?? game.actors.find(owned) ?? null;
}

/** Values of the checked inputs with this name in a form, in document order. */
export function checkedValues(form, name) {
	return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}
