import { registerAdversaryInventory } from "./adversary-inventory.js";
import { registerDeathLoot } from "./death-loot.js";
import { preparePricesWorld, registerPrices } from "./prices.js";
import { MODULE_ID } from "./shared.js";
import { registerWeight } from "./weight.js";

// The separate modules this toolkit replaces. Running them side by side would apply every hook twice.
const SPLIT_MODULES = {
	"mist-age-prices": ["legacyPricesMigrated", "priceTableSignature", "hbCompendiumsCreated", "hbTablesCreated", "hbLootTablesCreated", "lootTablesVersion"],
	"mist-age-weight": ["freeOverload"]
};

/** Copies the world settings of the split modules once, so finished one-time steps are not repeated. */
async function migrateSplitModuleSettings() {
	if (game.settings.get(MODULE_ID, "splitSettingsMigrated")) {
		return;
	}
	const storage = game.settings.storage.get("world");
	for (const [moduleId, keys] of Object.entries(SPLIT_MODULES)) {
		for (const key of keys) {
			const value = storage.getSetting(`${moduleId}.${key}`)?.value;
			if (value !== undefined && value !== null) {
				await game.settings.set(MODULE_ID, key, value);
			}
		}
	}
	await game.settings.set(MODULE_ID, "splitSettingsMigrated", true);
}

Hooks.once("init", () => {
	const active = Object.keys(SPLIT_MODULES).filter(id => game.modules.get(id)?.active);
	if (active.length) {
		Hooks.once("ready", () => {
			ui.notifications.error(game.i18n.format("MIST_AGE.SplitModulesActive", { modules: active.join(", ") }), { permanent: true });
		});
		return;
	}
	game.settings.register(MODULE_ID, "splitSettingsMigrated", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
	registerPrices();
	registerWeight();
	registerAdversaryInventory();
	registerDeathLoot();

	Hooks.once("ready", async () => {
		if (!game.user.isGM) {
			return;
		}
		await migrateSplitModuleSettings();
		await preparePricesWorld();
	});
});
