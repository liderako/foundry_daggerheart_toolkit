import { MODULE_ID } from "./shared.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Sections of the toolkit settings window. Each key is a world setting registered by a feature with config: false;
// its name, hint, type, choices, file picker and change list come from that registration.
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
		keys: ["freeOverload", "overloadEffect", "overloadIcon", "overloadHeavyIcon", "overloadLightChanges", "overloadHeavyChanges"]
	},
	{ id: "inventory", icon: "fa-solid fa-flask", keys: ["hideEmptyConsumables"] },
	{ id: "weapons", icon: "fa-solid fa-crosshairs", keys: ["weaponJam"] },
	{ id: "tokens", icon: "fa-solid fa-id-badge", keys: ["syncTokenNames"] },
	{ id: "adversaries", icon: "fa-solid fa-skull", keys: ["deathLoot"] }
];

// Change modes of Foundry before v14, where a change stored a number instead of a type.
const LEGACY_MODE_TYPES = { CUSTOM: "custom", MULTIPLY: "multiply", ADD: "add", DOWNGRADE: "downgrade", UPGRADE: "upgrade", OVERRIDE: "override" };

/**
 * Effect change types with their labels and default priorities, as the effect sheet offers them. Types the system
 * draws with its own controls are left out, since a plain row cannot edit them.
 */
function getChangeTypes() {
	const registered = CONFIG.ActiveEffect.documentClass.CHANGE_TYPES;
	const types = registered
		? Object.entries(registered).filter(([, config]) => !config.render).map(([type, config]) => [type, config.label, config.defaultPriority ?? 0])
		: Object.entries(CONST.ACTIVE_EFFECT_MODES).map(([name, mode]) => [LEGACY_MODE_TYPES[name], `EFFECT.MODE_${name}`, mode * 10]);
	return types
		.map(([type, label, defaultPriority]) => ({ type, label: game.i18n.localize(label), defaultPriority }))
		.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

/** Character attribute keys Daggerheart suggests for effect changes, with their labels. */
function getChangePaths() {
	try {
		const character = game.i18n.localize(CONFIG.Actor.dataModels.character.metadata.label);
		return game.system.api.applications.sheetConfigs.ActiveEffectConfig.getChangeChoices()
			.filter(choice => choice.group === character && !choice.value.startsWith("@"))
			.map(choice => ({ value: choice.isFullPath ? choice.value : `system.${choice.value}`, label: choice.label || choice.value }));
	} catch (error) {
		console.warn(`${MODULE_ID} | Could not read the Daggerheart change paths`, error);
		return [];
	}
}

class ToolkitSettings extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-settings`,
		tag: "form",
		classes: ["mist-age-settings"],
		window: { title: "MIST_AGE.Settings.Title", icon: "fa-solid fa-gears", contentClasses: ["standard-form"], resizable: true },
		// A fixed height that fits most screens; the sections scroll inside it and the window can be resized.
		position: { width: 680, height: 700 },
		form: { handler: ToolkitSettings.#onSubmit, closeOnSubmit: true }
	};

	static PARTS = {
		sections: { template: `modules/${MODULE_ID}/templates/settings.hbs`, scrollable: [""] },
		footer: { template: "templates/generic/form-footer.hbs" }
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const changeTypes = getChangeTypes();
		this.changeTypePriorities = Object.fromEntries(changeTypes.map(({ type, defaultPriority }) => [type, defaultPriority]));
		context.changeTypes = Object.fromEntries(changeTypes.map(({ type, label }) => [type, label]));
		context.changePaths = getChangePaths();
		context.newChange = { key: "", type: "add", value: "", priority: null, defaultPriority: this.changeTypePriorities.add ?? 0 };
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
					choices: config.choices,
					filePicker: config.filePicker,
					// A list of effect changes, edited like the Changes tab of an effect.
					changes: config.changes && (Array.isArray(value) ? value : []).map(change => ({
						...change,
						defaultPriority: this.changeTypePriorities[change.type] ?? 0
					}))
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
		for (const editor of this.element.querySelectorAll(".mist-changes")) {
			this.#activateChangeEditor(editor);
		}
	}

	/** Rows are added and removed in place, so other unsaved inputs in the window are kept. */
	#activateChangeEditor(editor) {
		const list = editor.querySelector(".mist-change-list");
		const template = editor.querySelector("template.mist-change-template");
		const bindRow = row => {
			row.querySelector(".mist-change-delete").addEventListener("click", () => row.remove());
			const type = row.querySelector(".mist-change-type");
			type.addEventListener("change", () => {
				row.querySelector(".mist-change-priority").placeholder = this.changeTypePriorities[type.value] ?? 0;
			});
		};
		const addRow = key => {
			const row = template.content.firstElementChild.cloneNode(true);
			if (key) {
				row.querySelector(".mist-change-key").value = key;
			}
			list.append(row);
			bindRow(row);
			row.querySelector(key ? ".mist-change-value" : ".mist-change-key").focus();
		};
		list.querySelectorAll(".mist-change-row").forEach(bindRow);
		editor.querySelector(".mist-change-add").addEventListener("click", () => addRow());
		editor.querySelector(".mist-change-add-path")?.addEventListener("click", () => addRow(editor.querySelector(".mist-change-path").value));
	}

	static async #onSubmit(event, form, formData) {
		for (const [key, value] of Object.entries(formData.object)) {
			if (game.settings.get(MODULE_ID, key) !== value) {
				await game.settings.set(MODULE_ID, key, value);
			}
		}
		// Change rows have no input names; each editor is read from its rows in order.
		for (const editor of form.querySelectorAll(".mist-changes[data-setting]")) {
			const changes = [...editor.querySelectorAll(".mist-change-list .mist-change-row")]
				.map(row => {
					const priority = row.querySelector(".mist-change-priority").value.trim();
					return {
						key: row.querySelector(".mist-change-key").value.trim(),
						type: row.querySelector(".mist-change-type").value,
						value: row.querySelector(".mist-change-value").value.trim(),
						priority: priority === "" ? null : Number(priority)
					};
				})
				.filter(change => change.key);
			const key = editor.dataset.setting;
			if (JSON.stringify(changes) !== JSON.stringify(game.settings.get(MODULE_ID, key))) {
				await game.settings.set(MODULE_ID, key, changes);
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
