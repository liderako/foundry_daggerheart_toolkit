// Item Piles uses character actors for piles, and Daggerheart gives every new character the Homebrew starting money
// (1 Silver in The Mist Age), so each new pile started with a coin. Piles start empty instead; player characters keep
// their starting money.
const PILE_ENABLED = "flags.item-piles.data.enabled";
const EMPTY_GOLD = { coins: 0, handfuls: 0, bags: 0, chests: 0 };

/** Called during init. */
export function registerEmptyPiles() {
	Hooks.on("preCreateActor", (actor, data) => {
		if (foundry.utils.getProperty(data, PILE_ENABLED) && !foundry.utils.hasProperty(data, "system.gold")) {
			actor.updateSource({ "system.gold": EMPTY_GOLD });
		}
	});
	// Piles dropped on the map copy the Default Item Pile actor, which was created with the starting money.
	Hooks.once("item-piles-ready", async () => {
		if (!game.users.activeGM?.isSelf) {
			return;
		}
		const actor = game.actors.get(game.settings.get("item-piles", "defaultItemPileActorID"));
		if (actor?.system.gold && Object.values(actor.system.gold).some(amount => amount > 0)) {
			await actor.update({ "system.gold": EMPTY_GOLD });
		}
	});
}
