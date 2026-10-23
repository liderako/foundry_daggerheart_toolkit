import { INVENTORY_TYPES, MODULE_ID } from "./shared.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/inventory-tab.hbs`;
// Actor types that get an inventory with gold: the Daggerheart sheet (in game.system.api) and the tab it follows.
const INVENTORY_ACTORS = [
	{ type: "adversary", sheet: "Adversary", after: "features" },
	{ type: "companion", sheet: "Companion", after: "details" }
];

/**
 * Gives adversaries and companions an inventory and gold. Daggerheart already builds the inventory lists, the
 * currency inputs and item transfers for any actor whose data model sets hasInventory; these actors only lack that
 * flag, a gold field and a tab to show them. Called during init, after the system has set up its models and sheets.
 */
export function registerInventoryTabs() {
	for (const { type, sheet, after } of INVENTORY_ACTORS) {
		extendModel(type);
		addInventoryTab(game.system.api?.applications?.sheets?.actors?.[sheet], after);
	}
}

function extendModel(type) {
	const Base = CONFIG.Actor.dataModels[type];
	if (!Base) {
		return;
	}
	CONFIG.Actor.dataModels[type] = class extends Base {
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

function addInventoryTab(sheetClass, after) {
	if (!sheetClass || "inventory" in sheetClass.PARTS) {
		return;
	}
	const parts = {};
	for (const [id, part] of Object.entries(sheetClass.PARTS)) {
		parts[id] = part;
		if (id === after) {
			parts.inventory = { template: TEMPLATE, scrollable: [".items-section"] };
		}
	}
	sheetClass.PARTS = parts;

	const tabs = foundry.utils.deepClone(sheetClass.TABS);
	const index = tabs.primary.tabs.findIndex(tab => tab.id === after);
	tabs.primary.tabs.splice(index + 1, 0, { id: "inventory" });
	sheetClass.TABS = tabs;

	// The character sheet edits and deletes inventory items through this row menu; these sheets only have one for
	// their attack.
	sheetClass.DEFAULT_OPTIONS.contextMenus.push({
		handler: getInventoryContextOptions,
		selector: [...INVENTORY_TYPES].map(type => `[data-item-uuid][data-type="${type}"]`).join(", "),
		options: { parentClassHooks: false, fixed: true }
	});
}

/** Edit, send to chat and delete: the Daggerheart common item options. Called with the sheet as `this`. */
function getInventoryContextOptions() {
	return this._getContextMenuCommonOptions({ toChat: true });
}
