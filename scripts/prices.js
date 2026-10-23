import {
	HB_ITEM_COMPENDIUMS,
	HB_TABLE_COMPENDIUMS,
	LOOT_TABLES_VERSION,
	createHbCompendiums,
	relinkTablesToHb,
	syncHbLootTables
} from "./hb.js";
import { INVENTORY_TYPES, MODULE_ID, PRICE_PATH, nameKey, rerenderItemAndActorSheets } from "./shared.js";

const LEGACY_PRICE_PATH = "flags.item-piles.system.price";
const PRICE_TABLE_URL = `modules/${MODULE_ID}/data/compendium-prices.json`;
// Bump when the matching rules change, so the table is applied again.
const PRICE_TABLE_LOGIC = 2;

// Exchange rates between neighbouring Daggerheart currencies, editable in the module settings. Defaults are
// The Mist Age's: 10 Penny (coins) = 1 Silver (handfuls), 100 Silver = 1 Gold (bags), 10 Gold = 1 Gold Bar (chests).
const RATE_DEFAULTS = { coinsPerHandful: 10, handfulsPerBag: 100, bagsPerChest: 10 };
const CURRENCY_IMAGES = {
	chests: "icons/commodities/metal/ingot-gold.webp",
	bags: "icons/commodities/currency/coin-embossed-crown-gold.webp",
	handfuls: "icons/commodities/currency/coin-embossed-unicorn-silver.webp",
	coins: "icons/commodities/currency/coin-engraved-slot-one-copper.webp"
};

export function getPrice(item) {
	return Number(foundry.utils.getProperty(item, PRICE_PATH)) || 0;
}

function getCurrencies() {
	return game.settings.get("daggerheart", "Homebrew")?.currency ?? {};
}

/**
 * Worth of one unit of each currency in handfuls, largest first. Prices are stored in handfuls, so changing the
 * rates changes how a price is split into coins, not the stored price. Item Piles currencies are rebuilt from this.
 */
function getExchangeRates() {
	const rate = key => {
		const value = Number(game.settings.get(MODULE_ID, key));
		return value > 0 ? value : RATE_DEFAULTS[key];
	};
	const handfulsPerBag = rate("handfulsPerBag");
	return { chests: handfulsPerBag * rate("bagsPerChest"), bags: handfulsPerBag, handfuls: 1, coins: 1 / rate("coinsPerHandful") };
}

function getEnabledUnits() {
	const currencies = getCurrencies();
	return Object.entries(getExchangeRates())
		.filter(([key]) => currencies[key]?.enabled)
		.map(([key, rate]) => ({ key, rate, label: game.i18n.localize(currencies[key].label), icon: currencies[key].icon }));
}

/** Splits a price in handfuls into the enabled currencies, largest first. */
function splitPrice(price) {
	const units = getEnabledUnits();
	if (!price || !units.length) {
		return [];
	}
	const smallestRate = units.at(-1).rate;
	let remaining = Math.round(price / smallestRate);
	const parts = [];
	for (const unit of units) {
		const unitSize = Math.round(unit.rate / smallestRate);
		const count = Math.floor(remaining / unitSize);
		remaining -= count * unitSize;
		if (count > 0) {
			parts.push({ ...unit, count });
		}
	}
	return parts;
}

export function formatPriceHTML(price) {
	return splitPrice(price).map(part => {
		const label = foundry.utils.escapeHTML(part.label);
		return `<span class="mist-price-part" data-tooltip="${label}"><i class="${part.icon}" inert></i> ${part.count}</span>`;
	}).join(" ");
}

function injectHeaderPrice(element, item) {
	const container = element.querySelector(".item-sheet-header .item-description");
	if (!container) {
		return;
	}
	container.querySelector(".mist-price")?.remove();
	const price = getPrice(item);
	const html = price ? formatPriceHTML(price) : `<span class="mist-price-none">${game.i18n.localize("MIST_AGE_PRICES.NoPrice")}</span>`;
	container.insertAdjacentHTML("beforeend", `<h3 class="mist-price"><i class="fa-solid fa-scale-balanced" inert></i> ${html}</h3>`);
}

function injectPriceInput(sheet, element, item) {
	const fieldset = element.querySelector("section.tab[data-tab='settings'] fieldset");
	if (!fieldset || fieldset.querySelector(".mist-price-input")) {
		return;
	}
	const units = getEnabledUnits();
	const base = units.find(unit => unit.rate === 1)?.label ?? "handfuls";
	const smallest = units.at(-1);
	const largest = units[0];
	const shortRate = rate => Math.round((rate ?? 1) * 10000) / 10000;
	const hint = foundry.utils.escapeHTML(game.i18n.format("MIST_AGE_PRICES.PriceHint", {
		currency: base,
		smallest: smallest?.label ?? base,
		smallestRate: shortRate(smallest?.rate),
		largest: largest?.label ?? base,
		largestRate: shortRate(largest?.rate)
	}));
	const disabled = sheet.isEditable ? "" : "disabled";
	fieldset.insertAdjacentHTML("beforeend", `
		<span data-tooltip="${hint}">${game.i18n.localize("MIST_AGE_PRICES.Price")} (${foundry.utils.escapeHTML(base)})</span>
		<input class="mist-price-input" type="number" name="${PRICE_PATH}" value="${getPrice(item)}" min="0" step="any" data-dtype="Number" ${disabled} />
	`);
}

function injectInventoryPrices(sheet, element) {
	for (const row of element.querySelectorAll("li.inventory-item[data-item-id]")) {
		row.querySelector(".mist-price-tag")?.remove();
		const item = sheet.document.items?.get(row.dataset.itemId);
		if (!item || !INVENTORY_TYPES.has(item.type)) {
			continue;
		}
		const price = getPrice(item);
		if (!price) {
			continue;
		}
		const tag = `<div class="tag mist-price-tag">${formatPriceHTML(price)}</div>`;
		const tags = row.querySelector(".item-tags");
		if (tags) {
			tags.insertAdjacentHTML("beforeend", tag);
		} else {
			row.querySelector(".item-name")?.insertAdjacentHTML("afterend", tag);
		}
	}
}

async function migrateLegacyPrices() {
	const collectUpdates = items => items
		.filter(item => foundry.utils.hasProperty(item, LEGACY_PRICE_PATH) && !foundry.utils.hasProperty(item, PRICE_PATH))
		.map(item => ({ _id: item.id, [PRICE_PATH]: Number(foundry.utils.getProperty(item, LEGACY_PRICE_PATH)) || 0 }));

	const migrated = await updateWorldItems(collectUpdates);
	if (migrated) {
		console.log(`${MODULE_ID} | Moved ${migrated} Item Piles prices to ${PRICE_PATH}`);
	}
}

/** World actors plus the synthetic actors of unlinked tokens (merchants placed on scenes). */
function getAllActors() {
	const actors = [...game.actors];
	for (const scene of game.scenes) {
		for (const token of scene.tokens) {
			if (!token.actorLink && token.actor) {
				actors.push(token.actor);
			}
		}
	}
	return actors;
}

/** Applies collectUpdates(items) to sidebar items and to every actor's items; returns the number of updated items. */
async function updateWorldItems(collectUpdates) {
	let count = 0;
	const worldUpdates = collectUpdates(game.items);
	if (worldUpdates.length) {
		await Item.updateDocuments(worldUpdates);
		count += worldUpdates.length;
	}
	for (const actor of getAllActors()) {
		const updates = collectUpdates(actor.items);
		if (updates.length) {
			await actor.updateEmbeddedDocuments("Item", updates);
			count += updates.length;
		}
	}
	return count;
}

function hasOwnPrice(item) {
	const raw = foundry.utils.getProperty(item, PRICE_PATH);
	return raw !== null && raw !== undefined && raw !== "";
}

function hashText(text) {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}

/** Applies collectUpdates(indexEntries) to every world Item compendium; returns the number of updated items. */
async function updateWorldCompendiums(collectUpdates) {
	let count = 0;
	for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageType === "world")) {
		const index = await pack.getIndex({ fields: [PRICE_PATH] });
		const updates = collectUpdates([...index.values()]);
		if (!updates.length) {
			continue;
		}
		const wasLocked = pack.locked;
		if (wasLocked) {
			await pack.configure({ locked: false });
		}
		try {
			await Item.updateDocuments(updates, { pack: pack.collection });
			count += updates.length;
		} finally {
			if (wasLocked) {
				await pack.configure({ locked: true });
			}
		}
	}
	return count;
}

/**
 * Fills prices from data/compendium-prices.json into world items that have none: world compendiums (including the
 * HB copies), sidebar items, actors and unlinked tokens. A price set by hand is never overwritten.
 */
async function applyPriceTable({ force = false } = {}) {
	const response = await fetch(PRICE_TABLE_URL, { cache: "no-store" });
	if (!response.ok) {
		console.warn(`${MODULE_ID} | Could not load ${PRICE_TABLE_URL}`);
		return;
	}
	const text = await response.text();
	const signature = `${PRICE_TABLE_LOGIC}:${hashText(text)}`;
	if (!force && game.settings.get(MODULE_ID, "priceTableSignature") === signature) {
		return;
	}
	const { prices } = JSON.parse(text);
	const priceByKey = new Map(prices.map(entry => [nameKey(entry.type, entry.name), entry.price]));
	const collectUpdates = items => items
		.filter(item => !hasOwnPrice(item) && priceByKey.has(nameKey(item.type, item.name)))
		.map(item => ({ _id: item._id ?? item.id, [PRICE_PATH]: priceByKey.get(nameKey(item.type, item.name)) }));

	const compendium = await updateWorldCompendiums(collectUpdates);
	const copies = await updateWorldItems(collectUpdates);
	await game.settings.set(MODULE_ID, "priceTableSignature", signature);
	ui.notifications.info(game.i18n.format("MIST_AGE_PRICES.TableApplied", { compendium, copies }));
}

function buildItemPilesCurrencies(existing) {
	return getEnabledUnits().map(unit => {
		const path = `system.gold.${unit.key}`;
		const current = existing.find(currency => currency.data?.path === path);
		return {
			type: "attribute",
			name: unit.label,
			img: current?.img ?? CURRENCY_IMAGES[unit.key],
			abbreviation: `{#} ${unit.label}`,
			data: { path },
			primary: unit.rate === 1,
			exchangeRate: unit.rate
		};
	});
}

async function syncItemPilesCurrencies() {
	const existing = game.itempiles.API.CURRENCIES;
	const wanted = buildItemPilesCurrencies(existing);
	const signature = list => JSON.stringify(list.map(currency => [currency.data?.path, currency.name, currency.primary, currency.exchangeRate]));
	if (signature(existing) !== signature(wanted)) {
		await game.itempiles.API.setCurrencies(wanted);
		console.log(`${MODULE_ID} | Item Piles currencies updated`, wanted);
	}
}

async function onRatesChanged() {
	rerenderItemAndActorSheets();
	if (game.user.isGM && game.itempiles?.API) {
		await syncItemPilesCurrencies();
	}
}

/** Called during init: settings, Item Piles wiring and sheet rendering. */
export function registerPrices() {
	for (const [key, defaultValue] of Object.entries(RATE_DEFAULTS)) {
		game.settings.register(MODULE_ID, key, {
			name: `MIST_AGE_PRICES.Rates.${key}.Name`,
			hint: `MIST_AGE_PRICES.Rates.${key}.Hint`,
			scope: "world",
			config: false,
			type: Number,
			default: defaultValue,
			onChange: onRatesChanged
		});
	}
	game.settings.register(MODULE_ID, "legacyPricesMigrated", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
	game.settings.register(MODULE_ID, "priceTableSignature", {
		scope: "world",
		config: false,
		type: String,
		default: ""
	});
	game.settings.register(MODULE_ID, "hbCompendiumsCreated", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
	game.settings.register(MODULE_ID, "hbTablesCreated", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
	// Version 1 of the loot tables only recorded this flag; lootTablesVersion supersedes it.
	game.settings.register(MODULE_ID, "hbLootTablesCreated", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
	game.settings.register(MODULE_ID, "lootTablesVersion", {
		scope: "world",
		config: false,
		type: Number,
		default: 0
	});

	Hooks.once("item-piles-ready", async () => {
		if (!game.user.isGM) {
			return;
		}
		if (game.itempiles.API.ITEM_PRICE_ATTRIBUTE !== PRICE_PATH) {
			await game.itempiles.API.setItemPriceAttribute(PRICE_PATH);
		}
		await syncItemPilesCurrencies();
	});

	Hooks.on("renderItemSheetV2", (sheet, element) => {
		if (!INVENTORY_TYPES.has(sheet.document.type)) {
			return;
		}
		injectHeaderPrice(element, sheet.document);
		if (game.user.isGM) {
			injectPriceInput(sheet, element, sheet.document);
		}
	});

	Hooks.on("renderActorSheetV2", (sheet, element) => {
		injectInventoryPrices(sheet, element);
	});
}

/**
 * GM-only world upkeep on ready: one-time migrations, the HB compendiums and loot tables, and the price table.
 * Every step is idempotent, so running it again only fills what is missing.
 */
export async function preparePricesWorld() {
	if (!game.settings.get(MODULE_ID, "legacyPricesMigrated")) {
		await migrateLegacyPrices();
		await game.settings.set(MODULE_ID, "legacyPricesMigrated", true);
	}
	let createdItemPacks = [];
	if (!game.settings.get(MODULE_ID, "hbCompendiumsCreated")) {
		createdItemPacks = await createHbCompendiums(HB_ITEM_COMPENDIUMS);
		await game.settings.set(MODULE_ID, "hbCompendiumsCreated", true);
	}
	await applyPriceTable({ force: createdItemPacks.length > 0 });

	let relinked = 0;
	if (!game.settings.get(MODULE_ID, "hbTablesCreated")) {
		for (const pack of await createHbCompendiums(HB_TABLE_COMPENDIUMS)) {
			relinked += await relinkTablesToHb(await pack.getDocuments());
		}
		await game.settings.set(MODULE_ID, "hbTablesCreated", true);
	}
	// Tables imported later from the system compendium are relinked on the next load.
	relinked += await relinkTablesToHb(game.tables);
	if (relinked) {
		ui.notifications.info(game.i18n.format("MIST_AGE_PRICES.TablesRelinked", { count: relinked }));
	}
	const lootTablesVersion = Math.max(
		game.settings.get(MODULE_ID, "lootTablesVersion"),
		game.settings.get(MODULE_ID, "hbLootTablesCreated") ? 1 : 0
	);
	if (lootTablesVersion < LOOT_TABLES_VERSION) {
		await syncHbLootTables();
		await game.settings.set(MODULE_ID, "lootTablesVersion", LOOT_TABLES_VERSION);
	}
}
