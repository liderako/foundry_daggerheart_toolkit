import { MODULE_ID } from "./shared.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/adversary-inventory.hbs`;

/**
 * Gives adversaries an inventory and gold. Daggerheart already builds the inventory lists, the currency inputs and
 * item transfers for any actor whose data model sets hasInventory; adversaries only lack that flag, a gold field
 * and a tab to show them. Called during init, after the system has set up its data models and sheets.
 */
export function registerAdversaryInventory() {
	extendAdversaryModel();
	addInventoryTab(game.system.api?.applications?.sheets?.actors?.Adversary);
}

function extendAdversaryModel() {
	const Base = CONFIG.Actor.dataModels.adversary;
	if (!Base) {
		return;
	}
	CONFIG.Actor.dataModels.adversary = class AdversaryWithInventory extends Base {
		static get metadata() {
			return foundry.utils.mergeObject(super.metadata, { hasInventory: true });
		}

		static defineSchema() {
			const fields = foundry.data.fields;
			const coins = () => new fields.NumberField({ initial: 0, integer: true });
			// Same shape and path as character gold, so Item Piles can loot it with the same currency settings.
			return {
				...super.defineSchema(),
				gold: new fields.SchemaField({ coins: coins(), handfuls: coins(), bags: coins(), chests: coins() })
			};
		}
	};
}

function addInventoryTab(sheetClass) {
	if (!sheetClass || "inventory" in sheetClass.PARTS) {
		return;
	}
	const parts = {};
	for (const [id, part] of Object.entries(sheetClass.PARTS)) {
		parts[id] = part;
		if (id === "features") {
			parts.inventory = { template: TEMPLATE, scrollable: [".items-section"] };
		}
	}
	sheetClass.PARTS = parts;

	const tabs = foundry.utils.deepClone(sheetClass.TABS);
	const features = tabs.primary.tabs.findIndex(tab => tab.id === "features");
	tabs.primary.tabs.splice(features + 1, 0, { id: "inventory" });
	sheetClass.TABS = tabs;
}
