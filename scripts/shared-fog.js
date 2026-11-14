import { MODULE_ID } from "./shared.js";

// Fog of War exploration is Shared on every scene: one explored area for all users. New and imported scenes start
// Shared, and the scenes the world already has are switched once on the GM's load. A scene changed by hand afterwards
// keeps its mode.
const SHARED = CONST.FOG_EXPLORATION_MODES.SHARED;

export function registerSharedFog() {
	game.settings.register(MODULE_ID, "sharedFogMigrated", { scope: "world", config: false, type: Boolean, default: false });
	// Read the scene schema only once every module has set up: reading it during init fixes it before modules such as
	// Stairways add their embedded documents to scenes, and then no scene can be drawn.
	Hooks.once("setup", () => {
		foundry.documents.BaseScene.schema.getField("fog.mode").initial = SHARED;
	});
	Hooks.on("preCreateScene", scene => {
		scene.updateSource({ "fog.mode": SHARED });
	});
	Hooks.once("ready", migrateScenes);
}

async function migrateScenes() {
	if (!game.users.activeGM?.isSelf || game.settings.get(MODULE_ID, "sharedFogMigrated")) {
		return;
	}
	const updates = game.scenes.filter(scene => scene.fog.mode !== SHARED).map(scene => ({ _id: scene.id, "fog.mode": SHARED }));
	if (updates.length) {
		await Scene.updateDocuments(updates);
	}
	await game.settings.set(MODULE_ID, "sharedFogMigrated", true);
}
