# The Mist Age - Toolkit

Foundry VTT module for the Daggerheart world *The Mist Age*.

- **Prices.** A price (in Silver) on weapons, armor, consumables and loot, shown on item sheets and inventories. Item Piles merchants read it, and the module keeps the Item Piles currencies in line with the Daggerheart homebrew currency (10 Penny = 1 Silver, 100 Silver = 1 Gold).
- **HB compendiums.** One-time copies of the Daggerheart Weapons, Armors, Consumables, Items and Rolltables compendiums as world compendiums with an `(HB)` suffix, so system updates never overwrite them. Prices from `data/compendium-prices.json` fill items that have no price yet.
- **Loot tables.** Primary/Secondary × Physical/Magic weapon tables and an armor table; the roll formula picks the rarity (Common = Tier 1 … Legendary = Tier 4).
- **Weight.** Weight in slots per item (`data/weights.json` holds per-item defaults) and a load bar on character sheets with capacity from Strength.
- **Adversary inventory.** An Inventory tab with gold on adversary sheets.

## Install

In Foundry: **Add-on Modules → Install Module**, paste the manifest URL and press **Install**:

```
https://github.com/liderako/the_mist_age_foundry_daggerheart_addtional/releases/latest/download/module.json
```

## Release a new version

1. Commit and push the changes.
2. On GitHub create a release with a tag like `v1.0.1` and publish it.
3. The **Release** workflow sets that version in `module.json` and attaches `module.json` and `module.zip` to the release. Foundry then offers the update.

## Data notes

- Prices are stored in `flags.mist-age-prices.price` and weights in `flags.mist-age-weight.*`: the scopes of the earlier separate modules, kept so existing data needs no migration.
- Adversary gold is stored in `system.gold`, like character gold. Disabling the module drops that field from adversaries the next time they are saved.
