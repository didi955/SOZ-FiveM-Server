import { PlayerUpdate } from '@public/core/decorators/player';

import { On, Once, OnceStep, OnEvent } from '../../core/decorators/event';
import { Inject } from '../../core/decorators/injectable';
import { Provider } from '../../core/decorators/provider';
import { wait } from '../../core/utils';
import { ClientEvent, ServerEvent } from '../../shared/event';
import { InventoryItem } from '../../shared/item';
import { PlayerData } from '../../shared/player';
import { WeaponDrawPosition, Weapons } from '../../shared/weapons/weapon';
import { AttachedObjectService } from '../object/attached.object.service';
import { WeaponService } from './weapon.service';

@Provider()
export class WeaponDrawingProvider {
    private shouldDrawWeapon = true;
    private shouldAdminDrawWeapon = true;
    private weaponsToDraw: WeaponDrawPosition[] = [];
    private weaponAttached: Record<string, number> = {};
    private playerLoaded = false;

    @Inject(AttachedObjectService)
    private attachedObjectService: AttachedObjectService;

    @Inject(WeaponService)
    private weaponService: WeaponService;

    private async updateWeaponDrawList(playerItem: Record<string, InventoryItem> | InventoryItem[]) {
        const weaponToDraw = Object.values(playerItem)
            .filter(
                item =>
                    item.type === 'weapon' &&
                    Weapons[item.name.toUpperCase()] &&
                    Weapons[item.name.toUpperCase()].drawPosition
            )
            .map(item => Weapons[item.name.toUpperCase()].drawPosition);

        if (weaponToDraw.map(w => w.model).join('') !== this.weaponsToDraw.map(w => w.model).join('')) {
            await this.undrawWeapon();
            this.weaponsToDraw = weaponToDraw;
            await this.drawWeapon();
        }
    }

    private async drawWeapon() {
        if (!this.shouldDrawWeapon || !this.shouldAdminDrawWeapon) {
            return;
        }

        for (const weapon of this.weaponsToDraw) {
            if (this.weaponAttached[weapon.model]) continue;
            this.weaponAttached[weapon.model] = -1;

            const object = await this.attachedObjectService.attachObjectToPlayer({
                bone: 24816,
                model: weapon.model,
                position: weapon.position,
                rotation: weapon.rotation,
                rotationOrder: 2,
            });

            this.weaponAttached[weapon.model] = object;

            const playerWeapon = this.weaponService.getCurrentWeapon();
            if (playerWeapon) {
                const weaponModel = Weapons[playerWeapon.name.toUpperCase()].drawPosition?.model;
                if (weaponModel) {
                    SetEntityVisible(object, false, false);
                }
            }
        }
    }

    private async undrawWeapon() {
        Object.values(this.weaponAttached).forEach(weapon => {
            SetEntityAsMissionEntity(weapon, true, true);
            const netId = ObjToNet(weapon);
            TriggerServerEvent(ServerEvent.OBJECT_ATTACHED_UNREGISTER, netId);
            DeleteObject(weapon);
        });
        this.weaponAttached = {};
    }

    @Once(OnceStep.PlayerLoaded, true)
    async setupPlayerWeaponsDraw(player: PlayerData) {
        this.shouldDrawWeapon = true;
        this.playerLoaded = true;
        await this.updateWeaponDrawList(player.items);
    }

    @PlayerUpdate()
    async onPlayerUpdate(player: PlayerData) {
        if (!this.playerLoaded) {
            return;
        }

        await this.updateWeaponDrawList(player.items);
        const weapon = this.weaponService.getCurrentWeapon();

        if (weapon) {
            if (
                !Object.values(player.items)
                    .map(i => i.slot)
                    .includes(weapon.slot)
            ) {
                await this.weaponService.clear();
            }
        }

        await this.refreshDrawWeapons();
    }

    public async undrawAdminWeapons() {
        this.shouldAdminDrawWeapon = false;
        await this.undrawWeapon();
    }

    public async drawAdminWeapons() {
        this.shouldAdminDrawWeapon = true;
        await this.drawWeapon();
    }

    @OnEvent(ClientEvent.BASE_ENTERED_VEHICLE)
    public async undrawWeapons() {
        if (IsThisModelABike(GetEntityModel(GetVehiclePedIsIn(PlayerPedId(), false)))) {
            return;
        }

        this.shouldDrawWeapon = false;
        await this.undrawWeapon();
    }

    @OnEvent(ClientEvent.BASE_LEFT_VEHICLE)
    public async drawWeapons() {
        this.shouldDrawWeapon = true;
        await this.drawWeapon();
    }

    async refreshDrawWeapons() {
        Object.values(this.weaponAttached).forEach(weapon => {
            SetEntityVisible(weapon, true, false);
        });

        const weapon = this.weaponService.getCurrentWeapon();
        if (weapon) {
            const weaponModel = Weapons[weapon.name.toUpperCase()]?.drawPosition?.model;
            if (weaponModel) {
                if (this.weaponAttached[weaponModel]) {
                    SetEntityVisible(this.weaponAttached[weaponModel], !weapon, false);
                }
            }
        }
    }

    @OnEvent(ClientEvent.WEAPON_USE_WEAPON)
    async onUseWeapon(usedWeapon: InventoryItem | null) {
        if (!this.shouldDrawWeapon) {
            return;
        }

        await wait(500);

        Object.values(this.weaponAttached).forEach(weapon => {
            SetEntityVisible(weapon, true, false);
        });

        const weapon = this.weaponService.getCurrentWeapon();
        const weaponModel = Weapons[usedWeapon?.name.toUpperCase()]?.drawPosition?.model;
        if (weaponModel) {
            if (this.weaponAttached[weaponModel]) {
                SetEntityVisible(this.weaponAttached[weaponModel], !weapon, false);
            }
        }
    }

    @Once(OnceStep.Stop)
    async stop() {
        this.shouldDrawWeapon = false;
        await this.undrawWeapon();
    }

    @On('QBCore:Client:OnPlayerUnload')
    async playerUnLoaded() {
        this.shouldDrawWeapon = false;
        this.playerLoaded = false;
        await this.undrawWeapon();
    }
}
