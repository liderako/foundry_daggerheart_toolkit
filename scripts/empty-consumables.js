import { MODULE_ID, rerenderActorSheets } from "./shared.js";

/**
 * Used-up consumables leave the inventory. A consumable at quantity 0 disappears from actor sheets at once and is
 * deleted when the GM next loads the world. It is not deleted right away because the chat card of its use still
 * needs it: Daggerheart looks up the action on the item to apply the healing, damage or effects it rolled. Item Piles
 * merchants and piles keep their empty stacks. The hideEmptyConsumables setting turns this off. Called during init.
 */
export function registerEmptyConsumables() {
	game.settings.register(MODULE_ID, "hideEmptyConsumables", {
		name: "MIST_AGE.EmptyConsumables.Name",
		hint: "MIST_AGE.EmptyConsumables.Hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: rerenderActorSheets
	});

	Hooks.on("renderActorSheetV2", (sheet, element) => {
		if (isEnabled() && !isPile(sheet.document)) {
			hideEmptyRows(sheet.document, element);
		}
	});
	Hooks.once("ready", deleteEmptyConsumables);
}

function isEnabled() {
	return game.settings.get(MODULE_ID, "hideEmptyConsumables");
}

function isPile(actor) {
	return !!game.itempiles?.API.isValidItemPile(actor);
}

function isUsedUp(item) {
	return item.type === "consumable" && !(Number(item.system.quantity) > 0);
}

function hideEmptyRows(actor, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		const item = actor.items.get(row.dataset.itemId);
		if (item && isUsedUp(item)) {
			row.remove();
		}
	}
}

/** Run by the active GM on load, when the chat cards of earlier sessions no longer need their items. */
async function deleteEmptyConsumables() {
	if (!game.users.activeGM?.isSelf || !isEnabled()) {
		return;
	}
	let deleted = 0;
	for (const actor of game.actors) {
		const ids = isPile(actor) ? [] : actor.items.filter(isUsedUp).map(item => item.id);
		if (ids.length) {
			await actor.deleteEmbeddedDocuments("Item", ids);
			deleted += ids.length;
		}
	}
	if (deleted) {
		console.log(`${MODULE_ID} | Deleted ${deleted} used-up consumables`);
	}
}
