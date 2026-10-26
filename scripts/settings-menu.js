import { MODULE_ID } from "./shared.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Sections of the toolkit settings window. Each key is a world setting registered by a feature with config: false;
// its name, hint, type, choices, file picker and effect editor come from that registration.
const SECTIONS = [
	{ id: "prices", icon: "fa-solid fa-coins", keys: ["coinsPerHandful", "handfulsPerBag", "bagsPerChest"] },
	{
		id: "capacity",
		icon: "fa-solid fa-dumbbell",
		keys: ["capacityBase", "capacityPerStrength", "capacityPerNegativeStrength", "characterCapacity", "characterManualCapacity", "characterCapacityGMOnly"]
	},
	{
		id: "overload",
		icon: "fa-solid fa-weight-hanging",
		keys: ["freeOverload", "overloadEffect", "overloadIcon", "overloadHeavyIcon", "overloadLightEffect", "overloadHeavyEffect"]
	},
	{ id: "inventory", icon: "fa-solid fa-flask", keys: ["hideEmptyConsumables"] },
	{ id: "weapons", icon: "fa-solid fa-crosshairs", keys: ["weaponJam"] },
	{ id: "exhaustion", icon: "fa-solid fa-bed", keys: ["exhaustionChecks", "exhaustionSheetButton"] },
	{ id: "rest", icon: "fa-solid fa-campground", keys: ["longRestReminder"] },
	{ id: "tokens", icon: "fa-solid fa-id-badge", keys: ["syncTokenNames"] },
	{ id: "adversaries", icon: "fa-solid fa-skull", keys: ["deathLoot", "adversaryMoneyButton", "adversaryMoneyTable"] }
];

/** A one-line summary of an effect setting's changes, such as "system.evasion add -1". */
function summarizeEffect(value) {
	const changes = value?.system?.changes ?? [];
	if (!changes.length) {
		return game.i18n.localize("MIST_AGE.Settings.NoChanges");
	}
	return changes.map(change => {
		const shown = typeof change.value === "object" ? "" : ` ${change.value}`;
		return `${change.key || change.type} ${change.key ? change.type : ""}${shown}`.replace(/\s+/g, " ").trim();
	}).join("; ");
}

class ToolkitSettings extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-settings`,
		tag: "form",
		classes: ["mist-age-settings"],
		window: { title: "MIST_AGE.Settings.Title", icon: "fa-solid fa-gears", contentClasses: ["standard-form"], resizable: true },
		// A fixed height that fits most screens; the sections scroll inside it and the window can be resized.
		position: { width: 640, height: 700 },
		form: { handler: ToolkitSettings.#onSubmit, closeOnSubmit: true }
	};

	static PARTS = {
		sections: { template: `modules/${MODULE_ID}/templates/settings.hbs`, scrollable: [""] },
		footer: { template: "templates/generic/form-footer.hbs" }
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.sections = SECTIONS.map(section => ({
			icon: section.icon,
			label: game.i18n.localize(`MIST_AGE.Settings.Sections.${section.id}.Label`),
			hint: game.i18n.localize(`MIST_AGE.Settings.Sections.${section.id}.Hint`),
			fields: section.keys.map(key => {
				const config = game.settings.settings.get(`${MODULE_ID}.${key}`);
				const value = game.settings.get(MODULE_ID, key);
				return {
					key,
					name: game.i18n.localize(config.name),
					hint: game.i18n.localize(config.hint),
					value,
					isBoolean: config.type === Boolean,
					isText: config.type === String && !config.choices && !config.filePicker,
					choices: config.choices,
					filePicker: config.filePicker,
					// An effect edited in the system's effect sheet; the window shows what it changes.
					effect: config.editEffect && { summary: summarizeEffect(value) }
				};
			})
		}));
		context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "MIST_AGE.Settings.Save" }];
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		// Keeps the image preview next to a file picker in step with the chosen path.
		for (const picker of this.element.querySelectorAll("file-picker")) {
			const preview = picker.closest(".form-fields")?.querySelector(".mist-settings-icon-preview");
			picker.addEventListener("change", () => {
				if (preview) {
					preview.src = picker.value;
				}
			});
		}
		// The effect is saved when its sheet closes; only its summary is refreshed, keeping other unsaved inputs.
		for (const button of this.element.querySelectorAll("[data-mist-edit-effect]")) {
			const key = button.dataset.mistEditEffect;
			button.addEventListener("click", async () => {
				await game.settings.settings.get(`${MODULE_ID}.${key}`).editEffect();
				const summary = button.closest(".form-fields").querySelector(".mist-effect-summary");
				summary.textContent = summarizeEffect(game.settings.get(MODULE_ID, key));
			});
		}
	}

	static async #onSubmit(event, form, formData) {
		for (const [key, value] of Object.entries(formData.object)) {
			if (game.settings.get(MODULE_ID, key) !== value) {
				await game.settings.set(MODULE_ID, key, value);
			}
		}
	}
}

/** Puts every toolkit setting behind one button in the module settings, grouped into sections. Called during init. */
export function registerSettingsMenu() {
	game.settings.registerMenu(MODULE_ID, "settingsMenu", {
		name: "MIST_AGE.Settings.Menu.Name",
		label: "MIST_AGE.Settings.Menu.Label",
		hint: "MIST_AGE.Settings.Menu.Hint",
		icon: "fa-solid fa-gears",
		type: ToolkitSettings,
		restricted: true
	});
}
