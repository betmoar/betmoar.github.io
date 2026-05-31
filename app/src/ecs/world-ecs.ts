import { World } from 'miniplex';

// miniplex ECS — the entity store the game systems share. M5a introduces traffic; pedestrians,
// police, the player, and job markers become components/archetypes here in later steps.
export interface Car {
  x: number; z: number; y: number; rot: number;
  axis: 0 | 1;        // 0 = drives along X (cross-street), 1 = along Z (avenue)
  dir: 1 | -1;
  spd: number;
  color: number;      // index into the car palette
  turnedAt: number | null;
}
export interface Ped {
  x: number; z: number; y: number; rot: number;
  dir: 1 | -1;        // walks ±Z along an avenue-side sidewalk
  spd: number;
  phase: number;      // walk-bob animation phase
  color: number;
}
export interface Entity { car?: Car; ped?: Ped }

export const ecs = new World<Entity>();
export const cars = ecs.with('car');
export const peds = ecs.with('ped');
