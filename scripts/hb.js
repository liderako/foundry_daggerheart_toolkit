// System compendiums copied into the world once. A system update replaces its own packs but never world packs.
export const HB_ITEM_COMPENDIUMS = {
	"daggerheart.weapons": "Weapons (HB)",
	"daggerheart.armors": "Armors (HB)",
	"daggerheart.consumables": "Consumables (HB)",
	"daggerheart.loot": "Loot (HB)"
};
export const HB_TABLE_COMPENDIUMS = {
	"daggerheart.rolltables": "Rolltables (HB)"
};
const HB_SUFFIX = " (HB)";
const ITEM_UUID = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/;

// Weapon and armor loot tables: one table per category with every item, ordered by tier. Tier plays the role of
// rarity, and each rarity is a roll formula that only lands on the items of its tier.
export const LOOT_TABLES_VERSION = 3;
const LOOT_TABLES = [
	{ label: "Primary Physical Weapons (HB)", pack: "Weapons (HB)", img: "icons/weapons/swords/greatsword-crossguard-steel.webp", filter: weaponFilter(false, "physical") },
	{ label: "Primary Magic Weapons (HB)", pack: "Weapons (HB)", img: "icons/weapons/staves/staff-ornate-blue-jewel.webp", filter: weaponFilter(false, "magical") },
	{ label: "Secondary Physical Weapons (HB)", pack: "Weapons (HB)", img: "icons/weapons/daggers/dagger-black.webp", filter: weaponFilter(true, "physical") },
	{ label: "Secondary Magic Weapons (HB)", pack: "Weapons (HB)", img: "icons/weapons/wands/wand-gem-blue.webp", filter: weaponFilter(true, "magical") },
	{ label: "Armor (HB)", pack: "Armors (HB)", img: "icons/equipment/chest/breastplate-banded-steel.webp", filter: () => true }
];
// Version 1 had one table for every weapon; versions 1-2 also had a sub-table per tier ("<label> - Tier N").
const OBSOLETE_LOOT_TABLES = ["Weapons (HB)"];
const LOOT_INDEX_FIELDS = ["system.tier", "system.secondary", "system.attack.damage.main.type"];
const RARITIES = ["Common", "Uncommon", "Rare", "Legendary"];
const LOOT_TABLES_FOLDER = "Weapons & Armor (HB)";

/** Wheelchairs are left out: they are a character's mobility gear, not loot. A weapon with both damage types fits both tables. */
function weaponFilter(secondary, damageType) {
	return entry => !/wheelchair/i.test(entry.name)
		&& !!entry.system?.secondary === secondary
		&& (entry.system?.attack?.damage?.main?.type ?? []).includes(damageType);
}

function findWorldPack(label) {
	return game.packs.find(pack => pack.metadata.packageType === "world" && pack.metadata.label === label);
}

/** Copies each missing source compendium into the world, adding the HB suffix to every document; returns the new packs. */
export async function createHbCompendiums(compendiums) {
	const created = [];
	for (const [sourceId, label] of Object.entries(compendiums)) {
		const source = game.packs.get(sourceId);
		if (!source || findWorldPack(label)) {
			continue;
		}
		const copy = await source.duplicateCompendium({ label });
		await copy.updateAll(doc => ({ name: `${doc.name}${HB_SUFFIX}` }), doc => !/\(HB\)\s*$/i.test(doc.name));
		created.push(copy);
	}
	if (created.length) {
		const packs = created.map(pack => pack.metadata.label).join(", ");
		ui.notifications.info(game.i18n.format("MIST_AGE_PRICES.HbCreated", { packs }));
	}
	return created;
}

/**
 * Rebuilds the weapon and armor loot tables in the world from the HB compendiums, replacing the tables earlier
 * versions created in the same folder. Returns the names of the created tables.
 */
export async function syncHbLootTables() {
	const folder = game.folders.find(f => f.type === "RollTable" && f.name === LOOT_TABLES_FOLDER)
		?? await Folder.create({ name: LOOT_TABLES_FOLDER, type: "RollTable" });
	const labels = [...LOOT_TABLES.map(def => def.label), ...OBSOLETE_LOOT_TABLES];
	const outdated = game.tables.filter(table => table.folder?.id === folder.id
		&& labels.some(label => table.name === label || table.name.startsWith(`${label} - Tier `)));
	if (outdated.length) {
		await RollTable.deleteDocuments(outdated.map(table => table.id));
	}

	const created = [];
	for (const def of LOOT_TABLES) {
		const pack = findWorldPack(def.pack);
		if (!pack) {
			continue;
		}
		const index = await pack.getIndex({ fields: LOOT_INDEX_FIELDS });
		const results = [];
		const formulas = [];
		for (const [i, rarity] of RARITIES.entries()) {
			const tier = i + 1;
			const entries = index
				.filter(entry => entry.system?.tier === tier && def.filter(entry))
				.sort((a, b) => a.name.localeCompare(b.name));
			if (!entries.length) {
				continue;
			}
			// Items of this tier sit right after the previous tiers, so "offset + 1dN" only lands on them.
			const offset = results.length;
			formulas.push({ name: `${rarity} (Tier ${tier})`, formula: offset ? `${offset} + 1d${entries.length}` : `1d${entries.length}` });
			results.push(...entries.map((entry, n) => ({
				type: "document",
				documentUuid: pack.getUuid(entry._id),
				name: entry.name,
				img: entry.img,
				range: [offset + n + 1, offset + n + 1],
				weight: 1
			})));
		}
		if (!results.length) {
			continue;
		}
		const [base, ...alternatives] = formulas;
		await RollTable.create({
			name: def.label,
			img: def.img,
			folder: folder.id,
			description: "<p>Pick the rarity in the roll formula: Common = Tier 1, Uncommon = Tier 2, Rare = Tier 3, Legendary = Tier 4.</p>",
			formula: base.formula,
			replacement: true,
			displayRoll: true,
			flags: {
				daggerheart: {
					formulaName: base.name,
					activeAltFormula: "",
					altFormula: Object.fromEntries(alternatives.map(formula => [foundry.utils.randomID(), formula]))
				}
			},
			results
		});
		created.push(def.label);
	}
	if (created.length) {
		ui.notifications.info(game.i18n.format("MIST_AGE_PRICES.LootTablesCreated", { tables: created.join(", ") }));
	}
	return created;
}

/**
 * Points roll table results that link to Daggerheart item compendiums at the HB copies of those items
 * (same document id, HB name). Returns the number of changed results.
 */
export async function relinkTablesToHb(tables) {
	const pending = [];
	for (const table of tables) {
		const results = table.results.filter(result => {
			const match = result.documentUuid?.match(ITEM_UUID);
			return match && match[1] in HB_ITEM_COMPENDIUMS;
		});
		if (results.length) {
			pending.push({ table, results });
		}
	}
	if (!pending.length) {
		return 0;
	}

	const targets = new Map();
	for (const [sourceId, label] of Object.entries(HB_ITEM_COMPENDIUMS)) {
		const pack = findWorldPack(label);
		if (pack) {
			targets.set(sourceId, { collection: pack.collection, index: await pack.getIndex() });
		}
	}

	let count = 0;
	for (const { table, results } of pending) {
		const updates = [];
		for (const result of results) {
			const [, sourceId, id] = result.documentUuid.match(ITEM_UUID);
			const target = targets.get(sourceId);
			const entry = target?.index.get(id);
			if (entry) {
				updates.push({ _id: result.id, documentUuid: `Compendium.${target.collection}.Item.${entry._id}`, name: entry.name });
			}
		}
		if (updates.length) {
			await table.updateEmbeddedDocuments("TableResult", updates);
			count += updates.length;
		}
	}
	return count;
}
