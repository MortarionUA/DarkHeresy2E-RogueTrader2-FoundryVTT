/**
 * Roll a generic roll, and post the result to chat.
 * @param {object} rollData
 */
export async function commonRoll(rollData) {
    await _computeTarget(rollData);
    await _rollTarget(rollData);
    await _sendToChat(rollData);
}

/**
 * Roll a combat roll, and post the result to chat.
 * @param {object} rollData
 */
export async function combatRoll(rollData) {
    if (rollData.weaponTraits.skipAttackRoll) {
        rollData.result = 5; // Attacks that skip the hit roll always hit body; 05 reversed 50 = body
        await _rollDamage(rollData);
        // Without a To Hit Roll we need a substitute otherwise foundry can't render the message
        rollData.rollObject = rollData.damages[0].damageRoll;
    } else {
        await _computeTarget(rollData);
        await _rollTarget(rollData);
        if (rollData.isJammed) {
            if (rollData.isOverheated) {
                await _rollDamage(rollData);
            }
        } else if (rollData.isSuccess) {
            await _rollDamage(rollData);
        }
    }
    await _sendToChat(rollData);
}

export async function shipCombatRoll(rollData) {
    // if (rollData.weaponTraits.skipAttackRoll) {
    //   rollData.result = 5; // Attacks that skip the hit roll always hit body; 05 reversed 50 = body
    //   await _rollShipDamage(rollData);
    //   // Without a To Hit Roll we need a substitute otherwise foundry can't render the message
    //   rollData.rollObject = rollData.damages[0].damageRoll;
    // } else {
    await _computeShipTarget(rollData);
    rollData.shotResults = [];
    rollData.numberOfHits = 0;
    if (rollData.shipWeaponClass == "attack") {
        if (rollData.enemyStats) {
            await _fireCounterMeasures(rollData);
            for (let i = 0; i < rollData.strength - rollData.turretHits; i++) {
                await _rollShipAttackCraft(rollData);
            }
        }
        else {
            for (let i = 0; i < rollData.strength; i++) {
                await _rollShipAttackCraft(rollData);
            }
        }
        await _rollShipAttackDamage(rollData);
    } else {
        for (let i = 0; i < rollData.strength; i++) {
            await _rollShipTargetDamage(rollData);
        }
    }
    // }
    await _sendShipToChat(rollData);
}

export async function shipTurretRoll(rollData) {
    rollData.turretHits = 0;
    rollData.target = rollData.baseTarget + rollData.modifier
    for (let i = 0; i < rollData.turretNumber; i++) {
        let r = new Roll("1d100", {});
        r.evaluate({async: false});
        if (r.total <= rollData.target) {
            rollData.turretHits++;
        }
    }
    await _sendTurretsToChat(rollData);
}

export async function unitCombatRoll(rollData) {
    await _computeUnitTarget(rollData);
    await _rollUnitTargetDamage(rollData);
    await _sendUnitToChat(rollData);
}

/**
 * Post an "empty clip, need to reload" message to chat.
 * @param {object} rollData
 */
export async function reportEmptyClip(rollData) {
    await _emptyClipToChat(rollData);
}

/**
 * Compute the target value, including all +/-modifiers, for a roll.
 * @param {object} rollData
 */
async function _computeTarget(rollData) {
    const range = (rollData.range) ? rollData.range : "0";
    let attackType = 0;
    if (typeof rollData.attackType !== "undefined" && rollData.attackType != null) {
        _computeRateOfFire(rollData);
        attackType = rollData.attackType.modifier;
    }
    let psyModifier = 0;
    if (typeof rollData.psy !== "undefined" && typeof rollData.psy.useModifier !== "undefined" && rollData.psy.useModifier) {
        // Set Current Psyrating to the allowed maximum if it is bigger
        if (rollData.psy.value > rollData.psy.max) {
            rollData.psy.value = rollData.psy.max;
        }
        psyModifier = (rollData.psy.rating - rollData.psy.value) * 10;
        rollData.psy.push = psyModifier < 0;
        if (rollData.psy.push && rollData.psy.warpConduit) {
            let ratingBonus = new Roll("1d5").evaluate({async: false}).total;
            rollData.psy.value += ratingBonus;
        }
    }
    let aim = rollData.aim?.val ? rollData.aim.val : 0;
    const formula = `0 + ${rollData.modifier} + ${aim} + ${range} + ${attackType} + ${psyModifier}`;
    let r = new Roll(formula, {});
    r.evaluate({async: false});
    if (r.total > 60) {
        rollData.target = rollData.baseTarget + 60;
    } else if (r.total < -60) {
        rollData.target = rollData.baseTarget + -60;
    } else {
        rollData.target = rollData.baseTarget + r.total;
    }
    rollData.rollObject = r;
}

async function _computeShipTarget(rollData) {
    if (rollData.shipWeaponClass == "attack" || rollData.shipWeaponClass == "torpedoes") {
        rollData.range = 0;
    }
    const range = (rollData.range) ? rollData.range : "0";
    let attackType = 0;
    const formula = `0 + ${rollData.modifier} + + ${range}`;
    let r = new Roll(formula, {});
    r.evaluate({async: false});
    if (r.total > 60) {
        rollData.target = rollData.baseTarget + 60;
    } else if (r.total < -60) {
        rollData.target = rollData.baseTarget + -60;
    } else {
        rollData.target = rollData.baseTarget + r.total;
    }
    rollData.rollObject = r;
}

async function _computeUnitTarget(rollData) {
    let range = 0;

    if (rollData.weaponTraits.scatter && (rollData.range == "-20")) {
        range = 10;
    } else if (rollData.weaponClass == "pistol" && (rollData.range == "-20")) {
        range = 0;
    } else if (rollData.weaponTraits.scatter && (rollData.range == "0")) {
        range = -20;
    } else {
        range = (rollData.range) ? rollData.range : "0";
    }
    let attackType = 0;
    if (typeof rollData.attackType !== "undefined" && rollData.attackType != null) {
        _computeRateOfFire(rollData);
        attackType = rollData.attackType.modifier;
    }
    let enemyDefence = 0;
    if (rollData.isMelee) {
        enemyDefence = rollData.enemyStats.meleeDefence;
    } else {
        enemyDefence = rollData.enemyStats.rangedDefence;
    }
    if (rollData.weaponTraits.torrent) {
        enemyDefence = 0;
    }
    let massCombatMod = 30;
    const formula = `0 + ${rollData.modifier} + ${range} + ${attackType} - ${enemyDefence} + ${massCombatMod}`;
    let r = new Roll(formula, {});
    r.evaluate({async: false});
    if (r.total > 60) {
        rollData.target = rollData.baseTarget + 60;
    } else if (r.total < -60) {
        rollData.target = rollData.baseTarget + -60;
    } else {
        rollData.target = rollData.baseTarget + r.total;
    }
    rollData.rollObject = r;
}

/**
 * Roll a d100 against a target, and apply the result to the rollData.
 * @param {object} rollData
 */
async function _rollTarget(rollData) {
    let r = new Roll("1d100", {});
    r.evaluate({async: false});
    rollData.result = r.total;
    rollData.rollObject = r;
    rollData.isJammed = rollData.result >= rollData.jamTarget;
    rollData.isSuccess = rollData.result <= rollData.target;
    rollData.isOverheated = false;
    if (rollData.isJammed) {
        if (rollData.overheats) {
            rollData.isOverheated = true;
        }
    } else if (rollData.isSuccess) {
        rollData.dof = 0;
        rollData.dos = 1 + _getDegree(rollData.target, rollData.result);
    } else {
        rollData.dos = 0;
        rollData.dof = 1 + _getDegree(rollData.result, rollData.target);
    }
    if (typeof rollData.psy !== "undefined") _computePsychicPhenomena(rollData);
}

async function _fireCounterMeasures(rollData) {
    let crewRate = rollData.enemyStats.enemy.bio.shipCrewRate;
    let turretNumber = rollData.enemyStats.enemy.system.shipTurretRate.value;
    rollData.turretHits = 0;
    for (let i = 0; i < turretNumber; i++) {
        let r = new Roll("1d100", {});
        r.evaluate({async: false});
        if (r.total <= crewRate) {
            rollData.turretHits++;
        }
    }
}

async function _rollShipAttackCraft(rollData) {
    let r = new Roll("1d100", {});
    r.evaluate({async: false});
    let rollResult = new Object();
    rollResult.result = r.total;
    rollResult.rollObject = r;
    rollResult.isSuccess = rollResult.result <= rollData.target;
    if (rollResult.isSuccess) {
        rollResult.dof = 0;
        rollResult.dos = 1 + _getDegree(rollData.target, rollResult.result);
    } else {
        rollResult.dos = 0;
        rollResult.dof = 1 + _getDegree(rollResult.result, rollData.target);
    }
    if (rollResult.isSuccess) {
        rollData.numberOfHits = rollData.numberOfHits + 1 + Number(((rollResult.dos - 1) / 2).toFixed(0));
    }
}

async function _rollShipAttackDamage(rollData) {
    let temporalDamage = 0;
    for (let i = 0; i < rollData.numberOfHits; i++) {
        temporalDamage++
        if (temporalDamage == rollData.damageFormula) {
            let formula = temporalDamage;
            let r = new Roll("1d100", {});
            r.evaluate({async: false});
            let rollResult = new Object();
            rollResult.dos = 1;
            rollResult.isSuccess = true;
            rollResult.result = r.total;
            formula = `${formula}+${rollData.damageBonus}`;

            rollResult.hit = await _computeShipDamage(formula, rollResult.dos);
            rollResult.location = _getShipLocation(rollResult.result, rollData.attackedShipType.name, rollData.sideOfAttack.name);
            if (rollData.enemyStats) {
                await _applyDamage(rollData, rollResult);
            }
            temporalDamage = 0;
            rollData.shotResults.push(rollResult);
        } else if (i == rollData.numberOfHits - 1) {
            let formula = temporalDamage;
            let r = new Roll("1d100", {});
            r.evaluate({async: false});
            let rollResult = new Object();
            rollResult.dos = 1;
            rollResult.isSuccess = true;
            rollResult.result = r.total;
            formula = `${formula}+${rollData.damageBonus}`;

            rollResult.hit = await _computeShipDamage(formula, rollResult.dos);
            rollResult.location = _getShipLocation(rollResult.result, rollData.attackedShipType.name, rollData.sideOfAttack.name);
            if (rollData.enemyStats) {
                await _applyDamage(rollData, rollResult);
            }
            rollData.shotResults.push(rollResult);
        }
    }

}

async function _rollShipTargetDamage(rollData) {
    let r = new Roll("1d100", {});
    r.evaluate({async: false});
    let rollResult = new Object();
    rollResult.result = r.total;
    rollResult.rollObject = r;
    rollResult.isSuccess = rollResult.result <= rollData.target;
    if (rollResult.isSuccess) {
        rollResult.dof = 0;
        rollResult.dos = 1 + _getDegree(rollData.target, rollResult.result);
    } else {
        rollResult.dos = 0;
        rollResult.dof = 1 + _getDegree(rollResult.result, rollData.target);
    }
    if (rollResult.isSuccess) {
        let formula = "0";
        if (rollData.damageFormula) {
            formula = rollData.damageFormula;

            formula = `${formula}+${rollData.damageBonus}`;
            // if (rollData.shipWeaponClass == "attack") {
            //     formula = `${formula}+${rollData.damageBonus}+${rollResult.dos}`;
            // }
        }
        rollResult.hit = await _computeShipDamage(formula, rollResult.dos);
        if (rollData.enemyStats && rollData.shipWeaponClass != "torpedoes") {
            let shipShields = rollData.enemyStats.enemy.system.shipShields;
            let damage = rollResult.hit.total;
            if (rollData.shipWeaponTraits.lance) {
                damage -= rollData.shipWeaponTraits.lance.valueOf();
            }
            if (shipShields.shieldFive.value > 0) {
                rollResult.hit.total = damage;
                await rollData.enemyStats.enemy.update({'system.shipShields.shieldFive.value': shipShields.shieldFive.value - damage});
                rollResult.location = "HIT_SYSTEMS.SHIELDS";
            } else if (shipShields.shieldFour.value > 0) {
                rollResult.hit.total = damage;
                await rollData.enemyStats.enemy.update({'system.shipShields.shieldFour.value': shipShields.shieldFour.value - damage});
                rollResult.location = "HIT_SYSTEMS.SHIELDS";
            } else if (shipShields.shieldThree.value > 0) {
                rollResult.hit.total = damage;
                await rollData.enemyStats.enemy.update({'system.shipShields.shieldThree.value': shipShields.shieldThree.value - damage});
                rollResult.location = "HIT_SYSTEMS.SHIELDS";
            } else if (shipShields.shieldTwo.value > 0) {
                rollResult.hit.total = damage;
                await rollData.enemyStats.enemy.update({'system.shipShields.shieldTwo.value': shipShields.shieldTwo.value - damage});
                rollResult.location = "HIT_SYSTEMS.SHIELDS";
            } else if (shipShields.shieldOne.value > 0) {
                rollResult.hit.total = damage;
                await rollData.enemyStats.enemy.update({'system.shipShields.shieldOne.value': shipShields.shieldOne.value - damage});
                rollResult.location = "HIT_SYSTEMS.SHIELDS";
            } else {
                rollResult.location = _getShipLocation(rollResult.result, rollData.attackedShipType.name, rollData.sideOfAttack.name);
                await _applyDamage(rollData, rollResult);
            }
        } else {
            rollResult.location = _getShipLocation(rollResult.result, rollData.attackedShipType.name, rollData.sideOfAttack.name);
        }
        rollData.numberOfHits++;
    }
    rollData.shotResults.push(rollResult);
}

async function _applyDamage(rollData, rollResult) {
    let damage = rollResult.hit.total;
    let bonusArmorDamage = 0;
    if (rollData.shipWeaponTraits.lance) {
        bonusArmorDamage = rollData.shipWeaponTraits.lance.valueOf();
    }
    if (rollResult.location == "HIT_SYSTEMS.PROW") {
        let armor = rollData.enemyStats.enemy.system.shipArmor.prow.armor.value;
        let structure = rollData.enemyStats.enemy.system.shipArmor.prow.structure.value;
        if ((damage + bonusArmorDamage) < armor) {
            await rollData.enemyStats.enemy.update({'system.shipArmor.prow.armor.value': armor - (damage + bonusArmorDamage)});
            rollResult.hit.total = damage + bonusArmorDamage;
            if (rollData.shipWeaponClass == "torpedoes") await _rollCriticalDamage(rollData, rollResult, 0);
        } else {
            let structureDamage = damage - armor;
            await _rollCriticalDamage(rollData, rollResult, structureDamage);
            if (armor > 0) {
                await rollData.enemyStats.enemy.update({'system.shipArmor.prow.armor.value': 0});
                await rollData.enemyStats.enemy.update({'system.shipArmor.prow.structure.value': structure - structureDamage - bonusArmorDamage});
                rollResult.hit.total = structureDamage + bonusArmorDamage + armor;
            } else {
                await rollData.enemyStats.enemy.update({'system.shipArmor.prow.structure.value': structure - structureDamage});
                rollResult.hit.total = structureDamage;
            }
        }
    }
    if (rollResult.location == "HIT_SYSTEMS.PORT") {
        let armor = rollData.enemyStats.enemy.system.shipArmor.port.armor.value;
        let structure = rollData.enemyStats.enemy.system.shipArmor.port.structure.value;
        if ((damage + bonusArmorDamage) < armor) {
            await rollData.enemyStats.enemy.update({'system.shipArmor.port.armor.value': armor - (damage + bonusArmorDamage)});
            rollResult.hit.total = damage + bonusArmorDamage;
            if (rollData.shipWeaponClass == "torpedoes") await _rollCriticalDamage(rollData, rollResult, 0);
        } else {
            let structureDamage = damage - armor;
            await _rollCriticalDamage(rollData, rollResult, structureDamage);
            if (armor > 0) {
                await rollData.enemyStats.enemy.update({'system.shipArmor.port.armor.value': 0});
                await rollData.enemyStats.enemy.update({'system.shipArmor.port.structure.value': structure - structureDamage - bonusArmorDamage});
                rollResult.hit.total = structureDamage + bonusArmorDamage + armor;
            } else {
                await rollData.enemyStats.enemy.update({'system.shipArmor.port.structure.value': structure - structureDamage});
                rollResult.hit.total = structureDamage;
            }
        }
    }
    if (rollResult.location == "HIT_SYSTEMS.STARBOARD") {
        let armor = rollData.enemyStats.enemy.system.shipArmor.starboard.armor.value;
        let structure = rollData.enemyStats.enemy.system.shipArmor.starboard.structure.value;
        if ((damage + bonusArmorDamage) < armor) {
            await rollData.enemyStats.enemy.update({'system.shipArmor.starboard.armor.value': armor - (damage + bonusArmorDamage)});
            rollResult.hit.total = damage + bonusArmorDamage;
            if (rollData.shipWeaponClass == "torpedoes") await _rollCriticalDamage(rollData, rollResult, 0);
        } else {
            let structureDamage = damage - armor;
            await _rollCriticalDamage(rollData, rollResult, structureDamage);
            if (armor > 0) {
                await rollData.enemyStats.enemy.update({'system.shipArmor.starboard.armor.value': 0});
                await rollData.enemyStats.enemy.update({'system.shipArmor.starboard.structure.value': structure - structureDamage - bonusArmorDamage});
                rollResult.hit.total = structureDamage + bonusArmorDamage + armor;
            } else {
                await rollData.enemyStats.enemy.update({'system.shipArmor.starboard.structure.value': structure - structureDamage});
                rollResult.hit.total = structureDamage;
            }
        }
    }
    if (rollResult.location == "HIT_SYSTEMS.MAIN") {
        let armor = rollData.enemyStats.enemy.system.shipArmor.main.armor.value;
        let structure = rollData.enemyStats.enemy.system.shipArmor.main.structure.value;
        if ((damage + bonusArmorDamage) < armor) {
            await rollData.enemyStats.enemy.update({'system.shipArmor.main.armor.value': armor - (damage + bonusArmorDamage)});
            rollResult.hit.total = damage + bonusArmorDamage;
            if (rollData.shipWeaponClass == "torpedoes") await _rollCriticalDamage(rollData, rollResult, 0);
        } else {
            let structureDamage = damage - armor;
            await _rollCriticalDamage(rollData, rollResult, structureDamage);
            if (armor > 0) {
                await rollData.enemyStats.enemy.update({'system.shipArmor.main.armor.value': 0});
                await rollData.enemyStats.enemy.update({'system.shipArmor.main.structure.value': structure - structureDamage - bonusArmorDamage});
                rollResult.hit.total = structureDamage + bonusArmorDamage + armor;
            } else {
                await rollData.enemyStats.enemy.update({'system.shipArmor.main.structure.value': structure - structureDamage});
                rollResult.hit.total = structureDamage;
            }
        }
    }
    if (rollResult.location == "HIT_SYSTEMS.BRIDGE") {
        let armor = rollData.enemyStats.enemy.system.shipArmor.bridge.armor.value;
        let structure = rollData.enemyStats.enemy.system.shipArmor.bridge.structure.value;
        if ((damage + bonusArmorDamage) < armor) {
            await rollData.enemyStats.enemy.update({'system.shipArmor.bridge.armor.value': armor - (damage + bonusArmorDamage)});
            rollResult.hit.total = damage + bonusArmorDamage;
            if (rollData.shipWeaponClass == "torpedoes") await _rollCriticalDamage(rollData, rollResult, 0);
        } else {
            let structureDamage = damage - armor;
            await _rollCriticalDamage(rollData, rollResult, structureDamage + 8);
            if (armor > 0) {
                await rollData.enemyStats.enemy.update({'system.shipArmor.bridge.armor.value': 0});
                await rollData.enemyStats.enemy.update({'system.shipArmor.bridge.structure.value': structure - structureDamage - bonusArmorDamage});
                rollResult.hit.total = structureDamage + bonusArmorDamage + armor;
            } else {
                await rollData.enemyStats.enemy.update({'system.shipArmor.bridge.structure.value': structure - structureDamage});
                rollResult.hit.total = structureDamage;
            }
        }
    }
    if (rollResult.location == "HIT_SYSTEMS.AFT") {
        let armor = rollData.enemyStats.enemy.system.shipArmor.aft.armor.value;
        let structure = rollData.enemyStats.enemy.system.shipArmor.aft.structure.value;
        if ((damage + bonusArmorDamage) < armor) {
            await rollData.enemyStats.enemy.update({'system.shipArmor.aft.armor.value': armor - (damage + bonusArmorDamage)});
            rollResult.hit.total = damage + bonusArmorDamage;
            if (rollData.shipWeaponClass == "torpedoes") await _rollCriticalDamage(rollData, rollResult, 0);
        } else {
            let structureDamage = damage - armor;
            await _rollCriticalDamage(rollData, rollResult, structureDamage);
            if (armor > 0) {
                await rollData.enemyStats.enemy.update({'system.shipArmor.aft.armor.value': 0});
                await rollData.enemyStats.enemy.update({'system.shipArmor.aft.structure.value': structure - structureDamage - bonusArmorDamage});
                rollResult.hit.total = structureDamage + bonusArmorDamage + armor;
            } else {
                await rollData.enemyStats.enemy.update({'system.shipArmor.aft.structure.value': structure - structureDamage});
                rollResult.hit.total = structureDamage;
            }
        }
    }
}

async function _rollCriticalDamage(rollData, rollResult, damage) {
    let r = new Roll("2d6", {});
    r.evaluate({async: false});
    let result = r.total + Number((damage / 4).toFixed(0));
    if (result <= 8) {
        rollResult.critical = "No Critical Hits";
    } else if (result <= 10) {
        rollResult.critical = "1 Critical Hit";
    } else if (result <= 12) {
        let t = new Roll("d3+1", {});
        t.evaluate({async: false});
        rollResult.critical = t.total + " Critical Hits";
    } else if (result <= 14) {
        let t = new Roll("d6+1", {});
        t.evaluate({async: false});
        rollResult.critical = t.total + " Critical Hits";
    } else if (result > 14) {
        let t = new Roll("2d6+2", {});
        t.evaluate({async: false});
        rollResult.critical = t.total + " Critical Hits";
    }
}

async function _rollUnitTargetDamage(rollData) {
    let dos = 0;
    let dof = 0;
    for (let i = 0; i < rollData.quantity; i++) {
        let r = new Roll("1d100", {});
        r.evaluate({async: false});
        let result = r.total;
        let isSuccess = result <= rollData.target;
        if (isSuccess) {
            dof = 0;
            dos = 1 + _getDegree(rollData.target, result);
        } else {
            dos = 0;
            dof = 1 + _getDegree(result, rollData.target);
        }
        if (isSuccess || rollData.weaponTraits.ordnance > dof) {
            let multipleHits = 0;
            if (rollData.weaponTraits.torrent) {
                let rollFormula = rollData.weaponTraits.torrent + "d4+" + rollData.weaponTraits.torrent;
                let r = new Roll(rollFormula, {});
                r.evaluate({async: false});
                multipleHits += r.total + Number(((dos - 1) / 2).toFixed(0));
            }
            if (rollData.weaponTraits.ordnance) {
                multipleHits += rollData.weaponTraits.ordnance + Number(((dos - 1) / 2).toFixed(0)) - dof;
            }
            if (rollData.weaponTraits.scatter && (rollData.range == "-20")) {
                multipleHits += Number(((dos - 1) / 2).toFixed(0));
            }
            if (multipleHits > 0) {
                for (let j = 0; j < multipleHits; j++) {
                    let formula = "0";
                    let damageBonus = rollData.damageBonus;
                    let enemyArmor = rollData.enemyStats.armor;
                    let enemyToughness = rollData.enemyStats.toughness;
                    let enemyWounds = rollData.enemyStats.wounds;
                    if (rollData.enemyStats.auxChance > 0) {
                        let r = new Roll("1d100", {});
                        r.evaluate({async: false});
                        let result = r.total;
                        if (result < rollData.enemyStats.auxChance) {
                            enemyArmor = rollData.enemyStats.auxArmor;
                            enemyToughness = rollData.enemyStats.auxToughness;
                            enemyWounds = rollData.enemyStats.auxWounds;
                        }
                    }
                    if (rollData.weaponTraits.scatter && (rollData.range == "-20")) {
                        damageBonus += 3;
                    }
                    if (rollData.weaponTraits.scatter && (rollData.range == "0")) {
                        damageBonus -= 3;
                    }
                    if (rollData.damageFormula) {
                        formula = rollData.damageFormula;

                        if (rollData.weaponTraits.tearing) {
                            formula = _appendTearing(formula);
                        }
                        if (rollData.weaponTraits.proven) {
                            formula = _appendNumberedDiceModifier(formula, "min", rollData.weaponTraits.proven);
                        }
                        if (rollData.weaponTraits.primitive) {
                            formula = _appendNumberedDiceModifier(formula, "max", rollData.weaponTraits.primitive);
                        }

                        formula = `${formula}+${rollData.damageBonus}`;
                    }
                    let penetration = _rollUnitPenetration(rollData);
                    let hit = await _computeUnitDamage(formula, dos, rollData.weaponTraits);
                    let damageResult = hit.total - Math.max((enemyArmor - penetration), 0) - enemyToughness;
                    if (rollData.weaponTraits.accurate) {
                        damageResult += dos * 2;
                    }
                    if (damageResult > 0) {
                        if (damageResult >= enemyWounds) {
                            rollData.brutals++;
                            rollData.damageDealt += enemyWounds;
                        } else rollData.damageDealt += damageResult;
                    }
                    if (hit.righteousFury > 0) {
                        rollData.crits++;
                    }
                    rollData.numberOfHits++;

                    let potentialHits = dos;
                    let stormMod = (rollData.weaponTraits.storm ? 2 : 1);

                    if (((rollData.attackType.hitMargin > 0) || (rollData.twinLinkedAdditionalHitMargin > 0))) {
                        let maxAdditionalHit = Math.floor(((potentialHits * stormMod) - 1) / rollData.attackType.hitMargin);
                        if (typeof rollData.maxAdditionalHit !== "undefined" && maxAdditionalHit > rollData.maxAdditionalHit) {
                            maxAdditionalHit = rollData.maxAdditionalHit;
                        }
                        if (rollData.twinLinkedAdditionalHitMargin != 0) {
                            let twinLinkedAdditionalHit = Math.floor(potentialHits / rollData.twinLinkedAdditionalHitMargin);
                            if (twinLinkedAdditionalHit > rollData.maxTwinLinkedHit) {
                                twinLinkedAdditionalHit = rollData.maxTwinLinkedHit;
                            }
                            if (twinLinkedAdditionalHit > 0) {
                                maxAdditionalHit += twinLinkedAdditionalHit;
                            }
                        }
                        rollData.numberOfHit = maxAdditionalHit + 1;
                        for (let i = 0; i < maxAdditionalHit; i++) {
                            let hit = await _computeUnitDamage(formula, dos, rollData.weaponTraits);
                            let damageResult = hit.total - Math.max((rollData.enemyStats.armor - penetration), 0) - rollData.enemyStats.toughness;
                            if (rollData.weaponTraits.accurate) {
                                damageResult += dos * 2;
                            }
                            if (damageResult > 0) {
                                if (damageResult >= rollData.enemyStats.wounds) {
                                    rollData.brutals++;
                                    rollData.damageDealt += rollData.enemyStats.wounds;
                                } else rollData.damageDealt += damageResult;
                            }
                            if (hit.righteousFury > 0) {
                                rollData.crits++;
                            }
                            rollData.numberOfHits++;
                        }
                    }
                }
            } else {
                let formula = "0";
                let damageBonus = rollData.damageBonus;
                let enemyArmor = rollData.enemyStats.armor;
                let enemyToughness = rollData.enemyStats.toughness;
                let enemyWounds = rollData.enemyStats.wounds;
                if (rollData.enemyStats.auxChance > 0) {
                    let r = new Roll("1d100", {});
                    r.evaluate({async: false});
                    let result = r.total;
                    if (result < rollData.enemyStats.auxChance) {
                        enemyArmor = rollData.enemyStats.auxArmor;
                        enemyToughness = rollData.enemyStats.auxToughness;
                        enemyWounds = rollData.enemyStats.auxWounds;
                    }
                }
                if (rollData.weaponTraits.scatter && (rollData.range == "-20")) {
                    damageBonus += 3;
                }
                if (rollData.weaponTraits.scatter && (rollData.range == "0")) {
                    damageBonus -= 3;
                }
                if (rollData.damageFormula) {
                    formula = rollData.damageFormula;

                    if (rollData.weaponTraits.tearing) {
                        formula = _appendTearing(formula);
                    }
                    if (rollData.weaponTraits.proven) {
                        formula = _appendNumberedDiceModifier(formula, "min", rollData.weaponTraits.proven);
                    }
                    if (rollData.weaponTraits.primitive) {
                        formula = _appendNumberedDiceModifier(formula, "max", rollData.weaponTraits.primitive);
                    }

                    formula = `${formula}+${rollData.damageBonus}`;
                }
                let penetration = _rollUnitPenetration(rollData);
                let hit = await _computeUnitDamage(formula, dos, rollData.weaponTraits);
                let damageResult = hit.total - Math.max((enemyArmor - penetration), 0) - enemyToughness;
                if (rollData.weaponTraits.accurate) {
                    damageResult += dos * 2;
                }
                if (damageResult > 0) {
                    if (damageResult >= enemyWounds) {
                        rollData.brutals++;
                        rollData.damageDealt += enemyWounds;
                    } else rollData.damageDealt += damageResult;
                }
                if (hit.righteousFury > 0) {
                    rollData.crits++;
                }
                rollData.numberOfHits++;

                let potentialHits = dos;
                let stormMod = (rollData.weaponTraits.storm ? 2 : 1);

                if (((rollData.attackType.hitMargin > 0) || (rollData.twinLinkedAdditionalHitMargin > 0))) {
                    let maxAdditionalHit = Math.floor(((potentialHits * stormMod) - 1) / rollData.attackType.hitMargin);
                    if (typeof rollData.maxAdditionalHit !== "undefined" && maxAdditionalHit > rollData.maxAdditionalHit) {
                        maxAdditionalHit = rollData.maxAdditionalHit;
                    }
                    if (rollData.twinLinkedAdditionalHitMargin != 0) {
                        let twinLinkedAdditionalHit = Math.floor(potentialHits / rollData.twinLinkedAdditionalHitMargin);
                        if (twinLinkedAdditionalHit > rollData.maxTwinLinkedHit) {
                            twinLinkedAdditionalHit = rollData.maxTwinLinkedHit;
                        }
                        if (twinLinkedAdditionalHit > 0) {
                            maxAdditionalHit += twinLinkedAdditionalHit;
                        }
                    }
                    rollData.numberOfHit = maxAdditionalHit + 1;
                    for (let i = 0; i < maxAdditionalHit; i++) {
                        let hit = await _computeUnitDamage(formula, dos, rollData.weaponTraits);
                        let damageResult = hit.total - Math.max((rollData.enemyStats.armor - penetration), 0) - rollData.enemyStats.toughness;
                        if (rollData.weaponTraits.accurate) {
                            damageResult += dos * 2;
                        }
                        if (damageResult > 0) {
                            if (damageResult >= rollData.enemyStats.wounds) {
                                rollData.brutals++;
                                rollData.damageDealt += rollData.enemyStats.wounds;
                            } else rollData.damageDealt += damageResult;
                        }
                        if (hit.righteousFury > 0) {
                            rollData.crits++;
                        }
                        rollData.numberOfHits++;
                    }
                }
            }
        }

    }
}

/**
 * Handle rolling and collecting parts of a combat damage roll.
 * @param {object} rollData
 */
async function _rollDamage(rollData) {
    let formula = "0";
    rollData.damages = [];
    if (rollData.damageFormula) {
        formula = rollData.damageFormula;

        if (rollData.weaponTraits.tearing) {
            formula = _appendTearing(formula);
        }
        if (rollData.weaponTraits.proven) {
            formula = _appendNumberedDiceModifier(formula, "min", rollData.weaponTraits.proven);
        }
        if (rollData.weaponTraits.primitive) {
            formula = _appendNumberedDiceModifier(formula, "max", rollData.weaponTraits.primitive);
        }

        formula = `${formula}+${rollData.damageBonus}`;
        if (rollData.weaponTraits.unstable) {
            formula = _appendUnstable(formula);
        }
        formula = _replaceSymbols(formula, rollData);
    }
    let penetration = _rollPenetration(rollData);
    let firstHit = await _computeDamage(formula, penetration, rollData.dos, rollData.aim?.val, rollData.weaponTraits);
    if (firstHit.total !== 0) {
        const firstLocation = _getLocation(rollData.result);
        firstHit.location = firstLocation;
        rollData.damages.push(firstHit);

        let potentialHits = rollData.dos;
        let stormMod = (rollData.weaponTraits.storm ? 2 : 1);
        // if (rollData.weaponTraits.twinLinked) {
        //   stormMod = 2;
        // }
        if (((rollData.attackType.hitMargin > 0) || (rollData.twinLinkedAdditionalHitMargin > 0)) && !rollData.isOverheated) {
            let maxAdditionalHit = Math.floor(((potentialHits * stormMod) - 1) / rollData.attackType.hitMargin);
            if (typeof rollData.maxAdditionalHit !== "undefined" && maxAdditionalHit > rollData.maxAdditionalHit) {
                maxAdditionalHit = rollData.maxAdditionalHit;
            }
            if (rollData.twinLinkedAdditionalHitMargin != 0) {
                let twinLinkedAdditionalHit = Math.floor(potentialHits / rollData.twinLinkedAdditionalHitMargin);
                if (twinLinkedAdditionalHit > rollData.maxTwinLinkedHit) {
                    twinLinkedAdditionalHit = rollData.maxTwinLinkedHit;
                }
                if (twinLinkedAdditionalHit > 0) {
                    maxAdditionalHit += twinLinkedAdditionalHit;
                }
            }
            rollData.numberOfHit = maxAdditionalHit + 1;
            for (let i = 0; i < maxAdditionalHit; i++) {
                let additionalHit = await _computeDamage(formula, penetration, rollData.dos, rollData.aim?.val, rollData.weaponTraits);
                additionalHit.location = _getAdditionalLocation(firstLocation, i);
                rollData.damages.push(additionalHit);
            }
        } else {
            rollData.numberOfHit = 1;
        }
        // let minDamage = rollData.damages.reduce(
        //   (min, damage) => min.minDice < damage.minDice ? min : damage, rollData.damages[0]
        // );
        // if (minDamage.minDice < rollData.dos) {
        //   minDamage.total += (rollData.dos - minDamage.minDice);
        // }
    }
}

async function _rollShipDamage(rollData) {
    let formula = "0";
    if (rollData.damageFormula) {
        formula = rollData.damageFormula;

        formula = `${formula}+${rollData.damageBonus}`;
        formula = _replaceSymbols(formula, rollData);
    }
    let hit = await _computeShipDamage(formula, rollData.dos);
    hit.location = _getShipLocation(rollData.result, rollData.attackedShipType, rollData.sideOfAttack);
}

/**
 * Roll and compute damage.
 * @param {number} penetration
 * @param {object} rollData
 * @returns {object}
 */
async function _computeDamage(damageFormula, penetration, dos, aimMode, weaponTraits) {
    let r = new Roll(damageFormula);
    r.evaluate({async: false});
    let damage = {
        total: r.total,
        righteousFury: 0,
        dices: [],
        penetration: penetration,
        dos: dos,
        formula: damageFormula,
        replaced: false,
        damageRender: await r.render()
    };

    if (weaponTraits.accurate && (aimMode != "0")) {
        let aimDmg = 0;
        if (aimMode == "10") {
            aimDmg = (dos - 1) * 1; //-1 because each degree after the first counts
        } else {
            aimDmg = (dos - 1) * 2; //-1 because each degree after the first counts
        }
        let ar = new Roll(`${aimDmg}`);
        ar.evaluate({async: false});
        damage.accurateRender = await ar.render();
        // }
    }

    // Without a To Hit we a roll to associate the chat message with
    if (weaponTraits.skipAttackRoll) {
        damage.damageRoll = r;
    }

    r.terms.forEach(term => {
        if (typeof term === "object" && term !== null) {
            let rfFace = weaponTraits.rfFace ? weaponTraits.rfFace : term.faces; // Without the Vengeful weapon trait rfFace is undefined
            term.results?.forEach(async result => {
                let dieResult = result.count ? result.count : result.result; // Result.count = actual value if modified by term
                if (result.active && dieResult >= rfFace) damage.righteousFury = _rollRighteousFury();
                if (result.active && dieResult < dos) damage.dices.push(dieResult);
                if (result.active && (typeof damage.minDice === "undefined" || dieResult < damage.minDice)) damage.minDice = dieResult;
            });
        }
    });
    return damage;
}

async function _computeUnitDamage(damageFormula, dos, weaponTraits) {
    let r = new Roll(damageFormula);
    r.evaluate({async: false});
    let damage = {
        total: r.total,
        righteousFury: 0,
        dices: [],
        dos: dos,
        formula: damageFormula,
        replaced: false,
        damageRender: await r.render()
    };
    r.terms.forEach(term => {
        if (typeof term === "object" && term !== null) {
            let rfFace = weaponTraits.rfFace ? weaponTraits.rfFace : term.faces; // Without the Vengeful weapon trait rfFace is undefined
            term.results?.forEach(async result => {
                let dieResult = result.count ? result.count : result.result; // Result.count = actual value if modified by term
                if (result.active && dieResult >= rfFace) damage.righteousFury = _rollRighteousFury();
                if (result.active && dieResult < dos) damage.dices.push(dieResult);
                if (result.active && (typeof damage.minDice === "undefined" || dieResult < damage.minDice)) damage.minDice = dieResult;
            });
        }
    });
    return damage;
}

async function _computeShipDamage(damageFormula, dos) {
    let r = new Roll(damageFormula);
    r.evaluate({async: false});
    let damage = {
        total: r.total,
        righteousFury: 0,
        dices: [],
        dos: dos,
        formula: damageFormula,
        replaced: false,
        damageRender: await r.render()
    };

    // Without a To Hit we a roll to associate the chat message with
    // if (weaponTraits.skipAttackRoll) {
    //   damage.damageRoll = r;
    // }

    // r.terms.forEach(term => {
    //   if (typeof term === "object" && term !== null) {
    //     let rfFace = weaponTraits.rfFace ? weaponTraits.rfFace : term.faces; // Without the Vengeful weapon trait rfFace is undefined
    //     term.results?.forEach(async result => {
    //       let dieResult = result.count ? result.count : result.result; // Result.count = actual value if modified by term
    //       if (result.active && dieResult >= rfFace) damage.righteousFury = _rollRighteousFury();
    //       if (result.active && dieResult < dos) damage.dices.push(dieResult);
    //       if (result.active && (typeof damage.minDice === "undefined" || dieResult < damage.minDice)) damage.minDice = dieResult;
    //     });
    //   }
    // });
    return damage;
}

/**
 * Evaluate final penetration, by leveraging the dice roll API.
 * @param {object} rollData
 * @returns {number}
 */
function _rollPenetration(rollData) {
    let penetration = (rollData.penetrationFormula) ? _replaceSymbols(rollData.penetrationFormula, rollData) : "0";
    let multiplier = 1;

    if (penetration.includes("(")) // Legacy Support
    {
        if (rollData.dos >= 3) {
            let rsValue = penetration.match(/\(\d+\)/gi); // Get Razorsharp Value
            penetration = penetration.replace(/\d+.*\(\d+\)/gi, rsValue); // Replace construct BaseValue(RazorsharpValue) with the extracted data
        }

    } else if (rollData.weaponTraits.razorSharp) {
        if (rollData.dos >= 3) {
            multiplier = 2;
        }
    }
    let r = new Roll(penetration.toString());
    r.evaluate({async: false});
    return r.total * multiplier;
}

function _rollUnitPenetration(rollData) {
    let penetration = rollData.penetrationFormula;
    let multiplier = 1;

    if (penetration.includes("(")) // Legacy Support
    {
        if (rollData.dos >= 3) {
            let rsValue = penetration.match(/\(\d+\)/gi); // Get Razorsharp Value
            penetration = penetration.replace(/\d+.*\(\d+\)/gi, rsValue); // Replace construct BaseValue(RazorsharpValue) with the extracted data
        }

    } else if (rollData.weaponTraits.razorSharp) {
        if (rollData.dos >= 3) {
            multiplier = 2;
        }
    }
    let r = new Roll(penetration.toString());
    r.evaluate({async: false});
    return r.total * multiplier;
}

/**
 * Roll a Righteous Fury dice, and return the value.
 * @returns {number}
 */
function _rollRighteousFury() {
    let r = new Roll("1d5");
    r.evaluate({async: false});
    return r.total;
}

/**
 * Check for psychic phenomena (i.e, the user rolled two matching numbers, etc.), and add the result to the rollData.
 * @param {object} rollData
 */
function _computePsychicPhenomena(rollData) {
    rollData.psy.hasPhenomena = rollData.psy.push ? !_isDouble(rollData.result) : _isDouble(rollData.result);
}

/**
 * Check if a number (d100 roll) has two matching digits.
 * @param {number} number
 * @returns {boolean}
 */
function _isDouble(number) {
    if (number === 100) {
        return true;
    } else {
        const digit = number % 10;
        return number - digit === digit * 10;
    }
}

/**
 * Get the hit location from a WS/BS roll.
 * @param {number} result
 * @returns {string}
 */
function _getLocation(result) {
    const toReverse = result < 10 ? `0${result}` : result.toString();
    const locationTarget = parseInt(toReverse.split("").reverse().join(""));
    if (locationTarget <= 10) {
        return "ARMOUR.HEAD";
    } else if (locationTarget <= 20) {
        return "ARMOUR.RIGHT_ARM";
    } else if (locationTarget <= 30) {
        return "ARMOUR.LEFT_ARM";
    } else if (locationTarget <= 70) {
        return "ARMOUR.BODY";
    } else if (locationTarget <= 85) {
        return "ARMOUR.RIGHT_LEG";
    } else if (locationTarget <= 100) {
        return "ARMOUR.LEFT_LEG";
    } else {
        return "ARMOUR.BODY";
    }
}

function _getShipLocation(result, attackedShip, sideOfAttack) {
    const toReverse = result < 10 ? `0${result}` : result.toString();
    const locationTarget = parseInt(toReverse.split("").reverse().join(""));
    if (attackedShip == "bigShip") {
        if (sideOfAttack == "prow") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 45) {
                return "HIT_SYSTEMS.PROW";
            } else if (locationTarget <= 60) {
                return "HIT_SYSTEMS.PORT";
            } else if (locationTarget <= 75) {
                return "HIT_SYSTEMS.STARBOARD";
            } else return "HIT_SYSTEMS.MAIN";
        }
        if (sideOfAttack == "port") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 15) {
                return "HIT_SYSTEMS.PROW";
            } else if (locationTarget <= 30) {
                return "HIT_SYSTEMS.AFT";
            } else if (locationTarget <= 60) {
                return "HIT_SYSTEMS.PORT";
            } else return "HIT_SYSTEMS.MAIN";
        }
        if (sideOfAttack == "starboard") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 15) {
                return "HIT_SYSTEMS.PROW";
            } else if (locationTarget <= 30) {
                return "HIT_SYSTEMS.AFT";
            } else if (locationTarget <= 60) {
                return "HIT_SYSTEMS.STARBOARD";
            } else return "HIT_SYSTEMS.MAIN";
        }
        if (sideOfAttack == "aft") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 45) {
                return "HIT_SYSTEMS.AFT";
            } else if (locationTarget <= 60) {
                return "HIT_SYSTEMS.PORT";
            } else if (locationTarget <= 75) {
                return "HIT_SYSTEMS.STARBOARD";
            } else return "HIT_SYSTEMS.MAIN";
        }
    } else if (attackedShip == "smallShip") {
        if (sideOfAttack == "prow") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 60) {
                return "HIT_SYSTEMS.PROW";
            } else return "HIT_SYSTEMS.MAIN";
        }
        if (sideOfAttack == "port") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 30) {
                return "HIT_SYSTEMS.PORT";
            } else if (locationTarget <= 50) {
                return "HIT_SYSTEMS.AFT";
            } else return "HIT_SYSTEMS.MAIN";
        }
        if (sideOfAttack == "starboard") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 30) {
                return "HIT_SYSTEMS.STARBOARD";
            } else if (locationTarget <= 50) {
                return "HIT_SYSTEMS.AFT";
            } else return "HIT_SYSTEMS.MAIN";
        }
        if (sideOfAttack == "aft") {
            if (locationTarget <= 5) {
                return "HIT_SYSTEMS.BRIDGE";
            } else if (locationTarget <= 60) {
                return "HIT_SYSTEMS.AFT";
            } else return "HIT_SYSTEMS.MAIN";
        }
    } else return "HIT_SYSTEMS.MAIN";
}

/**
 * Calculate modifiers/etc. from RoF type, and add them to the rollData.
 * @param {object} rollData
 */
function _computeRateOfFire(rollData) {
    rollData.maxAdditionalHit = 0;
    rollData.maxTwinLinkedHit = 0;
    let stormMod = rollData.weaponTraits.storm ? 2 : 1;
    // let stormMod = 1;
    // if (rollData.weaponTraits.storm || rollData.weaponTraits.twinLinked) {
    //   stormMod = 2;
    // }

    switch (rollData.attackType.name) {
        case "standard":
            rollData.attackType.modifier = 10;
            rollData.attackType.hitMargin = rollData.weaponTraits.storm ? 1 : 0;
            rollData.maxAdditionalHit = rollData.weaponTraits.storm ? 1 : 0;
            rollData.twinLinkedAdditionalHitMargin = rollData.weaponTraits.twinLinked ? 2 : 0;
            rollData.maxTwinLinkedHit = rollData.weaponTraits.twinLinked ? 1 : 0;
            break;

        case "bolt":
        case "blast":
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 0;
            break;

        case "swift":
        case "semi_auto":
        case "barrage":
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 2;
            rollData.maxAdditionalHit = (rollData.rateOfFire.burst * stormMod) - 1;
            rollData.twinLinkedAdditionalHitMargin = rollData.weaponTraits.twinLinked ? 3 : 0;
            rollData.maxTwinLinkedHit = rollData.rateOfFire.burst;
            break;

        case "lightning":
        case "full_auto":
            rollData.attackType.modifier = -10;
            rollData.attackType.hitMargin = 1;
            rollData.maxAdditionalHit = (rollData.rateOfFire.full * stormMod) - 1;
            rollData.twinLinkedAdditionalHitMargin = rollData.weaponTraits.twinLinked ? 2 : 0;
            rollData.maxTwinLinkedHit = rollData.rateOfFire.full;
            break;

        case "storm":
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 1;
            rollData.maxAdditionalHit = rollData.rateOfFire.full - 1;
            break;

        case "called_shot":
            rollData.attackType.modifier = -20;
            rollData.attackType.hitMargin = 0;
            break;

        case "charge":
            rollData.attackType.modifier = 20;
            rollData.attackType.hitMargin = 0;
            break;

        case "allOut":
            rollData.attackType.modifier = 30;
            rollData.attackType.hitMargin = 0;
            break;

        default:
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 0;
            break;
    }
}

const additionalHit = {
    head: ["ARMOUR.HEAD", "ARMOUR.RIGHT_ARM", "ARMOUR.BODY", "ARMOUR.LEFT_ARM", "ARMOUR.BODY"],
    rightArm: ["ARMOUR.RIGHT_ARM", "ARMOUR.RIGHT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY", "ARMOUR.RIGHT_ARM"],
    leftArm: ["ARMOUR.LEFT_ARM", "ARMOUR.LEFT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY", "ARMOUR.LEFT_ARM"],
    body: ["ARMOUR.BODY", "ARMOUR.RIGHT_ARM", "ARMOUR.HEAD", "ARMOUR.LEFT_ARM", "ARMOUR.BODY"],
    rightLeg: ["ARMOUR.RIGHT_LEG", "ARMOUR.BODY", "ARMOUR.RIGHT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY"],
    leftLeg: ["ARMOUR.LEFT_LEG", "ARMOUR.BODY", "ARMOUR.LEFT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY"]
};

/**
 * Get successive hit locations for an attack which scored multiple hits.
 * @param {string} firstLocation
 * @param {number} numberOfHit
 * @returns {string}
 */
function _getAdditionalLocation(firstLocation, numberOfHit) {
    if (firstLocation === "ARMOUR.HEAD") {
        return _getLocationByIt(additionalHit.head, numberOfHit);
    } else if (firstLocation === "ARMOUR.RIGHT_ARM") {
        return _getLocationByIt(additionalHit.rightArm, numberOfHit);
    } else if (firstLocation === "ARMOUR.LEFT_ARM") {
        return _getLocationByIt(additionalHit.leftArm, numberOfHit);
    } else if (firstLocation === "ARMOUR.BODY") {
        return _getLocationByIt(additionalHit.body, numberOfHit);
    } else if (firstLocation === "ARMOUR.RIGHT_LEG") {
        return _getLocationByIt(additionalHit.rightLeg, numberOfHit);
    } else if (firstLocation === "ARMOUR.LEFT_LEG") {
        return _getLocationByIt(additionalHit.leftLeg, numberOfHit);
    } else {
        return _getLocationByIt(additionalHit.body, numberOfHit);
    }
}

/**
 * Lookup hit location from array.
 * @param {Array} part
 * @param {number} numberOfHit
 * @returns {string}
 */
function _getLocationByIt(part, numberOfHit) {
    const index = numberOfHit > (part.length - 1) ? part.length - 1 : numberOfHit;
    return part[index];
}


/**
 * Get degrees of success/failure from a target and a roll.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function _getDegree(a, b) {
    return Math.floor(a / 10) - Math.floor(b / 10);
}

/**
 * Replaces all Symbols in the given Formula with their Respective Values
 * The Symbols consist of Attribute Boni and Psyrating
 * @param {*} formula
 * @param {*} rollData
 * @returns {string}
 */
function _replaceSymbols(formula, rollData) {
    if (rollData.psy) {
        formula = formula.replaceAll(/PR/gi, rollData.psy.value);
    }
    for (let boni of rollData.attributeBoni) {
        formula = formula.replaceAll(boni.regex, boni.value);
    }
    return formula;
}

/**
 * Add a special weapon modifier value to a roll formula.
 * @param {string} formula
 * @param {string} modifier
 * @param {number} value
 * @returns {string}
 */
function _appendNumberedDiceModifier(formula, modifier, value) {
    let diceRegex = /\d+d\d+/;
    if (!formula.includes(modifier)) {
        let match = formula.match(diceRegex);
        if (match) {
            let dice = match[0];
            dice += `${modifier}${value}`;
            formula = formula.replace(diceRegex, dice);
        }
    }
    return formula;
}

/**
 * Add the "tearing" special weapon modifier to a roll formula.
 * @param {string} formula
 * @returns {string}
 */
function _appendTearing(formula) {
    let diceRegex = /\d+d\d+/;
    if (!formula.match(/dl|kh/gi, formula)) { // Already has drop lowest or keep highest
        let match = formula.match(/\d+/g, formula);
        let numDice = parseInt(match[0]) + 1;
        let faces = parseInt(match[1]);
        let diceTerm = `${numDice}d${faces}dl`;
        formula = formula.replace(diceRegex, diceTerm);
    }
    return formula;
}

function _appendUnstable(formula) {
    let r = new Roll("d10");
    r.evaluate({async: false});
    if (r.total == 1) {
        formula = "(" + formula + ")/2";
    } else if (r.total == 10) {
        formula = "(" + formula + ")*2";
    }
    return formula;
}

/**
 * Post a roll to chat.
 * @param {object} rollData
 */
async function _sendToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        type: CONST.CHAT_MESSAGE_TYPES.ROLL,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "rogue-trader.rollData": rollData
        }
    };

    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }

    if (rollData.rollObject) {
        rollData.render = await rollData.rollObject.render();
        chatData.roll = rollData.rollObject;
    }

    const html = await renderTemplate("systems/rogue-trader/template/chat/roll.html", rollData);
    chatData.content = html;

    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }

    ChatMessage.create(chatData);
}

async function _sendShipToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        type: CONST.CHAT_MESSAGE_TYPES.ROLL,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "rogue-trader.rollData": rollData
        }
    };

    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }

    // if (rollData.rollObject) {
    //   rollData.render = await rollData.rollObject.render();
    //   chatData.roll = rollData.rollObject;
    // }

    const html = await renderTemplate("systems/rogue-trader/template/chat/ship-roll.html", rollData);
    chatData.content = html;

    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }

    ChatMessage.create(chatData);
}

async function _sendTurretsToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        type: CONST.CHAT_MESSAGE_TYPES.ROLL,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "rogue-trader.rollData": rollData
        }
    };

    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }

    const html = await renderTemplate("systems/rogue-trader/template/chat/ship-turrets.html", rollData);
    chatData.content = html;

    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }

    ChatMessage.create(chatData);
}

async function _sendUnitToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        type: CONST.CHAT_MESSAGE_TYPES.ROLL,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "rogue-trader.rollData": rollData
        }
    };

    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }

    // if (rollData.rollObject) {
    //     rollData.render = await rollData.rollObject.render();
    //     chatData.roll = rollData.rollObject;
    // }

    const html = await renderTemplate("systems/rogue-trader/template/chat/unit-roll.html", rollData);
    chatData.content = html;

    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }

    ChatMessage.create(chatData);
}

/**
 * Post a "you need to reload" message to chat.
 * @param {object} rollData
 */
async function _emptyClipToChat(rollData) {
    let chatData = {
        user: game.user.id,
        content: `
          <div class="rogue-trader chat roll">
              <div class="background border">
                  <p><strong>Reload! Out of Ammo!</strong></p>
              </div>
          </div>
        `
    };
    ChatMessage.create(chatData);
}