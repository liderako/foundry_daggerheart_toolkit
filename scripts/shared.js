export const MODULE_ID = "mist-age-toolkit";

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
